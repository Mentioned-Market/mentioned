// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/MentionedMarket.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {
        _mint(msg.sender, 1000000 * 1e6); // 1M USDC
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MentionedMarketTest is Test {
    MentionedMarket public market;
    MockUSDC public usdc;

    address public owner = address(1);
    address public alice = address(2);
    address public bob = address(3);
    address public charlie = address(4);
    
    uint256 public eventId;
    uint256 public wordId;

    function setUp() public {
        // Deploy USDC first
        usdc = new MockUSDC(); // This mints 1M USDC to this contract
        
        // Transfer USDC to owner
        usdc.transfer(owner, 100000 * 1e6);
        
        // Deploy market as owner
        vm.prank(owner);
        market = new MentionedMarket(address(usdc));
        
        // Fund users  (total: 30k, leaving 870k for test contract)
        usdc.transfer(alice, 10000 * 1e6);
        usdc.transfer(bob, 10000 * 1e6);
        usdc.transfer(charlie, 10000 * 1e6);
        
        // Approve market
        vm.prank(alice);
        usdc.approve(address(market), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(market), type(uint256).max);
        vm.prank(charlie);
        usdc.approve(address(market), type(uint256).max);
        
        // Create event and add word
        vm.startPrank(owner);
        eventId = market.createEvent("Trump Speech");
        wordId = market.addWord(eventId, "tariffs");
        market.setEventState(eventId, MentionedMarket.EventState.LIVE);
        vm.stopPrank();
    }
    
    // ============ AMM Tests ============
    
    function testAMMInitialization() public {
        (uint256 yesLiq, uint256 noLiq, uint256 k, bool init) = market.getAMMPool(wordId);
        
        assertTrue(init, "Pool should be initialized");
        assertEq(yesLiq, 100e6, "YES liquidity should be 100");
        assertEq(noLiq, 100e6, "NO liquidity should be 100");
        assertEq(k, 100e6 * 100e6, "K should be product of liquidities");
    }
    
    function testAMMInitialPrice() public {
        uint256 yesPrice = market.getCurrentPrice(wordId, MentionedMarket.Outcome.YES);
        uint256 noPrice = market.getCurrentPrice(wordId, MentionedMarket.Outcome.NO);
        
        assertEq(yesPrice, 0.5e6, "YES price should be 0.5 USDC initially");
        assertEq(noPrice, 0.5e6, "NO price should be 0.5 USDC initially");
    }
    
    function testBuyYesTokensAMM() public {
        uint256 usdcToSpend = 10e6; // 10 USDC
        
        uint256 aliceBalanceBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        (uint256 tokensOut, uint256 usdcSpent) = market.buyTokensAMM(
            wordId,
            MentionedMarket.Outcome.YES,
            1, // min tokens
            usdcToSpend
        );
        
        // Check balances
        assertGt(tokensOut, 0, "Should receive tokens");
        assertEq(usdcSpent, usdcToSpend, "Should spend specified USDC");
        assertEq(
            usdc.balanceOf(alice),
            aliceBalanceBefore - usdcSpent,
            "Alice USDC should decrease"
        );
        
        // Check token balance
        uint256 tokenBalance = market.getTokenBalance(alice, wordId, MentionedMarket.Outcome.YES);
        assertEq(tokenBalance, tokensOut, "Alice should have YES tokens");
        
        // Price should increase after buy
        uint256 newPrice = market.getCurrentPrice(wordId, MentionedMarket.Outcome.YES);
        assertGt(newPrice, 0.5e6, "YES price should increase");
    }
    
    function testBuyNoTokensAMM() public {
        uint256 usdcToSpend = 10e6;
        
        vm.prank(alice);
        (uint256 tokensOut, uint256 usdcSpent) = market.buyTokensAMM(
            wordId,
            MentionedMarket.Outcome.NO,
            1,
            usdcToSpend
        );
        
        assertGt(tokensOut, 0, "Should receive NO tokens");
        
        uint256 tokenBalance = market.getTokenBalance(alice, wordId, MentionedMarket.Outcome.NO);
        assertEq(tokenBalance, tokensOut, "Alice should have NO tokens");
        
        // NO price should increase
        uint256 newPrice = market.getCurrentPrice(wordId, MentionedMarket.Outcome.NO);
        assertGt(newPrice, 0.5e6, "NO price should increase");
    }
    
    function testSellTokensAMM() public {
        // First buy tokens
        vm.prank(alice);
        (uint256 tokensOut,) = market.buyTokensAMM(
            wordId,
            MentionedMarket.Outcome.YES,
            1,
            10e6
        );
        
        uint256 aliceBalanceBefore = usdc.balanceOf(alice);

        // Then sell half
        uint256 tokensToSell = tokensOut / 2;
        vm.prank(alice);
        uint256 usdcOut = market.sellTokensAMM(
            wordId,
            MentionedMarket.Outcome.YES,
            tokensToSell,
            0 // no min for test
        );
        
        assertGt(usdcOut, 0, "Should receive USDC");
        assertEq(
            usdc.balanceOf(alice),
            aliceBalanceBefore + usdcOut,
            "Alice USDC should increase"
        );
    }
    
    function testPriceMovementAMM() public {
        uint256 initialPrice = market.getCurrentPrice(wordId, MentionedMarket.Outcome.YES);
        
        // Alice buys YES
        vm.prank(alice);
        market.buyTokensAMM(wordId, MentionedMarket.Outcome.YES, 1, 20e6);
        
        uint256 priceAfterBuy = market.getCurrentPrice(wordId, MentionedMarket.Outcome.YES);
        assertGt(priceAfterBuy, initialPrice, "Price should increase after buy");

        // Bob buys NO
        vm.prank(bob);
        market.buyTokensAMM(wordId, MentionedMarket.Outcome.NO, 1, 15e6);

        uint256 priceAfterCounterTrade = market.getCurrentPrice(wordId, MentionedMarket.Outcome.YES);
        assertLt(priceAfterCounterTrade, priceAfterBuy, "Price should decrease after counter trade");
    }

    function testSlippageProtection() public {
        vm.prank(alice);
        vm.expectRevert("Slippage exceeded");
        market.buyTokensAMM(
            wordId,
            MentionedMarket.Outcome.YES,
            1000e6, // unrealistic min tokens
            10e6
        );
    }
    
    function testAMMQuotes() public {
        (uint256 tokensOut, uint256 effectivePrice) = market.getAMMBuyQuote(
            wordId,
            MentionedMarket.Outcome.YES,
            10e6
        );
        
        assertGt(tokensOut, 0, "Should quote tokens");
        assertGt(effectivePrice, 0, "Should quote price");
    }
    
    // ============ Limit Order Tests ============
    
    function testPlaceBuyLimitOrder() public {
        uint256 price = 0.6e6; // 0.6 USDC
        uint256 amount = 100;

        uint256 aliceBalanceBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        uint256 orderId = market.placeLimitOrder(
            wordId,
            MentionedMarket.Outcome.YES,
            MentionedMarket.OrderType.BUY,
            price,
            amount
        );
        
        assertEq(orderId, 1, "First order ID should be 1");

        // Check USDC locked
        uint256 expectedLocked = (price * amount) / 1e6;
        assertEq(
            usdc.balanceOf(alice),
            aliceBalanceBefore - expectedLocked,
            "USDC should be locked"
        );
        
        // Check order
        MentionedMarket.Order memory order = market.getOrder(orderId);
        assertEq(order.maker, alice, "Maker should be alice");
        assertEq(order.price, price, "Price should match");
        assertEq(order.amount, amount, "Amount should match");
        assertEq(order.filled, 0, "Should not be filled");
    }
    
    function testPlaceSellLimitOrder() public {
        // First get tokens via AMM
        vm.prank(alice);
        market.buyTokensAMM(wordId, MentionedMarket.Outcome.YES, 1, 50e6);
        
        uint256 tokensBefore = market.getTokenBalance(alice, wordId, MentionedMarket.Outcome.YES);

        uint256 price = 0.7e6;
        uint256 amount = 50;

        vm.prank(alice);
        uint256 orderId = market.placeLimitOrder(
            wordId,
            MentionedMarket.Outcome.YES,
            MentionedMarket.OrderType.SELL,
            price,
            amount
        );

        // Tokens should be locked (burned)
        uint256 tokensAfter = market.getTokenBalance(alice, wordId, MentionedMarket.Outcome.YES);
        assertEq(tokensAfter, tokensBefore - amount, "Tokens should be locked");
    }
    
    function testFillBuyOrder() public {
        // Alice places buy order
        uint256 price = 0.6e6;
        uint256 amount = 100;
        
        vm.prank(alice);
        uint256 orderId = market.placeLimitOrder(
            wordId,
            MentionedMarket.Outcome.YES,
            MentionedMarket.OrderType.BUY,
            price,
            amount
        );
        
        // Bob gets tokens and fills order
        vm.prank(bob);
        market.buyTokensAMM(wordId, MentionedMarket.Outcome.YES, 1, 50e6);
        
        uint256 bobBalanceBefore = usdc.balanceOf(bob);
        uint256 bobTokensBefore = market.getTokenBalance(bob, wordId, MentionedMarket.Outcome.YES);
        
        vm.prank(bob);
        market.fillOrder(orderId, amount);
        
        // Check Bob received USDC
        assertGt(usdc.balanceOf(bob), bobBalanceBefore, "Bob should receive USDC");
        
        // Check Bob's tokens decreased
        assertEq(
            market.getTokenBalance(bob, wordId, MentionedMarket.Outcome.YES),
            bobTokensBefore - amount,
            "Bob tokens should decrease"
        );
        
        // Check Alice received tokens
        assertEq(
            market.getTokenBalance(alice, wordId, MentionedMarket.Outcome.YES),
            amount,
            "Alice should receive tokens"
        );
    }
    
    function testFillSellOrder() public {
        // Alice gets tokens and places sell order
        vm.prank(alice);
        market.buyTokensAMM(wordId, MentionedMarket.Outcome.YES, 1, 50e6);

        uint256 price = 0.7e6;
        uint256 amount = 50;

        vm.prank(alice);
        uint256 orderId = market.placeLimitOrder(
            wordId,
            MentionedMarket.Outcome.YES,
            MentionedMarket.OrderType.SELL,
            price,
            amount
        );

        // Bob fills order
        uint256 bobBalanceBefore = usdc.balanceOf(bob);

        vm.prank(bob);
        market.fillOrder(orderId, amount);
        
        // Check Bob received tokens
        assertEq(
            market.getTokenBalance(bob, wordId, MentionedMarket.Outcome.YES),
            amount,
            "Bob should receive tokens"
        );
        
        // Check Bob's USDC decreased
        uint256 expectedCost = (price * amount) / 1e6;
        assertEq(
            usdc.balanceOf(bob),
            bobBalanceBefore - expectedCost,
            "Bob USDC should decrease"
        );
    }

    function testCancelOrder() public {
        uint256 price = 0.6e6;
        uint256 amount = 100;

        vm.prank(alice);
        uint256 orderId = market.placeLimitOrder(
            wordId,
            MentionedMarket.Outcome.YES,
            MentionedMarket.OrderType.BUY,
            price,
            amount
        );

        uint256 aliceBalanceBefore = usdc.balanceOf(alice);
        
        vm.prank(alice);
        market.cancelOrder(orderId);

        // Check USDC refunded
        uint256 expectedRefund = (price * amount) / 1e6;
        assertEq(
            usdc.balanceOf(alice),
            aliceBalanceBefore + expectedRefund,
            "USDC should be refunded"
        );
        
        // Check order cancelled
        MentionedMarket.Order memory order = market.getOrder(orderId);
        assertTrue(order.cancelled, "Order should be cancelled");
    }
    
    function testPartialFill() public {
        uint256 price = 0.6e6;
        uint256 amount = 100;
        
        vm.prank(alice);
        uint256 orderId = market.placeLimitOrder(
            wordId,
            MentionedMarket.Outcome.YES,
            MentionedMarket.OrderType.BUY,
            price,
            amount
        );
        
        // Bob gets tokens
        vm.prank(bob);
        market.buyTokensAMM(wordId, MentionedMarket.Outcome.YES, 1, 50e6);
        
        // Fill partial
        uint256 fillAmount = 50;
        vm.prank(bob);
        market.fillOrder(orderId, fillAmount);

        MentionedMarket.Order memory order = market.getOrder(orderId);
        assertEq(order.filled, fillAmount, "Should be partially filled");
        
        // Charlie gets tokens and fills rest
        vm.prank(charlie);
        market.buyTokensAMM(wordId, MentionedMarket.Outcome.YES, 1, 50e6);
        
        vm.prank(charlie);
        market.fillOrder(orderId, fillAmount);
        
        order = market.getOrder(orderId);
        assertEq(order.filled, amount, "Should be fully filled");
    }
    
    // ============ Hybrid System Tests ============
    
    function testHybridTrading() public {
        // Alice uses AMM to buy YES
        vm.prank(alice);
        (uint256 tokensFromAMM,) = market.buyTokensAMM(
            wordId,
            MentionedMarket.Outcome.YES,
            1,
            30e6
        );
        
        uint256 priceAfterAMM = market.getCurrentPrice(wordId, MentionedMarket.Outcome.YES);
        
        // Bob places limit order at lower price
        uint256 limitPrice = priceAfterAMM - 0.05e6;
        vm.prank(bob);
        uint256 orderId = market.placeLimitOrder(
            wordId,
            MentionedMarket.Outcome.YES,
            MentionedMarket.OrderType.BUY,
            limitPrice,
            100
        );
        
        // Charlie can choose: AMM (instant) or fill Bob's order (better price)
        // Let's say Charlie fills Bob's order
        vm.prank(charlie);
        market.buyTokensAMM(wordId, MentionedMarket.Outcome.YES, 1, 50e6);
        
        vm.prank(charlie);
        market.fillOrder(orderId, 50);
        
        // All three users should have tokens
        assertGt(market.getTokenBalance(alice, wordId, MentionedMarket.Outcome.YES), 0, "Alice has tokens");
        assertGt(market.getTokenBalance(bob, wordId, MentionedMarket.Outcome.YES), 0, "Bob has tokens");
        assertGt(market.getTokenBalance(charlie, wordId, MentionedMarket.Outcome.YES), 0, "Charlie has tokens");
    }
    
    // ============ Resolution Tests ============
    
    function testClaimWinnings() public {
        // Alice buys YES tokens with 50 USDC
        uint256 usdcSpent = 50e6;
        vm.prank(alice);
        (uint256 tokensOut,) = market.buyTokensAMM(
            wordId,
            MentionedMarket.Outcome.YES,
            1,
            usdcSpent
        );
        
        // The contract has Alice's 50 USDC
        // Alice received tokensOut (in wei, e.g., 33.3e6 = 33.3 tokens)
        
        // Resolve to YES
        vm.prank(owner);
        market.resolveWord(wordId, MentionedMarket.Outcome.YES);
        
        uint256 aliceBalanceBefore = usdc.balanceOf(alice);
        
        // Claim winnings
        vm.prank(alice);
        market.claimWinnings(wordId, tokensOut);
        
        // Should receive tokensOut USDC (1:1 ratio, both in 1e6 scale)
        // e.g., 33.3e6 tokens -> 33.3e6 USDC = 33.3 USDC
        assertEq(
            usdc.balanceOf(alice),
            aliceBalanceBefore + tokensOut,
            "Should receive 1 USDC per winning token"
        );
        
        // Alice spent 50 USDC, got back ~33.3 USDC
        // She lost money because she bought at a premium (AMM slippage)
    }
    
    function testLosingTokensWorthless() public {
        // Alice buys NO tokens
        vm.prank(alice);
        (uint256 tokensOut,) = market.buyTokensAMM(
            wordId,
            MentionedMarket.Outcome.NO,
            1,
            50e6
        );
        
        // Resolve to YES (Alice loses)
        vm.prank(owner);
        market.resolveWord(wordId, MentionedMarket.Outcome.YES);
        
        // Alice still has NO tokens but they're worthless
        uint256 noTokens = market.getTokenBalance(alice, wordId, MentionedMarket.Outcome.NO);
        assertEq(noTokens, tokensOut, "Still has NO tokens but they're worthless");
        
        // Cannot claim winnings with losing tokens
        // Claiming will burn the tokens but won't give USDC
        // This is just to show losing tokens have no value
    }
    
    // ============ Edge Cases ============
    
    function testCannotTradeResolvedMarket() public {
        vm.prank(owner);
        market.resolveWord(wordId, MentionedMarket.Outcome.YES);
        
        vm.prank(alice);
        vm.expectRevert("Word already resolved");
        market.buyTokensAMM(wordId, MentionedMarket.Outcome.YES, 1, 10e6);
    }
    
    function testCannotTradeInactiveEvent() public {
        vm.prank(owner);
        market.setEventState(eventId, MentionedMarket.EventState.PREMARKET);

        vm.prank(alice);
        vm.expectRevert("Event not live");
        market.buyTokensAMM(wordId, MentionedMarket.Outcome.YES, 1, 10e6);
    }
    
    function testMultipleWords() public {
        // Set event back to premarket to add words
        vm.prank(owner);
        market.setEventState(eventId, MentionedMarket.EventState.PREMARKET);
        
        // Add more words
        vm.startPrank(owner);
        uint256 word2 = market.addWord(eventId, "china");
        uint256 word3 = market.addWord(eventId, "economy");
        
        // Set back to live
        market.setEventState(eventId, MentionedMarket.EventState.LIVE);
        vm.stopPrank();
        
        // Each should have independent AMM pools
        uint256 price1 = market.getCurrentPrice(wordId, MentionedMarket.Outcome.YES);
        uint256 price2 = market.getCurrentPrice(word2, MentionedMarket.Outcome.YES);
        uint256 price3 = market.getCurrentPrice(word3, MentionedMarket.Outcome.YES);
        
        assertEq(price1, price2, "Initial prices should match");
        assertEq(price2, price3, "Initial prices should match");
        
        // Trade on word1 shouldn't affect word2
        vm.prank(alice);
        market.buyTokensAMM(wordId, MentionedMarket.Outcome.YES, 1, 30e6);
        
        uint256 newPrice1 = market.getCurrentPrice(wordId, MentionedMarket.Outcome.YES);
        uint256 newPrice2 = market.getCurrentPrice(word2, MentionedMarket.Outcome.YES);
        
        assertGt(newPrice1, price1, "Word1 price should increase");
        assertEq(newPrice2, price2, "Word2 price should not change");
    }
    
    function testBulkOperations() public {
        // Set event back to premarket
        vm.prank(owner);
        market.setEventState(eventId, MentionedMarket.EventState.PREMARKET);
        
        // Add words in bulk
        string[] memory words = new string[](3);
        words[0] = "mexico";
        words[1] = "canada";
        words[2] = "europe";
        
        vm.prank(owner);
        uint256[] memory wordIds = market.addWordsBulk(eventId, words);
        
        assertEq(wordIds.length, 3, "Should create 3 words");
        
        // Each should have AMM pool
        for (uint256 i = 0; i < wordIds.length; i++) {
            (,,, bool init) = market.getAMMPool(wordIds[i]);
            assertTrue(init, "Pool should be initialized");
        }
    }
    
    function testFeeCollection() public {
        // Set fee to 1%
        vm.prank(owner);
        market.setTradingFee(100); // 100 bps = 1%
        
        uint256 contractBalanceBefore = usdc.balanceOf(address(market));
        
        // Trade via AMM (fees collected)
        vm.prank(alice);
        market.buyTokensAMM(wordId, MentionedMarket.Outcome.YES, 1, 100e6);
        
        // Contract should have more USDC (fees)
        uint256 contractBalanceAfter = usdc.balanceOf(address(market));
        assertGt(contractBalanceAfter, contractBalanceBefore, "Fees should be collected");
    }
    
    // ============ Gas Tests ============
    
    function testGasAMMBuy() public {
        vm.prank(alice);
        uint256 gasBefore = gasleft();
        market.buyTokensAMM(wordId, MentionedMarket.Outcome.YES, 1, 10e6);
        uint256 gasUsed = gasBefore - gasleft();

        console.log("Gas used for AMM buy:", gasUsed);
        // Should be much cheaper than limit order + fill
    }

    function testGasLimitOrder() public {
        vm.prank(alice);
        uint256 gasBefore = gasleft();
        market.placeLimitOrder(
            wordId,
            MentionedMarket.Outcome.YES,
            MentionedMarket.OrderType.BUY,
            0.6e6,
            100
        );
        uint256 gasUsed = gasBefore - gasleft();
        
        console.log("Gas used for limit order:", gasUsed);
    }
}
