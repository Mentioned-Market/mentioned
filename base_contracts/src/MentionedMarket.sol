// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MentionedMarket
 * @notice A hybrid AMM-CLOB prediction market for word mentions in events
 * @dev Uses ERC-1155 for YES/NO tokens, supports both instant AMM trading and limit order book
 */
contract MentionedMarket is ERC1155, ERC1155Holder, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum EventState {
        PREMARKET,
        LIVE,
        RESOLVED
    }

    enum OrderType {
        BUY,
        SELL
    }

    enum Outcome {
        YES,
        NO
    }

    // ============ Structs ============

    struct Event {
        string name;
        EventState state;
        uint256 createdAt;
        uint256[] wordIds;
        mapping(uint256 => bool) hasWord;
    }

    struct Word {
        uint256 eventId;
        string text;
        bool resolved;
        Outcome outcome;
    }

    struct Order {
        uint256 orderId;
        uint256 wordId;
        address maker;
        Outcome outcome;
        OrderType orderType;
        uint256 price; // Price in USDC (scaled by 1e6, range 0 to 1e6)
        uint256 amount;
        uint256 filled;
        bool cancelled;
    }

    struct AMMPool {
        uint256 yesLiquidity; // YES token reserves
        uint256 noLiquidity;  // NO token reserves
        uint256 k;            // Constant product k = yesLiquidity * noLiquidity
        bool initialized;
    }

    // ============ State Variables ============

    IERC20 public immutable USDC;

    uint256 public nextEventId = 1;
    uint256 public nextWordId = 1;
    uint256 public nextOrderId = 1;

    uint256 public tradingFeeBps = 10; // 0.1% default fee
    uint256 public constant INITIAL_LIQUIDITY = 100e6; // 100 tokens per side initially
    uint256 public constant MIN_LIQUIDITY = 1e6; // Minimum 1 token

    mapping(uint256 => Event) public events;
    mapping(uint256 => Word) public words;
    mapping(uint256 => Order) public orders;

    // AMM pools for each word
    mapping(uint256 => AMMPool) public ammPools;

    // Active order IDs for each word/outcome/orderType
    mapping(uint256 => mapping(Outcome => mapping(OrderType => uint256[]))) public activeOrders;

    // User orders
    mapping(address => uint256[]) public userOrders;

    // ============ Events ============

    event EventCreated(uint256 indexed eventId, string name);
    event EventStateChanged(uint256 indexed eventId, EventState newState);
    event WordAdded(uint256 indexed eventId, uint256 indexed wordId, string text);
    event WordResolved(uint256 indexed wordId, Outcome outcome);

    event AMMPoolInitialized(uint256 indexed wordId, uint256 yesLiquidity, uint256 noLiquidity);
    event AMMTrade(
        uint256 indexed wordId,
        address indexed trader,
        Outcome outcome,
        bool isBuy,
        uint256 tokenAmount,
        uint256 usdcAmount,
        uint256 newPrice
    );

    event OrderPlaced(
        uint256 indexed orderId,
        uint256 indexed wordId,
        address indexed maker,
        Outcome outcome,
        OrderType orderType,
        uint256 price,
        uint256 amount
    );

    event OrderFilled(
        uint256 indexed orderId,
        address indexed taker,
        uint256 amount,
        uint256 price
    );

    event OrderCancelled(uint256 indexed orderId);
    event TradingFeeUpdated(uint256 newFeeBps);

    // ============ Constructor ============

    constructor(address _usdc) ERC1155("") Ownable(msg.sender) {
        require(_usdc != address(0), "Invalid USDC address");
        USDC = IERC20(_usdc);
    }

    // ============ Modifiers ============

    modifier onlyLiveEvent(uint256 eventId) {
        require(events[eventId].state == EventState.LIVE, "Event not live");
        _;
    }

    modifier onlyUnresolvedWord(uint256 wordId) {
        require(!words[wordId].resolved, "Word already resolved");
        _;
    }

    // ============ Event Management ============

    function createEvent(string calldata name) external onlyOwner returns (uint256) {
        uint256 eventId = nextEventId++;
        Event storage newEvent = events[eventId];
        newEvent.name = name;
        newEvent.state = EventState.PREMARKET;
        newEvent.createdAt = block.timestamp;

        emit EventCreated(eventId, name);
        return eventId;
    }

    function setEventState(uint256 eventId, EventState newState) external onlyOwner {
        require(events[eventId].createdAt > 0, "Event does not exist");
        events[eventId].state = newState;
        emit EventStateChanged(eventId, newState);
    }

    function addWord(uint256 eventId, string calldata text) external onlyOwner returns (uint256) {
        require(events[eventId].createdAt > 0, "Event does not exist");
        require(events[eventId].state == EventState.PREMARKET, "Can only add words in premarket");

        uint256 wordId = nextWordId++;
        words[wordId] = Word({
            eventId: eventId,
            text: text,
            resolved: false,
            outcome: Outcome.YES
        });

        events[eventId].wordIds.push(wordId);
        events[eventId].hasWord[wordId] = true;

        // Initialize AMM pool with equal liquidity (50/50 price)
        _initializeAMMPool(wordId);

        emit WordAdded(eventId, wordId, text);
        return wordId;
    }

    function addWordsBulk(uint256 eventId, string[] calldata texts) 
        external 
        onlyOwner 
        returns (uint256[] memory) 
    {
        require(events[eventId].createdAt > 0, "Event does not exist");
        require(events[eventId].state == EventState.PREMARKET, "Can only add words in premarket");

        uint256[] memory wordIds = new uint256[](texts.length);

        for (uint256 i = 0; i < texts.length; i++) {
            uint256 wordId = nextWordId++;
            words[wordId] = Word({
                eventId: eventId,
                text: texts[i],
                resolved: false,
                outcome: Outcome.YES
            });

            events[eventId].wordIds.push(wordId);
            events[eventId].hasWord[wordId] = true;
            wordIds[i] = wordId;

            // Initialize AMM pool
            _initializeAMMPool(wordId);

            emit WordAdded(eventId, wordId, texts[i]);
        }

        return wordIds;
    }

    function resolveWord(uint256 wordId, Outcome outcome) 
        external 
        onlyOwner 
        onlyUnresolvedWord(wordId) 
    {
        require(words[wordId].eventId > 0, "Word does not exist");
        
        words[wordId].resolved = true;
        words[wordId].outcome = outcome;

        emit WordResolved(wordId, outcome);
    }

    function resolveWordsBulk(uint256[] calldata wordIds, Outcome[] calldata outcomes) 
        external 
        onlyOwner 
    {
        require(wordIds.length == outcomes.length, "Arrays length mismatch");

        for (uint256 i = 0; i < wordIds.length; i++) {
            require(words[wordIds[i]].eventId > 0, "Word does not exist");
            require(!words[wordIds[i]].resolved, "Word already resolved");

            words[wordIds[i]].resolved = true;
            words[wordIds[i]].outcome = outcomes[i];

            emit WordResolved(wordIds[i], outcomes[i]);
        }
    }

    // ============ AMM Functions ============

    function _initializeAMMPool(uint256 wordId) internal {
        AMMPool storage pool = ammPools[wordId];
        require(!pool.initialized, "Pool already initialized");

        pool.yesLiquidity = INITIAL_LIQUIDITY;
        pool.noLiquidity = INITIAL_LIQUIDITY;
        pool.k = INITIAL_LIQUIDITY * INITIAL_LIQUIDITY;
        pool.initialized = true;

        // Mint initial liquidity tokens to contract
        uint256 yesTokenId = _getTokenId(wordId, Outcome.YES);
        uint256 noTokenId = _getTokenId(wordId, Outcome.NO);
        _mint(address(this), yesTokenId, INITIAL_LIQUIDITY, "");
        _mint(address(this), noTokenId, INITIAL_LIQUIDITY, "");

        emit AMMPoolInitialized(wordId, INITIAL_LIQUIDITY, INITIAL_LIQUIDITY);
    }

    /**
     * @notice Buy tokens instantly via AMM (one side only)
     * @param wordId The word ID
     * @param outcome YES or NO
     * @param minTokensOut Minimum tokens to receive (slippage protection)
     * @param maxUSDCIn Maximum USDC to spend
     * @return tokensOut Amount of tokens received
     * @return usdcSpent Amount of USDC spent
     */
    function buyTokensAMM(
        uint256 wordId,
        Outcome outcome,
        uint256 minTokensOut,
        uint256 maxUSDCIn
    ) external nonReentrant onlyLiveEvent(words[wordId].eventId) onlyUnresolvedWord(wordId) 
        returns (uint256 tokensOut, uint256 usdcSpent) 
    {
        require(words[wordId].eventId > 0, "Word does not exist");
        AMMPool storage pool = ammPools[wordId];
        require(pool.initialized, "Pool not initialized");

        // Calculate tokens out and USDC needed
        (tokensOut, usdcSpent) = _calculateBuyAMM(wordId, outcome, maxUSDCIn);
        
        require(tokensOut >= minTokensOut, "Slippage exceeded");
        require(tokensOut > 0, "Insufficient output");

        // Collect USDC from user
        USDC.safeTransferFrom(msg.sender, address(this), usdcSpent);

        // Update pool reserves
        if (outcome == Outcome.YES) {
            pool.yesLiquidity -= tokensOut;
            pool.noLiquidity += usdcSpent;
        } else {
            pool.noLiquidity -= tokensOut;
            pool.yesLiquidity += usdcSpent;
        }

        // Mint tokens to user
        uint256 tokenId = _getTokenId(wordId, outcome);
        _mint(msg.sender, tokenId, tokensOut, "");

        uint256 newPrice = getCurrentPrice(wordId, outcome);
        emit AMMTrade(wordId, msg.sender, outcome, true, tokensOut, usdcSpent, newPrice);
    }

    /**
     * @notice Sell tokens instantly via AMM
     * @param wordId The word ID
     * @param outcome YES or NO
     * @param tokenAmount Amount of tokens to sell
     * @param minUSDCOut Minimum USDC to receive (slippage protection)
     * @return usdcOut Amount of USDC received
     */
    function sellTokensAMM(
        uint256 wordId,
        Outcome outcome,
        uint256 tokenAmount,
        uint256 minUSDCOut
    ) external nonReentrant onlyLiveEvent(words[wordId].eventId) onlyUnresolvedWord(wordId) 
        returns (uint256 usdcOut) 
    {
        require(words[wordId].eventId > 0, "Word does not exist");
        require(tokenAmount > 0, "Amount must be positive");
        AMMPool storage pool = ammPools[wordId];
        require(pool.initialized, "Pool not initialized");

        // Calculate USDC out
        usdcOut = _calculateSellAMM(wordId, outcome, tokenAmount);
        require(usdcOut >= minUSDCOut, "Slippage exceeded");

        // Burn user's tokens
        uint256 tokenId = _getTokenId(wordId, outcome);
        _burn(msg.sender, tokenId, tokenAmount);

        // Update pool reserves
        if (outcome == Outcome.YES) {
            pool.yesLiquidity += tokenAmount;
            pool.noLiquidity -= usdcOut;
        } else {
            pool.noLiquidity += tokenAmount;
            pool.yesLiquidity -= usdcOut;
        }

        // Transfer USDC to user
        USDC.safeTransfer(msg.sender, usdcOut);

        uint256 newPrice = getCurrentPrice(wordId, outcome);
        emit AMMTrade(wordId, msg.sender, outcome, false, tokenAmount, usdcOut, newPrice);
    }

    function _calculateBuyAMM(uint256 wordId, Outcome outcome, uint256 maxUSDCIn) 
        internal 
        view 
        returns (uint256 tokensOut, uint256 usdcIn) 
    {
        AMMPool storage pool = ammPools[wordId];
        
        // For buying YES: spend USDC to get YES tokens
        // yesOut = yesLiquidity - (k / (noLiquidity + usdcIn))
        // For buying NO: spend USDC to get NO tokens
        // noOut = noLiquidity - (k / (yesLiquidity + usdcIn))
        
        if (outcome == Outcome.YES) {
            // Calculate max tokens we can get with maxUSDCIn
            uint256 newNoLiquidity = pool.noLiquidity + maxUSDCIn;
            uint256 newYesLiquidity = pool.k / newNoLiquidity;
            tokensOut = pool.yesLiquidity - newYesLiquidity;
            
            // Apply fee
            tokensOut = (tokensOut * (10000 - tradingFeeBps)) / 10000;
            usdcIn = maxUSDCIn;
        } else {
            // Calculate max tokens we can get with maxUSDCIn
            uint256 newYesLiquidity = pool.yesLiquidity + maxUSDCIn;
            uint256 newNoLiquidity = pool.k / newYesLiquidity;
            tokensOut = pool.noLiquidity - newNoLiquidity;
            
            // Apply fee
            tokensOut = (tokensOut * (10000 - tradingFeeBps)) / 10000;
            usdcIn = maxUSDCIn;
        }
        
        require(tokensOut > 0, "Insufficient liquidity");
    }

    function _calculateSellAMM(uint256 wordId, Outcome outcome, uint256 tokenAmount) 
        internal 
        view 
        returns (uint256 usdcOut) 
    {
        AMMPool storage pool = ammPools[wordId];
        
        if (outcome == Outcome.YES) {
            // Selling YES tokens, getting USDC from NO pool
            uint256 newYesLiquidity = pool.yesLiquidity + tokenAmount;
            uint256 newNoLiquidity = pool.k / newYesLiquidity;
            usdcOut = pool.noLiquidity - newNoLiquidity;
        } else {
            // Selling NO tokens, getting USDC from YES pool
            uint256 newNoLiquidity = pool.noLiquidity + tokenAmount;
            uint256 newYesLiquidity = pool.k / newNoLiquidity;
            usdcOut = pool.yesLiquidity - newYesLiquidity;
        }
        
        // Apply fee
        usdcOut = (usdcOut * (10000 - tradingFeeBps)) / 10000;
    }

    /**
     * @notice Get current AMM price for an outcome
     * @param wordId The word ID
     * @param outcome YES or NO
     * @return price Price scaled to 1e6 (0 to 1e6 = $0 to $1)
     */
    function getCurrentPrice(uint256 wordId, Outcome outcome) public view returns (uint256 price) {
        AMMPool storage pool = ammPools[wordId];
        require(pool.initialized, "Pool not initialized");
        
        uint256 totalLiquidity = pool.yesLiquidity + pool.noLiquidity;
        
        if (outcome == Outcome.YES) {
            // Price = noLiquidity / totalLiquidity
            price = (pool.noLiquidity * 1e6) / totalLiquidity;
        } else {
            // Price = yesLiquidity / totalLiquidity
            price = (pool.yesLiquidity * 1e6) / totalLiquidity;
        }
    }

    /**
     * @notice Get quote for buying tokens via AMM
     * @param wordId The word ID
     * @param outcome YES or NO
     * @param usdcIn Amount of USDC to spend
     * @return tokensOut Estimated tokens out
     * @return effectivePrice Effective price per token
     */
    function getAMMBuyQuote(uint256 wordId, Outcome outcome, uint256 usdcIn) 
        external 
        view 
        returns (uint256 tokensOut, uint256 effectivePrice) 
    {
        (tokensOut,) = _calculateBuyAMM(wordId, outcome, usdcIn);
        if (tokensOut > 0) {
            effectivePrice = (usdcIn * 1e6) / tokensOut;
        }
    }

    /**
     * @notice Get quote for selling tokens via AMM
     * @param wordId The word ID
     * @param outcome YES or NO
     * @param tokenAmount Amount of tokens to sell
     * @return usdcOut Estimated USDC out
     * @return effectivePrice Effective price per token
     */
    function getAMMSellQuote(uint256 wordId, Outcome outcome, uint256 tokenAmount) 
        external 
        view 
        returns (uint256 usdcOut, uint256 effectivePrice) 
    {
        usdcOut = _calculateSellAMM(wordId, outcome, tokenAmount);
        if (usdcOut > 0) {
            effectivePrice = (usdcOut * 1e6) / tokenAmount;
        }
    }

    // ============ Limit Order Book Functions ============

    /**
     * @notice Place a limit order
     * @param wordId The word ID
     * @param outcome YES or NO
     * @param orderType BUY or SELL
     * @param price Price in USDC (scaled by 1e6, 0 to 1e6)
     * @param amount Number of tokens
     * @return orderId The ID of the created order
     */
    function placeLimitOrder(
        uint256 wordId,
        Outcome outcome,
        OrderType orderType,
        uint256 price,
        uint256 amount
    ) external nonReentrant onlyLiveEvent(words[wordId].eventId) onlyUnresolvedWord(wordId) 
        returns (uint256) 
    {
        require(words[wordId].eventId > 0, "Word does not exist");
        require(amount > 0, "Amount must be positive");
        require(price > 0 && price <= 1e6, "Invalid price");

        uint256 orderId = nextOrderId++;

        orders[orderId] = Order({
            orderId: orderId,
            wordId: wordId,
            maker: msg.sender,
            outcome: outcome,
            orderType: orderType,
            price: price,
            amount: amount,
            filled: 0,
            cancelled: false
        });

        userOrders[msg.sender].push(orderId);

        // Lock collateral
        if (orderType == OrderType.BUY) {
            // Lock USDC
            USDC.safeTransferFrom(msg.sender, address(this), (price * amount) / 1e6);
        } else {
            // Lock tokens
            uint256 tokenId = _getTokenId(wordId, outcome);
            _burn(msg.sender, tokenId, amount);
        }

        // Add to active orders
        activeOrders[wordId][outcome][orderType].push(orderId);

        emit OrderPlaced(orderId, wordId, msg.sender, outcome, orderType, price, amount);

        return orderId;
    }

    /**
     * @notice Fill an existing limit order
     * @param orderId The order ID to fill
     * @param amount Amount to fill
     */
    function fillOrder(uint256 orderId, uint256 amount) external nonReentrant {
        Order storage order = orders[orderId];
        require(!order.cancelled, "Order cancelled");
        require(order.filled < order.amount, "Order already filled");
        require(amount > 0, "Amount must be positive");
        
        uint256 remainingAmount = order.amount - order.filled;
        require(amount <= remainingAmount, "Amount exceeds remaining");

        Word storage word = words[order.wordId];
        require(!word.resolved, "Word already resolved");
        require(events[word.eventId].state == EventState.LIVE, "Event not live");

        // Calculate fee
        uint256 feeAmount = (order.price * amount * tradingFeeBps) / (1e6 * 10000);
        uint256 netProceeds = (order.price * amount) / 1e6 - feeAmount;

        uint256 tokenId = _getTokenId(order.wordId, order.outcome);

        if (order.orderType == OrderType.BUY) {
            // Taker is selling tokens
            _burn(msg.sender, tokenId, amount);
            _mint(order.maker, tokenId, amount, "");
            USDC.safeTransfer(msg.sender, netProceeds);
        } else {
            // Taker is buying tokens
            USDC.safeTransferFrom(msg.sender, address(this), (order.price * amount) / 1e6);
            _mint(msg.sender, tokenId, amount, "");
            USDC.safeTransfer(order.maker, netProceeds);
        }

        order.filled += amount;

        emit OrderFilled(orderId, msg.sender, amount, order.price);
    }

    /**
     * @notice Cancel an order and refund collateral
     * @param orderId The order ID
     */
    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        require(order.maker == msg.sender, "Not order maker");
        require(!order.cancelled, "Already cancelled");
        require(order.filled < order.amount, "Already filled");

        order.cancelled = true;

        uint256 remainingAmount = order.amount - order.filled;

        // Refund collateral
        if (order.orderType == OrderType.BUY) {
            USDC.safeTransfer(msg.sender, (order.price * remainingAmount) / 1e6);
        } else {
            uint256 tokenId = _getTokenId(order.wordId, order.outcome);
            _mint(msg.sender, tokenId, remainingAmount, "");
        }

        emit OrderCancelled(orderId);
    }

    // ============ Settlement ============

    /**
     * @notice Claim winnings after resolution
     * @param wordId The word ID
     * @param amount Amount of winning tokens to claim (in wei, not scaled)
     */
    function claimWinnings(uint256 wordId, uint256 amount) external nonReentrant {
        require(words[wordId].resolved, "Word not resolved");
        require(amount > 0, "Amount must be positive");

        uint256 winningTokenId = _getTokenId(wordId, words[wordId].outcome);
        
        // Burn winning tokens
        _burn(msg.sender, winningTokenId, amount);

        // Transfer USDC - amount is in token units, USDC needs 1e6 decimals
        // But our tokens are also in 1e6 scale, so 1 token = 1 USDC
        USDC.safeTransfer(msg.sender, amount);
    }

    // ============ Internal Functions ============

    function _getTokenId(uint256 wordId, Outcome outcome) internal pure returns (uint256) {
        return wordId * 2 + uint256(outcome);
    }

    // Override supportsInterface for multiple inheritance
    function supportsInterface(bytes4 interfaceId) 
        public 
        view 
        override(ERC1155, ERC1155Holder) 
        returns (bool) 
    {
        return super.supportsInterface(interfaceId);
    }

    // ============ Admin Functions ============

    function setTradingFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= 1000, "Fee cannot exceed 10%");
        tradingFeeBps = newFeeBps;
        emit TradingFeeUpdated(newFeeBps);
    }

    function withdrawFees(address recipient, uint256 amount) external onlyOwner {
        USDC.safeTransfer(recipient, amount);
    }

    // ============ View Functions ============

    function getEvent(uint256 eventId) external view returns (
        string memory name,
        EventState state,
        uint256 createdAt,
        uint256[] memory wordIds
    ) {
        Event storage e = events[eventId];
        return (e.name, e.state, e.createdAt, e.wordIds);
    }

    function getWord(uint256 wordId) external view returns (
        uint256 eventId,
        string memory text,
        bool resolved,
        Outcome outcome
    ) {
        Word storage w = words[wordId];
        return (w.eventId, w.text, w.resolved, w.outcome);
    }

    function getOrder(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
    }

    function getUserOrders(address user) external view returns (uint256[] memory) {
        return userOrders[user];
    }

    function getActiveOrders(uint256 wordId, Outcome outcome, OrderType orderType) 
        external 
        view 
        returns (uint256[] memory) 
    {
        return activeOrders[wordId][outcome][orderType];
    }

    function getTokenBalance(address user, uint256 wordId, Outcome outcome) 
        external 
        view 
        returns (uint256) 
    {
        uint256 tokenId = _getTokenId(wordId, outcome);
        return balanceOf(user, tokenId);
    }

    function getAMMPool(uint256 wordId) external view returns (
        uint256 yesLiquidity,
        uint256 noLiquidity,
        uint256 k,
        bool initialized
    ) {
        AMMPool storage pool = ammPools[wordId];
        return (pool.yesLiquidity, pool.noLiquidity, pool.k, pool.initialized);
    }

    function getBestOrders(
        uint256 wordId,
        Outcome outcome,
        OrderType orderType,
        uint256 limit
    ) external view returns (
        uint256[] memory orderIds,
        uint256[] memory prices,
        uint256[] memory amounts
    ) {
        uint256[] storage allOrders = activeOrders[wordId][outcome][orderType];
        uint256 resultSize = allOrders.length < limit ? allOrders.length : limit;
        
        orderIds = new uint256[](resultSize);
        prices = new uint256[](resultSize);
        amounts = new uint256[](resultSize);
        
        uint256 count = 0;
        for (uint256 i = 0; i < allOrders.length && count < limit; i++) {
            Order storage order = orders[allOrders[i]];
            if (!order.cancelled && order.filled < order.amount) {
                orderIds[count] = order.orderId;
                prices[count] = order.price;
                amounts[count] = order.amount - order.filled;
                count++;
            }
        }
        
        if (count < resultSize) {
            assembly {
                mstore(orderIds, count)
                mstore(prices, count)
                mstore(amounts, count)
            }
        }
    }
}
