// In-memory TTL cache with single-flight de-duplication and stale-on-error.
//
// Purpose: collapse repeated/concurrent reads of an expensive computation (e.g.
// RPC-amplifier routes that fan one request into many upstream Helius calls)
// into at most one in-flight computation per key per TTL window.
//
//  - TTL          → a fresh value is served without recomputing.
//  - single-flight → concurrent misses for the same key await ONE computation
//                    instead of each launching their own fan-out (no stampede).
//  - stale-on-error → if recompute throws but a recent value exists within the
//                    stale window, serve it rather than failing the request.
//
// In-memory and therefore PER PROCESS (same trade-off as lib/rateLimit): with N
// web replicas each keeps its own cache. Fine for cutting RPC load from a single
// instance; not a cross-instance shared cache. Lives on globalThis so it
// survives Next.js hot reloads (same convention as lib/chatStream).

interface Entry<T> {
  value: T
  storedAt: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const STORE: Map<string, Entry<unknown>> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__ttlCacheStore ??
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((globalThis as any).__ttlCacheStore = new Map())

// In-flight computations, keyed the same as STORE, so concurrent misses coalesce.
const INFLIGHT: Map<string, Promise<unknown>> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__ttlCacheInflight ??
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((globalThis as any).__ttlCacheInflight = new Map())

// Evict entries no caller has refreshed in a while so per-key caches (e.g. one
// entry per wallet) can't grow unbounded. Generous relative to any TTL we use.
const MAX_IDLE_MS = 10 * 60_000
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (!(globalThis as any).__ttlCacheSweep) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).__ttlCacheSweep = true
  setInterval(() => {
    const cutoff = Date.now() - MAX_IDLE_MS
    for (const [key, entry] of STORE) {
      if (entry.storedAt < cutoff) STORE.delete(key)
    }
  }, 60_000)
}

export interface CacheOptions {
  /** How long a stored value is served without recomputing. */
  ttlMs: number
  /**
   * Extra window past ttlMs during which a stale value is served ONLY if a
   * recompute fails. 0 (default) disables stale-on-error. Use for read paths
   * where slightly-old data beats a hard error (e.g. a public listing).
   */
  staleMs?: number
}

/**
 * Get a cached value for `key`, computing it via `compute` on a miss.
 * Concurrent misses for the same key share a single computation.
 */
export async function cached<T>(
  key: string,
  { ttlMs, staleMs = 0 }: CacheOptions,
  compute: () => Promise<T>,
): Promise<T> {
  const now = Date.now()
  const entry = STORE.get(key) as Entry<T> | undefined
  if (entry && now - entry.storedAt < ttlMs) return entry.value

  // Coalesce concurrent misses onto one computation.
  const existing = INFLIGHT.get(key) as Promise<T> | undefined
  if (existing) return existing

  const p = (async (): Promise<T> => {
    try {
      const value = await compute()
      STORE.set(key, { value, storedAt: Date.now() })
      return value
    } catch (err) {
      // Serve last-good within the stale window rather than failing the request.
      const stale = STORE.get(key) as Entry<T> | undefined
      if (stale && staleMs > 0 && Date.now() - stale.storedAt < ttlMs + staleMs) {
        return stale.value
      }
      throw err
    } finally {
      INFLIGHT.delete(key)
    }
  })()

  INFLIGHT.set(key, p)
  return p
}
