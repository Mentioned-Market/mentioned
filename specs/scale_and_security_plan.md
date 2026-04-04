# Scalability & Security Implementation Plan

Audit date: 2026-03-31. Targeting 1000+ concurrent users.
Updated: 2026-04-04 — revised for Railway (persistent containers) + Cloudflare (edge proxy) infrastructure. Original plan assumed Vercel serverless which overstated the need for external state stores.

**Infrastructure context:**
- **Hosting:** Railway Pro (long-running Node.js containers, `standalone` output mode). NOT serverless — process state persists across requests, only resets on deploy/restart.
- **Edge:** Cloudflare in front (DNS, CDN, DDoS protection, WAF rules, security headers). Can offload rate limiting, CORS, and CSP to the edge without code changes.
- **Database:** Railway managed PostgreSQL.

---

## Phase 1 — Critical Security (do first, before scaling)

### 1.1 ~~Rotate & Externalize Jupiter API Key~~ ✅ DONE
Already moved to `process.env.JUPITER_API_KEY`.

### 1.2 Webhook Signature Validation
**Files:** `app/api/webhook/route.ts`
**Problem:** Anyone can POST fake trade events. No auth header or HMAC check.
**Changes:**
- Add `HELIUS_WEBHOOK_SECRET` env var
- At top of POST handler, before parsing body:
  - Read `authorization` header (Helius sends the secret as an auth header)
  - Compare against env var with timing-safe comparison
  - Return 401 if mismatch
- Helius webhook auth docs: they send the secret in the `Authorization` header. Verify with `authorization === process.env.HELIUS_WEBHOOK_SECRET`
- **Cloudflare note:** Could also restrict webhook endpoint to Helius IP ranges via Cloudflare WAF rules as defense-in-depth, but the auth header check is the primary control.
**Estimated effort:** 30 minutes

### 1.3 ~~Sign Discord OAuth State~~ ✅ DONE
Implemented via `signDiscordState()` / `verifyDiscordState()` in `lib/walletAuth.ts`. HMAC-SHA256 with 10-minute expiry.

### 1.4 ~~Wallet Signature Verification~~ ✅ DONE
Implemented in `lib/walletAuth.ts`. Phantom Ed25519 sign-in via `verifyPhantomSignIn()`, session cookies via `getVerifiedWallet()`. Routes use this for auth.

---

## Phase 2 — Infrastructure for Scale

> **Railway context:** Railway runs persistent Node.js containers. Process state (in-memory Maps, module-level caches) survives across requests and only resets on deploy/restart. This is fundamentally different from Vercel serverless where every cold start wipes state. Most items originally scoped here assumed serverless and have been re-evaluated.

### 2.1 Add Redis — DEFERRED (not needed yet)
**Original rationale:** In-memory Maps are per-instance on Vercel serverless.
**Railway reality:** Single persistent container means in-memory Maps work fine. Rate limits persist across requests. Caches survive until redeploy.
**When to revisit:** When scaling to multiple Railway replicas (horizontal scaling). At that point, add Railway Redis add-on (~$5-10/month) or Upstash. Until then, in-memory state is correct and simpler.

### 2.2 Rate Limiting Cleanup
**Files:** `app/api/chat/route.ts`, `app/api/chat/event/route.ts`, `app/api/custom/[id]/trade/route.ts`
**Original problem:** Distributed rate limiting needed for serverless.
**Actual problem:** In-memory Maps work on Railway, but chat rate limit Maps (`lastSent`) have no cleanup — entries accumulate forever until redeploy. Only `bug-report/route.ts` has periodic cleanup.
**Changes:**
- Add periodic cleanup to chat and trade rate limit Maps (same pattern as bug-report: clear entries older than window every 10 minutes)
- Add rate limiting to routes that currently have none:
  - `POST /api/profile` (username/PFP changes) — 10s window, 1 request per wallet
  - `POST /api/polymarket/orders` (order placement) — 1s window, 2 per wallet
  - `POST /api/polymarket/trades/record` (trade recording) — 1s window, 2 per wallet
  - `POST /api/achievements` (achievement unlock) — 5s window, 1 per wallet
- **Cloudflare layer:** Consider adding Cloudflare Rate Limiting rules as a first line of defense (e.g., 100 req/min per IP across all API routes). This catches abuse before it hits Railway. Configurable in Cloudflare dashboard, no code changes.
**Estimated effort:** 1-2 hours (code) + 30 min (Cloudflare rules)

### 2.3 Caching — KEEP AS-IS (for now)
**Original problem:** In-memory caches lost on cold start.
**Railway reality:** In-memory caches persist across requests. Leaderboard cache (`weeklyCache`/`alltimeCache` with 3-min TTL) and token price cache (`tokenCache` with 1-hour TTL) work correctly on Railway. They only reset on redeploy, which triggers a single recomputation — acceptable.
**When to revisit:** If leaderboard computation becomes so expensive it noticeably slows the first request after deploy, or when scaling to multiple replicas.

### 2.4 Database Connection Pooling
**Files:** `lib/db.ts` (lines 10-14)
**Problem:** `max: 10` with no timeouts. Missing safety nets for when Postgres is slow or overloaded.
**Railway context:** Single container means `max: 10` is fine (no risk of 50 serverless instances each opening 10 connections). PgBouncer is not necessary yet. But timeouts are important regardless of hosting.
**Changes:**
- Update pool config:
  ```typescript
  const pool = new pg.Pool({
    connectionString: dbUrl,
    ssl: sslDisabled ? false : { rejectUnauthorized: false },
    max: 10,                        // Fine for single instance
    idleTimeoutMillis: 30000,       // Close idle connections after 30s
    connectionTimeoutMillis: 5000,  // Fail fast if can't connect in 5s
  })
  ```
- Add statement timeout: `pool.on('connect', (client) => client.query('SET statement_timeout = 30000'))`
- **When to add PgBouncer:** When scaling to multiple Railway replicas. Railway supports adding a PgBouncer proxy as a separate service.
**Estimated effort:** 15 minutes

### 2.5 Fetch Timeouts on External APIs
**Files:** `lib/jupiterApi.ts`, `app/api/profile/[username]/route.ts`, `app/api/bug-report/route.ts`, `app/api/discord/callback/route.ts`
**Problem:** No `AbortSignal` on any fetch. If Jupiter or Discord is slow, the request handler blocks indefinitely. On Railway this ties up a thread and a DB connection. With 1000 concurrent users hitting polymarket pages during a Jupiter slowdown, this cascades fast.
**Changes:**
- Update `jupFetch` in `lib/jupiterApi.ts` to use timeout (default 8s):
  ```typescript
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  const res = await fetch(url, { ...init, signal: controller.signal })
  clearTimeout(timeout)
  ```
- Add similar timeout to Discord API calls in callback route (5s)
- Add similar timeout to bug-report Discord webhook (5s)
**Priority:** HIGH — this is the most likely failure mode at scale. External API slowdowns are common and will cascade without timeouts.
**Estimated effort:** 1 hour

---

## Phase 3 — Database Performance

### 3.1 ~~Fix N+1 in insertPointEvent~~ ✅ DONE
Replaced loop with single bulk `INSERT ... SELECT FROM user_profiles WHERE referred_by = $4`.

### 3.2 ~~Add Missing Indexes~~ ✅ DONE
Added `idx_chat_messages_wallet` on `chat_messages(wallet)` in `scripts/migrate.ts`. Run migration to apply.

### 3.3 Add LIMIT / Pagination to Unbounded Queries — PARTIAL
- `listCustomMarketsPublic()` — added `LIMIT 200` ✅
- `getAllPolymarketTraders()` — left as-is. Used by leaderboard which needs all wallets; already cached with 3-min TTL.
- `getAllMarketImages()` — left as-is. Small lookup table, no realistic growth concern.

### 3.4 Consolidate Multi-Query Functions — SKIPPED (low priority)
`getReferralStats()` uses `Promise.all` for 3 parallel queries — already fast. `getWalletFreeMarketStats()` uses subselects in a single query. Not worth the refactor risk for marginal gain.

---

## Phase 4 — Trading Logic Hardening

### 4.1 ~~Move Lock Check Inside Transaction~~ ✅ DONE
`executeVirtualTrade` now acquires `FOR UPDATE` lock on `custom_markets` row as its first step inside the transaction. Checks `status` and `lock_time` atomically before proceeding.

### 4.2 ~~Fix Resolution Double-Payout Race~~ ✅ DONE
New `resolveMarketAtomic()` function wraps the entire resolution (word outcomes, position payouts, status update) in a single transaction with `FOR UPDATE` on the market row. Resolve route rewritten to use it.

### 4.3 ~~Minimum Trade Size & Float Safeguards~~ ✅ DONE
Added guards in `executeVirtualTrade`: `shares < 0.001` and `cost < 0.01` both throw `'Trade too small'`. Integer math refactor deferred.

### 4.4 ~~Slippage Protection~~ ✅ DONE
`executeVirtualTrade` accepts optional `maxCost` parameter. Trade route accepts `max_cost` in request body. If buy cost exceeds `maxCost`, throws `'Slippage exceeded'`. Client can send previewed cost * 1.02 as `max_cost`.

---

## Phase 5 — Frontend Performance

### 5.1 ~~Add Visibility-Based Polling~~ ✅ DONE
Created `hooks/useVisibleInterval.ts` — pauses polling when tab is hidden, resumes on focus. Applied to polymarket event page (5.2).
**Remaining:** Apply to `CustomMarketPageContent.tsx`, `positions/page.tsx`, `leaderboard/page.tsx` as needed.

### 5.2 ~~Stagger / Deduplicate Polling~~ ✅ DONE
Polymarket event page now uses a single `useVisibleInterval` (10s) that polls orderbook + orders every tick and positions every 3rd tick. Down from 3 separate intervals.

### 5.3 ~~Bound EventChat Position Cache~~ ✅ DONE
Both `positionCache` and `customPositionCache` clear when they exceed 200 entries.

### 5.4 Remove Dead Dependencies — NOT APPLICABLE
Both `recharts` (profile page) and `@solana/kit` (4 files) are actively imported. No dead deps to remove.

---

## Phase 6 — Hardening & Observability

### 6.1 CORS Headers
**Where:** Cloudflare Transform Rules (not code)
**Problem:** No CORS headers set. External sites can call API routes.
**Change:** Add a Cloudflare Transform Rule to set `Access-Control-Allow-Origin` to `https://www.mentioned.market` on API responses. This is defense-in-depth since wallet auth (1.4, done) already prevents impersonation.
**Why Cloudflare, not code:** Cloudflare handles this at the edge before traffic reaches Railway. No code changes, no redeploy, easier to update.
**Estimated effort:** 30 minutes (Cloudflare dashboard)

### 6.2 Content Security Policy
**Where:** Cloudflare Transform Rules (not code)
**Change:** Add CSP header via Cloudflare response header rule. Start with report-only:
```
Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https://api.jup.ag https://api.helius.xyz wss:; font-src 'self' https://fonts.gstatic.com;
```
Monitor for violations in browser console, then switch to enforcing mode.
**Why Cloudflare, not code:** Same as CORS — edge-level, no redeploy needed, easy to iterate.
**Estimated effort:** 30 minutes (Cloudflare dashboard), ongoing tuning

### 6.3 ~~Input Validation on Jupiter Proxy Routes~~ ✅ DONE
Orders route now whitelists allowed fields before forwarding to Jupiter. Claim/close routes already constructed their own body with only `ownerPubkey`.

### 6.4 ~~Admin Audit Logging~~ ✅ DONE (partial)
- `admin_audit_log` table added to `scripts/migrate.ts`
- `logAdminAction()` function added to `lib/db.ts`
- Applied to resolve route. **Remaining:** Add to other admin routes (market create, lock, etc.)

### 6.5 ~~Polymarket Category Whitelist~~ ✅ DONE
Whitelist of allowed categories (`mentions`, `sports`, `crypto`, `politics`, `culture`, `news`) enforced in `app/api/polymarket/route.ts`. Returns 400 for invalid categories.

---

## Execution Order Summary

Items marked ✅ are complete. Items marked ~~strikethrough~~ are deferred.

| Item | Severity | Status |
|------|----------|--------|
| 1.1 Rotate Jupiter API key | CRITICAL | ✅ DONE (prior) |
| 1.2 Webhook signature validation | CRITICAL | ✅ DONE |
| 1.3 Sign Discord OAuth state | CRITICAL | ✅ DONE (prior) |
| 1.4 Wallet signature auth | CRITICAL | ✅ DONE (prior) |
| 2.4 Database pool timeouts | HIGH | ✅ DONE |
| 2.5 Fetch timeouts | HIGH | ✅ DONE |
| 4.1 Lock check in transaction | HIGH | ✅ DONE |
| 4.2 Resolution double-payout fix | HIGH | ✅ DONE |
| 2.2 Rate limit cleanup + new limits | MEDIUM | ✅ DONE |
| 3.1 Fix N+1 in insertPointEvent | MEDIUM | ✅ DONE |
| 3.2 Add missing indexes | MEDIUM | ✅ DONE (run migration) |
| 3.3 Unbounded query limits | MEDIUM | ✅ PARTIAL (listCustomMarketsPublic capped) |
| 4.3 Minimum trade size | MEDIUM | ✅ DONE |
| 4.4 Slippage protection | MEDIUM | ✅ DONE (server-side; client sends max_cost) |
| 5.1 Visibility-based polling | MEDIUM | ✅ DONE (hook created, applied to polymarket event) |
| 5.2 Stagger polling | MEDIUM | ✅ DONE |
| 5.3 Bound position cache | LOW | ✅ DONE |
| 6.3 Jupiter proxy validation | LOW | ✅ DONE |
| 6.4 Admin audit logging | LOW | ✅ PARTIAL (table + function + resolve route) |
| 6.5 Category whitelist | LOW | ✅ DONE |
| 5.4 Remove dead deps | LOW | N/A — both in use |
| 3.4 Consolidate multi-query functions | LOW | SKIPPED — already adequate |
| 6.1 CORS headers (Cloudflare) | LOW | TODO (Cloudflare dashboard) |
| 6.2 CSP headers (Cloudflare) | LOW | TODO (Cloudflare dashboard) |
| 2.1 Redis | DEFERRED | Not needed until multi-replica |
| 2.3 External caching | DEFERRED | Not needed until multi-replica |

**Remaining:** Only Cloudflare dashboard config (CORS + CSP) and extending audit logging to other admin routes. All code changes complete.

---

## New Environment Variables Needed

| Variable | Purpose | Where | Status |
|----------|---------|-------|--------|
| `JUPITER_API_KEY` | Jupiter Prediction API auth | Railway + .env.local | ✅ Done |
| `HELIUS_WEBHOOK_SECRET` | Webhook auth validation | Railway + Helius dashboard | TODO |
| `DISCORD_STATE_SECRET` | OAuth state HMAC signing | Railway | ✅ Done |
| `SESSION_SECRET` | JWT/cookie signing for wallet auth | Railway | ✅ Done |

**No longer needed (deferred):**
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — only needed when scaling to multiple replicas

---

## New Files Created

| File | Purpose | Status |
|------|---------|--------|
| `lib/walletAuth.ts` | Wallet signature verification + session management | ✅ Done |
| `hooks/useVisibleInterval.ts` | Polling hook that pauses when tab hidden | ✅ Done |

**No longer needed (deferred):**
- `lib/redis.ts` — only needed when scaling to multiple replicas
- `lib/rateLimit.ts` — in-memory rate limiting is fine on Railway; just needs cleanup

## New DB Tables

| Table | Purpose |
|-------|---------|
| `admin_audit_log` | Admin action audit trail |