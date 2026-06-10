// Per-IP sliding-window rate limiter, shared across API routes.
//
// Buckets live on globalThis so they survive Next.js hot reloads in dev and are
// shared across any duplicated module instances (same convention as
// lib/chatStream and lib/mentionStream). In-memory and therefore PER PROCESS:
// with N web replicas the effective ceiling is N × max. That's fine for blunting
// abuse from a single source — it is not a cross-instance global guarantee.
//
// Used to protect RPC-amplifier routes (one HTTP request fans out into many
// upstream Helius calls) where a per-resource cooldown isn't enough because the
// resource key (e.g. a `wallet` query param) is attacker-controlled.

interface Bucket {
  windowMs: number
  hits: Map<string, number[]> // ip → request timestamps within the window
}

const STORE: Map<string, Bucket> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__rateLimitStore ??
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((globalThis as any).__rateLimitStore = new Map<string, Bucket>())

// Single sweep across all buckets drops idle IPs so the maps don't grow
// unbounded. Started once per process, guarded via globalThis.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (!(globalThis as any).__rateLimitSweep) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).__rateLimitSweep = true
  setInterval(() => {
    const now = Date.now()
    for (const bucket of STORE.values()) {
      for (const [ip, ts] of bucket.hits) {
        const recent = ts.filter((t) => now - t < bucket.windowMs)
        if (recent.length === 0) bucket.hits.delete(ip)
        else bucket.hits.set(ip, recent)
      }
    }
  }, 60_000)
}

export interface RateLimitResult {
  ok: boolean
  /** Seconds until the caller may retry (0 when ok) — use as the Retry-After header. */
  retryAfter: number
}

/**
 * Check (and record) a request against a named per-IP sliding window.
 *
 * @param name    Bucket namespace so routes with different ceilings don't share a window.
 * @param ip      Client IP from getClientIp(); a null IP is bucketed under 'unknown'
 *                (fails toward limiting rather than handing out a free bypass).
 * @param max     Max requests allowed per window.
 * @param windowMs Window length in ms (default 60s).
 */
export function checkRateLimit(
  name: string,
  ip: string | null,
  max: number,
  windowMs = 60_000,
): RateLimitResult {
  let bucket = STORE.get(name)
  if (!bucket) {
    bucket = { windowMs, hits: new Map() }
    STORE.set(name, bucket)
  }

  const key = ip ?? 'unknown'
  const now = Date.now()
  const recent = (bucket.hits.get(key) ?? []).filter((t) => now - t < windowMs)

  if (recent.length >= max) {
    bucket.hits.set(key, recent)
    const retryMs = windowMs - (now - recent[0])
    return { ok: false, retryAfter: Math.max(1, Math.ceil(retryMs / 1000)) }
  }

  recent.push(now)
  bucket.hits.set(key, recent)
  return { ok: true, retryAfter: 0 }
}
