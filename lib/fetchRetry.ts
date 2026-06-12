// Client-safe fetch wrapper that retries ONCE on a 429, honoring Retry-After.
//
// Some paid-markets read routes are per-IP rate limited; a legit user on a
// shared/NAT IP (or with a tab polling on an interval) can occasionally get a
// 429. Rather than surfacing an empty/error state, wait out the server-provided
// Retry-After once and try again. Returns the Response so callers keep their
// existing `if (res.ok)` handling unchanged.

const DEFAULT_RETRY_MS = 2_000
const MAX_RETRY_MS = 8_000

export async function fetchWith429Retry(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init)
  if (res.status !== 429) return res

  const headerSeconds = Number(res.headers.get('Retry-After'))
  const waitMs = Math.min(
    MAX_RETRY_MS,
    Number.isFinite(headerSeconds) && headerSeconds > 0 ? headerSeconds * 1_000 : DEFAULT_RETRY_MS,
  )
  await new Promise((r) => setTimeout(r, waitMs))
  return fetch(url, init)
}
