# Custom Free Markets — Complete Specification

This document describes how free prediction markets work on Mentioned. It covers what they are, why each design decision was made, and how every component fits together. Written for both humans (product, engineering) and AI models working on the codebase.

---

## What Are Free Markets?

Free markets are prediction markets on Mentioned where users trade with virtual "play tokens" instead of real cryptocurrency. Users predict whether specific words will be mentioned during a live event (Twitch stream, earnings call, press conference, etc.) by buying YES or NO shares on each word.

Free markets use the exact same LMSR (Logarithmic Market Scoring Rule) automated market maker as the real on-chain mention markets. Prices move as people trade. Early contrarians get better prices. The experience is identical to the paid markets — the only difference is the currency is virtual.

### Why Free Markets Exist

1. **Onboarding.** Most users have never traded on a prediction market. Free markets let them learn the mechanics — price movement, share ownership, buy/sell decisions — without risking real money.

2. **Funnel to paid markets.** Once users understand how mention markets work, the transition to the real on-chain markets (which use SOL) is natural. A future "what you could have won" feature will show users what their virtual trades would have returned in real markets.

3. **Engagement.** Free markets give users a reason to participate even if they don't hold crypto. The points reward creates competitive incentive within the platform's existing points/leaderboard system.

---

## How It Works — User Perspective

### Starting a Market

An admin creates a market with a title (e.g., "What Will Trump Post On X.com — Next 48 Hours"), a list of words to predict on, and a lock time after which trading stops. Each market is configured with a `b` parameter (controls price sensitivity) and a starting play token amount (default 1000).

### Trading

When a user opens a free market, they receive play tokens automatically on their first trade. They can:

- **Buy YES shares** on a word — betting that the word WILL be mentioned. This costs play tokens. The price increases as more people buy YES.
- **Buy NO shares** on a word — betting that the word WON'T be mentioned. Same mechanics, opposite direction.
- **Sell shares** back to the market at any time before lock — locking in a profit or cutting a loss at the current market price.

Prices start at 50/50 (50 cents YES, 50 cents NO) and move as people trade. If lots of people buy YES on "China", the YES price rises (say to 72 cents) and the NO price drops (to 28 cents). A user who bought YES early at 50 cents now holds shares worth 72 cents.

### Resolution and Payout

After the event, an admin resolves each word as YES or NO based on whether it was actually mentioned.

- **Correct shares** (YES shares when the word resolves YES, or NO shares when it resolves NO) pay out **1 token per share**.
- **Wrong shares** pay out **0 tokens**.

The user's profit is calculated across all their trades in the market:

```
profit = (tokens received from sells + resolution payouts) - tokens spent on buys
```

### Points Conversion

Profit converts to platform points at a **0.5x multiplier**:

```
points = max(0, floor(profit * 0.5))
```

**Why 0.5x?** The existing points economy awards modest values (10 pts per trade, 50 for a win). Without a multiplier, a single good market run could earn hundreds of points and dominate all other point sources. The 0.5x keeps free markets rewarding without inflating the points economy. The multiplier is a single constant (`VIRTUAL_MARKET_POINTS_MULTIPLIER`) that can be tuned.

**Why floor at 0?** Free markets are free. Losses within a market reduce that market's profit but never subtract from a user's existing platform points earned elsewhere. This preserves the "no downside" property of free-to-play.

**Why do unspent tokens not count?** Only deployed capital (tokens actually spent on trades) generates profit. If a user receives 1000 tokens but never trades, they earn 0 points. This incentivises participation over inaction.

---

## The AMM — How Pricing Works

### LMSR (Logarithmic Market Scoring Rule)

Each word in a market has its own independent binary LMSR pool. LMSR is an automated market maker designed specifically for prediction markets. It guarantees:

- **Always liquid.** There is always a price to buy or sell at. No need to wait for a counterparty.
- **Prices reflect demand.** As more people buy YES, the YES price rises organically.
- **Early movers benefit.** Buying YES at 30 cents is cheaper than buying at 70 cents. Users who predict correctly early earn more.

#### The Math

The cost function is: `C(q_yes, q_no) = b * ln(exp(q_yes/b) + exp(q_no/b))`

The implied YES price is: `P(yes) = 1 / (1 + exp((q_no - q_yes) / b))`

Where:
- `q_yes` and `q_no` are the total quantities of YES and NO shares in the pool
- `b` is the liquidity parameter (set by admin per market)
- Buying `n` YES shares costs `C(q_yes + n, q_no) - C(q_yes, q_no)`
- Selling `n` YES shares returns `C(q_yes, q_no) - C(q_yes - n, q_no)`

**Why LMSR?** It is the standard for prediction markets (used by Polymarket, Augur, etc.). It is the same algorithm used by the real on-chain mention markets on Mentioned. Using the same math means user skills transfer directly from free markets to paid markets.

#### Numerical Stability

The implementation uses the log-sum-exp trick (`logSumExp(a, b) = max(a,b) + ln(exp(a - max) + exp(b - max))`) to prevent floating-point overflow when pool quantities are large. This is a standard numerical computing technique.

### The `b` Parameter

`b` controls how sensitive prices are to trading activity. Lower `b` means prices move more per trade; higher `b` means prices are more stable.

**Rule of thumb:** To move the price ~10 percentage points from 50/50, approximately `0.22 * b` tokens must be spent.

| Expected traders | Recommended b | Behaviour |
|---|---|---|
| 1-5 | 100-200 | Very sensitive. One user moves price significantly. |
| 5-20 | 300-500 | Good for small launches. Meaningful price discovery. |
| 20-50 | 500-1000 | Moderate movement. Requires collective volume. |
| 50+ | 1000-3000 | Stable. Large volume needed to shift prices. |

**Why admin-configurable?** The optimal `b` depends on expected participation, which varies per market. A market for a niche event with 5 expected users needs a different `b` than a major event with 200 users. The admin knows the audience best.

### Virtual Market Maker Subsidy

In real LMSR markets, an admin deposits SOL as a liquidity subsidy — the market maker can lose money when winners outweigh losers. In the virtual system, there is no deposited capital. The platform acts as the implicit market maker, creating tokens at resolution to pay winning shares.

**Why this is fine:** Play tokens have no external value. The "loss" absorbed by the virtual market maker costs nothing. This is what makes LMSR always liquid — the virtual subsidy ensures there is always a counterparty for any trade.

---

## Market Lifecycle

```
draft -> open -> locked -> resolved
  \        \        \
   -> cancelled  -> cancelled  -> cancelled
```

| State | Visible to users? | Trading? | Description |
|---|---|---|---|
| **Draft** | No (direct link only) | No | Admin configures words, cover image, stream URL. Preview only. |
| **Open** | Yes | Yes | Users can buy and sell shares. Prices move. |
| **Locked** | Yes | No | Trading frozen. Triggered manually by admin or automatically when `lock_time` passes. |
| **Resolved** | Yes | No | Admin marks each word YES/NO. Points awarded to participants. |
| **Cancelled** | Yes | No | Terminal state. 0 points awarded. Positions voided. |

**Why a lock state?** Prevents last-second trading after the event outcome is known but before the admin has resolved the market. Without it, users could see the livestream result and buy correct shares at stale prices before resolution.

**Why cancelled?** Events get postponed or cancelled. Admins need an escape hatch that clearly communicates "this market doesn't count" without awarding anyone points.

---

## Resolution and Scoring

### Per-Word Resolution

Each word is resolved independently (YES or NO). The admin can resolve words one at a time or all at once. The schema supports incremental resolution so a complex market can be resolved over multiple sessions.

**Why per-word?** Some events have many words and outcomes trickle in. An admin watching a livestream might resolve words as they're mentioned rather than waiting until the end.

### Payout Calculation

When a word resolves:
- Each YES share pays 1 token if the word resolved YES, 0 if NO
- Each NO share pays 1 token if the word resolved NO, 0 if YES

This is added to `tokens_received` on the user's position record.

### Final Scoring

After ALL words in a market are resolved, the market transitions to `resolved` (via CAS — compare-and-swap — to prevent double-scoring on concurrent requests). Then, for each participant:

```
tokens_spent    = sum of all buy costs across all words
tokens_received = sum of all sell returns + all resolution payouts
net             = tokens_received - tokens_spent
points          = max(0, floor(net * 0.5))
```

**Why CAS for status transition?** If two admin requests resolve the last word simultaneously, both would try to transition the market and trigger scoring. The CAS (`UPDATE ... WHERE status = 'locked'`) ensures only one succeeds. The scoring itself is also idempotent via a unique constraint on `point_events(wallet, action, ref_id)`.

**Why fire-and-forget scoring?** Scoring iterates all participants and inserts point events. This can take time with many users. Running it asynchronously means the admin gets an immediate response while scoring happens in the background. Idempotency means it's safe to retry if it fails.

---

## Database Schema

### `custom_markets`

The market itself. One row per market.

| Column | Type | Purpose |
|---|---|---|
| `id` | SERIAL PK | Market identifier |
| `title` | TEXT NOT NULL | Display title |
| `description` | TEXT | Optional description |
| `cover_image_url` | TEXT | Cover image for listing cards |
| `stream_url` | TEXT | Livestream URL (Twitch/YouTube) — auto-embeds on detail page |
| `status` | TEXT DEFAULT 'draft' | Lifecycle state |
| `lock_time` | TIMESTAMPTZ | When trading stops (null = manual lock only) |
| `b_parameter` | NUMERIC(10,2) DEFAULT 500 | LMSR liquidity parameter |
| `play_tokens` | INTEGER DEFAULT 1000 | Starting tokens per user |
| `created_at` | TIMESTAMPTZ | Creation time |
| `updated_at` | TIMESTAMPTZ | Last modification |

### `custom_market_words`

Words within a market. One row per word.

| Column | Type | Purpose |
|---|---|---|
| `id` | SERIAL PK | Word identifier |
| `market_id` | INTEGER FK -> custom_markets | Parent market |
| `word` | TEXT NOT NULL | The word/phrase |
| `resolved_outcome` | BOOLEAN | null = unresolved, true = YES, false = NO |

**Why separate table?** Enables FK from positions, DB-level unique constraints, efficient aggregation, and per-word resolution. A JSON array on the market row wouldn't support any of these.

### `custom_market_word_pools`

LMSR pool state per word. Updated on every trade.

| Column | Type | Purpose |
|---|---|---|
| `word_id` | INTEGER PK FK -> words | One pool per word |
| `yes_qty` | NUMERIC(18,6) DEFAULT 0 | Total YES shares in the pool |
| `no_qty` | NUMERIC(18,6) DEFAULT 0 | Total NO shares in the pool |
| `updated_at` | TIMESTAMPTZ | Last trade time |

CHECK constraints enforce `yes_qty >= 0` and `no_qty >= 0`.

**Why a separate table from words?** Pool state is hot data — locked with `SELECT FOR UPDATE` on every trade. Keeping it in its own table avoids locking the word metadata row during trades.

**Why created atomically with words?** If a word exists without a pool row, the first trade would fail. The `addCustomMarketWords` function inserts both in a single transaction.

### `custom_market_positions`

User share holdings per word. One row per (wallet, word).

| Column | Type | Purpose |
|---|---|---|
| `id` | SERIAL PK | Row identifier |
| `market_id` | INTEGER FK | Parent market (denormalized for index efficiency) |
| `word_id` | INTEGER FK | Which word |
| `wallet` | TEXT | User's wallet address |
| `yes_shares` | NUMERIC(18,6) DEFAULT 0 | YES shares held |
| `no_shares` | NUMERIC(18,6) DEFAULT 0 | NO shares held |
| `tokens_spent` | NUMERIC(18,6) DEFAULT 0 | Cumulative buy costs on this word |
| `tokens_received` | NUMERIC(18,6) DEFAULT 0 | Cumulative sell returns + resolution payouts |
| `updated_at` | TIMESTAMPTZ | Last modification |

UNIQUE constraint on `(word_id, wallet)` enables upsert pattern (`ON CONFLICT DO UPDATE`). CHECK constraints enforce all numeric columns >= 0.

**Why `market_id` is denormalized?** It could be derived from `word_id -> words -> market_id`, but having it directly enables the `idx_cmp_market_wallet` index for "get all positions for this user in this market" without a join.

### `custom_market_balances`

User's remaining play token balance per market. Created lazily on first trade.

| Column | Type | Purpose |
|---|---|---|
| `market_id` | INTEGER FK | Which market |
| `wallet` | TEXT | User's wallet |
| `balance` | NUMERIC(18,6) NOT NULL | Remaining play tokens |

Composite PK on `(market_id, wallet)`. CHECK constraint enforces `balance >= 0`.

**Why no DEFAULT on balance?** The starting balance comes from `market.play_tokens`, which is configurable per market. A column default of 1000 would be wrong for markets with different token amounts. The code explicitly reads `market.play_tokens` and inserts that value.

### `custom_market_trades`

Individual trade log. One row per buy or sell action.

| Column | Type | Purpose |
|---|---|---|
| `id` | SERIAL PK | Trade identifier |
| `market_id` | INTEGER FK | Parent market |
| `word_id` | INTEGER FK | Which word |
| `wallet` | TEXT | Trader |
| `action` | TEXT CHECK IN ('buy','sell') | Trade direction |
| `side` | TEXT CHECK IN ('YES','NO') | Which side |
| `shares` | NUMERIC(18,6) | Share quantity |
| `cost` | NUMERIC(18,6) | Tokens spent (buy) or received (sell) |
| `yes_price` | NUMERIC(6,4) | Implied YES price after this trade |
| `no_price` | NUMERIC(6,4) | Implied NO price after this trade |
| `created_at` | TIMESTAMPTZ | Trade time |

**Why a separate trade log?** Positions aggregate over time (you only see current holdings). The trade log preserves history for: the trade feed on the detail page, auditing, and the future "what you could have won" feature which needs to know what price each trade was made at.

### `custom_market_price_history`

Implied YES price per word after every trade. Powers the price chart.

| Column | Type | Purpose |
|---|---|---|
| `id` | SERIAL PK | Row identifier |
| `word_id` | INTEGER FK | Which word |
| `yes_price` | NUMERIC(6,4) | YES implied price (0-1) |
| `no_price` | NUMERIC(6,4) | NO implied price (0-1) |
| `recorded_at` | TIMESTAMPTZ | When recorded |

Index on `(word_id, recorded_at DESC)` for efficient chart queries.

**Why separate from trades?** The chart component only needs timestamp + price, not the full trade details. Keeping it separate makes chart queries faster and simpler.

---

## Concurrency Model

### Trade Serialisation

Every trade runs inside a Postgres transaction with `SELECT FOR UPDATE` on the pool row. This ensures two concurrent trades on the same word compute costs against the correct pool state. Different words in the same market can trade concurrently without conflict (different pool rows, no lock contention).

**Why not application-level locking?** Postgres row-level locking is battle-tested, survives server restarts, and works correctly across multiple server instances. Application-level locks (mutex, Redis) add complexity and failure modes.

### Resolution Safety

The CAS pattern on market status (`UPDATE custom_markets SET status = 'resolved' WHERE id = $1 AND status = 'locked'`) prevents double-scoring. Only one concurrent resolve request can succeed. Scoring is additionally protected by the `point_events` unique constraint on `(wallet, action, ref_id)`, making it idempotent even if called twice.

---

## API Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/custom` | GET | Public | List public markets (with word prices, trader counts) |
| `/api/custom` | POST | Admin | Create market with `b_parameter`, `play_tokens`, and optional words |
| `/api/custom/[id]` | GET | Public | Market detail with words, pool prices, trader count |
| `/api/custom/[id]` | PUT | Admin | Update market metadata |
| `/api/custom/[id]` | DELETE | Admin | Delete market (cascades) |
| `/api/custom/[id]/trade` | POST | Wallet | Buy or sell shares (rate-limited 500ms) |
| `/api/custom/[id]/positions` | GET | Wallet | User's positions + balance for this market |
| `/api/custom/[id]/sentiment` | GET | Public | Per-word LMSR prices and trader counts (for polling) |
| `/api/custom/[id]/chart` | GET | Public | Price history for chart rendering |
| `/api/custom/[id]/trades` | GET | Public | Recent trade history feed |
| `/api/custom/[id]/resolve` | POST | Admin | Resolve words, triggers scoring when all resolved |
| `/api/custom/[id]/status` | POST | Admin | Status transitions (draft->open, open->locked, etc.) |
| `/api/custom/[id]/words` | POST/DELETE | Admin | Add/remove words (draft only) |

Admin auth: wallet must be in `ADMIN_WALLETS` env var. Same pattern as all other admin endpoints on Mentioned.

---

## UI — Detail Page (`/custom/[id]`)

The detail page mirrors the polymarket event page layout (`/polymarkets/event/[eventId]`) to maintain visual consistency across the platform. Key sections:

1. **Breadcrumb** — Markets / Free Market
2. **Event header** — Cover image, FREE + status badges, title, description
3. **Meta bar** — Trader count, word count, lock time countdown
4. **Resolved summary** — (when resolved) Total profit/loss and points earned
5. **Stream embed** — Twitch/YouTube auto-embed with side-by-side event chat
6. **Price chart** — `EventPriceChart` component (same as polymarket pages) showing all words as colored lines with clickable legend and timeframe buttons
7. **Word table** — Each row: word name, chance %, YES/NO price buttons. Clicking selects the word in the trading panel.
8. **Recent trades** — Feed showing "alice bought 142 YES on earnings at 63c"
9. **Event chat** — Reuses existing `EventChat` component with `eventId="custom_{id}"`

### Trading Panel (right sidebar, sticky)

1. **"How does this work?"** — Blue info button at top that opens a popover explaining the free market mechanics
2. **Play Tokens** — Balance bar showing `X / Y` with progress bar and points conversion explainer
3. **Current P&L** — (when user has positions) Shows spent, realised, unrealised, total profit, and projected points
4. **Selected word** — "Buy YES - Iran"
5. **Buy / Sell toggle**
6. **YES / NO buttons** — With live prices in cents
7. **Amount input** — Tokens to spend (buy) or shares to sell
8. **Cost breakdown** — Average price, shares, payout if correct, profit, points earned
9. **Action button** — "Buy Yes" / "Sell No" etc.
10. **Positions** — Cards showing held shares per word with P&L

### Mobile

Mobile trade bar at bottom with slide-up sheet (same pattern as polymarket event pages).

---

## UI — Market Listing (`/markets`)

Free markets appear alongside paid markets on the `/markets` page with filter tabs (All / Paid / Free). Each free market is rendered as a `CustomEventCard` showing:

- Cover image with "FREE" badge and status badge
- Title
- Scrolling word list showing YES/NO prices in cents per word
- Footer: trader count, lock countdown, word count

---

## UI — Admin (`/customadmin`)

Admin page for creating and managing free markets:

- **Create form** — Title, description, cover image URL, stream URL, lock time, `b` parameter (with guidance text), play tokens, words (comma/newline separated)
- **Market list** — Expandable rows with edit fields, word management, resolution panel, status transitions, delete

---

## Key Files

| File | Purpose |
|---|---|
| `lib/virtualLmsr.ts` | Float-based LMSR math (virtualImpliedPrice, virtualBuyCost, virtualSellReturn, sharesForTokens) |
| `lib/db.ts` | All DB functions: executeVirtualTrade (transactional), pool/position/balance/trade queries |
| `lib/customScoring.ts` | Resolution payouts and profit-to-points conversion |
| `lib/customMarketUtils.ts` | Status helpers, transition validation, client-side estimate functions |
| `lib/adminAuth.ts` | Admin wallet check |
| `app/api/custom/` | All API routes |
| `app/custom/[id]/page.tsx` | Market detail page |
| `app/customadmin/page.tsx` | Admin page |
| `components/CustomEventCard.tsx` | Market listing card |
| `components/EventPriceChart.tsx` | Price chart (shared with polymarket pages, supports preloaded data) |
| `scripts/migrate.ts` | Schema definitions |

---

## Known Limitations and Future Work

### Current Limitations

- **No wallet signature verification.** The platform trusts the wallet address in API requests without cryptographic proof. This is a platform-wide architectural debt, not specific to free markets. Impact is limited since play tokens have no real value.
- **In-memory rate limiting.** The 500ms per-wallet rate limit resets on server restart and doesn't work across multiple instances. Acceptable at current scale.
- **Double-payout risk on repeated resolve.** If an admin calls the resolve endpoint twice for the same word before market status transitions, payouts are applied twice. The CAS on status change prevents double-scoring, but individual word payouts are not idempotent.

### Planned Extensions

- **"What You Could Have Won"** — Link a free market to a real on-chain market. After resolution, show users what their virtual trades would have returned in real SOL. The schema supports this via a nullable `linked_market_id` column.
- **Transcript auto-resolution** — Parse event transcripts to automatically resolve words. The per-word `resolved_outcome` column supports incremental resolution.
- **Hidden sentiment** — Optionally hide prices until a user has traded on a word. Prevents pure free-riding on crowd wisdom.
- **Points buy-in** — Users spend platform points (instead of free play tokens) for higher-stakes free markets with bigger point payouts.
