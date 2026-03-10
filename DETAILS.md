# Mentioned Platform Documentation

Mentioned is a prediction market platform on Solana. Users trade YES/NO outcomes on esports matches, live events, and word-mention markets. The platform integrates Jupiter's Prediction Market API (Polymarket data) with a custom on-chain LMSR AMM for native mention markets.

**Stack:** Next.js 14 · React 18 · TypeScript · Tailwind CSS · Solana (Anchor 0.31.1) · PostgreSQL (Railway) · Phantom Wallet (Wallet Standard)

---

## Pages

### Homepage (`/`)
Displays Polymarket esports events in a grid layout. Events are split into **Live Now** and **Upcoming** sections. Each event card shows team odds (YES/NO percentages), volume, and close time. Fetches from `/api/polymarket?category=esports`.

### Event Detail (`/polymarkets/event/[eventId]`)
Full trading interface for a Polymarket event. Shows multiple markets per event (e.g. team matchups), live orderbook visualization with YES/NO sides, a trading panel to place orders, current user positions, order history, and settlement countdown.

### Positions (`/positions`)
Three-tab interface for the connected wallet:
- **Positions** — Open positions with unrealized P&L, mark price, avg price, payout if right, estimated settlement time. Each position has a **Close** (red) or **Claim** (green) button depending on whether the market has settled.
- **Open Orders** — Pending orders awaiting fill with side, contracts, max price, size, and creation time.
- **History** — All trade history: fills, settlements, claims, failures. Shows action, status, price, deposit/withdraw amounts, realized P&L, and fees.

### Leaderboard (`/leaderboard`)
Weekly trader rankings (resets every Monday UTC). Summary cards show total traders, total volume, top P&L, and best win rate. Sortable by P&L, Volume, or Win Rate. Table shows rank (gold/silver/bronze badges for top 3), trader name, P&L, win rate, winning trade count, and volume.

### Profile (`/profile`)
Set or edit a username (3–20 chars, alphanumeric + underscore, must be unique). Shows wallet address and summary cards (positions, total value, P&L, open orders). Includes the same three-tab positions/orders/history interface as the Positions page.

### Mention Markets (`/markets`)
Lists on-chain mention markets (native LMSR protocol). Filter tabs for Active and Resolved markets. Each card shows word grid with YES/NO prices, category, title, event countdown, and volume.

### Market Detail (`/market/[id]`)
Full on-chain trading interface for mention markets. Buy/sell with denomination toggle (Shares/USD/SOL). LMSR price chart, word selection, trade history, user positions. Admin resolution controls for market operators.

### Waitlist (`/waitlist`)
Email signup form.

---

## API Routes

### Polymarket Integration
All Polymarket routes proxy Jupiter's Prediction API (`https://api.jup.ag/prediction/v1`) with API key authentication and client IP forwarding.

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/polymarket` | GET | Fetch events by category (default: esports) |
| `/api/polymarket/event` | GET | Fetch single event with markets (`?eventId=`) |
| `/api/polymarket/positions` | GET | Fetch user positions (`?ownerPubkey=`) |
| `/api/polymarket/positions/close` | DELETE | Close a position (returns unsigned tx) |
| `/api/polymarket/positions/claim` | POST | Claim settled position payout (returns unsigned tx) |
| `/api/polymarket/orders` | POST | Create a new order |
| `/api/polymarket/orders/list` | GET | Fetch user's open orders (`?ownerPubkey=`) |
| `/api/polymarket/orderbook` | GET | Fetch market orderbook (`?marketId=`) |
| `/api/polymarket/history` | GET | Fetch trade history (`?ownerPubkey=`) |
| `/api/polymarket/leaderboard` | GET | Compute weekly leaderboard (3-min cache, `?debug=1` for raw data) |
| `/api/polymarket/trades/record` | POST | Record trade to DB for leaderboard tracking |

### User & Chat

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/profile` | GET | Get username for wallet |
| `/api/profile` | PUT | Set/update username (unique constraint) |
| `/api/chat` | GET | Fetch recent messages (50 max, `?after=` for polling) |
| `/api/chat` | POST | Send message (200 char max, 500ms rate limit) |

### Mention Markets (On-Chain)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/trades` | GET | Fetch on-chain trades (`?marketId=` or `?trader=`) |
| `/api/trades/chart` | GET | Fetch trade data for charting (market + word) |
| `/api/trades/volume` | GET | Volume totals for markets (`?marketIds=`) |
| `/api/market-image` | GET | Fetch market cover images |
| `/api/transcript` | GET/POST | Store/fetch event transcripts |
| `/api/webhook` | POST | Helius webhook for indexing on-chain events |
| `/api/waitlist` | POST | Email signup |

---

## Trading Flow

### Polymarket (Jupiter Integration)

1. User browses events on the homepage or event detail page
2. Selects a market and side (YES/NO), enters amount
3. Frontend calls `POST /api/polymarket/orders` → proxied to Jupiter API
4. Jupiter returns an unsigned Solana transaction
5. Phantom wallet prompts user to sign and send
6. Trade is recorded to `polymarket_trades` table via fire-and-forget POST to `/api/polymarket/trades/record`
7. Position appears in Positions tab; can be closed or claimed after settlement

### Mention Markets (On-Chain LMSR)

1. User navigates to a market detail page
2. Selects a word and side (YES/NO), enters amount
3. LMSR math calculates cost (`lmsrBuyCost()`) or proceeds (`lmsrSellReturn()`)
4. Buy/sell instruction created via `createBuyIx()` / `createSellIx()`
5. Transaction bundled and signed via Phantom
6. Helius webhook indexes the trade event to `trade_events` table
7. UI refreshes positions and chart

---

## Leaderboard System

Weekly rankings that reset every Monday at 00:00 UTC.

**How it works:**
1. When a user trades through Mentioned, the trade is recorded in the `polymarket_trades` database table (wallet, market, amount, side)
2. The leaderboard API fetches all distinct wallets that traded this week from the DB
3. For each wallet, it calls Jupiter's `/history` endpoint to get all trade events
4. Events are filtered to the current week by timestamp
5. Metrics are computed from Jupiter's event types:
   - **Volume** — sum of `totalCostUsd` from `order_filled` events
   - **P&L** — sum of `realizedPnl` from `payout_claimed` events
   - **Winning trades** — count of claims where `realizedPnl > 0`
   - **Total trades** — count of `order_filled` events
6. Usernames are batch-loaded from `user_profiles`
7. Results are cached for 3 minutes

---

## Chat System

Global real-time chat available to all connected users.

- Polling-based: fetches new messages every 3 seconds via `?after={lastMessageId}`
- Messages limited to 200 characters, rate-limited to 500ms per wallet
- Username auto-populated from `user_profiles` or truncated wallet address
- Optimistic UI: messages appear instantly with a temporary negative ID
- Collapsible chat bubble in the bottom-right corner with unread badge
- Auto-scrolls to bottom when expanded

---

## Database Schema

### `polymarket_trades`
Records trades placed through Mentioned for leaderboard tracking.
- `id` (serial), `wallet`, `market_id`, `event_id`, `is_yes`, `is_buy`, `side`, `amount_usd`, `tx_signature`, `created_at`
- Indexed on `wallet + created_at` and `created_at`

### `user_profiles`
User identity and settings.
- `id` (serial), `wallet` (unique), `username` (unique), `created_at`, `updated_at`

### `chat_messages`
Global chat messages.
- `id` (serial), `wallet`, `username`, `message`, `created_at`
- Indexed on `created_at DESC`

### `trade_events`
On-chain mention market trades (indexed via Helius webhook).
- `id`, `signature`, `market_id`, `word_index`, `direction` (0=YES, 1=NO), `is_buy`, `quantity`, `cost`, `fee`, `new_yes_qty`, `new_no_qty`, `implied_price`, `trader`, `block_time`, `created_at`
- Indexed on `signature` (unique composite), `market_id + block_time`, `trader + block_time`, `market_id + word_index`

### `market_transcripts`
Event transcript text for markets.
- `id`, `market_id` (unique), `transcript`, `source_url`, `submitted_by`, `created_at`

### `market_metadata`
Market cover images.
- `id`, `market_id` (unique), `image_url`, `created_at`

---

## Wallet Integration

Uses Wallet Standard (`@wallet-standard/app`) with Phantom wallet.

- **Auto-reconnect:** On page load, checks if Phantom has a cached account and silently connects
- **Balance polling:** Every 10 seconds via `@solana/kit` RPC client
- **Transaction signing:** Phantom's `solana:signAndSendTransaction` feature, transaction encoded as Uint8Array (base64 from API → bytes)
- **Account change detection:** Listens for wallet events to update connected account
- **RPC:** `https://api.mainnet-beta.solana.com`

---

## Smart Contracts

### mention-market-amm (Active)
- **Program ID:** `2oKQaiKx3C2qpkqFYGDdvEGTyBDJP85iuQtJ5vaPdFrU`
- **Type:** Binary LMSR per word with shared liquidity pool
- **Instructions:** deposit, withdraw, create_market, pause_market, buy, sell, deposit_liquidity, withdraw_liquidity, resolve_word, redeem
- **Accounts:** MarketAccount (with embedded WordState[8]), LpPosition, UserEscrow
- **Math:** Fixed-point (1e9 precision) — fp_exp, fp_ln, binary_lmsr_cost, implied_price
- **Deployment:** Devnet (native lamports vault, no wrapped SOL)

### mention-market (Legacy)
- **Program ID:** `AJ4XSwJoh2C8vmd8U7xhpzMkzkZZPaBRpbfpkmm4DmeN`
- **Type:** Central limit order book
- **Status:** Not actively used in current frontend

---

## Components

| Component | Purpose |
|-----------|---------|
| `Header` | Logo, nav (Leaderboard, Positions), wallet dropdown (Profile, Disconnect) |
| `Footer` | Site links (Waitlist, Discord, Twitter), legal disclaimer |
| `GlobalChat` | Collapsible chat widget with polling, optimistic sends, unread badge |
| `MarketCard` | Market preview card with image, word grid, odds, volume |
| `OrderBook` | YES/NO orderbook visualization with bar charts |
| `MarketChart` | LMSR price history chart (multi-word, color-coded) |
| `FlashValue` | Animated value change transitions |
| `CountdownTimer` | Real-time event countdown |
| `WordList` | Selectable word list for mention markets |
| `DepositModal` | SOL deposit/withdraw modal for on-chain escrow |
| `QuickBuy` | Quick trade execution |
| `SharePnLModal` | Social sharing of P&L results |
| `WalletProviderWrapper` | Root-level wallet context provider |

---

## External Integrations

| Service | Purpose |
|---------|---------|
| Jupiter Prediction API | Polymarket event data, trading, positions, history |
| Helius | Webhook indexing of on-chain trade events |
| Railway | PostgreSQL hosting |
| Supabase | Secondary data store |
| Phantom | Wallet connection and transaction signing |
