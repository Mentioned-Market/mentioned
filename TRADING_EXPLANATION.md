# Trading Mechanism Explanation

## How the Order Book Works

The current implementation uses a **Central Limit Order Book (CLOB)** system. This means:

### 1. **Orders Don't Execute Immediately**
When you place a BUY or SELL order:
- Your order is added to the order book
- It waits to be matched with an opposing order
- **Prices only update when orders are actually filled/matched**

### 2. **Example Flow**
Let's say "mexico" is trading at YES: $0.65, NO: $0.35

**When you BUY 10 YES shares:**
```
1. You approve 6.50 mUSDC
2. A BUY order is placed for 10 YES at $0.65
3. Your order appears in "Your Pending Orders" section
4. Your order sits in the order book waiting for a seller
5. Price does NOT update yet
6. When someone SELLS 10 YES at $0.65, your orders match
7. You receive 10 YES tokens
8. Price may update based on the new order book state
9. Your order disappears from pending (or shows as partially filled)
```

### 3. **Why Prices Don't Change Immediately**
The prices displayed are based on:
- The best available buy/sell orders in the order book
- Not on pending orders that haven't been matched

For prices to change, you need:
- Someone to place a matching order on the opposite side
- Or place an order at a different price level

### 4. **Token Holdings**
- **YES tokens**: Number of YES shares you own
- **NO tokens**: Number of NO shares you own
- These update once your orders are filled

### 5. **Viewing Your Pending Orders**
The "Your Pending Orders" section shows:
- All your active orders waiting to be matched
- Order details: word, YES/NO, BUY/SELL, price, amount
- Partially filled orders (shows how much has been filled)
- Cancel button to remove orders

### 6. **Complete Sets** (Alternative Method)
There's also a `createCompleteSets` function that:
- Lets you mint 1 YES + 1 NO for exactly 1 USDC
- Guarantees immediate execution
- Doesn't affect market prices
- Useful for providing liquidity

## Providing Liquidity (Market Making)

To bootstrap a market, you need **market makers**:

### Option 1: Manual Market Making
1. Create 2 demo wallets
2. Use `createCompleteSets()` to mint YES/NO tokens
3. Place SELL orders at various prices
4. New users can now BUY from your orders

### Option 2: First Users Wait
1. First user places a BUY order at $0.60
2. Order sits in the book (visible in Pending Orders)
3. Second user places a SELL order at $0.60
4. Orders match and execute
5. Both users see updated balances

### Example Market Making Strategy
```
Wallet A (Market Maker):
1. createCompleteSets(wordId, 100) → Get 100 YES + 100 NO for 100 USDC
2. Place SELL order: 50 YES at $0.65
3. Place SELL order: 50 NO at $0.35
4. Now users can BUY immediately at these prices

Wallet B (Trader):
1. Place BUY order: 10 YES at $0.65
2. Order matches with Wallet A's SELL order
3. Wallet B receives 10 YES tokens immediately
4. Wallet A receives 6.50 USDC
```

## Current Implementation Status

### ✅ Working Features
- Place BUY limit orders
- Place SELL limit orders
- View your YES/NO token holdings
- **View your pending orders**
- **Cancel pending orders**
- See order book (currently mock data)
- Transaction status and links
- Refresh data to see updates

### 🚧 To Be Implemented
- **Order matching/filling**: Need to manually fill orders or implement auto-matching
- **Real order book data**: Currently showing mock data, need to fetch actual orders from contract
- **Market orders**: Execute at best available price immediately
- **Order history**: View completed/cancelled orders

## Testing the Order Book

### Method 1: Two Wallets (Recommended)
1. Create 2 demo wallets (Wallet A & B)
2. **Wallet A**: Place a BUY order for 10 YES at $0.65
3. Check "Your Pending Orders" - order should appear
4. **Wallet B**: Place a SELL order for 10 YES at $0.65
5. Orders should match and execute
6. Both wallets will see updated balances
7. Order disappears from pending orders

### Method 2: Market Maker + Trader
1. **Wallet A (Market Maker)**:
   - Call `createCompleteSets(1, 100)` to get 100 YES + 100 NO
   - Place SELL order: 50 YES at $0.65
   - Place SELL order: 50 NO at $0.35
2. **Wallet B (Trader)**:
   - Place BUY order: 10 YES at $0.65
   - Order matches immediately with Wallet A's SELL
   - Receive 10 YES tokens

## Next Steps

For a fully functional trading experience, we need to:
1. Implement order matching logic (either on-chain or off-chain)
2. Fetch real order book data from the contract (not mock data)
3. Add market order functionality for instant execution at best price
4. Add order history view (completed/cancelled orders)
5. Consider implementing an AMM (Automated Market Maker) for guaranteed liquidity
6. Add market maker incentives/rewards


