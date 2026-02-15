# CLOB Requirements

What the off-chain order book needs to provide so the frontend can support real trading.

## Current State (Pre-CLOB)

**On-chain (working):**
- `deposit` / `withdraw` — user escrow management
- `create_market` — creates WordMarket with YES/NO mints
- `settle_match` — backend matches a YES buyer + NO buyer, deducts from escrows, mints tokens, funds vault
- `claim` — user burns winning tokens, receives SOL from vault
- `pause_market` / `resolve_market` — market lifecycle

**What's missing:**
- No way for users to place orders
- No order matching — `settle_match` is called manually by backend
- No price discovery — everything is 0.50/0.50
- `UserEscrow.locked` field exists but is unused (always 0)

## Architecture: Off-Chain CLOB + On-Chain Settlement

```
┌──────────────────────────────────────────────────────────┐
│                        Frontend                          │
│  Place order ──► CLOB API                                │
│  View order book ◄── CLOB API (REST + WebSocket)         │
│  Cancel order ──► CLOB API                               │
│  Deposit/Withdraw ──► Solana (on-chain, direct)          │
│  View positions ◄── Solana (on-chain, token balances)    │
│  Claim winnings ──► Solana (on-chain, direct)            │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│                     CLOB Backend                         │
│  Order book per word market                              │
│  Matching engine                                         │
│  On match → call settle_match on-chain                   │
│  Manage escrow locks (lock on order, unlock on cancel)   │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│                    Solana Program                         │
│  settle_match(price, amount) — mint tokens, move SOL     │
│  lock_funds / unlock_funds — escrow balance ↔ locked     │
│  claim() — burn winning tokens, receive SOL              │
└──────────────────────────────────────────────────────────┘
```

The backend is already the co-signer for `settle_match`. The CLOB extends this role to also manage the order book and trigger settlement when orders cross.

---

## 1. Order Placement

### What the frontend sends

```typescript
{
  marketId: number         // e.g. 1
  wordIndex: number        // e.g. 0 (which word in the market)
  side: 'YES' | 'NO'
  price: number            // 0.01 – 0.99 in SOL (or cents)
  quantity: number          // number of shares (1 share = 1 token = 1 SOL payout if correct)
}
```

### What happens

1. Frontend calls CLOB API with the order
2. CLOB validates user has sufficient unlocked escrow balance:
   - YES order cost = `price * quantity`
   - NO order cost = `(1 - price) * quantity`
3. CLOB calls `lock_funds` on-chain (or off-chain equivalent) to move funds from `balance` → `locked`
4. Order is added to the order book
5. CLOB returns order ID + confirmation

### What the frontend needs back

```typescript
{
  orderId: string
  status: 'open' | 'rejected'
  reason?: string            // if rejected (insufficient funds, market paused, etc.)
  price: number
  quantity: number
  filledQuantity: number     // 0 initially, may be >0 if immediately matched
  side: 'YES' | 'NO'
  createdAt: number          // unix timestamp
}
```

### Escrow Locking

The `UserEscrow` account already has a `locked` field (currently unused). The contract needs new instructions:

- **`lock_funds(amount)`** — called by backend when order is placed. Moves `amount` from `balance` to `locked`. Prevents the user from withdrawing funds committed to open orders.
- **`unlock_funds(amount)`** — called by backend when order is cancelled. Moves `amount` from `locked` back to `balance`.

`settle_match` should be updated to deduct from `locked` (not `balance`) since matched orders already had funds locked at placement time.

---

## 2. Order Book Data

### What the frontend needs

Per word market, the frontend needs to display the current order book and derive prices.

**REST endpoint** — initial load / polling fallback:

```
GET /api/orderbook/:marketId/:wordIndex
```

```typescript
{
  marketId: number
  wordIndex: number
  bids: Array<{ price: number; quantity: number }>   // sorted highest → lowest
  asks: Array<{ price: number; quantity: number }>   // sorted lowest → highest
  lastTradePrice: number | null
  lastTradeTime: number | null
}
```

**Notes:**
- `bids` = YES buy orders (users willing to pay X for YES)
- `asks` = YES sell orders (equivalent to NO buy orders at `1 - price`)
- Aggregated by price level (sum quantities at same price)
- Frontend currently has an `OrderBook` component that can consume this format

### Price Derivation

The YES price for display comes from the order book:

| Source | Calculation |
|--------|-------------|
| Best bid | Highest YES buy price |
| Best ask | Lowest YES sell price |
| Mid price | `(bestBid + bestAsk) / 2` |
| Last trade | Price of most recent `settle_match` |

The frontend currently shows `yesPrice: '0.50'` — this gets replaced by `lastTradePrice` or `midPrice` from the CLOB.

The NO price is always `1 - yesPrice`.

---

## 3. User's Open Orders

### What the frontend needs

```
GET /api/orders/:walletAddress
```

```typescript
Array<{
  orderId: string
  marketId: number
  wordIndex: number
  wordLabel: string          // e.g. "Economy" — for display without extra lookup
  side: 'YES' | 'NO'
  price: number
  quantity: number
  filledQuantity: number
  status: 'open' | 'partial' | 'filled' | 'cancelled'
  createdAt: number
  updatedAt: number
}>
```

### Where this is displayed

- **Market page trading panel** — show open orders for the currently selected word below "Your Position"
- **Profile page** — new "Orders" tab alongside Active / Claimable / History, showing all open orders across all markets
- **Header** — optionally show open order count as a badge

### Filtering

Frontend filters by:
- Market page: `marketId` + `wordIndex` matching the current view
- Profile page: all orders for the connected wallet, grouped or filterable by market

---

## 4. Cancel Orders

### What the frontend sends

```
DELETE /api/orders/:orderId
```

Or:

```typescript
POST /api/orders/:orderId/cancel
```

### What happens

1. CLOB removes order from the book
2. CLOB calls `unlock_funds` on-chain to move funds from `locked` → `balance`
3. Returns updated order with `status: 'cancelled'`

### Frontend UX

- Cancel button on each open order row
- Confirmation before cancelling (optional)
- Optimistic UI update — mark as cancelled immediately, revert if the API fails

---

## 5. Real-Time Updates

### What the frontend needs

WebSocket connection for live updates. Polling (every 5-10s) is an acceptable fallback for v1.

**Events the frontend subscribes to:**

| Event | Payload | Used For |
|-------|---------|----------|
| `orderbook_update` | `{ marketId, wordIndex, bids, asks }` | Live order book display |
| `trade` | `{ marketId, wordIndex, price, quantity, timestamp }` | Last trade price, chart data, trade feed |
| `order_update` | `{ orderId, status, filledQuantity }` | User's order status changes |
| `price_update` | `{ marketId, wordIndex, bestBid, bestAsk, lastPrice }` | Price display on market cards, word list |

**Subscription pattern:**

```typescript
// Subscribe to a specific market
ws.send({ type: 'subscribe', channel: 'orderbook', marketId: 1, wordIndex: 0 })

// Subscribe to user's orders
ws.send({ type: 'subscribe', channel: 'orders', wallet: '<pubkey>' })
```

### Fallback: REST polling

If WebSocket isn't ready for v1, the frontend can poll:
- Order book: every 5s when market page is open
- User orders: every 10s
- Prices for market cards on home page: every 15s

---

## 6. Price Updates Across the Frontend

Once the CLOB provides real prices, these places need updating:

| Location | Currently | After CLOB |
|----------|-----------|------------|
| Market page — word list | `yesPrice: '0.50'` hardcoded | `lastTradePrice` or `midPrice` from CLOB |
| Market page — trading panel | Hardcoded 0.50 | Best bid/ask from order book |
| Market page — chart | Random generated data | Real trade history (`trade` events) |
| Home page — market cards | Mock prices | Last trade prices from CLOB |
| Profile — position est. value | `shares * 0.50` placeholder | `shares * lastTradePrice` |
| Header — portfolio value | `shares * 0.50` placeholder | `shares * lastTradePrice` |

### Price for position valuation

Currently `estimatePositionValue()` in `lib/mentionMarket.ts` uses `0.50` for active markets. Once the CLOB is live, this should use the last trade price (or mid price) from the CLOB:

```
estimatedValueSol = shares * lastTradePrice   // for active markets
estimatedValueSol = shares * 1.0              // for resolved winning side (unchanged)
```

This means `fetchUserPositions()` will need to also fetch current prices from the CLOB API, or the caller passes prices in.

---

## 7. Trade History

### What the frontend needs

For the market page chart and for the profile "History" tab:

```
GET /api/trades/:marketId/:wordIndex?limit=100
```

```typescript
Array<{
  price: number
  quantity: number
  timestamp: number
  txSignature?: string       // on-chain settle_match tx, for verification link
}>
```

This also feeds the chart component — replacing the current randomly generated price data with real trade points.

---

## 8. Contract Changes Needed

### New instructions

| Instruction | Signer | Purpose |
|-------------|--------|---------|
| `lock_funds(amount)` | Backend | Move `amount` from escrow `balance` → `locked` when order is placed |
| `unlock_funds(amount)` | Backend | Move `amount` from escrow `locked` → `balance` when order is cancelled |

### Modified instructions

| Instruction | Change |
|-------------|--------|
| `settle_match` | Deduct from `locked` instead of `balance` (funds were locked when order was placed) |
| `withdraw` | Already only allows withdrawing `balance` (not `locked`), but verify this is enforced |

### No changes needed

- `deposit` — unchanged, adds to `balance`
- `create_market` — unchanged
- `pause_market` / `resolve_market` — unchanged
- `claim` — unchanged, works on token balances not escrow

### Open question: Cancel all on market pause

When a market is paused, should all open orders be cancelled and funds unlocked? This prevents users from having funds stuck in `locked` for a paused market. The CLOB backend would handle this — when it detects a `pause_market` event, it cancels all open orders and calls `unlock_funds` for each.

---

## 9. API Authentication

Orders need to be authenticated to prevent spoofing:

- User signs a message with their Phantom wallet (e.g., `"Place order: YES 0.35 x 10 on market 1 word 0"`)
- Frontend sends the signature + message + public key to the CLOB API
- CLOB verifies the ed25519 signature matches the public key
- This proves the user authorized the order without needing the private key

Alternatively, the CLOB could require a signed nonce/timestamp to prevent replay attacks.

---

## 10. Frontend Integration Summary

### New API client needed

```typescript
// lib/clobApi.ts

placeOrder(params: PlaceOrderRequest): Promise<Order>
cancelOrder(orderId: string): Promise<Order>
getOrderBook(marketId: number, wordIndex: number): Promise<OrderBook>
getUserOrders(wallet: string): Promise<Order[]>
getTradeHistory(marketId: number, wordIndex: number): Promise<Trade[]>
getPrices(marketId: number): Promise<Map<number, PriceInfo>>
```

### Pages to update

| Page | Changes |
|------|---------|
| `app/market/[id]/page.tsx` | Wire Buy/Sell button → `placeOrder()`. Show real order book. Show open orders. Real prices in word list. Real chart data. |
| `app/profile/page.tsx` | Add "Orders" tab for open orders with cancel buttons. Use real prices for position values. |
| `components/Header.tsx` | Use real prices for portfolio valuation. |
| `lib/mentionMarket.ts` | Update `estimatePositionValue()` to accept price param instead of hardcoded 0.50. |

### New components (may be needed)

- **OpenOrdersPanel** — list of user's open orders for a word market with cancel buttons
- **TradeHistory** — recent trades feed for a word market

---

## 11. Order Matching Logic (for CLOB dev reference)

A YES buy at price `P` can match with a NO buy at price `1 - P` (or lower for the NO side). Equivalently:

- YES bids are sorted highest first
- NO bids are converted to YES asks: a NO bid at `0.40` = YES ask at `0.60`
- When best YES bid >= best YES ask, a trade occurs
- The settlement price is typically the price of the resting order (maker price)
- Backend calls `settle_match(price, amount)` with the matched price

**Example:**
- User A bids YES at 0.35 for 5 shares → locks `0.35 * 5 = 1.75 SOL`
- User B bids NO at 0.60 for 5 shares → locks `0.60 * 5 = 3.00 SOL`
- NO bid at 0.60 = YES ask at 0.40
- User A's YES bid at 0.35 < YES ask at 0.40 → no match
- Later, User C bids YES at 0.42 for 3 shares → locks `0.42 * 3 = 1.26 SOL`
- YES bid 0.42 >= YES ask 0.40 → match 3 shares at 0.40 (maker price)
- Backend calls `settle_match(price=0.40 SOL, amount=3 tokens)`
  - YES cost: `0.40 * 3 = 1.20 SOL` from User C's locked escrow
  - NO cost: `0.60 * 3 = 1.80 SOL` from User B's locked escrow
  - Refund User C: `1.26 - 1.20 = 0.06 SOL` back to balance (price improvement)
  - Vault receives: `3.00 SOL` total collateral
  - User C gets 3 YES tokens, User B gets 3 NO tokens
