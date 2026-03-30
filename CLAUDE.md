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
│   ├── bug-report/       # Discord webhook bug reports (rate-limited, sanitized)
│   └── ...
├── polymarkets/          # Polymarket pages (event listing + event detail trading)
├── markets/              # Market listing (paid on-chain + free markets with filter tabs)
├── market/[id]/          # On-chain market detail (trading, chart, admin)
├── custom/[id]/          # Free market detail (virtual LMSR trading, chart, positions)
├── customadmin/          # Free market admin (create, manage, resolve)
├── positions/            # User positions/orders/history tabs
├── leaderboard/          # Weekly rankings + points leaderboard
├── profile/              # Unified profile: /profile/[username] handles owner + visitor views; /profile redirects to /profile/{wallet}
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
- **Discord required to trade.** Users can view free markets but must link Discord before placing trades. Enforced both client-side (UI gate in `/custom/[id]`) and server-side (403 from `/api/custom/[id]/trade`).
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
- Profile page is unified: ownership is derived (`profile.wallet === publicKey`), not a separate route. Owner-only UI (editing, Discord, orders tab, history tab, stat cards) is gated on `isOwnProfile`. Visitors see a read-only view. Use `isOwnerView = isOwnProfile && !viewAsPublic` to control which branch renders.

## Homepage (Scroll-Driven Slideshow)

The homepage (`app/page.tsx`) uses a scroll-driven slideshow architecture:
- **One tall scroll container** (`useGlobalScroll` hook) with a single `fixed inset-0` viewport overlay
- **Hero slide** (80vh scroll distance) + **5 content slides** (130vh each) defined in `SLIDES` array
- **Crossfade transitions**: outgoing slide fades out + slides left, incoming fades in + slides from right (last 25% of scroll range)
- **Auto-play animations**: Components receive `play: boolean` and use `useAutoPlay(play, duration)` hook (requestAnimationFrame-based, returns 0→1 over N ms). Animations play automatically when a slide becomes current, not scroll-driven.
- **After the slideshow**: normal-flow sections (social/competitive, market types, CTA) use `useScrollReveal` IntersectionObserver for reveal animations
- **Mobile**: Header uses burger menu (`md:hidden`), hero/slide text scales down, step 1 shows 1 card instead of 3, fixed viewport has safe padding
- **GlobalChat hidden on homepage** via `usePathname() === '/'` check, also hidden on mobile via CSS `hidden md:block`

## Achievements System

15 achievements defined in `lib/achievements.ts`. Each has `id`, `emoji`, `title`, `description`, `points`.

| ID | Emoji | Title | Points | Trigger Location |
|---|---|---|---|---|
| `set_nickname` | 🏷️ | Named & Famed | 75 | `PUT /api/profile` |
| `set_pfp` | 🎨 | Fresh Fit | 50 | `PATCH /api/profile` |
| `first_trade` | 🎯 | First Shot | 150 | `POST /api/polymarket/trades/record` |
| `win_trade` | 🏆 | Winner Winner | 225 | `POST /api/polymarket/positions/claim` |
| `lose_trade` | 💀 | Battle Scarred | 75 | `DELETE /api/polymarket/positions/close` |
| `10_trades` | 📊 | Getting Started | 100 | Trade record (count check) |
| `50_trades` | 🔥 | On Fire | 250 | Trade record (count check) |
| `100_trades` | 💯 | Centurion | 500 | Trade record (count check) |
| `3_wins` | 🎰 | Hat Trick | 150 | Claim position (win count check) |
| `10_wins` | 👑 | King of the Hill | 400 | Claim position (win count check) |
| `first_chat` | 💬 | Say Something | 50 | `POST /api/chat` and `POST /api/chat/event` |
| `50_chats` | 📢 | Loud Mouth | 150 | Chat POST (message count check) |
| `first_free_trade` | 🎮 | Free Player | 75 | `POST /api/custom/[id]/trade` |
| `free_market_win` | 🏅 | Play Money Pro | 150 | `lib/customScoring.ts` (on profit > 0) |

**Achievement flow**: API endpoint calls `tryUnlockAchievement(wallet, id)` → returns achievement def if newly unlocked → endpoint includes `newAchievements` array in response → frontend calls `showAchievementToast(ach)` from `useAchievements()` context.

**Count helpers in db.ts**: `getPolymarketTradeCount`, `getPolymarketWinCount`, `getChatMessageCount`, `getCustomMarketTradeCount`.

**Toast handling**: All endpoints that unlock achievements return `newAchievements` in the JSON response. Frontend pages/components that make these API calls check for `data.newAchievements?.length` and loop through calling `showAchievementToast()`. This includes: polymarket event page, positions page, profile page, custom market page, GlobalChat, and EventChat.

## Performance Patterns

- **Profile data cached in WalletContext.** `username`, `pfpEmoji`, and `refreshProfile()` live in `contexts/WalletContext.tsx`. Fetched once on wallet connect, shared by Header, GlobalChat, EventChat. Call `refreshProfile()` after any profile edit (username, PFP) so the header updates.
- **Smart chat polling.** `GlobalChat` and `EventChat` use adaptive `setTimeout` polling (not `setInterval`). Starts at 3s, backs off by 2s per empty response up to 15s max. Pauses when `document.hidden`. Resets to 3s on new messages or when the user sends a message. Constants: `POLL_MIN`, `POLL_MAX`, `POLL_BACKOFF_STEP`.
- **Lazy tab data loading.** Positions page and profile page only fetch data for the active tab. Orders and history fetch/poll when their tab becomes active; intervals are cleaned up when switching away. Follow the pattern: `useEffect` guarded by `tab !== 'x'` with interval inside.
- **CSS display:none for tabs.** Tab content on positions and profile pages uses `style={{ display: active ? undefined : 'none' }}` instead of conditional rendering (`{tab === 'x' && (...)}`). DOM stays mounted across tab switches for instant switching and preserved scroll position.
- **Memoized PNL map.** Profile page pre-computes `pnlMap` via `useMemo` over `activeHistory`, then uses `getPnl(h)` (a `Map.get` lookup) instead of calling `eventPnl(h)` repeatedly. All derived values (`periodPnl`, `biggestWin`, history row rendering) use `getPnl`.
- **Profile + achievements parallel fetch.** Profile page calls `fetchAchievements(data.wallet)` inline in the profile fetch `.then()` callback, eliminating a render-cycle delay between profile load and achievements load.

## Mobile Patterns

- **Header**: Nav links hidden on mobile (`hidden md:block`), burger menu shown (`md:hidden`) with dropdown for Markets/Leaderboard/Positions/Profile
- **GlobalChat**: Hidden on mobile via `hidden md:block md:flex` on both collapsed bubble and expanded panel
- **Market pages**: Use fixed bottom sheet for trading on mobile (`lg:hidden`), desktop sidebar (`hidden lg:block`)
- **CSS utility**: `.scrollbar-hide` in `globals.css` hides scrollbars cross-browser
