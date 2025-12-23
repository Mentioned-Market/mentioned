import * as anchor from "@coral-xyz/anchor";
import { BN } from "bn.js";
const { Program } = anchor;
import { 
  TOKEN_PROGRAM_ID, 
  createMint, 
  getOrCreateAssociatedTokenAccount,
  getAccount,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { assert } from "chai";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { createHash } from "crypto";

describe("Trump's Speech Market - Mexico, Left, Taxes", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const programId = "F8EsP2rp6FBuaTfKQ8ywx4hqhM3YpcJr4HPkXHeGsZyJ";
  
  // Minimal IDL - just enough for the program to work
  const IDL = {
    version: "0.1.0",
    name: "mention_amm_poc",
    instructions: [
      {
        name: "initializeEvent",
        accounts: [
          { name: "admin", isMut: true, isSigner: true },
          { name: "event", isMut: true, isSigner: false },
          { name: "systemProgram", isMut: false, isSigner: false }
        ],
        args: [{ name: "eventId", type: "u64" }]
      },
      {
        name: "initializeMarket",
        accounts: [
          { name: "admin", isMut: true, isSigner: true },
          { name: "event", isMut: false, isSigner: false },
          { name: "market", isMut: true, isSigner: false },
          { name: "systemProgram", isMut: false, isSigner: false }
        ],
        args: [
          { name: "marketId", type: "u64" },
          { name: "wordHash", type: { array: ["u8", 32] } },
          { name: "feeBps", type: "u16" }
        ]
      },
      {
        name: "addLiquidity",
        accounts: [
          { name: "admin", isMut: true, isSigner: true },
          { name: "event", isMut: false, isSigner: false },
          { name: "market", isMut: true, isSigner: false },
          { name: "yesMint", isMut: true, isSigner: false },
          { name: "noMint", isMut: true, isSigner: false },
          { name: "yesVault", isMut: true, isSigner: false },
          { name: "noVault", isMut: true, isSigner: false },
          { name: "tokenProgram", isMut: false, isSigner: false },
          { name: "systemProgram", isMut: false, isSigner: false }
        ],
        args: [{ name: "lamports", type: "u64" }]
      },
      {
        name: "buyYesWithSol",
        accounts: [
          { name: "user", isMut: true, isSigner: true },
          { name: "event", isMut: false, isSigner: false },
          { name: "market", isMut: true, isSigner: false },
          { name: "yesMint", isMut: true, isSigner: false },
          { name: "noMint", isMut: true, isSigner: false },
          { name: "yesVault", isMut: true, isSigner: false },
          { name: "noVault", isMut: true, isSigner: false },
          { name: "userYes", isMut: true, isSigner: false },
          { name: "userNo", isMut: true, isSigner: false },
          { name: "tokenProgram", isMut: false, isSigner: false },
          { name: "systemProgram", isMut: false, isSigner: false }
        ],
        args: [
          { name: "lamportsIn", type: "u64" },
          { name: "minOut", type: "u64" }
        ]
      },
      {
        name: "buyNoWithSol",
        accounts: [
          { name: "user", isMut: true, isSigner: true },
          { name: "event", isMut: false, isSigner: false },
          { name: "market", isMut: true, isSigner: false },
          { name: "yesMint", isMut: true, isSigner: false },
          { name: "noMint", isMut: true, isSigner: false },
          { name: "yesVault", isMut: true, isSigner: false },
          { name: "noVault", isMut: true, isSigner: false },
          { name: "userYes", isMut: true, isSigner: false },
          { name: "userNo", isMut: true, isSigner: false },
          { name: "tokenProgram", isMut: false, isSigner: false },
          { name: "systemProgram", isMut: false, isSigner: false }
        ],
        args: [
          { name: "lamportsIn", type: "u64" },
          { name: "minOut", type: "u64" }
        ]
      },
      {
        name: "mintSet",
        accounts: [
          { name: "user", isMut: true, isSigner: true },
          { name: "event", isMut: false, isSigner: false },
          { name: "market", isMut: true, isSigner: false },
          { name: "yesMint", isMut: true, isSigner: false },
          { name: "noMint", isMut: true, isSigner: false },
          { name: "userYesAccount", isMut: true, isSigner: false },
          { name: "userNoAccount", isMut: true, isSigner: false },
          { name: "tokenProgram", isMut: false, isSigner: false },
          { name: "systemProgram", isMut: false, isSigner: false }
        ],
        args: [{ name: "lamports", type: "u64" }]
      }
    ],
    accounts: [
      {
        name: "event",
        type: {
          kind: "struct",
          fields: [
            { name: "admin", type: "publicKey" },
            { name: "eventId", type: "u64" },
            { name: "bump", type: "u8" }
          ]
        }
      },
      {
        name: "market",
        type: {
          kind: "struct",
          fields: [
            { name: "event", type: "publicKey" },
            { name: "admin", type: "publicKey" },
            { name: "marketId", type: "u64" },
            { name: "wordHash", type: { array: ["u8", 32] } },
            { name: "feeBps", type: "u16" },
            { name: "resolved", type: "bool" },
            { name: "winningSide", type: { defined: "WinningSide" } },
            { name: "bump", type: "u8" }
          ]
        }
      }
    ],
    types: [
      {
        name: "WinningSide",
        type: {
          kind: "enum",
          variants: [
            { name: "Unresolved" },
            { name: "Yes" },
            { name: "No" }
          ]
        }
      }
    ],
    metadata: {
      address: programId
    }
  };

  const program = new Program(
    IDL as any,
    new PublicKey(programId),
    provider
  );

  const admin = provider.wallet as anchor.Wallet;
  
  // Event and market IDs
  const eventId = new BN(Date.now()); // Use timestamp for unique event
  const marketIdMexico = new BN(1);
  const marketIdLeft = new BN(2);
  const marketIdTaxes = new BN(3);
  
  // Hash the words
  const wordHashMexico = Array.from(createHash("sha256").update("Mexico").digest());
  const wordHashLeft = Array.from(createHash("sha256").update("Left").digest());
  const wordHashTaxes = Array.from(createHash("sha256").update("Taxes").digest());
  
  // Fee: 1% = 100 basis points
  const feeBps = 100;

  // PDAs
  let eventPda: PublicKey;
  let marketMexicoPda: PublicKey;
  let marketLeftPda: PublicKey;
  let marketTaxesPda: PublicKey;

  // Mints for each market
  let mexicoYesMint: PublicKey;
  let mexicoNoMint: PublicKey;
  let leftYesMint: PublicKey;
  let leftNoMint: PublicKey;
  let taxesYesMint: PublicKey;
  let taxesNoMint: PublicKey;

  // Test user
  const user = Keypair.generate();

  before(async () => {
    // Airdrop SOL to test user
    try {
      const airdropSig = await provider.connection.requestAirdrop(
        user.publicKey,
        5 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);
    } catch (e) {
      console.log("Airdrop failed (rate limit?), continuing with existing balance");
    }

    console.log("\n🎤 Setting up Trump's Speech Markets");
    console.log("📍 Program ID:", PROGRAM_ID.toString());
    console.log("📍 Admin:", admin.publicKey.toString());
    console.log("👤 Test User:", user.publicKey.toString());
    console.log("🆔 Event ID:", eventId.toString());
  });

  describe("Step 1: Create Event", () => {
    it("Creates the 'Trump's Speech' event", async () => {
      // Event PDA: seeds = [b"event", admin_key, event_id]
      [eventPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("event"),
          admin.publicKey.toBuffer(),
          eventId.toArrayLike(Buffer, "le", 8)
        ],
        program.programId
      );

      console.log("📋 Event PDA:", eventPda.toString());

      try {
        const tx = await program.methods
          .initializeEvent(eventId)
          .accounts({
            admin: admin.publicKey,
            event: eventPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        console.log("✅ Event created:", tx);

        // Verify event account
        const eventAccount = await program.account.event.fetch(eventPda);
        console.log("   Admin:", eventAccount.admin.toString());
        console.log("   Event ID:", eventAccount.eventId.toString());
        
        assert.equal(eventAccount.admin.toString(), admin.publicKey.toString());
        assert.equal(eventAccount.eventId.toString(), eventId.toString());
      } catch (e) {
        console.error("Error creating event:", e);
        throw e;
      }
    });
  });

  describe("Step 2: Initialize Markets", () => {
    it("Creates market: Will 'Mexico' be mentioned?", async () => {
      // Market PDA: seeds = [b"market", event_key, market_id]
      [marketMexicoPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("market"),
          eventPda.toBuffer(),
          marketIdMexico.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      console.log("📊 Mexico Market PDA:", marketMexicoPda.toString());

      try {
        const tx = await program.methods
          .initializeMarket(marketIdMexico, wordHashMexico, feeBps)
          .accounts({
            admin: admin.publicKey,
            event: eventPda,
            market: marketMexicoPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        console.log("✅ Mexico market created:", tx);

        const marketAccount = await program.account.market.fetch(marketMexicoPda);
        console.log("   Market ID:", marketAccount.marketId.toString());
        console.log("   Fee:", marketAccount.feeBps, "bps");
        
        assert.equal(marketAccount.marketId.toString(), marketIdMexico.toString());
      } catch (e) {
        console.error("Error creating Mexico market:", e);
        throw e;
      }
    });

    it("Creates market: Will 'Left' be mentioned?", async () => {
      [marketLeftPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("market"),
          eventPda.toBuffer(),
          marketIdLeft.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      console.log("📊 Left Market PDA:", marketLeftPda.toString());

      const tx = await program.methods
        .initializeMarket(marketIdLeft, wordHashLeft, feeBps)
        .accounts({
          admin: admin.publicKey,
          event: eventPda,
          market: marketLeftPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("✅ Left market created:", tx);
    });

    it("Creates market: Will 'Taxes' be mentioned?", async () => {
      [marketTaxesPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("market"),
          eventPda.toBuffer(),
          marketIdTaxes.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      console.log("📊 Taxes Market PDA:", marketTaxesPda.toString());

      const tx = await program.methods
        .initializeMarket(marketIdTaxes, wordHashTaxes, feeBps)
        .accounts({
          admin: admin.publicKey,
          event: eventPda,
          market: marketTaxesPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("✅ Taxes market created:", tx);
    });
  });

  describe("Step 3: Create Token Mints", () => {
    it("Creates YES/NO mints for all markets", async () => {
      console.log("\n🪙 Creating token mints...");
      
      // Mexico mints
      mexicoYesMint = await createMint(
        provider.connection,
        admin.payer,
        marketMexicoPda, // market is mint authority
        null,
        9
      );
      mexicoNoMint = await createMint(
        provider.connection,
        admin.payer,
        marketMexicoPda,
        null,
        9
      );
      console.log("✅ Mexico YES:", mexicoYesMint.toString());
      console.log("✅ Mexico NO:", mexicoNoMint.toString());

      // Left mints
      leftYesMint = await createMint(
        provider.connection,
        admin.payer,
        marketLeftPda,
        null,
        9
      );
      leftNoMint = await createMint(
        provider.connection,
        admin.payer,
        marketLeftPda,
        null,
        9
      );
      console.log("✅ Left YES:", leftYesMint.toString());
      console.log("✅ Left NO:", leftNoMint.toString());

      // Taxes mints
      taxesYesMint = await createMint(
        provider.connection,
        admin.payer,
        marketTaxesPda,
        null,
        9
      );
      taxesNoMint = await createMint(
        provider.connection,
        admin.payer,
        marketTaxesPda,
        null,
        9
      );
      console.log("✅ Taxes YES:", taxesYesMint.toString());
      console.log("✅ Taxes NO:", taxesNoMint.toString());
    });
  });

  describe("Step 4: Add Liquidity to Markets", () => {
    it("Adds liquidity to Mexico market", async () => {
      console.log("\n💧 Adding liquidity to Mexico market...");
      
      // Create pool vaults (ATAs owned by market PDA)
      const mexicoYesVault = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        mexicoYesMint,
        marketMexicoPda,
        true
      );

      const mexicoNoVault = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        mexicoNoMint,
        marketMexicoPda,
        true
      );

      console.log("   YES Vault:", mexicoYesVault.address.toString());
      console.log("   NO Vault:", mexicoNoVault.address.toString());

      const liquidityAmount = new BN(1 * LAMPORTS_PER_SOL); // 1 SOL

      const tx = await program.methods
        .addLiquidity(liquidityAmount)
        .accounts({
          admin: admin.publicKey,
          event: eventPda,
          market: marketMexicoPda,
          yesMint: mexicoYesMint,
          noMint: mexicoNoMint,
          yesVault: mexicoYesVault.address,
          noVault: mexicoNoVault.address,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("✅ Added 1 SOL liquidity:", tx);

      // Verify vault balances
      const yesVaultAccount = await getAccount(provider.connection, mexicoYesVault.address);
      const noVaultAccount = await getAccount(provider.connection, mexicoNoVault.address);
      
      console.log("   YES Vault balance:", yesVaultAccount.amount.toString());
      console.log("   NO Vault balance:", noVaultAccount.amount.toString());
      
      assert.equal(yesVaultAccount.amount.toString(), liquidityAmount.toString());
      assert.equal(noVaultAccount.amount.toString(), liquidityAmount.toString());
    });

    it("Adds liquidity to Left market", async () => {
      console.log("\n💧 Adding liquidity to Left market...");
      
      const leftYesVault = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        leftYesMint,
        marketLeftPda,
        true
      );

      const leftNoVault = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        leftNoMint,
        marketLeftPda,
        true
      );

      const liquidityAmount = new BN(1 * LAMPORTS_PER_SOL);

      const tx = await program.methods
        .addLiquidity(liquidityAmount)
        .accounts({
          admin: admin.publicKey,
          event: eventPda,
          market: marketLeftPda,
          yesMint: leftYesMint,
          noMint: leftNoMint,
          yesVault: leftYesVault.address,
          noVault: leftNoVault.address,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("✅ Added 1 SOL liquidity:", tx);
    });

    it("Adds liquidity to Taxes market", async () => {
      console.log("\n💧 Adding liquidity to Taxes market...");
      
      const taxesYesVault = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        taxesYesMint,
        marketTaxesPda,
        true
      );

      const taxesNoVault = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        taxesNoMint,
        marketTaxesPda,
        true
      );

      const liquidityAmount = new BN(1 * LAMPORTS_PER_SOL);

      const tx = await program.methods
        .addLiquidity(liquidityAmount)
        .accounts({
          admin: admin.publicKey,
          event: eventPda,
          market: marketTaxesPda,
          yesMint: taxesYesMint,
          noMint: taxesNoMint,
          yesVault: taxesYesVault.address,
          noVault: taxesNoVault.address,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("✅ Added 1 SOL liquidity:", tx);
    });
  });

  describe("Step 5: User Trading - Buy YES on Mexico", () => {
    it("User buys YES tokens on Mexico market with SOL", async () => {
      console.log("\n💰 User buying YES on Mexico market...");
      
      // Create user's token accounts
      const userYesAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer, // Admin pays for account creation
        mexicoYesMint,
        user.publicKey
      );

      const userNoAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        mexicoNoMint,
        user.publicKey
      );

      const mexicoYesVault = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        mexicoYesMint,
        marketMexicoPda,
        true
      );

      const mexicoNoVault = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        mexicoNoMint,
        marketMexicoPda,
        true
      );

      const buyAmount = new BN(0.1 * LAMPORTS_PER_SOL); // 0.1 SOL

      try {
        const tx = await program.methods
          .buyYesWithSol(buyAmount, new BN(1)) // minOut = 1 (accept any amount for testing)
          .accounts({
            user: user.publicKey,
            event: eventPda,
            market: marketMexicoPda,
            yesMint: mexicoYesMint,
            noMint: mexicoNoMint,
            yesVault: mexicoYesVault.address,
            noVault: mexicoNoVault.address,
            userYes: userYesAccount.address,
            userNo: userNoAccount.address,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc();

        console.log("✅ User bought YES tokens:", tx);

        const userYesBalance = await getAccount(provider.connection, userYesAccount.address);
        console.log("💰 User YES balance:", userYesBalance.amount.toString());
        
        assert.isTrue(userYesBalance.amount > BigInt(0));
      } catch (e) {
        console.error("Error buying YES:", e);
        throw e;
      }
    });
  });

  describe("Step 6: Market Summary", () => {
    it("Displays all market states", async () => {
      console.log("\n📊 === MARKET SUMMARY ===");
      
      const mexicoMarket = await program.account.market.fetch(marketMexicoPda);
      console.log("\n🇲🇽 Mexico Market:");
      console.log("   - PDA:", marketMexicoPda.toString());
      console.log("   - Market ID:", mexicoMarket.marketId.toString());
      console.log("   - Resolved:", mexicoMarket.resolved);
      console.log("   - Fee:", mexicoMarket.feeBps, "bps");

      const leftMarket = await program.account.market.fetch(marketLeftPda);
      console.log("\n⬅️  Left Market:");
      console.log("   - PDA:", marketLeftPda.toString());
      console.log("   - Market ID:", leftMarket.marketId.toString());
      console.log("   - Resolved:", leftMarket.resolved);

      const taxesMarket = await program.account.market.fetch(marketTaxesPda);
      console.log("\n💰 Taxes Market:");
      console.log("   - PDA:", marketTaxesPda.toString());
      console.log("   - Market ID:", taxesMarket.marketId.toString());
      console.log("   - Resolved:", taxesMarket.resolved);

      console.log("\n✅ All markets operational!");
      console.log("\n🎯 Next steps:");
      console.log("   - Users can now trade YES/NO tokens");
      console.log("   - Admin can resolve markets when event concludes");
      console.log("   - Winners can redeem their tokens for SOL");
    });
  });
});
