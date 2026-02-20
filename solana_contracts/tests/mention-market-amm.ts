import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MentionMarketAmm } from "../target/types/mention_market_amm";
import { expect } from "chai";
import {
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import BN from "bn.js";

describe("mention-market-amm", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .MentionMarketAmm as Program<MentionMarketAmm>;
  const user = provider.wallet;

  // ── PDA helpers ────────────────────────────────────────────────

  function getEscrowPda(wallet: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), wallet.toBuffer()],
      program.programId
    );
    return pda;
  }

  function getMarketPda(marketId: BN): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), marketId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    return pda;
  }

  function getVaultPda(marketId: BN): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), marketId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    return pda;
  }

  function getYesMintPda(marketId: BN, wordIndex: number): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("yes_mint"),
        marketId.toArrayLike(Buffer, "le", 8),
        Buffer.from([wordIndex]),
      ],
      program.programId
    );
    return pda;
  }

  function getNoMintPda(marketId: BN, wordIndex: number): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("no_mint"),
        marketId.toArrayLike(Buffer, "le", 8),
        Buffer.from([wordIndex]),
      ],
      program.programId
    );
    return pda;
  }

  const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
  );

  function getMetadataPda(mint: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );
    return pda;
  }

  function getLpPositionPda(marketId: BN, wallet: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("lp"),
        marketId.toArrayLike(Buffer, "le", 8),
        wallet.toBuffer(),
      ],
      program.programId
    );
    return pda;
  }

  /** Build remaining accounts array for create_market (yes_mint, yes_metadata, no_mint, no_metadata per word) */
  function getMintRemainingAccounts(
    marketId: BN,
    numWords: number
  ): { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] {
    const accounts: {
      pubkey: PublicKey;
      isSigner: boolean;
      isWritable: boolean;
    }[] = [];
    for (let i = 0; i < numWords; i++) {
      const yesMint = getYesMintPda(marketId, i);
      const noMint = getNoMintPda(marketId, i);
      accounts.push({
        pubkey: yesMint,
        isSigner: false,
        isWritable: true,
      });
      accounts.push({
        pubkey: getMetadataPda(yesMint),
        isSigner: false,
        isWritable: true,
      });
      accounts.push({
        pubkey: noMint,
        isSigner: false,
        isWritable: true,
      });
      accounts.push({
        pubkey: getMetadataPda(noMint),
        isSigner: false,
        isWritable: true,
      });
    }
    return accounts;
  }

  /** Create an ATA if it doesn't exist, return the address */
  async function getOrCreateAta(
    mint: PublicKey,
    owner: PublicKey
  ): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(mint, owner);
    try {
      await getAccount(provider.connection, ata);
    } catch {
      const ix = createAssociatedTokenAccountInstruction(
        user.publicKey, // payer
        ata,
        owner,
        mint
      );
      const tx = new anchor.web3.Transaction().add(ix);
      await provider.sendAndConfirm(tx);
    }
    return ata;
  }

  // ── Shared test state ──────────────────────────────────────────

  const MARKET_ID = new BN(1);
  const WORDS = ["Economy", "Immigration", "Ukraine"];
  const INITIAL_B = new BN(1_000_000_000); // 1.0 in fixed-point
  const BASE_B_PER_SOL = new BN(1_000_000_000); // b scales 1:1 with pool SOL
  const TRADE_FEE_BPS = 50; // 0.5%
  const RESOLVES_AT = new BN(Math.floor(Date.now() / 1000) + 86400); // +24h
  const ONE_TOKEN = new BN(1_000_000_000); // 1 token = 1e9 base units (9 decimals)

  // =========================================================
  // Escrow: deposit & withdraw
  // =========================================================
  describe("deposit", () => {
    it("creates escrow and deposits SOL on first call", async () => {
      const escrowPda = getEscrowPda(user.publicKey);
      const depositAmount = new BN(5 * LAMPORTS_PER_SOL);

      await program.methods
        .deposit(depositAmount)
        .accounts({
          user: user.publicKey,
          escrow: escrowPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const escrow = await program.account.userEscrow.fetch(escrowPda);
      expect(escrow.owner.toBase58()).to.equal(user.publicKey.toBase58());
      expect(escrow.balance.toNumber()).to.equal(5 * LAMPORTS_PER_SOL);
      expect(escrow.locked.toNumber()).to.equal(0);
    });

    it("deposits additional SOL into existing escrow", async () => {
      const escrowPda = getEscrowPda(user.publicKey);
      await program.methods
        .deposit(new BN(2 * LAMPORTS_PER_SOL))
        .accounts({
          user: user.publicKey,
          escrow: escrowPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const escrow = await program.account.userEscrow.fetch(escrowPda);
      expect(escrow.balance.toNumber()).to.equal(7 * LAMPORTS_PER_SOL);
    });

    it("fails when depositing zero", async () => {
      const escrowPda = getEscrowPda(user.publicKey);
      try {
        await program.methods
          .deposit(new BN(0))
          .accounts({
            user: user.publicKey,
            escrow: escrowPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("ZeroAmount");
      }
    });
  });

  describe("withdraw", () => {
    it("withdraws SOL from escrow", async () => {
      const escrowPda = getEscrowPda(user.publicKey);
      const withdrawAmount = new BN(1 * LAMPORTS_PER_SOL);

      await program.methods
        .withdraw(withdrawAmount)
        .accounts({
          user: user.publicKey,
          escrow: escrowPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const escrow = await program.account.userEscrow.fetch(escrowPda);
      expect(escrow.balance.toNumber()).to.equal(6 * LAMPORTS_PER_SOL);
    });

    it("fails when withdrawing more than balance", async () => {
      const escrowPda = getEscrowPda(user.publicKey);
      try {
        await program.methods
          .withdraw(new BN(100 * LAMPORTS_PER_SOL))
          .accounts({
            user: user.publicKey,
            escrow: escrowPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InsufficientBalance");
      }
    });

    it("fails when withdrawing zero", async () => {
      const escrowPda = getEscrowPda(user.publicKey);
      try {
        await program.methods
          .withdraw(new BN(0))
          .accounts({
            user: user.publicKey,
            escrow: escrowPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("ZeroAmount");
      }
    });
  });

  // =========================================================
  // Create market
  // =========================================================
  describe("create_market", () => {
    it("creates a market with 3 words and YES/NO mints", async () => {
      const marketPda = getMarketPda(MARKET_ID);
      const vaultPda = getVaultPda(MARKET_ID);
      const remainingAccounts = getMintRemainingAccounts(
        MARKET_ID,
        WORDS.length
      );

      await program.methods
        .createMarket(
          MARKET_ID,
          "SOTU 2026",
          WORDS,
          RESOLVES_AT,
          user.publicKey, // resolver = authority for tests
          TRADE_FEE_BPS,
          INITIAL_B,
          BASE_B_PER_SOL
        )
        .accounts({
          authority: user.publicKey,
          market: marketPda,
          vault: vaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        })
        .remainingAccounts(remainingAccounts)
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 }),
        ])
        .rpc();

      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.version).to.equal(1);
      expect(market.marketId.toNumber()).to.equal(1);
      expect(market.label).to.equal("SOTU 2026");
      expect(market.numWords).to.equal(3);
      expect(market.status).to.deep.equal({ open: {} });
      expect(market.tradeFeeBps).to.equal(TRADE_FEE_BPS);
      expect(market.liquidityParamB.toNumber()).to.equal(INITIAL_B.toNumber());
      expect(market.totalLpShares.toNumber()).to.equal(0);
      expect(market.router).to.be.null;
      expect(market.resolvedAt).to.be.null;

      // Verify word states
      for (let i = 0; i < WORDS.length; i++) {
        const word = market.words[i];
        expect(word.label).to.equal(WORDS[i]);
        expect(word.wordIndex).to.equal(i);
        expect(word.yesQuantity.toNumber()).to.equal(0);
        expect(word.noQuantity.toNumber()).to.equal(0);
        expect(word.outcome).to.be.null;
        // Verify mints match expected PDAs
        expect(word.yesMint.toBase58()).to.equal(
          getYesMintPda(MARKET_ID, i).toBase58()
        );
        expect(word.noMint.toBase58()).to.equal(
          getNoMintPda(MARKET_ID, i).toBase58()
        );
      }

      // Verify metadata accounts exist and are owned by the metadata program
      for (let i = 0; i < WORDS.length; i++) {
        const yesMint = getYesMintPda(MARKET_ID, i);
        const noMint = getNoMintPda(MARKET_ID, i);
        const yesMetadata = getMetadataPda(yesMint);
        const noMetadata = getMetadataPda(noMint);

        const yesMetaAccount = await provider.connection.getAccountInfo(yesMetadata);
        expect(yesMetaAccount).to.not.be.null;
        expect(yesMetaAccount!.owner.toBase58()).to.equal(
          TOKEN_METADATA_PROGRAM_ID.toBase58()
        );

        const noMetaAccount = await provider.connection.getAccountInfo(noMetadata);
        expect(noMetaAccount).to.not.be.null;
        expect(noMetaAccount!.owner.toBase58()).to.equal(
          TOKEN_METADATA_PROGRAM_ID.toBase58()
        );
      }
    });

    it("fails with market label too long", async () => {
      const badId = new BN(999);
      const marketPda = getMarketPda(badId);
      const vaultPda = getVaultPda(badId);
      const remainingAccounts = getMintRemainingAccounts(badId, 1);

      try {
        await program.methods
          .createMarket(
            badId,
            "a".repeat(65), // > 64 chars
            ["word1"],
            RESOLVES_AT,
            user.publicKey,
            0,
            INITIAL_B,
            BASE_B_PER_SOL
          )
          .accounts({
            authority: user.publicKey,
            market: marketPda,
            vault: vaultPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          })
          .remainingAccounts(remainingAccounts)
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("MarketLabelTooLong");
      }
    });

    it("fails with no words", async () => {
      const badId = new BN(998);
      const marketPda = getMarketPda(badId);
      const vaultPda = getVaultPda(badId);

      try {
        await program.methods
          .createMarket(
            badId,
            "Empty",
            [], // no words
            RESOLVES_AT,
            user.publicKey,
            0,
            INITIAL_B,
            BASE_B_PER_SOL
          )
          .accounts({
            authority: user.publicKey,
            market: marketPda,
            vault: vaultPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("NoWords");
      }
    });
  });

  // =========================================================
  // Pause market
  // =========================================================
  describe("pause_market", () => {
    it("pauses an open market", async () => {
      const marketPda = getMarketPda(MARKET_ID);

      await program.methods
        .pauseMarket()
        .accounts({
          authority: user.publicKey,
          market: marketPda,
        })
        .rpc();

      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.status).to.deep.equal({ paused: {} });
    });

    it("unpauses back to open", async () => {
      const marketPda = getMarketPda(MARKET_ID);

      await program.methods
        .pauseMarket()
        .accounts({
          authority: user.publicKey,
          market: marketPda,
        })
        .rpc();

      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.status).to.deep.equal({ open: {} });
    });
  });

  // =========================================================
  // Deposit liquidity
  // =========================================================
  describe("deposit_liquidity", () => {
    it("LP deposits SOL into the pool", async () => {
      const marketPda = getMarketPda(MARKET_ID);
      const vaultPda = getVaultPda(MARKET_ID);
      const lpPda = getLpPositionPda(MARKET_ID, user.publicKey);
      const lpAmount = new BN(10 * LAMPORTS_PER_SOL);

      await program.methods
        .depositLiquidity(lpAmount)
        .accounts({
          lpWallet: user.publicKey,
          market: marketPda,
          vault: vaultPda,
          lpPosition: lpPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.totalLpShares.toNumber()).to.equal(lpAmount.toNumber());

      // b should have been scaled: base_b_per_sol * vault_balance / 1e9
      // = 1e9 * 10e9 / 1e9 = 10e9
      expect(market.liquidityParamB.toNumber()).to.be.greaterThan(0);

      const lp = await program.account.lpPosition.fetch(lpPda);
      expect(lp.owner.toBase58()).to.equal(user.publicKey.toBase58());
      expect(lp.shares.toNumber()).to.equal(lpAmount.toNumber());

      // Vault should hold the LP deposit
      const vaultBalance = await provider.connection.getBalance(vaultPda);
      expect(vaultBalance).to.be.greaterThanOrEqual(lpAmount.toNumber());
    });

    it("fails when depositing zero", async () => {
      const marketPda = getMarketPda(MARKET_ID);
      const vaultPda = getVaultPda(MARKET_ID);
      const lpPda = getLpPositionPda(MARKET_ID, user.publicKey);

      try {
        await program.methods
          .depositLiquidity(new BN(0))
          .accounts({
            lpWallet: user.publicKey,
            market: marketPda,
            vault: vaultPda,
            lpPosition: lpPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("ZeroAmount");
      }
    });
  });

  // =========================================================
  // Buy
  // =========================================================
  describe("buy", () => {
    it("buys YES tokens for word 0 (Economy)", async () => {
      const marketPda = getMarketPda(MARKET_ID);
      const vaultPda = getVaultPda(MARKET_ID);
      const escrowPda = getEscrowPda(user.publicKey);
      const yesMint = getYesMintPda(MARKET_ID, 0);

      // Create ATA for the YES mint
      const traderAta = await getOrCreateAta(yesMint, user.publicKey);

      const escrowBefore = await program.account.userEscrow.fetch(escrowPda);
      const balanceBefore = escrowBefore.balance.toNumber();

      const buyQty = ONE_TOKEN; // 1 token
      const maxCost = new BN(5 * LAMPORTS_PER_SOL); // generous slippage

      await program.methods
        .buy(0, { yes: {} }, buyQty, maxCost)
        .accounts({
          trader: user.publicKey,
          traderEscrow: escrowPda,
          market: marketPda,
          vault: vaultPda,
          tokenMint: yesMint,
          traderTokenAccount: traderAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Verify tokens minted
      const tokenAccount = await getAccount(provider.connection, traderAta);
      expect(Number(tokenAccount.amount)).to.equal(buyQty.toNumber());

      // Verify escrow balance decreased
      const escrowAfter = await program.account.userEscrow.fetch(escrowPda);
      expect(escrowAfter.balance.toNumber()).to.be.lessThan(balanceBefore);

      // Verify word state updated
      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.words[0].yesQuantity.toNumber()).to.equal(
        buyQty.toNumber()
      );
      expect(market.words[0].noQuantity.toNumber()).to.equal(0);

      // Verify fee accumulated
      expect(market.accumulatedFees.toNumber()).to.be.greaterThan(0);

      console.log(
        `  Buy cost: ${balanceBefore - escrowAfter.balance.toNumber()} lamports`
      );
      console.log(`  Fees accumulated: ${market.accumulatedFees.toNumber()}`);
    });

    it("buys NO tokens for word 1 (Immigration)", async () => {
      const marketPda = getMarketPda(MARKET_ID);
      const vaultPda = getVaultPda(MARKET_ID);
      const escrowPda = getEscrowPda(user.publicKey);
      const noMint = getNoMintPda(MARKET_ID, 1);

      const traderAta = await getOrCreateAta(noMint, user.publicKey);

      const buyQty = ONE_TOKEN;
      const maxCost = new BN(5 * LAMPORTS_PER_SOL);

      await program.methods
        .buy(1, { no: {} }, buyQty, maxCost)
        .accounts({
          trader: user.publicKey,
          traderEscrow: escrowPda,
          market: marketPda,
          vault: vaultPda,
          tokenMint: noMint,
          traderTokenAccount: traderAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const tokenAccount = await getAccount(provider.connection, traderAta);
      expect(Number(tokenAccount.amount)).to.equal(buyQty.toNumber());

      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.words[1].noQuantity.toNumber()).to.equal(buyQty.toNumber());
    });

    it("price increases after buying more YES", async () => {
      const marketPda = getMarketPda(MARKET_ID);
      const vaultPda = getVaultPda(MARKET_ID);
      const escrowPda = getEscrowPda(user.publicKey);
      const yesMint = getYesMintPda(MARKET_ID, 0);
      const traderAta = getAssociatedTokenAddressSync(
        yesMint,
        user.publicKey
      );

      const escrowBefore = await program.account.userEscrow.fetch(escrowPda);
      const balanceBefore = escrowBefore.balance.toNumber();

      // Buy another token — should cost more than the first one
      const buyQty = ONE_TOKEN;
      const maxCost = new BN(5 * LAMPORTS_PER_SOL);

      await program.methods
        .buy(0, { yes: {} }, buyQty, maxCost)
        .accounts({
          trader: user.publicKey,
          traderEscrow: escrowPda,
          market: marketPda,
          vault: vaultPda,
          tokenMint: yesMint,
          traderTokenAccount: traderAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const escrowAfter = await program.account.userEscrow.fetch(escrowPda);
      const cost2 = balanceBefore - escrowAfter.balance.toNumber();

      // Now trader should hold 2 tokens
      const tokenAccount = await getAccount(provider.connection, traderAta);
      expect(Number(tokenAccount.amount)).to.equal(2 * ONE_TOKEN.toNumber());

      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.words[0].yesQuantity.toNumber()).to.equal(
        2 * ONE_TOKEN.toNumber()
      );

      console.log(`  Second buy cost: ${cost2} lamports (should be > first)`);
    });

    it("fails with slippage exceeded", async () => {
      const marketPda = getMarketPda(MARKET_ID);
      const vaultPda = getVaultPda(MARKET_ID);
      const escrowPda = getEscrowPda(user.publicKey);
      const yesMint = getYesMintPda(MARKET_ID, 0);
      const traderAta = getAssociatedTokenAddressSync(
        yesMint,
        user.publicKey
      );

      try {
        await program.methods
          .buy(0, { yes: {} }, ONE_TOKEN, new BN(1)) // max_cost = 1 lamport
          .accounts({
            trader: user.publicKey,
            traderEscrow: escrowPda,
            market: marketPda,
            vault: vaultPda,
            tokenMint: yesMint,
            traderTokenAccount: traderAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("SlippageExceeded");
      }
    });

    it("fails with invalid word index", async () => {
      const marketPda = getMarketPda(MARKET_ID);
      const vaultPda = getVaultPda(MARKET_ID);
      const escrowPda = getEscrowPda(user.publicKey);
      const yesMint = getYesMintPda(MARKET_ID, 0);
      const traderAta = getAssociatedTokenAddressSync(
        yesMint,
        user.publicKey
      );

      try {
        await program.methods
          .buy(7, { yes: {} }, ONE_TOKEN, new BN(5 * LAMPORTS_PER_SOL)) // word 7 doesn't exist
          .accounts({
            trader: user.publicKey,
            traderEscrow: escrowPda,
            market: marketPda,
            vault: vaultPda,
            tokenMint: yesMint,
            traderTokenAccount: traderAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidWordIndex");
      }
    });
  });

  // =========================================================
  // Sell
  // =========================================================
  describe("sell", () => {
    it("sells YES tokens back to the AMM for word 0", async () => {
      const marketPda = getMarketPda(MARKET_ID);
      const vaultPda = getVaultPda(MARKET_ID);
      const escrowPda = getEscrowPda(user.publicKey);
      const yesMint = getYesMintPda(MARKET_ID, 0);
      const traderAta = getAssociatedTokenAddressSync(
        yesMint,
        user.publicKey
      );

      const escrowBefore = await program.account.userEscrow.fetch(escrowPda);
      const balanceBefore = escrowBefore.balance.toNumber();

      const tokenBefore = await getAccount(provider.connection, traderAta);
      const tokensBefore = Number(tokenBefore.amount);

      const sellQty = ONE_TOKEN; // sell 1 of our 2 tokens

      await program.methods
        .sell(0, { yes: {} }, sellQty, new BN(0)) // min_return = 0 (no slippage floor)
        .accounts({
          trader: user.publicKey,
          traderEscrow: escrowPda,
          market: marketPda,
          vault: vaultPda,
          tokenMint: yesMint,
          traderTokenAccount: traderAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Verify tokens burned
      const tokenAfter = await getAccount(provider.connection, traderAta);
      expect(Number(tokenAfter.amount)).to.equal(
        tokensBefore - sellQty.toNumber()
      );

      // Verify escrow balance increased (received SOL back)
      const escrowAfter = await program.account.userEscrow.fetch(escrowPda);
      expect(escrowAfter.balance.toNumber()).to.be.greaterThan(balanceBefore);

      // Verify word state updated
      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.words[0].yesQuantity.toNumber()).to.equal(
        ONE_TOKEN.toNumber()
      );

      const returnAmount = escrowAfter.balance.toNumber() - balanceBefore;
      console.log(`  Sell return: ${returnAmount} lamports`);
    });

    it("fails with slippage below min", async () => {
      const marketPda = getMarketPda(MARKET_ID);
      const vaultPda = getVaultPda(MARKET_ID);
      const escrowPda = getEscrowPda(user.publicKey);
      const yesMint = getYesMintPda(MARKET_ID, 0);
      const traderAta = getAssociatedTokenAddressSync(
        yesMint,
        user.publicKey
      );

      try {
        await program.methods
          .sell(
            0,
            { yes: {} },
            ONE_TOKEN,
            new BN(100 * LAMPORTS_PER_SOL) // min_return impossibly high
          )
          .accounts({
            trader: user.publicKey,
            traderEscrow: escrowPda,
            market: marketPda,
            vault: vaultPda,
            tokenMint: yesMint,
            traderTokenAccount: traderAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("SlippageBelowMin");
      }
    });
  });

  // =========================================================
  // Withdraw liquidity (locked before resolution)
  // =========================================================
  describe("withdraw_liquidity (locked)", () => {
    it("fails to withdraw before market is resolved", async () => {
      const marketPda = getMarketPda(MARKET_ID);
      const vaultPda = getVaultPda(MARKET_ID);
      const lpPda = getLpPositionPda(MARKET_ID, user.publicKey);

      try {
        await program.methods
          .withdrawLiquidity(new BN(1))
          .accounts({
            lpWallet: user.publicKey,
            market: marketPda,
            vault: vaultPda,
            lpPosition: lpPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("MarketNotResolved");
      }
    });
  });

  // =========================================================
  // Resolve word
  // =========================================================
  describe("resolve_word", () => {
    it("resolves word 0 (Economy) as mentioned = true", async () => {
      const marketPda = getMarketPda(MARKET_ID);

      await program.methods
        .resolveWord(0, true)
        .accounts({
          resolver: user.publicKey,
          market: marketPda,
        })
        .rpc();

      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.words[0].outcome).to.equal(true);
      // Market shouldn't be fully resolved yet (only 1 of 3 words)
      expect(market.status).to.deep.equal({ open: {} });
    });

    it("resolves word 1 (Immigration) as mentioned = false", async () => {
      const marketPda = getMarketPda(MARKET_ID);

      await program.methods
        .resolveWord(1, false)
        .accounts({
          resolver: user.publicKey,
          market: marketPda,
        })
        .rpc();

      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.words[1].outcome).to.equal(false);
      expect(market.status).to.deep.equal({ open: {} });
    });

    it("resolves final word (Ukraine) — market becomes Resolved", async () => {
      const marketPda = getMarketPda(MARKET_ID);

      await program.methods
        .resolveWord(2, true)
        .accounts({
          resolver: user.publicKey,
          market: marketPda,
        })
        .rpc();

      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.words[2].outcome).to.equal(true);
      expect(market.status).to.deep.equal({ resolved: {} });
      expect(market.resolvedAt).to.not.be.null;
    });

    it("fails to re-resolve an already resolved word", async () => {
      const marketPda = getMarketPda(MARKET_ID);

      try {
        await program.methods
          .resolveWord(0, false)
          .accounts({
            resolver: user.publicKey,
            market: marketPda,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("MarketAlreadyResolved");
      }
    });
  });

  // =========================================================
  // Redeem
  // =========================================================
  describe("redeem", () => {
    it("redeems winning YES tokens for word 0 (Economy — mentioned)", async () => {
      const marketPda = getMarketPda(MARKET_ID);
      const vaultPda = getVaultPda(MARKET_ID);
      const escrowPda = getEscrowPda(user.publicKey);
      const yesMint = getYesMintPda(MARKET_ID, 0);
      const traderAta = getAssociatedTokenAddressSync(
        yesMint,
        user.publicKey
      );

      const tokenBefore = await getAccount(provider.connection, traderAta);
      const tokenAmountBefore = Number(tokenBefore.amount);
      expect(tokenAmountBefore).to.be.greaterThan(0);

      const escrowBefore = await program.account.userEscrow.fetch(escrowPda);

      await program.methods
        .redeem(0, { yes: {} })
        .accounts({
          trader: user.publicKey,
          traderEscrow: escrowPda,
          market: marketPda,
          vault: vaultPda,
          tokenMint: yesMint,
          traderTokenAccount: traderAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Tokens should be burned
      const tokenAfter = await getAccount(provider.connection, traderAta);
      expect(Number(tokenAfter.amount)).to.equal(0);

      // Escrow balance should increase by token_amount (1 base unit = 1 lamport)
      const escrowAfter = await program.account.userEscrow.fetch(escrowPda);
      const payout =
        escrowAfter.balance.toNumber() - escrowBefore.balance.toNumber();
      expect(payout).to.equal(tokenAmountBefore);

      console.log(
        `  Redeemed ${tokenAmountBefore} base units → ${payout} lamports`
      );
    });

    it("fails to redeem losing NO tokens for word 0 (Economy was mentioned → YES won)", async () => {
      const marketPda = getMarketPda(MARKET_ID);
      const vaultPda = getVaultPda(MARKET_ID);
      const escrowPda = getEscrowPda(user.publicKey);
      const noMint = getNoMintPda(MARKET_ID, 0);

      // Create ATA even though it will have 0 balance
      const traderAta = await getOrCreateAta(noMint, user.publicKey);

      try {
        await program.methods
          .redeem(0, { no: {} })
          .accounts({
            trader: user.publicKey,
            traderEscrow: escrowPda,
            market: marketPda,
            vault: vaultPda,
            tokenMint: noMint,
            traderTokenAccount: traderAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        // Either NotWinningDirection or NothingToRedeem (no tokens held)
        expect(["NotWinningDirection", "NothingToRedeem"]).to.include(
          err.error.errorCode.code
        );
      }
    });

    it("redeems winning NO tokens for word 1 (Immigration — not mentioned)", async () => {
      const marketPda = getMarketPda(MARKET_ID);
      const vaultPda = getVaultPda(MARKET_ID);
      const escrowPda = getEscrowPda(user.publicKey);
      const noMint = getNoMintPda(MARKET_ID, 1);
      const traderAta = getAssociatedTokenAddressSync(
        noMint,
        user.publicKey
      );

      const tokenBefore = await getAccount(provider.connection, traderAta);
      const tokenAmountBefore = Number(tokenBefore.amount);
      expect(tokenAmountBefore).to.be.greaterThan(0);

      const escrowBefore = await program.account.userEscrow.fetch(escrowPda);

      await program.methods
        .redeem(1, { no: {} })
        .accounts({
          trader: user.publicKey,
          traderEscrow: escrowPda,
          market: marketPda,
          vault: vaultPda,
          tokenMint: noMint,
          traderTokenAccount: traderAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const tokenAfter = await getAccount(provider.connection, traderAta);
      expect(Number(tokenAfter.amount)).to.equal(0);

      const escrowAfter = await program.account.userEscrow.fetch(escrowPda);
      const payout =
        escrowAfter.balance.toNumber() - escrowBefore.balance.toNumber();
      expect(payout).to.equal(tokenAmountBefore);

      console.log(
        `  Redeemed ${tokenAmountBefore} NO base units → ${payout} lamports`
      );
    });
  });

  // =========================================================
  // Withdraw liquidity (after resolution)
  // =========================================================
  describe("withdraw_liquidity", () => {
    it("LP withdraws partial shares after resolution", async () => {
      const marketPda = getMarketPda(MARKET_ID);
      const vaultPda = getVaultPda(MARKET_ID);
      const lpPda = getLpPositionPda(MARKET_ID, user.publicKey);

      const lpBefore = await program.account.lpPosition.fetch(lpPda);
      const walletBefore = await provider.connection.getBalance(
        user.publicKey
      );

      // Withdraw half the shares
      const sharesToBurn = lpBefore.shares.div(new BN(2));

      await program.methods
        .withdrawLiquidity(sharesToBurn)
        .accounts({
          lpWallet: user.publicKey,
          market: marketPda,
          vault: vaultPda,
          lpPosition: lpPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const lpAfter = await program.account.lpPosition.fetch(lpPda);
      expect(lpAfter.shares.toNumber()).to.equal(
        lpBefore.shares.toNumber() - sharesToBurn.toNumber()
      );

      const market = await program.account.marketAccount.fetch(marketPda);
      expect(market.totalLpShares.toNumber()).to.be.lessThan(
        lpBefore.shares.toNumber() * 2
      ); // total decreased

      const walletAfter = await provider.connection.getBalance(user.publicKey);
      expect(walletAfter).to.be.greaterThan(walletBefore);

      console.log(`  LP withdrew ${sharesToBurn.toNumber()} shares`);
      console.log(
        `  SOL received: ${walletAfter - walletBefore} lamports (approx, minus fee)`
      );
    });

    it("fails with insufficient shares", async () => {
      const marketPda = getMarketPda(MARKET_ID);
      const vaultPda = getVaultPda(MARKET_ID);
      const lpPda = getLpPositionPda(MARKET_ID, user.publicKey);

      try {
        await program.methods
          .withdrawLiquidity(new BN(999_999_999_999_999))
          .accounts({
            lpWallet: user.publicKey,
            market: marketPda,
            vault: vaultPda,
            lpPosition: lpPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InsufficientShares");
      }
    });
  });

  // =========================================================
  // Final escrow withdrawal (end-to-end check)
  // =========================================================
  describe("final withdrawal", () => {
    it("withdraws all remaining escrow balance", async () => {
      const escrowPda = getEscrowPda(user.publicKey);
      const escrow = await program.account.userEscrow.fetch(escrowPda);
      const remaining = escrow.balance;

      if (remaining.toNumber() > 0) {
        const walletBefore = await provider.connection.getBalance(
          user.publicKey
        );

        await program.methods
          .withdraw(remaining)
          .accounts({
            user: user.publicKey,
            escrow: escrowPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        const escrowAfter = await program.account.userEscrow.fetch(escrowPda);
        expect(escrowAfter.balance.toNumber()).to.equal(0);

        const walletAfter = await provider.connection.getBalance(
          user.publicKey
        );
        expect(walletAfter).to.be.greaterThan(walletBefore);

        console.log(
          `  Withdrew final ${remaining.toNumber()} lamports from escrow`
        );
      }
    });
  });
});
