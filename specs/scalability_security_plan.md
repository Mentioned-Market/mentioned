# Scalability & Security Implementation Plan

Audit date: 2026-03-31. Targeting 1000+ concurrent users.

---

## Phase 1 — Critical Security (do first, before scaling)

### 1.1 Rotate & Externalize Jupiter API Key
**Files:** `lib/jupiterApi.ts`
**Problem:** API key `2b9a1173-...` is hardcoded on line 3, committed to git.
**Changes:**
- Replace line 3 with `export const JUP_API_KEY = process.env.JUPITER_API_KEY!`
- Add `JUPITER_API_KEY` to Vercel env vars and `.env.local`
- Rotate the key in the Jupiter dashboard immediately — the old one is compromised
- Add `JUPITER_API_KEY=` to `.env.example` if one exists
**Estimated effort:** 15 minutes

### 1.2 Webhook Signature Validation
**Files:** `app/api/webhook/route.ts`
**Problem:** Anyone can POST fake trade events. No auth header or HMAC check.
**Changes:**
- Add `HELIUS_WEBHOOK_SECRET` env var
- At top of POST handler, before parsing body:
  - Read raw body as text (needed for HMAC)
  - Read `authorization` header (Helius sends the secret as an auth header)
  - Compare against env var
  - Return 401 if mismatch
- Helius webhook auth docs: they send the secret in the `Authorization` header. Verify with `authorization === process.env.HELIUS_WEBHOOK_SECRET`
**Estimated effort:** 30 minutes

### 1.3 Sign Discord OAuth State
**Files:** `app/api/discord/link/route.ts`, `app/api/discord/callback/route.ts`
**Problem:** State is plain base64url JSON `{ wallet }`. Attacker can forge it to link their Discord to any wallet.
**Changes:**
- In `link/route.ts`: Create state as `{ wallet, ts: Date.now() }`, sign with HMAC-SHA256 using `DISCORD_STATE_SECRET` env var, append `sig` to the JSON before base64url encoding
- In `callback/route.ts`: Verify HMAC signature. Reject if `ts` is older than 10 minutes. Reject if sig mismatch.
- Add `DISCORD_STATE_SECRET` (random 32-byte hex) to env vars
**Estimated effort:** 30 minutes

### 1.4 Wallet Signature Verification
**Files:** New `lib/walletAuth.ts`, `contexts/WalletContext.tsx`, all state-changing API routes
**Problem:** Every route trusts the wallet param from the client. Anyone can impersonate any wallet.

**Context:** The app supports two wallet types (`contexts/WalletContext.tsx`):
- **Privy** (`walletType: 'privy'`) — Users authenticate via Privy's login flow (`usePrivy()`, `@privy-io/react-auth`). Privy already issues JWTs and tracks `privyAuthenticated`. The app just doesn't send the token to API routes yet.
- **Phantom** (`walletType: 'phantom'`) — Direct wallet-standard connection. No auth. Server has zero proof of wallet ownership.

**Approach: Dual-path auth (leveraging existing Privy infra)**

**Path 1 — Privy users (already mostly solved):**
- Client: Call `getAccessToken()` from `@privy-io/react-auth` before API requests, send as `Authorization: Bearer <token>`
- Server: Verify JWT using `@privy-io/server-auth` (`PrivyClient.verifyAuthToken(token)`) — returns verified wallet address
- Privy handles sessions, refresh, token lifecycle. No new UX. Zero friction.

**Path 2 — Phantom users (sign-in message):**
- On connect, client calls `signMessage` via wallet-standard (`solana:signMessage` feature — supported on modern Phantom)
- Message format: `Sign in to Mentioned\nTimestamp: {unix_seconds}`
- Server verifies Ed25519 signature using `tweetnacl.sign.detached.verify()`
- Server issues `httpOnly` session cookie (signed JWT with wallet address + expiry)
- One popup on first connect. No gas, no transaction. Standard Solana dApp pattern.

**Shared server helper (`lib/walletAuth.ts`):**
```
async function getVerifiedWallet(req: NextRequest): Promise<string | null> {
  // 1. Check Authorization header → verify as Privy JWT → return wallet
  // 2. Check session cookie → verify as Phantom JWT → return wallet
  // 3. Return null (unauthenticated)
}
```

**Client-side changes (`contexts/WalletContext.tsx`):**
- Add a `useEffect` after Privy/Phantom connection that calls an auth endpoint
- For Privy: fetch access token via `getAccessToken()`, store in ref, attach to requests
- For Phantom: trigger `signMessage`, send to `POST /api/auth/sign-in`, receive session cookie
- Create a wrapper `authFetch(url, init)` that automatically attaches the right auth header/cookie

**Ship in two steps:**
1. **Step 1: Privy auth only** (2-3h) — Add `@privy-io/server-auth`, create `getVerifiedWallet()`, update routes. Privy users secured immediately. Phantom users continue as-is.
2. **Step 2: Phantom signMessage** (3-4h) — Add sign-in flow, session cookie, extend `getVerifiedWallet()`. Both paths secured.

**New dependencies:**
- `@privy-io/server-auth` — Privy JWT verification (server-side)
- `tweetnacl` — Ed25519 signature verification for Phantom sign-in

**Routes that need protection (state-changing):**
- `POST /api/chat` and `POST /api/chat/event` (impersonate chat)
- `PUT /api/profile` and `PATCH /api/profile` (steal username/PFP)
- `POST /api/custom/[id]/trade` (trade as someone else)
- `POST /api/polymarket/orders` (place orders as someone else)
- `POST /api/polymarket/trades/record` (record fake trades)
- `POST /api/polymarket/positions/claim` and `DELETE /api/polymarket/positions/close`
- `DELETE /api/discord/unlink` (unlink anyone's Discord)
- All admin routes (already check `isAdmin()` on wallet, but wallet itself is unverified)

**Estimated effort:** 5-7 hours total (2-3h Privy path, 3-4h Phantom path, can ship incrementally)

---

## Phase 2 — Infrastructure for Scale

### 2.1 Add Redis (Upstash)
**Problem:** In-memory Maps for rate limiting and caching are per-instance on Vercel serverless. Rate limits don't work. Caches are redundantly recomputed.
**Changes:**
- Add `@upstash/redis` dependency
- Create `lib/redis.ts` with Upstash client using `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
- Upstash has a free tier (10K requests/day) and is designed for serverless

**Used for:**
- Rate limiting (Phase 2.2)
- Leaderboard cache (Phase 2.3)
- Token price cache (Phase 2.3)
- Future: session tokens if using Option A auth

**Estimated effort:** 30 minutes (setup + client)

### 2.2 Distributed Rate Limiting
**Files:** `app/api/chat/route.ts`, `app/api/chat/event/route.ts`, `app/api/custom/[id]/trade/route.ts`, `app/api/bug-report/route.ts`
**Problem:** `new Map<string, number>()` is per-instance. Also, chat route Maps have no cleanup — leak memory.
**Changes:**
- Create `lib/rateLimit.ts` helper:
  ```
  rateLimit(key: string, windowMs: number, maxRequests: number): Promise<{ allowed: boolean, remaining: number }>
  ```
  Uses Redis `INCR` + `EXPIRE` (sliding window counter pattern)
- Replace all `new Map()` rate limiters with `rateLimit()` calls
- Add rate limiting to routes that currently have none:
  - `POST /api/profile` (username/PFP changes)
  - `POST /api/polymarket/orders` (order placement)
  - `POST /api/polymarket/trades/record` (trade recording)
  - `POST /api/achievements` (achievement unlock)
  - `DELETE /api/discord/unlink`

**Rate limit values:**
| Route | Window | Max | Key |
|-------|--------|-----|-----|
| `/api/chat`, `/api/chat/event` | 1s | 2 | wallet |
| `/api/custom/[id]/trade` | 500ms | 1 | wallet |
| `/api/polymarket/orders` | 1s | 2 | wallet |
| `/api/profile` (PUT/PATCH) | 10s | 1 | wallet |
| `/api/bug-report` | 1h | 3 | IP |

**Estimated effort:** 2-3 hours

### 2.3 External Caching for Expensive Queries
**Files:** `app/api/polymarket/leaderboard/route.ts`, `app/api/polymarket/prices/route.ts`
**Problem:** In-memory `let weeklyCache` / `let alltimeCache` / `tokenCache` lost on cold start. Leaderboard recomputation is extremely expensive (fetches Jupiter history for every trader).
**Changes:**
- Leaderboard: Cache serialized JSON in Redis with 3-minute TTL. Key: `leaderboard:weekly:{weekStart}` and `leaderboard:alltime`
- Token prices: Cache in Redis with 1-hour TTL. Key: `token:{marketId}`
- On cache miss, compute and store. On cache hit, return immediately.
**Estimated effort:** 1-2 hours

### 2.4 Database Connection Pooling
**Files:** `lib/db.ts` (lines 10-14)
**Problem:** `max: 10` per Vercel instance. No timeouts. No PgBouncer.
**Changes:**
- **Railway side:** Enable PgBouncer proxy on Railway. Use the pooler connection string (port 6543 typically) instead of direct Postgres connection string. Set PgBouncer to transaction mode.
- **Code side:** Update pool config:
  ```typescript
  const pool = new pg.Pool({
    connectionString: dbUrl,
    ssl: sslDisabled ? false : { rejectUnauthorized: false },
    max: 3,                        // Low per-instance, PgBouncer handles the rest
    idleTimeoutMillis: 10000,      // Close idle connections after 10s
    connectionTimeoutMillis: 5000, // Fail fast if can't connect in 5s
  })
  ```
- Add statement timeout via pool query: `pool.on('connect', (client) => client.query('SET statement_timeout = 30000'))`
**Estimated effort:** 1 hour

### 2.5 Fetch Timeouts on External APIs
**Files:** `lib/jupiterApi.ts`, `app/api/profile/[username]/route.ts`, `app/api/bug-report/route.ts`, `app/api/discord/callback/route.ts`
**Problem:** No `AbortSignal` on any fetch. If Jupiter or Discord is slow, functions hang until Vercel kills them.
**Changes:**
- Update `jupFetch` in `lib/jupiterApi.ts` to accept a timeout (default 8s):
  ```typescript
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  const res = await fetch(url, { ...init, signal: controller.signal })
  clearTimeout(timeout)
  ```
- Add similar timeout to Discord API calls in callback route
- Add `export const maxDuration = 60` to heavy routes: leaderboard, profile/[username]
**Estimated effort:** 1 hour

---

## Phase 3 — Database Performance

### 3.1 Fix N+1 in insertPointEvent
**File:** `lib/db.ts`, `insertPointEvent()` function
**Problem:** Loops through all referred users, running one INSERT per user.
**Change:** Replace the loop with a single bulk INSERT:
```sql
INSERT INTO point_events (wallet, action, points, ref_id, metadata)
SELECT wallet, 'referral_bonus', $1, $2, $3
FROM user_profiles
WHERE referred_by = $4
```
**Estimated effort:** 30 minutes

### 3.2 Add Missing Indexes
**File:** `scripts/migrate.ts`
**Add:**
```sql
CREATE INDEX IF NOT EXISTS idx_chat_messages_wallet ON chat_messages(wallet);
CREATE INDEX IF NOT EXISTS idx_profile_referred_by_created ON user_profiles(referred_by, created_at DESC) WHERE referred_by IS NOT NULL;
```
**Verify existing indexes are being used:** Run `EXPLAIN ANALYZE` on the hot queries (`getChatMessageCount`, `getReferredUsers`, `getAllPolymarketTraders`).
**Estimated effort:** 30 minutes

### 3.3 Add LIMIT / Pagination to Unbounded Queries
**Files:** `lib/db.ts`
**Functions to fix:**
- `getAllPolymarketTraders()` — add LIMIT or restructure leaderboard to not need all wallets
- `getAllMarketImages()` — add LIMIT or paginate
- `listCustomMarketsPublic()` — add pagination params (offset/limit)
**Estimated effort:** 1-2 hours

### 3.4 Consolidate Multi-Query Functions
**File:** `lib/db.ts`
**Functions to optimize:**
- `getReferralStats()` — 3 queries → 1 query with CTEs
- `getWalletFreeMarketStats()` — correlated subqueries → single CTE
- `insertPointEvent()` — already fixed in 3.1
**Estimated effort:** 1-2 hours

---

## Phase 4 — Trading Logic Hardening

### 4.1 Move Lock Check Inside Transaction
**Files:** `app/api/custom/[id]/trade/route.ts`, `lib/db.ts` (`executeVirtualTrade`)
**Problem:** Market lock_time is checked in the route handler BEFORE the transaction. Two concurrent requests can both pass the check.
**Change:** Inside `executeVirtualTrade`, after `BEGIN` and before any pool locks:
```sql
SELECT status, lock_time FROM custom_markets WHERE id = $1 FOR UPDATE
```
If `status !== 'open'` or `lock_time <= now()`, ROLLBACK and throw. This makes the check atomic with the trade.
**Estimated effort:** 30 minutes

### 4.2 Fix Resolution Double-Payout Race
**Files:** `app/api/custom/[id]/resolve/route.ts`, `lib/db.ts`
**Problem:** `resolveCustomMarketWords` and `resolveWordPositions` are called BEFORE the CAS status update. Two concurrent requests can both apply resolutions.
**Change:** Wrap the entire resolution in a single transaction:
1. `BEGIN`
2. `SELECT status FROM custom_markets WHERE id = $1 FOR UPDATE` — acquire lock
3. If status !== 'locked', ROLLBACK
4. Apply word resolutions
5. Apply position payouts
6. Update status to 'resolved'
7. `COMMIT`
8. Fire-and-forget scoring (already idempotent via point_events constraint)
**Estimated effort:** 1-2 hours

### 4.3 Minimum Trade Size & Float Safeguards
**File:** `lib/db.ts` (`executeVirtualTrade`)
**Problem:** Float tolerance of 0.000001 + `Math.min(cost, balance)` clamping can yield zero-cost trades.
**Changes:**
- Add minimum cost check: `if (cost < 0.01) throw new Error('Trade too small')`
- Add minimum shares check: `if (shares < 0.001) throw new Error('Trade too small')`
- Consider: replace float math with integer math (tokens * 1e6) for all balance/cost operations. This is a larger refactor but eliminates the entire class of float precision bugs. Flag for future consideration.
**Estimated effort:** 30 minutes (guard rails), 4-6 hours (integer math refactor, optional)

### 4.4 Slippage Protection
**Files:** `app/api/custom/[id]/trade/route.ts`, `lib/db.ts`
**Problem:** No `maxCost` parameter on buy trades. Market can move between client preview and server execution.
**Change:**
- Accept optional `max_cost` in trade request body
- In `executeVirtualTrade`, after computing cost: `if (maxCost && cost > maxCost) throw new Error('Slippage exceeded')`
- Client sends the previewed cost * 1.02 (2% slippage tolerance) as `max_cost`
**Estimated effort:** 1 hour

---

## Phase 5 — Frontend Performance

### 5.1 Add Visibility-Based Polling to All Pages
**Files:** `app/polymarkets/event/[eventId]/page.tsx`, `components/CustomMarketPageContent.tsx`, `app/positions/page.tsx`, `app/leaderboard/page.tsx`
**Problem:** Only GlobalChat pauses polling when tab is hidden. All other pages continue burning requests.
**Change:** Create a `useVisibleInterval(callback, delayMs)` hook that:
- Uses `document.hidden` to pause/resume
- Cleans up on unmount
- Replace all `setInterval(fn, ms)` with `useVisibleInterval(fn, ms)`
**Impact:** 50-70% reduction in background API requests
**Estimated effort:** 2 hours

### 5.2 Stagger / Deduplicate Polling
**File:** `app/polymarkets/event/[eventId]/page.tsx`
**Problem:** Three independent intervals (orderbook 15s, orders 10s, positions 30s) fire independently.
**Change:** Combine into a single 10s interval that fetches all three in one `Promise.all`. Reduce to one timer, one render cycle.
**Estimated effort:** 1 hour

### 5.3 Bound EventChat Position Cache
**File:** `components/EventChat.tsx`
**Problem:** `positionCache.current` grows unbounded.
**Change:** Use an LRU-style eviction — when cache exceeds 200 entries, delete the oldest half. Simple approach: track insertion order, trim periodically.
**Estimated effort:** 30 minutes

### 5.4 Remove Dead Dependencies
**File:** `package.json`
**Changes:**
- Verify `recharts` is unused (grep confirms no imports) → remove
- Verify `@solana/kit` usage → remove if unused
- Run `npm audit` and update vulnerable dependencies
**Estimated effort:** 30 minutes

---

## Phase 6 — Hardening & Observability

### 6.1 CORS Headers
**File:** `next.config.js`
**Problem:** No CORS headers set. External sites can call API routes.
**Change:** Add middleware or headers restricting `Access-Control-Allow-Origin` to `https://www.mentioned.market` and `https://mentioned.market`.
**Note:** Next.js API routes on the same domain don't need CORS. This only matters if you want to block cross-origin requests from other sites. Since wallet auth (1.4) will solve the impersonation risk, CORS is defense-in-depth, not urgent.
**Estimated effort:** 30 minutes

### 6.2 Content Security Policy
**File:** `next.config.js`
**Change:** Add CSP header. Start with report-only mode to avoid breaking things:
```
Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https://api.jup.ag https://api.helius.xyz wss:; font-src 'self' https://fonts.gstatic.com;
```
Monitor for violations, then switch to enforcing mode.
**Estimated effort:** 1 hour (initial), ongoing tuning

### 6.3 Input Validation on Jupiter Proxy Routes
**Files:** `app/api/polymarket/orders/route.ts`, `app/api/polymarket/positions/claim/route.ts`, `app/api/polymarket/positions/close/route.ts`
**Problem:** Request bodies forwarded to Jupiter without field whitelisting.
**Change:** Define allowed fields per route and strip everything else before forwarding. Use a simple `pick(body, allowedFields)` utility.
**Estimated effort:** 1 hour

### 6.4 Admin Audit Logging
**Files:** All admin routes (`app/api/custom/route.ts` POST, `app/api/custom/[id]/resolve/route.ts`, etc.)
**Change:** Add `admin_audit_log` table. On every admin action, insert: `{ wallet, action, target_id, payload, timestamp }`. No code changes beyond inserting a row after each admin operation.
**Estimated effort:** 1-2 hours

### 6.5 Polymarket Category Whitelist
**File:** `app/api/polymarket/route.ts`
**Problem:** User-controlled `category` parameter forwarded to Jupiter.
**Change:** Whitelist allowed categories: `['mentions', 'sports', 'crypto', 'politics']`. Return 400 for anything else.
**Estimated effort:** 15 minutes

---

## Execution Order Summary

| Order | Item | Severity | Effort | Depends On |
|-------|------|----------|--------|------------|
| 1 | 1.1 Rotate Jupiter API key | CRITICAL | 15m | — |
| 2 | 1.2 Webhook signature validation | CRITICAL | 30m | — |
| 3 | 1.3 Sign Discord OAuth state | CRITICAL | 30m | — |
| 4 | 2.1 Add Redis (Upstash) | HIGH | 30m | — |
| 5 | 2.2 Distributed rate limiting | HIGH | 2-3h | 2.1 |
| 6 | 2.4 Database connection pooling | HIGH | 1h | — |
| 7 | 1.4 Wallet signature auth | CRITICAL | 4-6h | 2.1 (for sessions) |
| 8 | 2.3 External caching | HIGH | 1-2h | 2.1 |
| 9 | 2.5 Fetch timeouts | HIGH | 1h | — |
| 10 | 4.1 Lock check in transaction | HIGH | 30m | — |
| 11 | 4.2 Resolution double-payout fix | HIGH | 1-2h | — |
| 12 | 4.3 Minimum trade size | MEDIUM | 30m | — |
| 13 | 3.1 Fix N+1 in insertPointEvent | MEDIUM | 30m | — |
| 14 | 3.2 Add missing indexes | MEDIUM | 30m | — |
| 15 | 3.3 Unbounded query limits | MEDIUM | 1-2h | — |
| 16 | 5.1 Visibility-based polling | MEDIUM | 2h | — |
| 17 | 5.2 Stagger polling | MEDIUM | 1h | 5.1 |
| 18 | 4.4 Slippage protection | MEDIUM | 1h | — |
| 19 | 3.4 Consolidate multi-query functions | LOW | 1-2h | — |
| 20 | 5.3 Bound position cache | LOW | 30m | — |
| 21 | 5.4 Remove dead deps | LOW | 30m | — |
| 22 | 6.1 CORS headers | LOW | 30m | 1.4 |
| 23 | 6.2 CSP headers | LOW | 1h | — |
| 24 | 6.3 Jupiter proxy validation | LOW | 1h | — |
| 25 | 6.4 Admin audit logging | LOW | 1-2h | — |
| 26 | 6.5 Category whitelist | LOW | 15m | — |

**Total estimated effort:** ~25-35 hours

---

## New Environment Variables Needed

| Variable | Purpose | Where |
|----------|---------|-------|
| `JUPITER_API_KEY` | Jupiter Prediction API auth | Vercel + .env.local |
| `HELIUS_WEBHOOK_SECRET` | Webhook HMAC validation | Vercel + Helius dashboard |
| `DISCORD_STATE_SECRET` | OAuth state HMAC signing | Vercel |
| `UPSTASH_REDIS_REST_URL` | Redis for rate limiting + cache | Vercel + Upstash dashboard |
| `UPSTASH_REDIS_REST_TOKEN` | Redis auth | Vercel + Upstash dashboard |
| `SESSION_SECRET` | JWT/cookie signing for wallet auth | Vercel |

---

## New Files to Create

| File | Purpose |
|------|---------|
| `lib/redis.ts` | Upstash Redis client |
| `lib/rateLimit.ts` | Distributed rate limiting helper |
| `lib/walletAuth.ts` | Wallet signature verification + session management |
| `hooks/useVisibleInterval.ts` | Polling hook that pauses when tab hidden |

## New DB Tables

| Table | Purpose |
|-------|---------|
| `sessions` | Wallet auth sessions (if not using JWT) |
| `admin_audit_log` | Admin action audit trail |
