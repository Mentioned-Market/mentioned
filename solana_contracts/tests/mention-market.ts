import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MentionMarket } from "../target/types/mention_market";
import { expect } from "chai";
import { PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";

describe("mention-market", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.MentionMarket as Program<MentionMarket>;
  const user = provider.wallet;

  function getEscrowPda(wallet: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), wallet.toBuffer()],
      program.programId
    );
  }

  // =========================================================
  // Deposit tests
  // =========================================================
  describe("deposit", () => {
    it("creates escrow and deposits SOL on first call", async () => {
      const [escrowPda] = getEscrowPda(user.publicKey);
      const depositAmount = new BN(1 * LAMPORTS_PER_SOL); // 1 SOL

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
      expect(escrow.balance.toNumber()).to.equal(1 * LAMPORTS_PER_SOL);
      expect(escrow.locked.toNumber()).to.equal(0);
    });

    it("deposits additional SOL into existing escrow", async () => {
      const [escrowPda] = getEscrowPda(user.publicKey);
      const depositAmount = new BN(0.5 * LAMPORTS_PER_SOL);

      await program.methods
        .deposit(depositAmount)
        .accounts({
          user: user.publicKey,
          escrow: escrowPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const escrow = await program.account.userEscrow.fetch(escrowPda);
      expect(escrow.balance.toNumber()).to.equal(1.5 * LAMPORTS_PER_SOL);
    });

    it("fails when depositing zero", async () => {
      const [escrowPda] = getEscrowPda(user.publicKey);

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

  // =========================================================
  // Withdraw tests
  // =========================================================
  describe("withdraw", () => {
    it("withdraws SOL from escrow", async () => {
      const [escrowPda] = getEscrowPda(user.publicKey);
      const withdrawAmount = new BN(0.5 * LAMPORTS_PER_SOL);

      const balanceBefore = await provider.connection.getBalance(
        user.publicKey
      );

      await program.methods
        .withdraw(withdrawAmount)
        .accounts({
          user: user.publicKey,
          escrow: escrowPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const escrow = await program.account.userEscrow.fetch(escrowPda);
      expect(escrow.balance.toNumber()).to.equal(1 * LAMPORTS_PER_SOL);

      const balanceAfter = await provider.connection.getBalance(
        user.publicKey
      );
      // User should have received ~0.5 SOL back (minus tx fee)
      expect(balanceAfter).to.be.greaterThan(balanceBefore);
    });

    it("fails when withdrawing more than balance", async () => {
      const [escrowPda] = getEscrowPda(user.publicKey);

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
      const [escrowPda] = getEscrowPda(user.publicKey);

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

    it("withdraws full remaining balance", async () => {
      const [escrowPda] = getEscrowPda(user.publicKey);
      const escrowBefore = await program.account.userEscrow.fetch(escrowPda);

      await program.methods
        .withdraw(escrowBefore.balance)
        .accounts({
          user: user.publicKey,
          escrow: escrowPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const escrow = await program.account.userEscrow.fetch(escrowPda);
      expect(escrow.balance.toNumber()).to.equal(0);
    });
  });

  // =========================================================
  // Create market tests
  // =========================================================
  describe("create_market", () => {
    const marketId = new BN(1);
    const wordIndex = 0;

    function getMarketPda(
      mId: BN,
      wIdx: number
    ): [PublicKey, number] {
      return PublicKey.findProgramAddressSync(
        [
          Buffer.from("market"),
          mId.toArrayLike(Buffer, "le", 8),
          new BN(wIdx).toArrayLike(Buffer, "le", 2),
        ],
        program.programId
      );
    }

    it("creates a word market with YES/NO mints", async () => {
      const [wordMarketPda] = getMarketPda(marketId, wordIndex);

      const [yesMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("yes_mint"), wordMarketPda.toBuffer()],
        program.programId
      );
      const [noMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("no_mint"), wordMarketPda.toBuffer()],
        program.programId
      );
      const [vault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), wordMarketPda.toBuffer()],
        program.programId
      );

      await program.methods
        .createMarket(marketId, wordIndex, "economy")
        .accounts({
          authority: user.publicKey,
          wordMarket: wordMarketPda,
          yesMint,
          noMint,
          vault,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,

        })
        .rpc();

      const market = await program.account.wordMarket.fetch(wordMarketPda);
      expect(market.authority.toBase58()).to.equal(user.publicKey.toBase58());
      expect(market.label).to.equal("economy");
      expect(market.marketId.toNumber()).to.equal(1);
      expect(market.wordIndex).to.equal(0);
      expect(market.totalCollateral.toNumber()).to.equal(0);
      expect(market.status).to.deep.equal({ active: {} });
      expect(market.outcome).to.be.null;
    });

    it("fails with label too long", async () => {
      const [wordMarketPda] = getMarketPda(new BN(2), 0);

      const [yesMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("yes_mint"), wordMarketPda.toBuffer()],
        program.programId
      );
      const [noMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("no_mint"), wordMarketPda.toBuffer()],
        program.programId
      );
      const [vault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), wordMarketPda.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .createMarket(
            new BN(2),
            0,
            "a".repeat(33) // 33 chars > max 32
          )
          .accounts({
            authority: user.publicKey,
            wordMarket: wordMarketPda,
            yesMint,
            noMint,
            vault,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
  
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("LabelTooLong");
      }
    });
  });

  // =========================================================
  // Pause & resolve market tests
  // =========================================================
  describe("pause_market & resolve_market", () => {
    const marketId = new BN(10);
    const wordIndex = 0;

    function getMarketPda(): [PublicKey, number] {
      return PublicKey.findProgramAddressSync(
        [
          Buffer.from("market"),
          marketId.toArrayLike(Buffer, "le", 8),
          new BN(wordIndex).toArrayLike(Buffer, "le", 2),
        ],
        program.programId
      );
    }

    before(async () => {
      const [wordMarketPda] = getMarketPda();
      const [yesMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("yes_mint"), wordMarketPda.toBuffer()],
        program.programId
      );
      const [noMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("no_mint"), wordMarketPda.toBuffer()],
        program.programId
      );
      const [vault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), wordMarketPda.toBuffer()],
        program.programId
      );

      await program.methods
        .createMarket(marketId, wordIndex, "bitcoin")
        .accounts({
          authority: user.publicKey,
          wordMarket: wordMarketPda,
          yesMint,
          noMint,
          vault,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,

        })
        .rpc();
    });

    it("pauses an active market", async () => {
      const [wordMarketPda] = getMarketPda();

      await program.methods
        .pauseMarket()
        .accounts({
          authority: user.publicKey,
          wordMarket: wordMarketPda,
        })
        .rpc();

      const market = await program.account.wordMarket.fetch(wordMarketPda);
      expect(market.status).to.deep.equal({ paused: {} });
    });

    it("resolves a paused market with Yes outcome", async () => {
      const [wordMarketPda] = getMarketPda();

      await program.methods
        .resolveMarket({ yes: {} })
        .accounts({
          authority: user.publicKey,
          wordMarket: wordMarketPda,
        })
        .rpc();

      const market = await program.account.wordMarket.fetch(wordMarketPda);
      expect(market.status).to.deep.equal({ resolved: {} });
      expect(market.outcome).to.deep.equal({ yes: {} });
    });

    it("fails to resolve an already-resolved market", async () => {
      const [wordMarketPda] = getMarketPda();

      try {
        await program.methods
          .resolveMarket({ no: {} })
          .accounts({
            authority: user.publicKey,
            wordMarket: wordMarketPda,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("MarketAlreadyResolved");
      }
    });
  });
});
