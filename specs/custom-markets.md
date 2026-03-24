# Custom Markets Spec

Free-to-play prediction markets where users predict YES/NO on words without spending crypto. Points awarded for correct predictions.

## Core Concept

Admins create markets with a list of words tied to an event (livestream, earnings report, patch notes). Users predict whether each word will be mentioned. After the event, admins resolve each word and points are awarded based on correctness and crowd sentiment.

## Market Lifecycle

```
draft → open → locked → resolved
  ↘      ↘       ↘
   cancelled  cancelled  cancelled
```

- **Draft**: Not visible on listing page. Accessible via direct link for admin preview. Words can be added/removed.
- **Open**: Visible to users. Predictions accepted. Sentiment visible.
- **Locked**: Predictions frozen. Triggered manually by admin or automatically when `lock_time` passes.
- **Resolved**: Admin marks each word YES/NO. Points awarded to participants.
- **Cancelled**: Terminal state, reachable from draft/open/locked.

## Scoring

Bands based on YES sentiment percentage at lock time:

| YES % | Band | Correct YES pts | Correct NO pts |
|-------|------|-----------------|----------------|
| < 40% | Unpopular | 150 | 50 |
| 40-60% | Split | 100 | 100 |
| > 60% | Popular | 50 | 150 |

- Incorrect prediction: -100 from market prize pool
- 4+ predictions bonus: +25 (one-time, per market)
- Market prize pool floored at 0 (no negative impact on global points)
- Points persisted via existing `point_events` system with `action = 'custom_market_win'` and `ref_id = 'custom_{marketId}'`

## Database

### Tables

**`custom_markets`** — id, title, description, cover_image_url, stream_url, status, lock_time, created_at, updated_at

**`custom_market_words`** — id, market_id (FK cascade), word, resolved_outcome (null = unresolved)

**`custom_market_predictions`** — id, market_id (FK cascade), word_id (FK cascade), wallet, prediction, created_at, updated_at. Unique on (market_id, word_id, wallet) for upsert.

### Key Indexes
- `idx_custom_markets_status` — status filtering for listing
- `idx_custom_pred_unique` — enforces one prediction per user per word, enables ON CONFLICT upsert
- `idx_custom_pred_wallet` — user prediction lookups
- `idx_custom_pred_word` — sentiment aggregation

## API Routes

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/custom` | GET | Public | List public markets (with word_count, prediction_count) |
| `/api/custom` | POST | Admin | Create market + words |
| `/api/custom/[id]` | GET | Public | Market detail + words + sentiment |
| `/api/custom/[id]` | PUT | Admin | Update market fields |
| `/api/custom/[id]` | DELETE | Admin | Delete market (cascades) |
| `/api/custom/[id]/predict` | POST | Wallet | Submit/change prediction (rate-limited) |
| `/api/custom/[id]/predictions` | GET | Wallet | Get user's predictions |
| `/api/custom/[id]/sentiment` | GET | Public | Per-word YES/NO percentages (for polling) |
| `/api/custom/[id]/status` | POST | Admin | Status transitions |
| `/api/custom/[id]/resolve` | POST | Admin | Resolve words, triggers scoring when all resolved |
| `/api/custom/[id]/words` | POST/DELETE | Admin | Add/remove words (draft only) |

Admin auth: `ADMIN_WALLETS` env var (comma-separated wallet pubkeys). Same pattern as existing admin pages.

## Pages

**`/custom/[id]`** — Detail page. Word grid with YES/NO toggles, sentiment bars per word, potential points panel, stream embed, event chat (reuses EventChat with `eventId="custom_{id}"`). Polls sentiment every 10s when open.

**`/customadmin`** — Admin page. Create form, markets table with expandable detail rows, word management, status transitions, resolution panel with per-word YES/NO + "resolve all".

**`/markets`** — Modified. Filter tabs (All/Paid/Free). Custom markets appear in a "Free" section via `CustomEventCard` component with green "FREE" badge.

## Key Files

| File | Purpose |
|------|---------|
| `lib/db.ts` | All custom market DB functions (~15 functions) |
| `lib/customScoring.ts` | Scoring engine, `resolveAndScoreMarket()`, `calculatePotentialPoints()` |
| `lib/customMarketUtils.ts` | Shared: sentiment bands, status helpers, transition validation |
| `lib/adminAuth.ts` | `isAdmin()` check against `ADMIN_WALLETS` env |
| `components/CustomEventCard.tsx` | Card for market listing page |

## Design Decisions

- **Separate words table** (not JSON on market) — enables FK from predictions, DB-level unique constraint, efficient sentiment joins
- **Sentiment visible before voting** — gaming the meta is intentional. Code structured so hiding sentiment until after voting is a simple conditional change.
- **Chat reuse** — `event_chat_messages` with `event_id = "custom_{id}"`. Zero changes to EventChat component.
- **Lock-time sentiment for scoring** — `getWordSentimentAtLockTime()` filters predictions by `updated_at <= lock_time`. After lock, live sentiment and lock-time sentiment are identical since no new predictions can come in.
- **CAS on resolution** — `updateCustomMarketStatus(id, 'resolved', 'locked')` prevents double-scoring on concurrent resolve requests. Scoring itself is idempotent via `point_events` dedup.
- **Atomic lock** — `lockCustomMarket()` sets status + lock_time in a single query.

## Planned Future Extensions

These were discussed during design and the code is structured to support them:

- **Points buy-in**: Users spend points to predict. Scoring fields support variable entry cost.
- **Transcript auto-resolution**: Parse `market_transcripts` for word mentions. Per-word `resolved_outcome` column supports incremental resolution.
- **Hidden sentiment**: Conditionally hide sentiment until user has voted on a word. The `WordCard` component can gate the sentiment bar display behind a simple check.
- **Confidence weighting**: Distribute a fixed budget across predictions instead of flat YES/NO.
