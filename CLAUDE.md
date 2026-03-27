# Mentioned — Project Guide

Solana prediction market platform. Users trade YES/NO outcomes on esports matches (via Jupiter/Polymarket), on-chain word-mention markets (LMSR AMM), and free play-token markets (virtual LMSR). Next.js 14 App Router fullstack app.

## Tech Stack

- **Frontend:** Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS
- **Blockchain:** Solana (`@solana/kit` v2), Anchor 0.31.1, Phantom wallet (Wallet Standard)
- **Database:** PostgreSQL 16 (Railway prod, Docker local), `pg` library with raw SQL
- **APIs:** Jupiter Prediction API (`api.jup.ag/prediction/v1`), Helius webhooks for on-chain indexing
- **Charts:** Canvas-based (`EventPriceChart`, `MarketChart`), Recharts

## Architecture

```
app/
├── api/
│   ├── polymarket/       # Jupiter API proxy (events, orders, positions, leaderboard)
│   ├── custom/           # Free market CRUD, trading, positions, chart, resolution
│   ├── trades/           # On-chain trade queries + chart data
│   ├── webhook/          # Helius webhook → parse Anchor events → insert to DB
│   ├── chat/             # Global chat (GET polling, POST with rate limit)
│   ├── profile/          # Username + PFP management
│   ├── achievements/     # Achievement unlock
│   └── ...
├── polymarkets/          # Polymarket pages (event listing + event detail trading)
├── markets/              # Market listing (paid on-chain + free markets with filter tabs)
├── market/[id]/          # On-chain market detail (trading, chart, admin)
├── custom/[id]/          # Free market detail (virtual LMSR trading, chart, positions)
├── customadmin/          # Free market admin (create, manage, resolve)
├── positions/            # User positions/orders/history tabs
├── leaderboard/          # Weekly rankings + points leaderboard
├── profile/              # User profile + public profile/[username]
├── admin/                # On-chain market creation, liquidity, resolution
└── polyadmin/            # Polymarket admin panel

components/               # React components (Header, EventChat, EventPriceChart, CustomEventCard, etc.)
contexts/                 # WalletContext (Phantom connection, balance, signing), AchievementContext
lib/
├── db.ts                 # All PostgreSQL queries (pool, typed functions, transactions)
├── mentionMarket.ts      # Solana instructions + LMSR math (buy/sell cost, implied price)
├── virtualLmsr.ts        # Float-based LMSR for free markets (same math, no bigint)
├── customScoring.ts      # Free market resolution payouts + profit-to-points conversion
├── customMarketUtils.ts  # Status helpers, transition validation, client-side estimates
├── adminAuth.ts          # Admin wallet check (ADMIN_WALLETS env)
├── jupiterApi.ts         # Jupiter API client (API key, fetch wrapper)
├── tradeParser.ts        # Parse Anchor events from Helius webhook payloads
├── achievements.ts       # Achievement definitions + unlock logic
├── points.ts             # Point system (trades, holds, chat, achievements)
└── ...

solana_contracts/         # Anchor programs (Rust)
├── programs/mention-market-amm/  # Active: LMSR AMM (devnet)
├── programs/mention-market/      # Legacy: CLOB (not used)
└── ...

scripts/                  # DB migration, seed, backfill (ts-node)
specs/                    # Feature specifications
├── custom_free_market_spec.md    # Complete free market spec (read this for free market context)
```

## Key Patterns

- **No ORM.** Raw SQL via `pg` pool in `lib/db.ts`. All DB functions exported from there.
- **No state manager.** React Context for wallet + achievements. Component-level `useState`/`useEffect` for everything else.
- **API routes proxy Jupiter.** Polymarket routes forward to `api.jup.ag` with API key + client IP.
- **Helius webhook indexing.** On-chain trades indexed via `POST /api/webhook` → `tradeParser.ts` → `db.insertTradeEvent()`.
- **Wallet auth only.** No sessions/JWT. Wallet public key is the identity. Admin checks via `ADMIN_WALLETS` env var.
- **Fire-and-forget side effects.** Points, achievements, and scoring awarded in API handlers without awaiting.
- **Transactions for free market trades.** `executeVirtualTrade` in `lib/db.ts` uses `pool.connect()` + `BEGIN/COMMIT/ROLLBACK` with `SELECT FOR UPDATE` for pool concurrency.
- **LMSR math:** On-chain in `lib/mentionMarket.ts` (bigint fixed-point 1e9). Free markets in `lib/virtualLmsr.ts` (float). Same formulas.
- **Path alias:** `@/*` maps to project root.

## Three Market Types

### 1. Polymarket (Jupiter Integration)
- Users trade on esports events via Jupiter's Prediction API
- Real USDC, real Solana transactions
- Pages: `/polymarkets`, `/polymarkets/event/[eventId]`
- API: `/api/polymarket/*`

### 2. On-Chain Mention Markets
- Custom LMSR AMM deployed on Solana devnet
- Real SOL, on-chain transactions signed via Phantom
- Pages: `/market/[id]`, `/admin`
- API: `/api/trades/*`, `/api/webhook`
- Contract: `2oKQaiKx3C2qpkqFYGDdvEGTyBDJP85iuQtJ5vaPdFrU`

### 3. Free Markets (Virtual LMSR)
- Same LMSR math as on-chain markets, but with virtual play tokens
- No real money — profit converts to platform points at 0.5x
- Pages: `/custom/[id]`, `/customadmin`
- API: `/api/custom/*`
- Full spec: `specs/custom_free_market_spec.md`
- Key files: `lib/virtualLmsr.ts`, `lib/customScoring.ts`, `lib/customMarketUtils.ts`

## Database Tables

### Core
| Table | Purpose |
|-------|---------|
| `trade_events` | On-chain mention market trades (Helius-indexed) |
| `polymarket_trades` | Jupiter trades recorded for leaderboard |
| `user_profiles` | wallet → username + pfp_emoji |
| `chat_messages` | Global chat |
| `event_chat_messages` | Per-event chat (also used for free markets with `event_id = "custom_{id}"`) |
| `point_events` | Points awarded (action, wallet, ref_id, metadata JSONB) |
| `user_achievements` | Unlocked achievements per wallet |
| `market_transcripts` | Event transcripts |
| `market_metadata` | Market cover images |
| `event_streams` | Live stream URLs |

### Free Markets
| Table | Purpose |
|-------|---------|
| `custom_markets` | Market config (title, status, b_parameter, play_tokens, lock_time) |
| `custom_market_words` | Words per market (word, resolved_outcome) |
| `custom_market_word_pools` | LMSR pool state per word (yes_qty, no_qty) |
| `custom_market_positions` | User share holdings per word (yes_shares, no_shares, tokens_spent/received) |
| `custom_market_balances` | User play token balance per market |
| `custom_market_trades` | Individual trade log (buy/sell, shares, cost, price after) |
| `custom_market_price_history` | Implied price per word after each trade (for chart) |

Schema defined in `scripts/migrate.ts`. All tables use `IF NOT EXISTS`.

## Points System

| Action | Points | Notes |
|--------|--------|-------|
| `trade_placed` | 10 | Per trade |
| `first_trade` | 100 | One-time bonus |
| `claim_won` | 50 | Claimed a winning position |
| `chat_message` | 2 | Daily cap of 10 messages (20 pts/day max) |
| `hold_1h/4h/24h` | 5/15/30 | Held position for duration |
| `achievement` | varies | Points from achievement unlock |
| `custom_market_win` | varies | Free market profit * 0.5x multiplier |

## Dev Commands

```bash
npm run dev           # Next.js dev server (localhost:3000)
npm run db:start      # Docker Postgres + migrate + seed
npm run db:migrate    # Run schema migrations
npm run db:seed       # Seed test data (local only)
npm run db:stop       # Stop Docker Postgres
npm run build         # Production build
npm run lint          # ESLint
```

## Key Constants

- **AMM Program ID:** `2oKQaiKx3C2qpkqFYGDdvEGTyBDJP85iuQtJ5vaPdFrU` (devnet)
- **Jupiter API base:** `https://api.jup.ag/prediction/v1`
- **RPC:** mainnet-beta (default), devnet for contracts
- **Domain:** `mentioned.market`
- **Free market points multiplier:** `0.5` (in `lib/customScoring.ts`)

## When Adding Features

- New API routes go in `app/api/`. Follow existing pattern: `NextRequest`/`NextResponse`, validate input, call `lib/db.ts` functions.
- New DB queries go in `lib/db.ts`. Use parameterized queries (`$1, $2`). Return typed results. Use transactions (`pool.connect()` + `BEGIN/COMMIT/ROLLBACK`) when multiple writes must be atomic.
- Schema changes go in `scripts/migrate.ts` with `IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- New pages go in `app/` using App Router conventions. Use `'use client'` only when needed.
- Wallet interactions use `useWallet()` from `contexts/WalletContext.tsx`.
- Solana instructions are built in `lib/mentionMarket.ts`.
- Free market changes reference `specs/custom_free_market_spec.md` for full context.
- Don't import server-only modules (`lib/db.ts`, `lib/customScoring.ts`) in client components — they pull in `pg`/`fs` which break the webpack build.
