# Mentioned Market - Base Sepolia Contract

A decentralized prediction market for word mentions in events, built on Base (Sepolia testnet).

## Architecture Overview

The `MentionedMarket` contract is a CLOB (Central Limit Order Book) based prediction market where:

- **Events** have 3 states: PREMARKET → LIVE → RESOLVED
- **Words** are added to events during PREMARKET
- **Trading** happens during LIVE state
- Each word has YES/NO markets (ERC-1155 tokens)
- Users can create/redeem complete sets (1 YES + 1 NO = 1 USDC)
- Order book for limit orders with manual fills
- Winners redeem tokens 1:1 for USDC after resolution

## Key Features

### Complete Set Operations
- **Create Sets**: Deposit 1 USDC → Get 1 YES + 1 NO token
- **Redeem Sets**: Burn 1 YES + 1 NO → Get 1 USDC back
- Ensures market liquidity and that YES + NO prices ≈ $1.00

### Order Book Trading
- Place limit orders (BUY/SELL)
- Fill existing orders manually
- Cancel orders for refunds
- Configurable trading fees (default: 0%)

### Admin Functions
- Create events
- Add words (single or bulk)
- Change event state
- Resolve words (single or bulk)
- Set trading fees

### Smart Contract Account Compatible
- All functions are compatible with smart contract wallets
- Supports ERC-4337 account abstraction for gas sponsorship
- Can batch transactions

## Contract Addresses

### Base Sepolia

- **MentionedMarket**: (to be deployed)
- **USDC**: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (or use MockUSDC)

## Setup

### Prerequisites

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install dependencies
forge install
```

### Environment Variables

Create a `.env` file:

```bash
PRIVATE_KEY=your_private_key_here
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASESCAN_API_KEY=your_basescan_api_key_here
```

## Testing

Run all tests:

```bash
forge test -vv
```

Run specific test:

```bash
forge test --match-test testFullWorkflow -vvvv
```

Generate gas report:

```bash
forge test --gas-report
```

## Deployment

### Option 1: Deploy with Mock USDC (Recommended for testing)

```bash
# 1. Deploy Mock USDC
forge script script/DeployMockUSDC.s.sol:DeployMockUSDC \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --broadcast \
  --verify

# 2. Update the USDC address in Deploy.s.sol with the deployed MockUSDC address

# 3. Deploy MentionedMarket
forge script script/Deploy.s.sol:DeployMentionedMarket \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --broadcast \
  --verify
```

### Option 2: Deploy with Real USDC

```bash
# Update USDC_BASE_SEPOLIA in Deploy.s.sol to real USDC address
forge script script/Deploy.s.sol:DeployMentionedMarket \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --broadcast \
  --verify
```

### Local Deployment (Anvil)

```bash
# Start local node
anvil

# Deploy (in another terminal)
forge script script/Deploy.s.sol:DeployMentionedMarket \
  --rpc-url http://localhost:8545 \
  --broadcast
```

## Usage Examples

### 1. Create Event and Add Words

```solidity
// Admin creates event
uint256 eventId = market.createEvent("Trump Inauguration Speech");

// Add words in bulk
string[] memory words = new string[](3);
words[0] = "America";
words[1] = "Freedom";
words[2] = "Democracy";
uint256[] memory wordIds = market.addWordsBulk(eventId, words);

// Set to LIVE
market.setEventState(eventId, EventState.LIVE);
```

### 2. Provide Liquidity (Create Complete Sets)

```solidity
// Approve USDC
usdc.approve(address(market), 1000 * 1e6);

// Create 1000 complete sets
market.createCompleteSets(wordId, 1000);
// Now you have 1000 YES tokens + 1000 NO tokens
```

### 3. Place Sell Order

```solidity
// Sell 100 YES tokens at $0.70
market.placeLimitOrder(
    wordId,
    Outcome.YES,
    OrderType.SELL,
    700000, // 0.70 USDC (scaled by 1e6)
    100     // amount
);
```

### 4. Fill Order (Buy)

```solidity
// Get active sell orders
(uint256[] memory orderIds, uint256[] memory prices, uint256[] memory amounts) 
    = market.getBestOrders(wordId, Outcome.YES, OrderType.SELL, 10);

// Fill first order
usdc.approve(address(market), prices[0] * amounts[0] / 1e6);
market.fillOrder(orderIds[0], amounts[0]);
```

### 5. Resolve and Claim

```solidity
// Admin resolves
market.resolveWord(wordId, Outcome.YES);

// Winners claim
market.claimWinnings(wordId, myYesBalance);
// Receives 1 USDC per YES token
```

## Contract Functions

### Admin Functions
- `createEvent(string name)` - Create new event
- `addWord(uint256 eventId, string text)` - Add single word
- `addWordsBulk(uint256 eventId, string[] texts)` - Add multiple words
- `setEventState(uint256 eventId, EventState state)` - Change event state
- `resolveWord(uint256 wordId, Outcome outcome)` - Resolve word
- `resolveWordsBulk(uint256[] wordIds, Outcome[] outcomes)` - Bulk resolve
- `setTradingFee(uint256 newFeeBps)` - Update trading fee
- `withdrawFees(address recipient, uint256 amount)` - Withdraw fees

### User Functions
- `createCompleteSets(uint256 wordId, uint256 amount)` - Mint YES+NO tokens
- `redeemCompleteSets(uint256 wordId, uint256 amount)` - Burn YES+NO for USDC
- `placeLimitOrder(...)` - Place limit order
- `fillOrder(uint256 orderId, uint256 amount)` - Fill existing order
- `cancelOrder(uint256 orderId)` - Cancel your order
- `claimWinnings(uint256 wordId, uint256 amount)` - Redeem winning tokens

### View Functions
- `getEvent(uint256 eventId)` - Get event details
- `getWord(uint256 wordId)` - Get word details
- `getOrder(uint256 orderId)` - Get order details
- `getUserOrders(address user)` - Get user's orders
- `getActiveOrders(uint256 wordId, Outcome outcome, OrderType orderType)` - Get active orders
- `getTokenBalance(address user, uint256 wordId, Outcome outcome)` - Get token balance
- `getBestOrders(...)` - Get best available orders with prices

## Token IDs

Tokens follow this encoding:
- Token ID = `wordId * 2 + outcome`
- YES token = `wordId * 2 + 0`
- NO token = `wordId * 2 + 1`

## Security Considerations

1. **ReentrancyGuard**: All state-changing functions protected
2. **Access Control**: Owner-only for admin functions
3. **Safe ERC20**: Using OpenZeppelin SafeERC20
4. **Complete Sets**: Ensures market integrity (YES + NO = $1.00)
5. **Order Validation**: Checks for cancelled/filled orders

## Gas Optimization

- Order book uses active order tracking (no iteration through all prices)
- Bulk operations for adding/resolving multiple words
- ERC-1155 for efficient multi-token management

## Frontend Integration

The contract is designed for:
- **Wagmi/Viem** integration
- **Smart contract wallets** (Privy, Dynamic, etc.)
- **Gas sponsorship** via ERC-4337
- **Batch transactions** for UX optimization

## Testing on Base Sepolia

1. Get Base Sepolia ETH from [Base Sepolia Faucet](https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet)
2. Deploy or get USDC (use MockUSDC for testing)
3. Interact via:
   - [BaseScan](https://sepolia.basescan.org/)
   - Your frontend
   - Cast commands

## Cast Examples

```bash
# Create event
cast send $MARKET_ADDRESS "createEvent(string)" "Test Event" \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --private-key $PRIVATE_KEY

# Get event
cast call $MARKET_ADDRESS "getEvent(uint256)" 1 \
  --rpc-url $BASE_SEPOLIA_RPC_URL
```

## Upgradeability

This version is non-upgradeable. For production, consider:
- UUPS or Transparent Proxy pattern
- TimelockController for admin functions
- Multi-sig for ownership

## License

MIT

## Support

For issues, questions, or contributions, please open an issue on GitHub.
