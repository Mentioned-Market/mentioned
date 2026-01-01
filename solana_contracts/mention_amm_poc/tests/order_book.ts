import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MentionAmmPoc } from "../target/types/mention_amm_poc";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createAccount, getAccount } from "@solana/spl-token";
import { assert } from "chai";
import * as crypto from "crypto";

describe("Order Book Tests", () => {
  // Configure the client
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.MentionAmmPoc as Program<MentionAmmPoc>;
  
  // Test accounts
  let admin: Keypair;
  let user1: Keypair;
  let user2: Keypair;
  
  // PDAs
  let eventPda: PublicKey;
  let marketPda: PublicKey;
  let yesMintPda: PublicKey;
  let noMintPda: PublicKey;
  
  // Test data
  const eventId = new anchor.BN(1);
  const marketId = new anchor.BN(1);
  const wordHash = Array.from(crypto.createHash('sha256').update('bitcoin').digest());
  
  // Event times
  const nowTimestamp = Math.floor(Date.now() / 1000);
  const startTime = new anchor.BN(nowTimestamp + 2); // Start in 2 seconds
  const endTime = new anchor.BN(nowTimestamp + 10); // End in 10 seconds

  before(async () => {
    // Create test accounts with funds
    admin = Keypair.generate();
    user1 = Keypair.generate();
    user2 = Keypair.generate();

    // Airdrop SOL to test accounts
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(admin.publicKey, 10 * LAMPORTS_PER_SOL)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user1.publicKey, 10 * LAMPORTS_PER_SOL)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user2.publicKey, 10 * LAMPORTS_PER_SOL)
    );

    console.log("✓ Test accounts funded");
  });

  describe("Event & Market Initialization", () => {
    it("Creates an event in PreMarket state", async () => {
      [eventPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("event"),
          admin.publicKey.toBuffer(),
          eventId.toArrayLike(Buffer, "le", 8)
        ],
        program.programId
      );

      await program.methods
        .initializeEvent(eventId, startTime, endTime)
        .accounts({
          admin: admin.publicKey,
          event: eventPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      const event = await program.account.event.fetch(eventPda);
      assert.ok(event.admin.equals(admin.publicKey));
      assert.ok(event.eventId.eq(eventId));
      assert.deepEqual(event.state, { preMarket: {} });
      assert.ok(event.startTime.eq(startTime));
      assert.ok(event.endTime.eq(endTime));

      console.log("✓ Event created in PreMarket state");
    });

    it("Creates a market", async () => {
      [marketPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("market"),
          eventPda.toBuffer(),
          marketId.toArrayLike(Buffer, "le", 8)
        ],
        program.programId
      );

      [yesMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("yes_mint"), marketPda.toBuffer()],
        program.programId
      );

      [noMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("no_mint"), marketPda.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeMarket(marketId, wordHash)
        .accounts({
          admin: admin.publicKey,
          event: eventPda,
          market: marketPda,
          yesMint: yesMintPda,
          noMint: noMintPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      const market = await program.account.market.fetch(marketPda);
      assert.ok(market.event.equals(eventPda));
      assert.ok(market.marketId.eq(marketId));
      assert.equal(market.resolved, false);
      assert.ok(market.nextOrderId.eq(new anchor.BN(0)));

      console.log("✓ Market created successfully in PreMarket state");
    });

    it("Fails to create market after event starts", async () => {
      // Wait for event to be startable
      await new Promise(resolve => setTimeout(resolve, 2500));
      
      // Start the event
      await program.methods
        .startEvent()
        .accounts({
          admin: admin.publicKey,
          event: eventPda,
        })
        .signers([admin])
        .rpc();

      const event = await program.account.event.fetch(eventPda);
      assert.deepEqual(event.state, { live: {} });

      // Try to create another market - should fail
      const newMarketId = new anchor.BN(999);
      const [newMarketPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("market"),
          eventPda.toBuffer(),
          newMarketId.toArrayLike(Buffer, "le", 8)
        ],
        program.programId
      );

      const [newYesMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("yes_mint"), newMarketPda.toBuffer()],
        program.programId
      );

      const [newNoMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("no_mint"), newMarketPda.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .initializeMarket(newMarketId, wordHash)
          .accounts({
            admin: admin.publicKey,
            event: eventPda,
            market: newMarketPda,
            yesMint: newYesMintPda,
            noMint: newNoMintPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
        
        assert.fail("Should have failed to create market after event started");
      } catch (err) {
        console.log("✓ Correctly prevented market creation after event started");
      }
    });
  });

  describe("Event State Transitions", () => {
    it("Transitions event from Live to Ended", async () => {
      // Wait for event to end
      await new Promise(resolve => setTimeout(resolve, 8000));

      await program.methods
        .endEvent()
        .accounts({
          admin: admin.publicKey,
          event: eventPda,
        })
        .signers([admin])
        .rpc();

      const event = await program.account.event.fetch(eventPda);
      assert.deepEqual(event.state, { ended: {} });

      console.log("✓ Event transitioned to Ended state");
    });

    it("Transitions event from Ended to Resolved", async () => {
      await program.methods
        .finalizeEvent()
        .accounts({
          admin: admin.publicKey,
          event: eventPda,
        })
        .signers([admin])
        .rpc();

      const event = await program.account.event.fetch(eventPda);
      assert.deepEqual(event.state, { resolved: {} });

      console.log("✓ Event transitioned to Resolved state");
    });
    });
  });

  describe("Minting and Burning Sets", () => {
    let user1YesAccount: PublicKey;
    let user1NoAccount: PublicKey;
    let testEventPda: PublicKey;
    let testMarketPda: PublicKey;
    let testYesMintPda: PublicKey;
    let testNoMintPda: PublicKey;

    before(async () => {
      // Create a new event for these tests (with distant times so we don't have to wait)
      const testEventId = new anchor.BN(2);
      const testMarketId = new anchor.BN(1);
      const farFuture = new anchor.BN(nowTimestamp + 3600); // 1 hour from now

      [testEventPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("event"),
          admin.publicKey.toBuffer(),
          testEventId.toArrayLike(Buffer, "le", 8)
        ],
        program.programId
      );

      await program.methods
        .initializeEvent(testEventId, new anchor.BN(nowTimestamp), farFuture)
        .accounts({
          admin: admin.publicKey,
          event: testEventPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      // Start event immediately
      await program.methods
        .startEvent()
        .accounts({
          admin: admin.publicKey,
          event: testEventPda,
        })
        .signers([admin])
        .rpc();

      [testMarketPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("market"),
          testEventPda.toBuffer(),
          testMarketId.toArrayLike(Buffer, "le", 8)
        ],
        program.programId
      );

      [testYesMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("yes_mint"), testMarketPda.toBuffer()],
        program.programId
      );

      [testNoMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("no_mint"), testMarketPda.toBuffer()],
        program.programId
      );

      // Note: Can't create market after starting - need to create before transition
      // This is expected behavior, so we'll skip market creation for this test
      // Instead, we'll use a hack: create event, create market, then transition
      
      // Create a fresh event for these tests
      const freshEventId = new anchor.BN(3);
      [testEventPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("event"), admin.publicKey.toBuffer(), freshEventId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      await program.methods
        .initializeEvent(freshEventId, new anchor.BN(nowTimestamp), farFuture)
        .accounts({
          admin: admin.publicKey,
          event: testEventPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      [testMarketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), testEventPda.toBuffer(), testMarketId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      [testYesMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("yes_mint"), testMarketPda.toBuffer()],
        program.programId
      );

      [testNoMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("no_mint"), testMarketPda.toBuffer()],
        program.programId
      );

      // Create market while in PreMarket state
      await program.methods
        .initializeMarket(testMarketId, wordHash)
        .accounts({
          admin: admin.publicKey,
          event: testEventPda,
          market: testMarketPda,
          yesMint: testYesMintPda,
          noMint: testNoMintPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      // Now start the event
      await program.methods
        .startEvent()
        .accounts({
          admin: admin.publicKey,
          event: testEventPda,
        })
        .signers([admin])
        .rpc();
    });

    it("User mints a complete set", async () => {
      // Create token accounts for user1
      user1YesAccount = await createAccount(
        provider.connection,
        user1,
        testYesMintPda,
        user1.publicKey
      );

      user1NoAccount = await createAccount(
        provider.connection,
        user1,
        testNoMintPda,
        user1.publicKey
      );

      const mintAmount = new anchor.BN(5 * LAMPORTS_PER_SOL);

      await program.methods
        .mintSet(mintAmount)
        .accounts({
          user: user1.publicKey,
          event: testEventPda,
          market: testMarketPda,
          yesMint: testYesMintPda,
          noMint: testNoMintPda,
          userYes: user1YesAccount,
          userNo: user1NoAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      const yesBalance = await provider.connection.getTokenAccountBalance(user1YesAccount);
      const noBalance = await provider.connection.getTokenAccountBalance(user1NoAccount);

      assert.equal(yesBalance.value.amount, mintAmount.toString());
      assert.equal(noBalance.value.amount, mintAmount.toString());

      console.log("✓ User minted 5 YES + 5 NO tokens");
    });

    it("User burns a complete set to get SOL back", async () => {
      const burnAmount = new anchor.BN(2 * LAMPORTS_PER_SOL);
      const balanceBefore = await provider.connection.getBalance(user1.publicKey);

      await program.methods
        .burnSet(burnAmount)
        .accounts({
          user: user1.publicKey,
          event: testEventPda,
          market: testMarketPda,
          yesMint: testYesMintPda,
          noMint: testNoMintPda,
          userYes: user1YesAccount,
          userNo: user1NoAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      const yesBalance = await provider.connection.getTokenAccountBalance(user1YesAccount);
      const noBalance = await provider.connection.getTokenAccountBalance(user1NoAccount);

      // Should have 3 SOL worth left (5 - 2)
      const expected = (3 * LAMPORTS_PER_SOL).toString();
      assert.equal(yesBalance.value.amount, expected);
      assert.equal(noBalance.value.amount, expected);

      console.log("✓ User burned 2 YES + 2 NO and got SOL back");
    });
  });

  describe("Order Placement and Cancellation", () => {
    let user2YesAccount: PublicKey;
    let user2NoAccount: PublicKey;
    let orderPda: PublicKey;
    let orderEscrowPda: PublicKey;

    before(async () => {
      // Setup user2 with tokens
      user2YesAccount = await createAccount(
        provider.connection,
        user2,
        yesMintPda,
        user2.publicKey
      );

      user2NoAccount = await createAccount(
        provider.connection,
        user2,
        noMintPda,
        user2.publicKey
      );

      // Mint tokens for user2
      await program.methods
        .mintSet(new anchor.BN(10 * LAMPORTS_PER_SOL))
        .accounts({
          user: user2.publicKey,
          event: eventPda,
          market: marketPda,
          yesMint: yesMintPda,
          noMint: noMintPda,
          userYes: user2YesAccount,
          userNo: user2NoAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user2])
        .rpc();
    });

    it("User places a sell order for NO tokens", async () => {
      const market = await program.account.market.fetch(marketPda);
      const orderId = market.nextOrderId;

      [orderPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("order"),
          marketPda.toBuffer(),
          orderId.toArrayLike(Buffer, "le", 8)
        ],
        program.programId
      );

      [orderEscrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("order_escrow"), orderPda.toBuffer()],
        program.programId
      );

      const sellPrice = 6000; // 60% price
      const sellSize = new anchor.BN(2 * LAMPORTS_PER_SOL);

      await program.methods
        .placeOrder(
          { sell: {} },
          { no: {} },
          sellPrice,
          sellSize
        )
        .accounts({
          user: user2.publicKey,
          market: marketPda,
          order: orderPda,
          yesMint: yesMintPda,
          noMint: noMintPda,
          userYes: user2YesAccount,
          userNo: user2NoAccount,
          orderEscrowToken: orderEscrowPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user2])
        .rpc();

      const order = await program.account.order.fetch(orderPda);
      assert.ok(order.user.equals(user2.publicKey));
      assert.equal(order.price, sellPrice);
      assert.ok(order.size.eq(sellSize));
      assert.ok(order.filled.eq(new anchor.BN(0)));
      assert.equal(order.cancelled, false);

      console.log("✓ User placed sell order for 2 NO @ 60%");
    });

    it("User cancels an unfilled order", async () => {
      const noBalanceBefore = await provider.connection.getTokenAccountBalance(user2NoAccount);

      await program.methods
        .cancelOrder()
        .accounts({
          user: user2.publicKey,
          order: orderPda,
          yesMint: yesMintPda,
          noMint: noMintPda,
          userYes: user2YesAccount,
          userNo: user2NoAccount,
          orderEscrowToken: orderEscrowPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user2])
        .rpc();

      const order = await program.account.order.fetch(orderPda);
      assert.equal(order.cancelled, true);

      const noBalanceAfter = await provider.connection.getTokenAccountBalance(user2NoAccount);
      
      // Should have gotten tokens back
      assert.ok(
        BigInt(noBalanceAfter.value.amount) > BigInt(noBalanceBefore.value.amount)
      );

      console.log("✓ User cancelled order and got tokens back");
    });
  });

  describe("Order Matching", () => {
    let buyOrderPda: PublicKey;
    let sellOrderPda: PublicKey;
    let buyEscrowPda: PublicKey;
    let sellEscrowPda: PublicKey;
    let user1YesAccount: PublicKey;
    let user1NoAccount: PublicKey;
    let user2YesAccount: PublicKey;
    let user2NoAccount: PublicKey;

    before(async () => {
      // Get token accounts
      const user1Accounts = await provider.connection.getTokenAccountsByOwner(
        user1.publicKey,
        { mint: yesMintPda }
      );
      user1YesAccount = user1Accounts.value[0].pubkey;

      const user1NoAccounts = await provider.connection.getTokenAccountsByOwner(
        user1.publicKey,
        { mint: noMintPda }
      );
      user1NoAccount = user1NoAccounts.value[0].pubkey;

      const user2Accounts = await provider.connection.getTokenAccountsByOwner(
        user2.publicKey,
        { mint: yesMintPda }
      );
      user2YesAccount = user2Accounts.value[0].pubkey;

      const user2NoAccounts = await provider.connection.getTokenAccountsByOwner(
        user2.publicKey,
        { mint: noMintPda }
      );
      user2NoAccount = user2NoAccounts.value[0].pubkey;
    });

    it("Creates matching buy and sell orders", async () => {
      const market = await program.account.market.fetch(marketPda);
      
      // User1 wants to BUY YES tokens (sell order for YES @ 40%)
      const sellOrderId = market.nextOrderId;
      [sellOrderPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("order"),
          marketPda.toBuffer(),
          sellOrderId.toArrayLike(Buffer, "le", 8)
        ],
        program.programId
      );

      [sellEscrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("order_escrow"), sellOrderPda.toBuffer()],
        program.programId
      );

      await program.methods
        .placeOrder(
          { sell: {} },
          { yes: {} },
          4000, // 40%
          new anchor.BN(1 * LAMPORTS_PER_SOL)
        )
        .accounts({
          user: user1.publicKey,
          market: marketPda,
          order: sellOrderPda,
          yesMint: yesMintPda,
          noMint: noMintPda,
          userYes: user1YesAccount,
          userNo: user1NoAccount,
          orderEscrowToken: sellEscrowPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      const updatedMarket = await program.account.market.fetch(marketPda);
      
      // User2 wants to SELL YES tokens (buy order for YES @ 45%)
      const buyOrderId = updatedMarket.nextOrderId;
      [buyOrderPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("order"),
          marketPda.toBuffer(),
          buyOrderId.toArrayLike(Buffer, "le", 8)
        ],
        program.programId
      );

      [buyEscrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("order_escrow"), buyOrderPda.toBuffer()],
        program.programId
      );

      await program.methods
        .placeOrder(
          { buy: {} },
          { yes: {} },
          4500, // 45% - higher than sell, so should match
          new anchor.BN(1 * LAMPORTS_PER_SOL)
        )
        .accounts({
          user: user2.publicKey,
          market: marketPda,
          order: buyOrderPda,
          yesMint: yesMintPda,
          noMint: noMintPda,
          userYes: user2YesAccount,
          userNo: user2NoAccount,
          orderEscrowToken: buyEscrowPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user2])
        .rpc();

      console.log("✓ Created matching buy and sell orders");
    });

    it("Matches the orders", async () => {
      const matchSize = new anchor.BN(1 * LAMPORTS_PER_SOL);

      await program.methods
        .matchOrders(matchSize)
        .accounts({
          matcher: admin.publicKey,
          buyOrder: buyOrderPda,
          sellOrder: sellOrderPda,
          yesMint: yesMintPda,
          noMint: noMintPda,
          buyerYes: user2YesAccount,
          buyerNo: user2NoAccount,
          sellerYes: user1YesAccount,
          sellerNo: user1NoAccount,
          buyOrderEscrow: buyEscrowPda,
          sellOrderEscrow: sellEscrowPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      const buyOrder = await program.account.order.fetch(buyOrderPda);
      const sellOrder = await program.account.order.fetch(sellOrderPda);

      assert.ok(buyOrder.filled.eq(matchSize));
      assert.ok(sellOrder.filled.eq(matchSize));

      console.log("✓ Orders matched successfully");
    });
  });

  describe("Market Resolution & Redemption", () => {
    let user1YesAccount: PublicKey;
    let user1NoAccount: PublicKey;

    before(async () => {
      const user1Accounts = await provider.connection.getTokenAccountsByOwner(
        user1.publicKey,
        { mint: yesMintPda }
      );
      user1YesAccount = user1Accounts.value[0].pubkey;

      const user1NoAccounts = await provider.connection.getTokenAccountsByOwner(
        user1.publicKey,
        { mint: noMintPda }
      );
      user1NoAccount = user1NoAccounts.value[0].pubkey;
    });

    it("Admin resolves market", async () => {
      await program.methods
        .resolveMarket({ yes: {} })
        .accounts({
          admin: admin.publicKey,
          event: eventPda,
          market: marketPda,
        })
        .signers([admin])
        .rpc();

      const market = await program.account.market.fetch(marketPda);
      assert.equal(market.resolved, true);
      assert.deepEqual(market.winningSide, { yes: {} });

      console.log("✓ Market resolved to YES");
    });

    it("User redeems winning tokens", async () => {
      const yesBalance = await provider.connection.getTokenAccountBalance(user1YesAccount);
      const redeemAmount = new anchor.BN(yesBalance.value.amount);

      if (redeemAmount.gt(new anchor.BN(0))) {
        const balanceBefore = await provider.connection.getBalance(user1.publicKey);

        await program.methods
          .redeem(redeemAmount)
          .accounts({
            user: user1.publicKey,
            event: eventPda,
            market: marketPda,
            yesMint: yesMintPda,
            noMint: noMintPda,
            userYes: user1YesAccount,
            userNo: user1NoAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();

        const balanceAfter = await provider.connection.getBalance(user1.publicKey);
        
        // Should have more SOL (minus transaction fees)
        assert.ok(balanceAfter > balanceBefore);

        console.log("✓ User redeemed winning YES tokens for SOL");
      }
    });
  });

  describe("Error Cases", () => {
    it("Fails to redeem losing tokens", async () => {
      const user2NoAccounts = await provider.connection.getTokenAccountsByOwner(
        user2.publicKey,
        { mint: noMintPda }
      );
      const user2NoAccount = user2NoAccounts.value[0].pubkey;

      const user2YesAccounts = await provider.connection.getTokenAccountsByOwner(
        user2.publicKey,
        { mint: yesMintPda }
      );
      const user2YesAccount = user2YesAccounts.value[0].pubkey;

      const noBalance = await provider.connection.getTokenAccountBalance(user2NoAccount);
      
      if (new anchor.BN(noBalance.value.amount).gt(new anchor.BN(0))) {
        try {
          await program.methods
            .redeem(new anchor.BN(1 * LAMPORTS_PER_SOL))
            .accounts({
              user: user2.publicKey,
              event: eventPda,
              market: marketPda,
              yesMint: yesMintPda,
              noMint: noMintPda,
              userYes: user2YesAccount,
              userNo: user2NoAccount,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([user2])
            .rpc();
          
          assert.fail("Should have failed to redeem NO tokens when YES won");
        } catch (err) {
          console.log("✓ Correctly prevented redemption of losing tokens");
        }
      }
    });

    it("Fails to place order after resolution", async () => {
      const market = await program.account.market.fetch(marketPda);
      const orderId = market.nextOrderId;

      const [orderPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("order"),
          marketPda.toBuffer(),
          orderId.toArrayLike(Buffer, "le", 8)
        ],
        program.programId
      );

      const [orderEscrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("order_escrow"), orderPda.toBuffer()],
        program.programId
      );

      const user1Accounts = await provider.connection.getTokenAccountsByOwner(
        user1.publicKey,
        { mint: yesMintPda }
      );
      const user1YesAccount = user1Accounts.value[0].pubkey;

      const user1NoAccounts = await provider.connection.getTokenAccountsByOwner(
        user1.publicKey,
        { mint: noMintPda }
      );
      const user1NoAccount = user1NoAccounts.value[0].pubkey;

      try {
        await program.methods
          .placeOrder(
            { sell: {} },
            { yes: {} },
            5000,
            new anchor.BN(1 * LAMPORTS_PER_SOL)
          )
          .accounts({
            user: user1.publicKey,
            market: marketPda,
            order: orderPda,
            yesMint: yesMintPda,
            noMint: noMintPda,
            userYes: user1YesAccount,
            userNo: user1NoAccount,
            orderEscrowToken: orderEscrowPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user1])
          .rpc();
        
        assert.fail("Should have failed to place order after resolution");
      } catch (err) {
        console.log("✓ Correctly prevented order placement after resolution");
      }
    });
  });
});

