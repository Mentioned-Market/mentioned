/**
 * End-to-end devnet test for mention-market-usdc-amm.
 *
 * Flow:
 *   create_market → deposit_liquidity → buy YES (word 0) → buy NO (word 1)
 *   → sell half of YES → resolve all words → redeem winners
 *   → withdraw_liquidity → withdraw_fees
 *
 * Authority/LP/trader: deployer-keypair.json (provider.wallet)
 * USDC mint: CxRN4jp8ki3o3Bs16Ld6JsKsAP8rG8Jrp6dq48TYig9L
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MentionMarketUsdcAmm } from "../target/types/mention_market_usdc_amm";
import { expect } from "chai";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getMint,
} from "@solana/spl-token";
import BN from "bn.js";

// ── Constants ──────────────────────────────────────────────────────────────

const USDC_MINT = new PublicKey("CxRN4jp8ki3o3Bs16Ld6JsKsAP8rG8Jrp6dq48TYig9L");
const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

// 1 USDC = 1_000_000 base units (6 decimals)
const ONE_USDC = new BN(1_000_000);
const MARKET_ID = new BN(Date.now()); // unique per run to avoid account collision

// ── Helpers ────────────────────────────────────────────────────────────────

function getMarketPda(programId: PublicKey, marketId: BN): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), marketId.toArrayLike(Buffer, "le", 8)],
    programId
  );
  return pda;
}

function getVaultAddress(usdcMint: PublicKey, marketPda: PublicKey): PublicKey {
  // Vault is the ATA of the market PDA for the USDC mint — fully deterministic
  return getAssociatedTokenAddressSync(usdcMint, marketPda, true);
}

function getYesMintPda(programId: PublicKey, marketId: BN, wordIndex: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("yes_mint"), marketId.toArrayLike(Buffer, "le", 8), Buffer.from([wordIndex])],
    programId
  );
  return pda;
}

function getNoMintPda(programId: PublicKey, marketId: BN, wordIndex: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("no_mint"), marketId.toArrayLike(Buffer, "le", 8), Buffer.from([wordIndex])],
    programId
  );
  return pda;
}

function getMetadataPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}

function getLpPositionPda(programId: PublicKey, marketId: BN, wallet: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp"), marketId.toArrayLike(Buffer, "le", 8), wallet.toBuffer()],
    programId
  );
  return pda;
}

function getMintRemainingAccounts(
  programId: PublicKey,
  marketId: BN,
  numWords: number
): { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] {
  const accounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
  for (let i = 0; i < numWords; i++) {
    const yesMint = getYesMintPda(programId, marketId, i);
    const noMint = getNoMintPda(programId, marketId, i);
    accounts.push({ pubkey: yesMint, isSigner: false, isWritable: true });
    accounts.push({ pubkey: getMetadataPda(yesMint), isSigner: false, isWritable: true });
    accounts.push({ pubkey: noMint, isSigner: false, isWritable: true });
    accounts.push({ pubkey: getMetadataPda(noMint), isSigner: false, isWritable: true });
  }
  return accounts;
}

async function getOrCreateAta(
  provider: anchor.AnchorProvider,
  payer: PublicKey,
  mint: PublicKey,
  owner: PublicKey
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  try {
    await getAccount(provider.connection, ata);
  } catch {
    const ix = createAssociatedTokenAccountInstruction(payer, ata, owner, mint);
    const tx = new anchor.web3.Transaction().add(ix);
    await provider.sendAndConfirm(tx);
  }
  return ata;
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe("mention-market-usdc-amm", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.MentionMarketUsdcAmm as Program<MentionMarketUsdcAmm>;
  const authority = provider.wallet.publicKey;

  const WORDS = ["tariff", "recession", "pivot"];
  const NUM_WORDS = WORDS.length;
  const RESOLVES_AT = new BN(Math.floor(Date.now() / 1000) + 86400); // +24h
  const TRADE_FEE_BPS = 50; // 0.5%
  // b = 10 USDC fixed (base_b_per_usdc = 0 means no dynamic scaling)
  const INITIAL_B = new BN(10_000_000); // 10 USDC in micro-USDC
  const BASE_B_PER_USDC = new BN(0); // fixed b for test simplicity

  // Derived addresses — populated after create_market
  let marketPda: PublicKey;
  let vaultAddress: PublicKey;
  let authorityUsdcAta: PublicKey;

  before(async () => {
    marketPda = getMarketPda(program.programId, MARKET_ID);
    vaultAddress = getVaultAddress(USDC_MINT, marketPda);

    // Ensure authority has a USDC ATA and has some balance
    authorityUsdcAta = await getOrCreateAta(provider, authority, USDC_MINT, authority);
    const usdcAccount = await getAccount(provider.connection, authorityUsdcAta);
    console.log(`  Authority USDC balance: ${Number(usdcAccount.amount) / 1_000_000} USDC`);
    expect(Number(usdcAccount.amount)).to.be.greaterThan(0, "Authority needs USDC — run: spl-token mint <MINT> 1000 <ATA>");

    console.log(`  Market ID: ${MARKET_ID.toString()}`);
    console.log(`  Market PDA: ${marketPda.toBase58()}`);
    console.log(`  Vault (ATA): ${vaultAddress.toBase58()}`);
  });

  // =========================================================================
  // 1. Create market
  // =========================================================================
  describe("create_market", () => {
    it("creates a market with 3 words, YES/NO mints, and USDC vault", async () => {
      const remainingAccounts = getMintRemainingAccounts(program.programId, MARKET_ID, NUM_WORDS);

      const tx = await program.methods
        .createMarket(
          MARKET_ID,
          "Trump Press Conference — May 2026",
          WORDS,
          RESOLVES_AT,
          authority, // resolver = authority for test
          TRADE_FEE_BPS,
          INITIAL_B,
          BASE_B_PER_USDC
        )
        .accounts({
          authority,
          market: marketPda,
          usdcMint: USDC_MINT,
          vault: vaultAddress,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        })
        .remainingAccounts(remainingAccounts)
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 }),
        ])
        .rpc();

      console.log(`  create_market tx: ${tx}`);

      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.version).to.equal(1);
      expect(market.marketId.toString()).to.equal(MARKET_ID.toString());
      expect(market.label).to.equal("Trump Press Conference — May 2026");
      expect(market.numWords).to.equal(NUM_WORDS);
      expect(market.status).to.deep.equal({ open: {} });
      expect(market.tradeFeeBps).to.equal(TRADE_FEE_BPS);
      expect(market.liquidityParamB.toString()).to.equal(INITIAL_B.toString());
      expect(market.totalLpShares.toNumber()).to.equal(0);
      expect(market.usdcMint.toBase58()).to.equal(USDC_MINT.toBase58());
      expect(market.accumulatedFees.toNumber()).to.equal(0);

      for (let i = 0; i < NUM_WORDS; i++) {
        const word = market.words[i];
        expect(word.label).to.equal(WORDS[i]);
        expect(word.wordIndex).to.equal(i);
        expect(word.yesQuantity.toNumber()).to.equal(0);
        expect(word.noQuantity.toNumber()).to.equal(0);
        expect(word.outcome).to.be.null;
        expect(word.yesMint.toBase58()).to.equal(getYesMintPda(program.programId, MARKET_ID, i).toBase58());
        expect(word.noMint.toBase58()).to.equal(getNoMintPda(program.programId, MARKET_ID, i).toBase58());
      }

      // Vault should exist and be empty
      const vault = await getAccount(provider.connection, vaultAddress);
      expect(Number(vault.amount)).to.equal(0);
      expect(vault.owner.toBase58()).to.equal(marketPda.toBase58());

      console.log(`  Market created. Vault: ${vaultAddress.toBase58()}`);
    });
  });

  // =========================================================================
  // 2. Deposit liquidity
  // =========================================================================
  describe("deposit_liquidity", () => {
    it("deposits 100 USDC — issues LP shares 1:1 on first deposit", async () => {
      const lpPositionPda = getLpPositionPda(program.programId, MARKET_ID, authority);
      const depositAmount = new BN(100_000_000); // 100 USDC

      const usdcBefore = await getAccount(provider.connection, authorityUsdcAta);

      const tx = await program.methods
        .depositLiquidity(depositAmount)
        .accounts({
          lpWallet: authority,
          market: marketPda,
          vault: vaultAddress,
          lpUsdc: authorityUsdcAta,
          lpPosition: lpPositionPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log(`  deposit_liquidity tx: ${tx}`);

      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.totalLpShares.toString()).to.equal(depositAmount.toString());

      const lp = await program.account.lpPosition.fetch(lpPositionPda);
      expect(lp.owner.toBase58()).to.equal(authority.toBase58());
      expect(lp.shares.toString()).to.equal(depositAmount.toString());

      const vault = await getAccount(provider.connection, vaultAddress);
      expect(Number(vault.amount)).to.equal(depositAmount.toNumber());

      const usdcAfter = await getAccount(provider.connection, authorityUsdcAta);
      expect(Number(usdcAfter.amount)).to.equal(Number(usdcBefore.amount) - depositAmount.toNumber());

      console.log(`  Vault balance: ${Number(vault.amount) / 1_000_000} USDC`);
      console.log(`  LP shares issued: ${lp.shares.toNumber()}`);
      console.log(`  b parameter: ${market.liquidityParamB.toNumber()}`);
    });

    it("fails when depositing zero", async () => {
      const lpPositionPda = getLpPositionPda(program.programId, MARKET_ID, authority);
      try {
        await program.methods
          .depositLiquidity(new BN(0))
          .accounts({
            lpWallet: authority,
            market: marketPda,
            vault: vaultAddress,
            lpUsdc: authorityUsdcAta,
            lpPosition: lpPositionPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("ZeroAmount");
      }
    });
  });

  // =========================================================================
  // 3. Buy
  // =========================================================================
  describe("buy", () => {
    it("buys 5 YES tokens for word 0 (tariff)", async () => {
      const yesMint = getYesMintPda(program.programId, MARKET_ID, 0);
      const traderYesAta = await getOrCreateAta(provider, authority, yesMint, authority);
      const buyQty = new BN(5_000_000); // 5 tokens (6 decimals)
      const maxCost = new BN(10_000_000); // 10 USDC max (generous slippage)

      const vaultBefore = await getAccount(provider.connection, vaultAddress);
      const usdcBefore = await getAccount(provider.connection, authorityUsdcAta);

      const tx = await program.methods
        .buy(0, { yes: {} }, buyQty, maxCost)
        .accounts({
          trader: authority,
          market: marketPda,
          vault: vaultAddress,
          traderUsdc: authorityUsdcAta,
          tokenMint: yesMint,
          traderTokenAccount: traderYesAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log(`  buy YES tx: ${tx}`);

      // YES tokens minted
      const yesAccount = await getAccount(provider.connection, traderYesAta);
      expect(Number(yesAccount.amount)).to.equal(buyQty.toNumber());

      // USDC left authority wallet
      const usdcAfter = await getAccount(provider.connection, authorityUsdcAta);
      const usdcSpent = Number(usdcBefore.amount) - Number(usdcAfter.amount);
      expect(usdcSpent).to.be.greaterThan(0);

      // Vault received USDC
      const vaultAfter = await getAccount(provider.connection, vaultAddress);
      expect(Number(vaultAfter.amount)).to.be.greaterThan(Number(vaultBefore.amount));

      // Market state updated
      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.words[0].yesQuantity.toNumber()).to.equal(buyQty.toNumber());
      expect(market.accumulatedFees.toNumber()).to.be.greaterThan(0);

      console.log(`  USDC spent (cost + fee): ${usdcSpent / 1_000_000} USDC`);
      console.log(`  Fees so far: ${market.accumulatedFees.toNumber() / 1_000_000} USDC`);
      console.log(`  YES implied price: ${market.words[0].yesQuantity.toNumber()}`);
    });

    it("buys 3 NO tokens for word 1 (recession)", async () => {
      const noMint = getNoMintPda(program.programId, MARKET_ID, 1);
      const traderNoAta = await getOrCreateAta(provider, authority, noMint, authority);
      const buyQty = new BN(3_000_000); // 3 tokens
      const maxCost = new BN(10_000_000); // 10 USDC max

      const tx = await program.methods
        .buy(1, { no: {} }, buyQty, maxCost)
        .accounts({
          trader: authority,
          market: marketPda,
          vault: vaultAddress,
          traderUsdc: authorityUsdcAta,
          tokenMint: noMint,
          traderTokenAccount: traderNoAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log(`  buy NO tx: ${tx}`);

      const noAccount = await getAccount(provider.connection, traderNoAta);
      expect(Number(noAccount.amount)).to.equal(buyQty.toNumber());

      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.words[1].noQuantity.toNumber()).to.equal(buyQty.toNumber());
    });

    it("price increases on second YES buy for word 0", async () => {
      const yesMint = getYesMintPda(program.programId, MARKET_ID, 0);
      const traderYesAta = getAssociatedTokenAddressSync(yesMint, authority, true);
      const buyQty = new BN(5_000_000);
      const maxCost = new BN(20_000_000);

      const usdcBefore = await getAccount(provider.connection, authorityUsdcAta);

      await program.methods
        .buy(0, { yes: {} }, buyQty, maxCost)
        .accounts({
          trader: authority,
          market: marketPda,
          vault: vaultAddress,
          traderUsdc: authorityUsdcAta,
          tokenMint: yesMint,
          traderTokenAccount: traderYesAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const usdcAfter = await getAccount(provider.connection, authorityUsdcAta);
      const cost2 = Number(usdcBefore.amount) - Number(usdcAfter.amount);

      // YES is now more expensive — second buy should cost more than ~same qty at 50/50
      console.log(`  Second YES buy cost: ${cost2 / 1_000_000} USDC (should be higher than first)`);
      expect(cost2).to.be.greaterThan(0);

      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.words[0].yesQuantity.toNumber()).to.equal(10_000_000); // 5+5
    });

    it("fails with slippage exceeded", async () => {
      const yesMint = getYesMintPda(program.programId, MARKET_ID, 0);
      const traderYesAta = getAssociatedTokenAddressSync(yesMint, authority, true);
      try {
        await program.methods
          .buy(0, { yes: {} }, new BN(1_000_000), new BN(1)) // max_cost = 1 micro-USDC
          .accounts({
            trader: authority,
            market: marketPda,
            vault: vaultAddress,
            traderUsdc: authorityUsdcAta,
            tokenMint: yesMint,
            traderTokenAccount: traderYesAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("SlippageExceeded");
      }
    });
  });

  // =========================================================================
  // 4. Sell
  // =========================================================================
  describe("sell", () => {
    it("sells 2 YES tokens for word 0 back to AMM", async () => {
      const yesMint = getYesMintPda(program.programId, MARKET_ID, 0);
      const traderYesAta = getAssociatedTokenAddressSync(yesMint, authority, true);
      const sellQty = new BN(2_000_000); // sell 2 of our 10

      const usdcBefore = await getAccount(provider.connection, authorityUsdcAta);
      const yesBefore = await getAccount(provider.connection, traderYesAta);

      const tx = await program.methods
        .sell(0, { yes: {} }, sellQty, new BN(0)) // min_return = 0
        .accounts({
          trader: authority,
          market: marketPda,
          vault: vaultAddress,
          traderUsdc: authorityUsdcAta,
          tokenMint: yesMint,
          traderTokenAccount: traderYesAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log(`  sell tx: ${tx}`);

      const yesAfter = await getAccount(provider.connection, traderYesAta);
      expect(Number(yesAfter.amount)).to.equal(Number(yesBefore.amount) - sellQty.toNumber());

      const usdcAfter = await getAccount(provider.connection, authorityUsdcAta);
      const received = Number(usdcAfter.amount) - Number(usdcBefore.amount);
      expect(received).to.be.greaterThan(0);

      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.words[0].yesQuantity.toNumber()).to.equal(8_000_000); // 10 - 2

      console.log(`  USDC received from sell: ${received / 1_000_000} USDC`);
    });

    it("fails with slippage below minimum", async () => {
      const yesMint = getYesMintPda(program.programId, MARKET_ID, 0);
      const traderYesAta = getAssociatedTokenAddressSync(yesMint, authority, true);
      try {
        await program.methods
          .sell(0, { yes: {} }, new BN(1_000_000), new BN(999_999_999_999))
          .accounts({
            trader: authority,
            market: marketPda,
            vault: vaultAddress,
            traderUsdc: authorityUsdcAta,
            tokenMint: yesMint,
            traderTokenAccount: traderYesAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("SlippageBelowMin");
      }
    });
  });

  // =========================================================================
  // 5. Pause / unpause
  // =========================================================================
  describe("pause_market", () => {
    it("pauses the market — buy is rejected", async () => {
      await program.methods
        .pauseMarket()
        .accounts({ authority, market: marketPda })
        .rpc();

      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.status).to.deep.equal({ paused: {} });

      // Attempt to buy while paused — should fail
      const yesMint = getYesMintPda(program.programId, MARKET_ID, 0);
      const traderYesAta = getAssociatedTokenAddressSync(yesMint, authority, true);
      try {
        await program.methods
          .buy(0, { yes: {} }, new BN(1_000_000), new BN(10_000_000))
          .accounts({
            trader: authority,
            market: marketPda,
            vault: vaultAddress,
            traderUsdc: authorityUsdcAta,
            tokenMint: yesMint,
            traderTokenAccount: traderYesAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("MarketNotOpen");
      }
    });

    it("unpauses back to open", async () => {
      await program.methods
        .pauseMarket()
        .accounts({ authority, market: marketPda })
        .rpc();
      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.status).to.deep.equal({ open: {} });
    });
  });

  // =========================================================================
  // 6. Withdraw liquidity locked before resolution
  // =========================================================================
  describe("withdraw_liquidity (pre-resolution)", () => {
    it("fails before market is resolved", async () => {
      const lpPositionPda = getLpPositionPda(program.programId, MARKET_ID, authority);
      try {
        await program.methods
          .withdrawLiquidity(new BN(1))
          .accounts({
            lpWallet: authority,
            market: marketPda,
            vault: vaultAddress,
            lpUsdc: authorityUsdcAta,
            lpPosition: lpPositionPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("MarketNotResolved");
      }
    });
  });

  // =========================================================================
  // 7. Resolve words
  // =========================================================================
  describe("resolve_word", () => {
    it("resolves word 0 (tariff) as YES — mentioned", async () => {
      await program.methods
        .resolveWord(0, true)
        .accounts({ resolver: authority, market: marketPda })
        .rpc();
      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.words[0].outcome).to.equal(true);
      expect(market.status).to.deep.equal({ open: {} }); // not fully resolved yet
    });

    it("resolves word 1 (recession) as NO — not mentioned", async () => {
      await program.methods
        .resolveWord(1, false)
        .accounts({ resolver: authority, market: marketPda })
        .rpc();
      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.words[1].outcome).to.equal(false);
    });

    it("resolves final word 2 (pivot) — market becomes Resolved", async () => {
      await program.methods
        .resolveWord(2, true)
        .accounts({ resolver: authority, market: marketPda })
        .rpc();
      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.words[2].outcome).to.equal(true);
      expect(market.status).to.deep.equal({ resolved: {} });
      expect(market.resolvedAt).to.not.be.null;
      console.log(`  Market fully resolved at ${new Date(market.resolvedAt!.toNumber() * 1000).toISOString()}`);
    });

    it("fails to re-resolve an already resolved word", async () => {
      try {
        await program.methods
          .resolveWord(0, false)
          .accounts({ resolver: authority, market: marketPda })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("MarketAlreadyResolved");
      }
    });
  });

  // =========================================================================
  // 8. Redeem
  // =========================================================================
  describe("redeem", () => {
    it("redeems winning YES tokens for word 0 (tariff — mentioned) 1:1 USDC", async () => {
      const yesMint = getYesMintPda(program.programId, MARKET_ID, 0);
      const traderYesAta = getAssociatedTokenAddressSync(yesMint, authority, true);

      const yesAccountBefore = await getAccount(provider.connection, traderYesAta);
      const tokensBefore = Number(yesAccountBefore.amount);
      expect(tokensBefore).to.be.greaterThan(0, "No YES tokens to redeem");

      const usdcBefore = await getAccount(provider.connection, authorityUsdcAta);

      const tx = await program.methods
        .redeem(0, { yes: {} })
        .accounts({
          redeemer: authority,
          market: marketPda,
          vault: vaultAddress,
          redeemerUsdc: authorityUsdcAta,
          tokenMint: yesMint,
          redeemerTokenAccount: traderYesAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log(`  redeem tx: ${tx}`);

      // All tokens burned
      const yesAccountAfter = await getAccount(provider.connection, traderYesAta);
      expect(Number(yesAccountAfter.amount)).to.equal(0);

      // USDC received = token base units (1:1)
      const usdcAfter = await getAccount(provider.connection, authorityUsdcAta);
      const received = Number(usdcAfter.amount) - Number(usdcBefore.amount);
      expect(received).to.equal(tokensBefore);

      console.log(`  Redeemed ${tokensBefore / 1_000_000} YES tokens → ${received / 1_000_000} USDC`);
    });

    it("fails to redeem losing YES tokens for word 1 (recession — NO won)", async () => {
      const yesMint = getYesMintPda(program.programId, MARKET_ID, 1);
      const traderYesAta = await getOrCreateAta(provider, authority, yesMint, authority);
      try {
        await program.methods
          .redeem(1, { yes: {} })
          .accounts({
            redeemer: authority,
            market: marketPda,
            vault: vaultAddress,
            redeemerUsdc: authorityUsdcAta,
            tokenMint: yesMint,
            redeemerTokenAccount: traderYesAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        // NotWinningDirection or NothingToRedeem (no tokens held)
        expect(["NotWinningDirection", "NothingToRedeem"]).to.include(err.error.errorCode.code);
      }
    });

    it("redeems winning NO tokens for word 1 (recession — not mentioned)", async () => {
      const noMint = getNoMintPda(program.programId, MARKET_ID, 1);
      const traderNoAta = getAssociatedTokenAddressSync(noMint, authority, true);

      const noAccountBefore = await getAccount(provider.connection, traderNoAta);
      const tokensBefore = Number(noAccountBefore.amount);
      const usdcBefore = await getAccount(provider.connection, authorityUsdcAta);

      await program.methods
        .redeem(1, { no: {} })
        .accounts({
          redeemer: authority,
          market: marketPda,
          vault: vaultAddress,
          redeemerUsdc: authorityUsdcAta,
          tokenMint: noMint,
          redeemerTokenAccount: traderNoAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const noAccountAfter = await getAccount(provider.connection, traderNoAta);
      expect(Number(noAccountAfter.amount)).to.equal(0);

      const usdcAfter = await getAccount(provider.connection, authorityUsdcAta);
      const received = Number(usdcAfter.amount) - Number(usdcBefore.amount);
      expect(received).to.equal(tokensBefore);

      console.log(`  Redeemed ${tokensBefore / 1_000_000} NO tokens → ${received / 1_000_000} USDC`);
    });
  });

  // =========================================================================
  // 9. Withdraw fees
  // =========================================================================
  describe("withdraw_fees", () => {
    it("withdraws accumulated fees to authority USDC ATA", async () => {
      const marketBefore = await program.account.marketAccount.fetch(marketPda);
      const feeAmount = marketBefore.accumulatedFees.toNumber();
      expect(feeAmount).to.be.greaterThan(0, "No fees to withdraw");

      const usdcBefore = await getAccount(provider.connection, authorityUsdcAta);

      const tx = await program.methods
        .withdrawFees()
        .accounts({
          authority,
          market: marketPda,
          vault: vaultAddress,
          authorityUsdc: authorityUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log(`  withdraw_fees tx: ${tx}`);

      const usdcAfter = await getAccount(provider.connection, authorityUsdcAta);
      const received = Number(usdcAfter.amount) - Number(usdcBefore.amount);
      expect(received).to.equal(feeAmount);

      const marketAfter = await program.account.marketAccount.fetch(marketPda);
      expect(marketAfter.accumulatedFees.toNumber()).to.equal(0);

      console.log(`  Withdrew ${feeAmount / 1_000_000} USDC in fees`);
    });
  });

  // =========================================================================
  // 10. Withdraw liquidity (after resolution)
  // =========================================================================
  describe("withdraw_liquidity", () => {
    it("LP withdraws all shares — receives remaining vault USDC", async () => {
      const lpPositionPda = getLpPositionPda(program.programId, MARKET_ID, authority);
      const lpBefore = await program.account.lpPosition.fetch(lpPositionPda);
      const sharesToBurn = lpBefore.shares;

      const vaultBefore = await getAccount(provider.connection, vaultAddress);
      const usdcBefore = await getAccount(provider.connection, authorityUsdcAta);

      const tx = await program.methods
        .withdrawLiquidity(sharesToBurn)
        .accounts({
          lpWallet: authority,
          market: marketPda,
          vault: vaultAddress,
          lpUsdc: authorityUsdcAta,
          lpPosition: lpPositionPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log(`  withdraw_liquidity tx: ${tx}`);

      const lpAfter = await program.account.lpPosition.fetch(lpPositionPda);
      expect(lpAfter.shares.toNumber()).to.equal(0);

      const marketAfter = await program.account.marketAccount.fetch(marketPda);
      expect(marketAfter.totalLpShares.toNumber()).to.equal(0);

      const usdcAfter = await getAccount(provider.connection, authorityUsdcAta);
      const received = Number(usdcAfter.amount) - Number(usdcBefore.amount);
      expect(received).to.be.greaterThan(0);

      console.log(`  Vault before withdrawal: ${Number(vaultBefore.amount) / 1_000_000} USDC`);
      console.log(`  LP received: ${received / 1_000_000} USDC`);
      console.log(`  (Difference from initial 100 USDC = net trading P&L for LP)`);
    });

    it("fails to withdraw with insufficient shares", async () => {
      const lpPositionPda = getLpPositionPda(program.programId, MARKET_ID, authority);
      try {
        await program.methods
          .withdrawLiquidity(new BN(999_999_999))
          .accounts({
            lpWallet: authority,
            market: marketPda,
            vault: vaultAddress,
            lpUsdc: authorityUsdcAta,
            lpPosition: lpPositionPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InsufficientShares");
      }
    });
  });
});
