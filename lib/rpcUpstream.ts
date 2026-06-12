// Server-side RPC upstream forwarder shared by the same-origin proxy routes
// (/api/rpc/mainnet, /api/paid-rpc).
//
// Resilience model: try the keyed primary (Helius) with a hard timeout; on
// infrastructure failure — network error, timeout, 5xx, or 429 — retry once
// against the public cluster endpoint. The public endpoint is a degraded
// fallback (heavily rate limited, no getProgramAccounts), but every method the
// proxies allowlist is standard and cheap, so reads and sends keep working
// through a Helius outage instead of hard-failing the whole app.
//
// JSON-RPC-level errors (HTTP 200 with an error body) are passed through, not
// failed over — they're deterministic responses, not infrastructure failures.
// Forwarding is also safe to repeat for sendTransaction: broadcasts are
// idempotent by signature.

// A single RPC call should answer well inside this; beyond it the client is
// better served by the fallback than by waiting.
const UPSTREAM_TIMEOUT_MS = 10_000

export interface UpstreamResult {
  status: number
  body: string
}

async function tryUpstream(url: string, body: string): Promise<UpstreamResult> {
  const res = await fetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  return { status: res.status, body: await res.text() }
}

// Log the host only — keyed URLs carry the API key in the query string and
// must never reach logs.
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'upstream'
  }
}

/**
 * Forward a JSON-RPC request body to `primary`, failing over to `fallback`
 * when the primary is unavailable. Throws only when every upstream fails.
 */
export async function forwardRpc(
  body: string,
  primary: string,
  fallback?: string
): Promise<UpstreamResult> {
  let primaryFailure: UpstreamResult | null = null

  try {
    const result = await tryUpstream(primary, body)
    if (result.status !== 429 && result.status < 500) return result
    primaryFailure = result
    console.warn(`[rpc] primary upstream ${hostOf(primary)} returned ${result.status}, failing over`)
  } catch {
    console.warn(`[rpc] primary upstream ${hostOf(primary)} unreachable (network/timeout), failing over`)
  }

  if (fallback && fallback !== primary) {
    try {
      return await tryUpstream(fallback, body)
    } catch {
      console.warn(`[rpc] fallback upstream ${hostOf(fallback)} also unreachable`)
    }
  }

  if (primaryFailure) return primaryFailure
  throw new Error('All RPC upstreams unreachable')
}
