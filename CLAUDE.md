# Mentioned — Project Guide

Solana prediction market platform. Users trade YES/NO outcomes on events (via Jupiter/Polymarket), on-chain word-mention markets (LMSR AMM), and free play-token markets (virtual LMSR). Next.js 14 App Router fullstack app.

## Tech Stack

- **Frontend:** Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS
- **Blockchain:** Solana (`@solana/kit` v2), Anchor 0.31.1, Phantom wallet (Wallet Standard)
- **Database:** PostgreSQL 16 (Railway prod, Docker local), `pg` library with raw SQL
- **APIs:** Jupiter Prediction API (`api.jup.ag/prediction/v1`), Helius webhooks for on-chain indexing
- **Charts:** Canvas-based (`EventPriceChart`, `MarketChart`), Recharts
- **Infra** All deployed on Railway - fronted with Cloudflare.

## Important notes to remember:
- The code needs to be well written and without errors, verify as you're working
- Every solution needs to take into account user experience and keep with the social aspect of Mentioned
- Scalability, performance and security is incredibly important, make sure any change meets this criteria
- When making changes, ensure they will perform and look well on mobile

## Architecture

```
app/
├── api/
│   ├── polymarket/       # Jupiter API proxy (events, orders, positions, leaderboard)
│   ├── custom/           # Free market CRUD, trading, positions, chart, resolution
│   ├── trades/           # On-chain trade queries + chart data
│   ├── webhook/          # Helius webhook → parse Anchor events → insert to DB
│   ├── chat/             # Global + event chat (SSE streaming, POST with rate limit)
│   ├── profile/          # Username + PFP management
│   ├── achievements/     # Achievement unlock
│   ├── bug-report/       # Discord webhook bug reports (rate-limited, sanitized)
│   ├── admin/streams/    # Transcription monitoring intent (start/cancel a worker run)
│   ├── admin/mentions/   # Live word-mention counter (initial load + SSE + dismiss)
│   └── ...
├── polymarkets/          # Polymarket pages (event listing + event detail trading)
├── markets/              # Market listing (paid on-chain + free markets with filter tabs)
├── free/[slug]/          # Free market detail (virtual LMSR trading, chart, positions)
├── customadmin/          # Free market admin (create, manage, resolve, live transcription panel)
├── positions/            # User positions/orders/history tabs
├── leaderboard/          # Weekly rankings + points leaderboard
├── profile/              # Unified profile: /profile/[username] handles owner + visitor views; /profile redirects to /profile/{wallet}
└── polyadmin/            # Polymarket admin panel
# Note: /market/[id] (on-chain market UI) and /paidcustomadmin live on
# feat/add-paid-markets, not main. Main has the contract + SDK + API only.

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
├── chatStream.ts         # Shared Postgres LISTEN singleton for SSE chat streaming
├── mentionStream.ts      # Shared Postgres LISTEN singleton for SSE word-mention streaming
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
└── live_transcription_spec.md    # Live transcription / word-detection spec (read for transcript-worker context)

services/                 # Sibling Node services (own package.json, own Railway deploy)
└── transcript-worker/    # Live + VOD transcription pipeline (Deepgram, ffmpeg, streamlink/yt-dlp)
```

## Key Patterns

- **No ORM.** Raw SQL via `pg` pool in `lib/db.ts`. All DB functions exported from there.
- **No state manager.** React Context for wallet + achievements. Component-level `useState`/`useEffect` for everything else.
- **API routes proxy Jupiter.** Polymarket routes forward to `api.jup.ag` with API key + client IP.
- **Helius webhook indexing.** On-chain trades indexed via `POST /api/webhook` → `tradeParser.ts` → `db.insertTradeEvent()`.
- **Wallet auth only.** No sessions/JWT. Wallet public key is the identity. Admin checks via `ADMIN_WALLETS` env var.
- **Fire-and-forget side effects.** Points, achievements, and scoring awarded in API handlers without awaiting.
- **Transactions for free market trades.** `executeVirtualTrade` in `lib/db.ts` uses `pool.connect()` + `BEGIN/COMMIT/ROLLBACK` with `SELECT FOR UPDATE` for pool concurrency.
- **LMSR math:** On-chain in `lib/mentionMarketUsdc.ts` (bigint, USDC base units 1e6). Free markets in `lib/virtualLmsr.ts` (float). Same formulas. Legacy SOL-AMM client `lib/mentionMarket.ts` still on disk (only `PrivyFundsModal` uses its `sendIxs` for SOL transfers — no longer interacts with the on-chain market program).
- **Path alias:** `@/*` maps to project root.

## Three Market Types

### 1. Polymarket (Jupiter Integration)
- Users trade on events via Jupiter's Prediction API
- Real USDC, real Solana transactions
- Pages: `/polymarkets`, `/polymarkets/event/[eventId]`
- API: `/api/polymarket/*`

### 2. On-Chain Mention Markets (USDC, devnet)
- Custom LMSR AMM deployed on Solana **devnet**, settled in **devnet USDC** (6 decimals).
- Trades signed via Phantom's `signTransaction` (raw-bytes path on `WalletContext.signOnly`) and broadcast directly to Helius devnet RPC — bypasses the mainnet simulate/send proxy.
- **UI lives on `feat/add-paid-markets` branch, not main.** When that branch ships, it adds `/market/[id]` (detail/trading: `OnchainMarketClient`) and `/paidcustomadmin` (admin create/liquidity/resolve), plus paid-market sections of `app/positions` and `app/profile/[username]`. Main has the contract source + SDK + read API only.
- API on main: `/api/paid-markets/*` (chart, trades, metadata, user-positions), `/api/webhook` (Helius → `tradeParser.ts` → `trade_events`).
- Legacy `/api/trades/*` routes are unmaintained — they still read `trade_events` but expect the old SOL/1e9 units; the parser now emits raw USDC base units (1e6) so any external caller will be off by ~1e6×. Only `TradeTicker` calls `/api/trades/recent`, which reads from `polymarket_trades` / `custom_market_trades` and is unaffected.
- Off-chain metadata (title, cover image, stream URL) lives in DB table `paid_market_metadata`; on-chain state is the source of truth for everything else.
- Contract: `9kSuebrHKKnFsgFcv5fc8S2gBazHA9Gki2NEWt2ft9tk` (Anchor program `mention-market-usdc-amm`). Source: `solana_contracts/programs/mention-market-usdc-amm/`.

### 3. Free Markets (Virtual LMSR)
- Same LMSR math as on-chain markets, but with virtual play tokens
- No real money — profit converts to platform points at 0.5x
- **Discord required to trade.** Users can view free markets but must link Discord before placing trades. Enforced both client-side (UI gate in `/free/[slug]`) and server-side (403 from `/api/custom/[id]/trade`).
- Pages: `/free/[slug]` (resolves slug → id via `/api/custom/by-slug/[slug]`), `/customadmin`
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
| `custom_market_words` | Words per market (word, resolved_outcome, **mention_threshold**, **match_variants**, **pending_resolution**) |
| `custom_market_word_pools` | LMSR pool state per word (yes_qty, no_qty) |
| `custom_market_positions` | User share holdings per word (yes_shares, no_shares, tokens_spent/received) |
| `custom_market_balances` | User play token balance per market |
| `custom_market_trades` | Individual trade log (buy/sell, shares, cost, price after) |
| `custom_market_price_history` | Implied price per word after each trade (for chart) |

### Live Transcription (transcript-worker)
| Table | Purpose |
|-------|---------|
| `monitored_streams` | One row per worker run (event_id, stream_url, status, kind, worker_pool, cost). Multiple terminal rows per event_id; partial unique index blocks two simultaneously-active runs. |
| `live_transcript_segments` | Finalized Deepgram segments (FK stream_id, start_ms/end_ms, text, confidence) |
| `word_mentions` | Detected mentions (FK stream_id, word_index, snippet, stream_offset_ms, confidence, superseded). UNIQUE(stream_id, word_index, global_char_offset) for position-based dedupe. |

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

- **AMM Program ID:** `9kSuebrHKKnFsgFcv5fc8S2gBazHA9Gki2NEWt2ft9tk` (devnet, USDC AMM — `mention-market-usdc-amm`)
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
- Don't cross the Next.js / `services/transcript-worker` boundary with imports. They share Postgres only (NOTIFY channels + tables). The worker has its own `package.json` and Railway deploy.
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

## Achievements System (Weekly Rotation)

Achievements rotate weekly. Each week's set is defined in `lib/achievements.ts` as the `ACHIEVEMENTS` array. The `user_achievements` table self-rotates via a `week_start` column (unique on `wallet + achievement_id + week_start`), so the same achievement ID can be unlocked again in a new week without manual table cleanup. Achievement points count toward the weekly leaderboard.

**Current week's achievements:**

| ID | Emoji | Title | Points | Trigger Location |
|---|---|---|---|---|
| `place_trade` | 🎯 | Pull the Trigger | 100 | `POST /api/polymarket/trades/record` |
| `win_trade` | 🏆 | Cashed Out | 150 | `POST /api/polymarket/positions/claim` |
| `send_chat` | 💬 | Say Something | 75 | `POST /api/chat` and `POST /api/chat/event` |
| `set_profile` | 🏷️ | Make It Official | 75 | `PUT /api/profile` |
| `free_trade` | 🎮 | Play Money | 100 | `POST /api/custom/[id]/trade` |
| `refer_friend` | 🤝 | Bring a Friend | 150 | `POST /api/referral` (awarded to referrer) |

**Achievement flow**: API endpoint calls `tryUnlockAchievement(wallet, id)` → returns achievement def if newly unlocked → endpoint includes `newAchievements` array in response → frontend calls `showAchievementToast(ach)` from `useAchievements()` context.

**Toast handling**: All endpoints that unlock achievements return `newAchievements` in the JSON response. Frontend pages/components that make these API calls check for `data.newAchievements?.length` and loop through calling `showAchievementToast()`. This includes: polymarket event page, positions page, profile page, custom market page, GlobalChat, and EventChat.

**Weekly reset process**: Update the `ACHIEVEMENTS` array in `lib/achievements.ts` with the new set, update trigger locations in API routes if new achievement IDs differ, redeploy. Do NOT clear `user_achievements` — the `week_start` column handles rotation automatically and historical rows should be preserved. Week boundary is UTC Monday (see `getWeekStart()` in `lib/db.ts` and `lib/points.ts`).

**Discord-link backfill**: When a user links Discord, `backfillAchievementPoints(wallet)` awards points for any current-week achievements they unlocked before linking. Dedup is handled by `insertPointEvent`'s `ON CONFLICT (wallet, action, ref_id)`, so calling it again is safe.

## Performance Patterns

- **Profile data cached in WalletContext.** `username`, `pfpEmoji`, and `refreshProfile()` live in `contexts/WalletContext.tsx`. Fetched once on wallet connect, shared by Header, GlobalChat, EventChat. Call `refreshProfile()` after any profile edit (username, PFP) so the header updates.
- **SSE + Postgres LISTEN/NOTIFY.** Real-time fanout is delivered via Server-Sent Events, not polling. Two singletons follow the same pattern:
  - `lib/chatStream.ts` (channel `chat_new`) — global + per-event chat. GlobalChat only opens SSE when the chat panel is expanded; when collapsed, it polls a lightweight `/api/chat/latest-id` endpoint every 30s for the unread badge. EventChat connects SSE on mount and supports backward cursor pagination (`?before=` param). Both fall back to 30s polling if SSE fails.
  - `lib/mentionStream.ts` (channel `word_mention`) — admin live word-mention counter in `/customadmin`. Worker emits "fat" NOTIFY payloads (full mention row + `type: 'mention' | 'dismiss'` discriminator) so the SSE route is a pure pass-through with zero extra DB hits per event.
  Both singletons survive Next.js hot reloads via `globalThis` and reconnect on disconnect.
- **Lazy tab data loading.** Positions page and profile page only fetch data for the active tab. Orders and history fetch/poll when their tab becomes active; intervals are cleaned up when switching away. Follow the pattern: `useEffect` guarded by `tab !== 'x'` with interval inside.
- **CSS display:none for tabs.** Tab content on positions and profile pages uses `style={{ display: active ? undefined : 'none' }}` instead of conditional rendering (`{tab === 'x' && (...)}`). DOM stays mounted across tab switches for instant switching and preserved scroll position.
- **Memoized PNL map.** Profile page pre-computes `pnlMap` via `useMemo` over `activeHistory`, then uses `getPnl(h)` (a `Map.get` lookup) instead of calling `eventPnl(h)` repeatedly. All derived values (`periodPnl`, `biggestWin`, history row rendering) use `getPnl`.
- **Profile + achievements parallel fetch.** Profile page calls `fetchAchievements(data.wallet)` inline in the profile fetch `.then()` callback, eliminating a render-cycle delay between profile load and achievements load.

## Mobile Patterns

- **Header**: Nav links hidden on mobile (`hidden md:block`), burger menu shown (`md:hidden`) with dropdown for Markets/Leaderboard/Positions/Profile
- **GlobalChat**: Hidden on mobile via `hidden md:block md:flex` on both collapsed bubble and expanded panel
- **Market pages**: Use fixed bottom sheet for trading on mobile (`lg:hidden`), desktop sidebar (`hidden lg:block`)
- **CSS utility**: `.scrollbar-hide` in `globals.css` hides scrollbars cross-browser

## Teams System

Teams feature lives in `app/arena/` (leaderboard + create/join) and `app/arena/[name]/` (team profile). API routes at `app/api/teams/`.

Key files:
- `lib/teamComp.ts` — `COMP_START` / `COMP_END` constants for the active competition window. Update these dates for future runs.
- `lib/db.ts` — `createTeam`, `joinTeam`, `getTeamLeaderboard`, `getTeamMemberPointTotals`, `getTeamBySlug` (no leave-team functionality)
- DB tables: `teams` (id, name, slug, join_code, created_by), `team_members` (wallet PK, team_id, role, joined_at)

Scoring rules:
- Team score = sum of member `point_events` with `created_at` in `[comp_start, comp_end)`. Points earned before joining (during the comp window) DO count — joining a team retroactively credits comp-window points.
- Before the comp starts, `windowStart = new Date(0)` (epoch) so the preview shows all-time points
- Discord link required to earn points — enforced at point_events level, applies automatically to teams
- Max 3 members per team, enforced in `joinTeam` with a count check inside the transaction

**Current competition:** May 4–17 2026, $1,000 prize pool (1st $600 / 2nd $300 / 3rd $100), top 3 teams win.

**Markets page banner:** `PointsExplainerBanner` is hidden during the team comp. `TeamCompBanner` is active in its place (`app/markets/page.tsx`). After May 17, swap `<TeamCompBanner />` back to `<PointsExplainerBanner />` in the JSX (line ~902) and remove the eslint-disable comment from `PointsExplainerBanner`.

## Live Transcription (transcript-worker)

Sibling Node service in `services/transcript-worker/` (own `package.json`, own Railway deploy, separate env scope from Next.js). Live + VOD transcription via Deepgram Nova-3 with automatic word-mention detection. Full spec in `specs/live_transcription_spec.md` — read it before changing any of: schema, NOTIFY payloads, worker pool routing, or VOD path.

**Surfaces in Next.js:**
- Admin UI lives in `app/customadmin/` (transcription panel + live `MentionsPanel`/`WordEditorRow` per market).
- API: `app/api/admin/streams/*` (start/cancel monitoring), `app/api/admin/mentions/*` (counter initial load + SSE + dismiss), `PATCH /api/custom/[id]/words/[wordId]` (per-word `mention_threshold` + `match_variants`).
- DB helpers in `lib/db.ts`: `createMonitoredStream`, `getMonitoredStreamByEvent`, `cancelMonitoredStream`, `getMentionsForStream`, `dismissWordMention`, `updateCustomMarketWord`.
- SSE singleton: `lib/mentionStream.ts` (see Performance Patterns above).

**Worker boundary rules:**
- Never import from `services/transcript-worker/` in Next.js code, or vice versa. The Next.js tsconfig already excludes `services/` from typecheck.
- Worker and Next.js communicate only through Postgres (shared DB, separate role recommended) — `LISTEN/NOTIFY` channels (`stream_added`, `stream_canceled`, `word_mention`, `stream_ended`) and table reads/writes. No HTTP between them.
- Worker NOTIFY payloads are forward-compatible: consumers tolerate missing fields (older worker generation) and ignore unknown fields. Don't break existing fields — only add.

**Schema and run model:**
- One `monitored_streams` row per worker run. Multiple terminal rows per `event_id` are allowed (each historical re-run preserves its own segments + mentions). Partial unique index on `(event_id) WHERE status IN ('pending','live')` blocks two simultaneously-active runs. `getMonitoredStreamByEvent` returns the active row when one exists, else the most recent terminal row.
- Mentions API + UI scope by `stream_id` (the latest run), not `event_id` — aggregating across runs would pollute the live counter. No historical-run picker yet.
- VOD jobs deliberately skip per-mention NOTIFY (would batch-spam SSE); Discord summary at completion is the signal.
- **Pending resolution.** A word can be flagged `pending_resolution=true` (admin acts after seeing a Discord ping). Trading on that word is fully frozen by `POST /api/custom/[id]/trade` until either resolved or unmarked. Reversible until a final outcome is set; resolution is terminal. Admin toggles live in `MentionsPanel` (per word card) and `WordEditorRow` (full word list).

## Maintaining This File

After completing work, consider whether CLAUDE.md needs updating. **Not every change warrants an update** — only update when:
- A new architectural pattern is introduced (e.g. SSE replacing polling, a new shared singleton)
- A key file is added to `lib/` or a new API domain is created under `app/api/`
- An existing pattern documented here has changed (e.g. how chat works, how auth works)
- A new "When Adding Features" rule applies going forward

Do **not** update for: routine bug fixes, UI tweaks, copy changes, adding pages that follow existing patterns, or minor refactors. The goal is to keep this file as a high-level architectural guide, not a changelog.
