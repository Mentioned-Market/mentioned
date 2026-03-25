# Custom Markets — Virtual LMSR Refactor Spec

## Motivation

The current custom markets implementation uses a simple YES/NO toggle per word with points awarded via sentiment bands (50/100/150). This doesn't teach users how mention markets actually work. The goal is to mirror the real LMSR market experience as closely as possible — users buy/sell YES and NO shares, prices move as demand shifts, early contrarians get better prices — using virtual "play tokens" instead of SOL. Later, a "what you could have won" feature can show users what their virtual positions would have returned in a real market.

---

## Core Model

### Play Tokens

- Every user is automatically allocated play tokens (default **1000**, configurable per market via `play_tokens` column) when they first interact with an open market (no explicit opt-in required — balance row is created lazily on first trade).
- Play tokens are **per-market** — a user's balance in market A is independent of market B.
- Unspent tokens at resolution are **forfeit**. They cannot be converted to platform points.
- Only **profit from deployed tokens** earns platform points.

### Virtual Market Maker Subsidy

In a real LMSR market, the admin deposits SOL as a liquidity subsidy — the market maker (the on-chain program) uses this to guarantee liquidity and can lose money if winners outweigh losers. In the virtual system, the platform acts as the implicit market maker. Play tokens are virtual, so the platform creates tokens at resolution to pay out winning shares. There is no deposited capital backing the `b` parameter — the subsidy is absorbed implicitly because play tokens have no external value.

This is intentional and correct. It means the total tokens paid out at resolution can exceed the total tokens collected from buyers. The difference is the virtual market maker's "loss," which costs nothing because the tokens are virtual. This is what makes LMSR always liquid — there is always a counterparty.

### LMSR Pricing

Each word in a market has an independent binary LMSR pool with a shared `b` parameter set by the admin at market creation. The same LMSR math as the real mention markets governs:

- **Implied price** (YES probability) = `1 / (1 + exp((no_qty - yes_qty) / b))`
- Both pools start at `yes_qty = 0, no_qty = 0` → implied price = 0.5 (50/50)
- Buying YES shares increases `yes_qty`, pushing YES price up and NO price down
- Selling YES shares decreases `yes_qty`, pulling prices back toward 50/50

The real market LMSR functions in `lib/mentionMarket.ts` use on-chain fixed-point bigints (1e9 precision). The virtual AMM needs a **float-based wrapper** — see `lib/virtualLmsr.ts` below.

### Buying Shares

When a user buys `shares` of YES (or NO) on a word:

```
cost = virtualBuyCost(yes_qty, no_qty, side, shares, b)
```

- `cost` is deducted from the user's play token balance
- `shares` are added to the user's position for that word
- The word's pool quantities are updated: `yes_qty += shares` (if buying YES)
- A price history point is recorded
- A trade record is inserted into `custom_market_trades`

**Constraint:** `cost <= user.balance`. Users cannot spend more than they have.

### Selling Shares

When a user sells `shares` back to the market:

```
returned = virtualSellReturn(yes_qty, no_qty, side, shares, b)
```

- `returned` is added to the user's play token balance
- `shares` are deducted from the user's position
- Pool quantities are updated: `yes_qty -= shares` (if selling YES)
- A price history point is recorded
- A trade record is inserted into `custom_market_trades`

**Constraint:** `shares <= user.yes_shares` (or `no_shares`). Cannot sell more than held.

### Profit Calculation

Tracked per user per market across all words:

```
tokens_spent    = cumulative sum of all buy costs across all words
tokens_received = cumulative sum of all sell returns + resolution payouts
net             = tokens_received - tokens_spent
platform_points = max(0, floor(net))   ← floored at 0, never negative
```

A user who only holds and never trades has `tokens_spent = 0`, `tokens_received = 0`, `net = 0`, `points = 0`. Inaction earns nothing.

### Points Calibration

The existing points economy awards modest values: 10 pts per trade, 50 pts for a claim win, 100 pts for first trade. A skilled virtual market player could earn hundreds of points from a single market if `net` maps 1:1 to platform points, which would dominate all other point sources.

**Decision:** Apply a multiplier of **0.5x** to virtual market profit when converting to platform points. So `platform_points = max(0, floor(net * 0.5))`. This keeps virtual markets rewarding but prevents them from making all other point sources irrelevant. The multiplier is stored as a constant in `lib/customScoring.ts` (`VIRTUAL_MARKET_POINTS_MULTIPLIER = 0.5`) so it can be tuned later without schema changes.

If this proves too conservative or too generous after initial markets, adjust the single constant.

### Resolution Payout

When admin resolves a word:
- Each YES share held pays **1 token** if the word resolves YES, **0 tokens** if NO
- Each NO share held pays **1 token** if the word resolves NO, **0 tokens** if YES

Resolution payouts are added to `tokens_received` in the user's position record. Platform points are computed and awarded after **all words in the market are resolved** (same CAS pattern as current implementation).

### Cancelled Markets

If a market is cancelled while it has active positions (status was `open` or `locked`):
- **0 platform points** are awarded to all participants.
- Positions are voided — no resolution payouts are computed.
- The play tokens were free, so there is no real loss to users.
- The UI shows "Market Cancelled" with no scoring breakdown.
- No entry is written to `point_events`.

### Example

User has 1000 play tokens. Market has three words.

| Action | Detail | Balance |
|--------|--------|---------|
| Start | — | 1000 |
| Buy 300 YES shares on "profit" | Cost: 180 tokens (price ~0.60) | 820 |
| Buy 200 NO shares on "guidance" | Cost: 100 tokens (price ~0.50) | 720 |
| Sell 150 YES shares on "profit" | Return: 105 tokens (price moved to 0.70) | 825 |
| Market locked, no more trades | — | 825 |
| **Resolution** | "profit" -> YES, "guidance" -> NO | — |
| "profit" YES payout | 150 remaining YES shares x 1 = 150 tokens | — |
| "guidance" NO payout | 200 NO shares x 1 = 200 tokens | — |

```
tokens_spent    = 180 + 100           = 280
tokens_received = 105 + 150 + 200     = 455
net             = 455 - 280           = 175
platform_points = floor(175 * 0.5)    = 87 points
```

The remaining balance of 825 (unspent play tokens still in the user's balance) is forfeit at resolution. Only profit from positions — the difference between what was spent buying shares and what was received from sells + resolution payouts — converts to platform points.

---

## The `b` Parameter — Admin Guidance

`b` controls price sensitivity: how many tokens need to flow into one side to move the implied price by a meaningful amount. Lower b = more volatile, higher b = more stable.

**Rule of thumb:** To move the price ~10 percentage points from 50/50, approximately `0.22 * b` tokens must be spent on one side.

| Expected active traders | Recommended b | Effect |
|---|---|---|
| 1-5 | 100-200 | One user spending 200 tokens moves price ~45pp. Very sensitive. |
| 5-20 | 300-500 | One user spending 200 tokens moves price ~15-25pp. Good for small launches. |
| 20-50 | 500-1000 | One user spending 200 tokens moves price ~5-10pp. Meaningful but not extreme. |
| 50+ | 1000-3000 | Requires significant collective volume to shift prices materially. |

**Practical starting point:** If you expect ~10 users each spending roughly half their tokens (500 tokens, spread over all words), use `b = 500`. Adjust up if markets feel too volatile, down if prices barely move.

Per-word volume is what matters — if a market has 8 words and users spread evenly, each word sees about `total_tokens / 8` of flow. Set `b` relative to per-word expected volume, not total.

---

## Schema Changes

### Tables to Add

#### `custom_market_word_pools`
LMSR pool state per word. One row per word, created automatically when words are added to a market (inserted in the same transaction as the word itself). Updated on every trade.

```sql
CREATE TABLE custom_market_word_pools (
  word_id       INTEGER PRIMARY KEY REFERENCES custom_market_words(id) ON DELETE CASCADE,
  yes_qty       NUMERIC(18,6) NOT NULL DEFAULT 0,
  no_qty        NUMERIC(18,6) NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_pool_yes_non_negative CHECK (yes_qty >= 0),
  CONSTRAINT chk_pool_no_non_negative CHECK (no_qty >= 0)
);
```

**Pool creation:** Whenever `addCustomMarketWords()` inserts rows into `custom_market_words`, it must also insert corresponding rows into `custom_market_word_pools` (with `yes_qty = 0, no_qty = 0`) in the same transaction. This ensures every word always has a pool row and prevents the first trade from failing on a missing pool.

#### `custom_market_positions`
User's accumulated share holdings and cost basis per word. One row per (wallet, word).

```sql
CREATE TABLE custom_market_positions (
  id               SERIAL PRIMARY KEY,
  market_id        INTEGER NOT NULL REFERENCES custom_markets(id) ON DELETE CASCADE,
  word_id          INTEGER NOT NULL REFERENCES custom_market_words(id) ON DELETE CASCADE,
  wallet           TEXT NOT NULL,
  yes_shares       NUMERIC(18,6) NOT NULL DEFAULT 0,
  no_shares        NUMERIC(18,6) NOT NULL DEFAULT 0,
  tokens_spent     NUMERIC(18,6) NOT NULL DEFAULT 0,  -- cumulative buy costs for this word
  tokens_received  NUMERIC(18,6) NOT NULL DEFAULT 0,  -- cumulative sell returns + resolution for this word
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (word_id, wallet),
  CONSTRAINT chk_pos_yes_non_negative CHECK (yes_shares >= 0),
  CONSTRAINT chk_pos_no_non_negative CHECK (no_shares >= 0),
  CONSTRAINT chk_pos_spent_non_negative CHECK (tokens_spent >= 0),
  CONSTRAINT chk_pos_received_non_negative CHECK (tokens_received >= 0)
);

CREATE INDEX idx_cmp_market_wallet ON custom_market_positions (market_id, wallet);
CREATE INDEX idx_cmp_word ON custom_market_positions (word_id);
```

#### `custom_market_balances`
User's remaining play token balance per market. Created lazily on first trade.

```sql
CREATE TABLE custom_market_balances (
  market_id  INTEGER NOT NULL REFERENCES custom_markets(id) ON DELETE CASCADE,
  wallet     TEXT NOT NULL,
  balance    NUMERIC(18,6) NOT NULL,  -- no DEFAULT: set explicitly from market.play_tokens on first trade
  PRIMARY KEY (market_id, wallet),
  CONSTRAINT chk_balance_non_negative CHECK (balance >= 0)
);
```

**No column default.** The lazy creation code must read `market.play_tokens` and insert that value explicitly. This ensures markets with non-default `play_tokens` values (e.g., 500 or 2000) are handled correctly.

#### `custom_market_price_history`
Implied YES price per word after every trade. Powers the price chart (mirrors the real market chart).

```sql
CREATE TABLE custom_market_price_history (
  id          SERIAL PRIMARY KEY,
  word_id     INTEGER NOT NULL REFERENCES custom_market_words(id) ON DELETE CASCADE,
  yes_price   NUMERIC(6,4) NOT NULL,  -- 0.0000 - 1.0000
  no_price    NUMERIC(6,4) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cmph_word_time ON custom_market_price_history (word_id, recorded_at DESC);
```

#### `custom_market_trades`
Individual trade log. One row per buy or sell action. Used for trade history display, auditing, and the future "what you could have won" feature.

```sql
CREATE TABLE custom_market_trades (
  id          SERIAL PRIMARY KEY,
  market_id   INTEGER NOT NULL REFERENCES custom_markets(id) ON DELETE CASCADE,
  word_id     INTEGER NOT NULL REFERENCES custom_market_words(id) ON DELETE CASCADE,
  wallet      TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('buy', 'sell')),
  side        TEXT NOT NULL CHECK (side IN ('YES', 'NO')),
  shares      NUMERIC(18,6) NOT NULL,
  cost        NUMERIC(18,6) NOT NULL,  -- tokens spent (buy) or tokens received (sell)
  yes_price   NUMERIC(6,4) NOT NULL,   -- implied price after this trade
  no_price    NUMERIC(6,4) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cmt_market ON custom_market_trades (market_id, created_at DESC);
CREATE INDEX idx_cmt_wallet ON custom_market_trades (wallet, created_at DESC);
```

### Tables to Modify

#### `custom_markets` — add columns

```sql
ALTER TABLE custom_markets
  ADD COLUMN IF NOT EXISTS b_parameter     NUMERIC(10,2) NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS play_tokens     INTEGER NOT NULL DEFAULT 1000;
```

`b_parameter` is stored as a plain float (not fixed-point). The virtual LMSR uses float math, not on-chain bigint representation.

### Tables to Drop

```sql
DROP TABLE IF EXISTS custom_market_predictions;
```

The boolean prediction model is fully replaced by positions + balances.

### Tables Unchanged

`custom_market_words` — existing columns remain (`id`, `market_id`, `word`, `resolved_outcome`). No changes needed.

---

## Precision Notes

LMSR math involves `exp()` and `log()` which inherently lose precision in IEEE 754 float64 arithmetic. Pool quantities and costs are computed in JavaScript `number` (float64, ~15 significant digits) but stored in Postgres `NUMERIC(18,6)` (6 decimal places, exact).

Over many trades, the pool state stored in the DB (exact NUMERIC) and intermediate JS calculations (approximate float64) may diverge by a small epsilon. This is acceptable for virtual play tokens — the invariant `sum(all buys) - sum(all sells) = pool quantity` may drift by fractions of a token. The `CHECK >= 0` constraints on pool and position tables guard against this drift ever producing a negative value from rounding.

---

## New Library: `lib/virtualLmsr.ts`

The existing LMSR functions in `lib/mentionMarket.ts` use on-chain bigint fixed-point (divide by 1e9 internally). The virtual AMM uses plain floats stored in Postgres. Create a clean float wrapper rather than polluting `mentionMarket.ts` with dual-mode logic.

```typescript
// lib/virtualLmsr.ts
// Float-based LMSR math for virtual (off-chain) prediction markets.
// Same underlying math as the on-chain LMSR in mentionMarket.ts,
// operating on plain numbers instead of bigint fixed-point values.

function logSumExp(a: number, b: number): number {
  const m = Math.max(a, b)
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m))
}

function lmsrCostFn(qYes: number, qNo: number, b: number): number {
  return b * logSumExp(qYes / b, qNo / b)
}

export function virtualImpliedPrice(
  yesQty: number, noQty: number, b: number
): { yes: number; no: number } {
  if (b === 0) return { yes: 0.5, no: 0.5 }
  const diff = (noQty - yesQty) / b
  const yes = 1 / (1 + Math.exp(diff))
  return { yes, no: 1 - yes }
}

export function virtualBuyCost(
  yesQty: number, noQty: number, side: 'YES' | 'NO', shares: number, b: number
): number {
  const before = lmsrCostFn(yesQty, noQty, b)
  const after = side === 'YES'
    ? lmsrCostFn(yesQty + shares, noQty, b)
    : lmsrCostFn(yesQty, noQty + shares, b)
  return Math.max(0, after - before)
}

export function virtualSellReturn(
  yesQty: number, noQty: number, side: 'YES' | 'NO', shares: number, b: number
): number {
  const before = lmsrCostFn(yesQty, noQty, b)
  const after = side === 'YES'
    ? lmsrCostFn(yesQty - shares, noQty, b)
    : lmsrCostFn(yesQty, noQty - shares, b)
  return Math.max(0, before - after)
}

// Given a token budget, calculate the maximum shares purchasable via binary search.
// Uses current implied price to set a reasonable upper bound.
export function sharesForTokens(
  yesQty: number, noQty: number, side: 'YES' | 'NO', tokens: number, b: number
): number {
  const price = virtualImpliedPrice(yesQty, noQty, b)
  const currentPrice = side === 'YES' ? price.yes : price.no
  // Upper bound: at the current price, max shares ~ tokens / price.
  // Use half the current price as floor to account for price moving during purchase.
  // Minimum floor of 0.01 to avoid division by zero at extreme prices.
  const hi = tokens / Math.max(0.01, currentPrice * 0.5)
  let lo = 0, upper = hi
  for (let i = 0; i < 60; i++) {
    const mid = (lo + upper) / 2
    virtualBuyCost(yesQty, noQty, side, mid, b) <= tokens ? (lo = mid) : (upper = mid)
  }
  return lo
}
```

`sharesForTokens` powers the "spend X tokens" input mode on the UI (user enters token amount, UI shows share count they'll receive).

---

## API Changes

### Replace `/api/custom/[id]/predict` with `/api/custom/[id]/trade`

**POST** — Buy or sell shares on a word.

Request:
```json
{
  "wallet": "...",
  "word_id": 42,
  "action": "buy",
  "side": "YES",
  "amount": 100,
  "amount_type": "tokens"
}
```

`amount_type`: `"tokens"` for buys (spend this many tokens, receive computed shares), `"shares"` for sells (sell this many shares, receive computed tokens). Buys also accept `"shares"` (buy exactly this many shares, pay computed cost).

Response:
```json
{
  "trade_id": 17,
  "cost": 63.4,
  "shares": 142.7,
  "new_yes_price": 0.63,
  "new_no_price": 0.37,
  "new_balance": 736.6,
  "new_yes_shares": 142.7,
  "new_no_shares": 0
}
```

**Validation:**
- Market must be `open` and not past `lock_time`
- For buy: compute cost first, verify `cost <= user.balance` (auto-create balance row using `market.play_tokens` if first trade)
- For sell: `shares <= position.yes_shares` (or `no_shares`)
- Rate limit: 500ms per wallet (same as current implementation)

**Concurrency:** Pool state update must be atomic. Use `SELECT FOR UPDATE` on `custom_market_word_pools` within a transaction before computing cost and updating quantities.

```
BEGIN
  SELECT ... FROM custom_market_word_pools WHERE word_id = $1 FOR UPDATE
  -- If first trade for this user: INSERT INTO custom_market_balances (market_id, wallet, balance) VALUES ($1, $2, market.play_tokens)
  compute cost/return using virtualBuyCost/virtualSellReturn
  UPDATE custom_market_word_pools SET yes_qty = ..., no_qty = ..., updated_at = NOW()
  INSERT INTO custom_market_positions ... ON CONFLICT (word_id, wallet) DO UPDATE
  UPDATE custom_market_balances SET balance = balance - cost  (or + returned for sells)
  INSERT INTO custom_market_trades (market_id, word_id, wallet, action, side, shares, cost, yes_price, no_price)
  INSERT INTO custom_market_price_history (word_id, yes_price, no_price)
COMMIT
```

### Replace `/api/custom/[id]/predictions` with `/api/custom/[id]/positions`

**GET** — Returns user's current positions (shares held per word) and remaining play token balance.

Query params: `?wallet=...`

```json
{
  "balance": 736.6,
  "starting_balance": 1000,
  "positions": [
    { "word_id": 42, "word": "earnings", "yes_shares": 142.7, "no_shares": 0, "tokens_spent": 63.4, "tokens_received": 0 },
    { "word_id": 43, "word": "guidance", "yes_shares": 0, "no_shares": 88.2, "tokens_spent": 45.1, "tokens_received": 0 }
  ]
}
```

When no balance row exists (user hasn't traded yet), return `balance: market.play_tokens` and `positions: []`. The `starting_balance` field always returns `market.play_tokens` so the UI can display "Play Tokens: X / Y" correctly regardless of whether the user has traded.

### Modify `/api/custom/[id]/sentiment`

Was: per-word YES/NO vote percentages.
Now: per-word LMSR implied prices and pool quantities (same endpoint, different data).

```json
{
  "words": [
    { "word_id": 42, "word": "earnings", "yes_price": 0.63, "no_price": 0.37, "yes_qty": 312.4, "no_qty": 104.1, "trader_count": 8 },
    ...
  ]
}
```

`trader_count` = distinct wallets with any position on that word. Replaces "predictor count."

### Modify `/api/custom/[id]` (GET, detail)

Add to response:
- `b_parameter` — for client-side price preview calculations
- `play_tokens` — starting balance for display
- Per-word `yes_price`, `no_price`, `yes_qty`, `no_qty` (inline from pools, replaces sentiment %)

### Add `/api/custom/[id]/chart`

**GET** — Returns price history for charting. `?word_id=` optional filter.

```json
{
  "words": [
    {
      "word_id": 42,
      "word": "earnings",
      "history": [
        { "t": "2026-03-25T14:00:00Z", "yes": 0.50, "no": 0.50 },
        { "t": "2026-03-25T14:03:12Z", "yes": 0.57, "no": 0.43 },
        ...
      ]
    }
  ]
}
```

### Add `/api/custom/[id]/trades`

**GET** — Returns recent trade history for display on the detail page.

Query params: `?wallet=` (optional, filter to one user), `?limit=` (default 50)

```json
{
  "trades": [
    { "id": 17, "wallet": "...", "username": "alice", "word": "earnings", "action": "buy", "side": "YES", "shares": 142.7, "cost": 63.4, "yes_price": 0.63, "created_at": "..." },
    ...
  ]
}
```

Joins against `user_profiles` for username display. Mirrors the trade feed on real market detail pages.

### Modify `/api/custom/[id]/resolve`

Same request shape (per-word `resolved_outcome`). The scoring change is internal:
- For each resolved word, call `resolveWordPositions()` to compute and store payouts
- After `updateCustomMarketStatus` CAS to `resolved`, call `resolveAndScoreVirtualMarket()` fire-and-forget
- Payout logic: for each resolved word, iterate all positions, add `yes_shares` (if YES wins) or `no_shares` (if NO wins) to `tokens_received`
- After all words settled, compute `net = sum(tokens_received) - sum(tokens_spent)` per wallet across the whole market, apply multiplier, floor at 0, award as points

### Modify `/api/custom` (POST — create market)

Add `b_parameter` (required, number, range 10-10000) and optionally `play_tokens` (integer, range 100-10000, default 1000) to the create request body.

---

## Scoring Changes

### Replace `lib/customScoring.ts`

The sentiment-band scoring is removed entirely. New scoring in `lib/customScoring.ts`:

```typescript
export const VIRTUAL_MARKET_POINTS_MULTIPLIER = 0.5
```

**`resolveWordPositions(marketId: number, wordId: number, outcome: 'YES' | 'NO')`**
- Fetches all positions for `wordId`
- For each position: `payout = outcome === 'YES' ? position.yes_shares : position.no_shares`
- Bulk-updates `tokens_received += payout` in `custom_market_positions`

**`resolveAndScoreVirtualMarket(marketId: number)`**
- Called fire-and-forget after all words are resolved and market transitions to `resolved`
- For each distinct wallet in the market:
  ```
  tokens_spent    = SUM(tokens_spent) across all words
  tokens_received = SUM(tokens_received) across all words
  net             = tokens_received - tokens_spent
  points          = max(0, floor(net * VIRTUAL_MARKET_POINTS_MULTIPLIER))
  ```
- Awards points via `insertPointEvent(wallet, 'custom_market_win', points, 'custom_{marketId}', { marketId, net, multiplier })`
- Idempotent via `point_events` unique constraint on `(wallet, action, ref_id)`

### Replace `lib/customMarketUtils.ts`

Remove sentiment band functions (`getSentimentBand`, `getPointsForPrediction`).

Add:
- `estimatePotentialPayout(yesQty, noQty, side, shares, b)` — preview: if this position resolves correct, what's the payout (shares * 1 token). Used for "potential payout" display.
- `estimateSellReturn(yesQty, noQty, side, shares, b)` — wrapper around `virtualSellReturn` for client-side preview
- Status helpers stay unchanged (`isValidStatusTransition`, `getStatusColor`, `getStatusLabel`, `isMarketOpen`)
- `CustomMarketStatus` type stays unchanged

---

## UI Changes

### `/custom/[id]` — Detail Page

The word card changes from a toggle to a buy/sell panel, mirroring the real market page.

**Word card (open market):**
- Header: word name, current YES/NO implied prices (e.g., "YES 63c / NO 37c")
- Price bar: visual YES/NO split based on implied price (not vote count)
- **Buy panel** (default view):
  - Side selector: YES | NO toggle
  - Input: token amount to spend (or share amount — toggle between modes)
  - Preview: "You'll receive ~142 YES shares" and "Payout if correct: 142 tokens"
  - Submit: "Buy YES" / "Buy NO" button
- **Sell panel** (shown only if user holds shares on this word):
  - Shows current position: "142 YES shares"
  - Input: shares to sell
  - Preview: "You'll receive ~105 tokens"
  - Submit: "Sell YES" / "Sell NO" button

**Balance bar (top of page):**
- "Play Tokens: 736 / 1000" (uses `starting_balance` from positions endpoint for the denominator)
- "Potential Profit: +142 tokens" (sum of unrealised gains from current positions if all win)
- Simple progress bar

**Price chart:**
- Replaces sentiment-over-time with LMSR implied price over time
- Same Recharts line chart used on the real market
- Polls `/api/custom/[id]/chart` — add as a new tab or replace existing chart

**Trade feed:**
- Recent trades section (mirrors real market detail page)
- Polls `/api/custom/[id]/trades` — shows "alice bought 142 YES on earnings at 63c"

**Word card (locked/resolved):**
- Shows locked-in shares + final price at lock
- On resolution: shows outcome badge (YES/NO), payout received, profit/loss per word
- Summary at top: "You earned 175 play tokens -> 87 platform points"

### `/customadmin` — Admin Page

**Market creation form:** Add `b_parameter` input (required) with inline help text:
> "Controls price sensitivity. Lower = prices move more per trade. Rule of thumb: set to ~50% of expected total tokens traded per word. For 10 users: 500. For 50 users: 1500."

Show computed guidance dynamically as admin types a value:
> "At b=500, a single user spending 200 tokens on one word moves the price ~+/-9 percentage points."

Add optional `play_tokens` input (default 1000) with label:
> "Starting play tokens per user. Higher = more trades possible per user."

### `CustomEventCard` — Market Listing

- Replace "Y/N vote %" in the scrolling list with YES/NO implied prices (e.g., "earnings: 63c/37c")
- Replace "X predictors" with "X traders"
- Badge stays "FREE"

---

## What Stays the Same

- Market lifecycle: `draft -> open -> locked -> resolved -> cancelled`
- `custom_markets` table structure (column additions only)
- `custom_market_words` table (no changes)
- Admin auth pattern (`ADMIN_WALLETS`)
- Chat: `event_chat_messages` with `event_id = "custom_{id}"`
- Stream embed
- Cover image
- Status transitions API (`/api/custom/[id]/status`)
- Word management API (`/api/custom/[id]/words`) — must now also create pool rows when adding words
- `/markets` listing with Free/Paid filter tabs
- Lock time mechanic
- Points awarded via `point_events` system with deduplication

---

## Concurrency Notes

Pool state (`yes_qty`, `no_qty`) is a shared mutable resource. Two users buying simultaneously without locking would compute costs against stale quantities. Every trade must update pools inside a DB transaction with `SELECT FOR UPDATE` on the relevant `custom_market_word_pools` row. This serialises per-word trades; different words in the same market can trade concurrently without conflict.

No Solana-style sequencing is needed — Postgres row-level locking is sufficient at this scale.

Resolution payout (updating `tokens_received` on positions) happens after lock, so there are no concurrent trades to conflict with. The CAS on market status (`UPDATE ... WHERE status = 'locked'`) prevents double-resolution.

---

## Future: "What You Could Have Won"

This falls out naturally once both systems are live:

1. A custom market is associated with a real on-chain mention market (add `linked_market_id` to `custom_markets`)
2. Since both use LMSR with implied prices, you can look up what the real market's implied price was at the time the user made each virtual trade (using `custom_market_trades.created_at` cross-referenced against `trade_events.block_time`)
3. Compute: "You bought 142 YES shares on 'earnings' in the virtual market when the real market price was also 63c. A 0.1 SOL buy at that price would have returned ~0.159 SOL (profit: 0.059 SOL)"
4. Display on the resolved detail page as a "Real market comparison" callout

No schema changes needed today — store `linked_market_id` as a nullable column on `custom_markets` and implement the comparison at resolution time when the feature is built.

---

## Migration from Current Branch State

1. Run schema migrations: drop `custom_market_predictions`, add the five new tables, add columns to `custom_markets`
2. No data migration needed — the branch has no production data
3. Delete: `lib/customScoring.ts` (rewrite), `lib/customMarketUtils.ts` (partial rewrite — keep status helpers)
4. Create: `lib/virtualLmsr.ts`
5. Modify: `lib/db.ts` — replace prediction functions with position/balance/pool/trade functions; update `addCustomMarketWords` to also insert pool rows
6. Replace: `/api/custom/[id]/predict/route.ts` -> `trade/route.ts`
7. Replace: `/api/custom/[id]/predictions/route.ts` -> `positions/route.ts`
8. Add: `/api/custom/[id]/chart/route.ts`
9. Add: `/api/custom/[id]/trades/route.ts`
10. Modify: `/api/custom/[id]/sentiment/route.ts` (returns prices, not vote %)
11. Modify: `/api/custom/[id]/resolve/route.ts` (payout logic)
12. Modify: `/api/custom/route.ts` (add `b_parameter`, `play_tokens` to create; update GET listing to return prices)
13. Rewrite: `app/custom/[id]/page.tsx` (word cards, buy/sell panel, balance bar, trade feed)
14. Update: `app/customadmin/page.tsx` (b parameter + play_tokens inputs)
15. Update: `components/CustomEventCard.tsx` (prices instead of vote %)
