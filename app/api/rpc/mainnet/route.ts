import { NextRequest, NextResponse } from 'next/server'
import { getClientIp } from '@/lib/clientIp'

// Same-origin passthrough to the mainnet RPC. The browser talks to this route so the
// Helius API key stays server-side (read from HELIUS_RPC_URL) instead of being inlined
// into the client bundle via a NEXT_PUBLIC_* var.
//
// This route relays *access* to a keyed endpoint, so it is hardened to cap abuse:
//  - per-IP rate limit  → caps aggregate calls from a single source
//  - method allowlist  → only the methods the client actually uses, all ≤1 credit
//  - getProgramAccounts → never allowed (10 credits; the client never calls it directly)
//  - no batch requests  → one POST maps to exactly one upstream call
//  - body-size cap      → a single legit call is tiny; anything larger is abuse
const RPC_URL =
  process.env.HELIUS_RPC_URL ||
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ||
  'https://api.mainnet-beta.solana.com'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Methods the browser legitimately calls through this proxy. Every entry is ≤1 credit,
// so even an attacker who forges the origin can only burn credits 1-for-1 at the rate
// limit (vs. 10/call for getProgramAccounts, which is deliberately excluded). Keep this
// list tight — only add a method once a client path actually needs it.
const ALLOWED_METHODS = new Set([
  'getBalance',                // WalletContext balance poll
  'simulateTransaction',       // WalletContext + walletUtils pre-simulate
  'getTokenAccountsByOwner',   // PrivyFundsModal token balances
  'getLatestBlockhash',        // sendIxs (PrivyFundsModal transfers)
  'sendTransaction',           // Privy HTTP-split sends (forward-compat)
  'getMultipleAccounts',       // batched reads (forward-compat)
  'getAccountInfo',            // single-account reads
  'getSignatureStatuses',      // tx confirmation polling
])

// A single JSON-RPC call — even one carrying a base64 transaction for simulate/send —
// is comfortably under this. Anything larger is either a batch or an abuse attempt.
const MAX_BODY_BYTES = 100 * 1024 // 100 KB

// Per-IP sliding-window rate limit. A legit client polls getBalance every 10s (6/min)
// plus the occasional simulate/blockhash/token read across tabs, so this leaves ~10x
// headroom while capping a single source. The map is in-memory and therefore per
// instance — with multiple Railway replicas the effective ceiling is N × this, which is
// fine: this stops casual single-source abuse, not distributed botnets (that's what the
// method allowlist + Helius domain-lock + key rotation are for).
const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX = 60 // requests per IP per window
const rateLimitMap = new Map<string, number[]>()

// Returns the seconds until the next slot frees up if the IP is over its limit, else 0.
function rateLimitRetryAfter(ip: string): number {
  const now = Date.now()
  const recent = (rateLimitMap.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  if (recent.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(ip, recent)
    const retryMs = RATE_LIMIT_WINDOW_MS - (now - recent[0])
    return Math.max(1, Math.ceil(retryMs / 1000))
  }
  recent.push(now)
  rateLimitMap.set(ip, recent)
  return 0
}

// Periodic cleanup so idle IPs don't accumulate in memory.
setInterval(() => {
  const now = Date.now()
  for (const [ip, timestamps] of rateLimitMap) {
    const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
    if (recent.length === 0) rateLimitMap.delete(ip)
    else rateLimitMap.set(ip, recent)
  }
}, 5 * 60 * 1000) // every 5 min

function rpcError(id: unknown, code: number, message: string, status: number) {
  return NextResponse.json(
    { jsonrpc: '2.0', id: id ?? null, error: { code, message } },
    { status }
  )
}

export async function POST(req: NextRequest) {
  // Per-IP rate limit first — cheapest rejection, before buffering the body. Fail open
  // when the IP is unresolvable (local dev, or a brief missing CF header) rather than
  // bucketing all such traffic together and throttling everyone at once.
  const ip = getClientIp(req)
  if (ip) {
    const retryAfter = rateLimitRetryAfter(ip)
    if (retryAfter > 0) {
      const res = rpcError(null, -32005, 'Rate limit exceeded', 429)
      res.headers.set('Retry-After', String(retryAfter))
      return res
    }
  }

  // Early reject on declared size before buffering the body.
  const contentLength = Number(req.headers.get('content-length') || 0)
  if (contentLength > MAX_BODY_BYTES) {
    return rpcError(null, -32600, 'Request too large', 413)
  }

  const body = await req.text()

  // Catch chunked/omitted-length bodies that slipped past the header check.
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    return rpcError(null, -32600, 'Request too large', 413)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return rpcError(null, -32700, 'Parse error', 400)
  }

  // Reject batch requests so one POST can't fan out into many (expensive) RPC calls.
  if (Array.isArray(parsed)) {
    return rpcError(null, -32600, 'Batch requests are not allowed', 400)
  }

  const { id, method } = (parsed ?? {}) as { id?: unknown; method?: unknown }
  if (typeof method !== 'string' || !ALLOWED_METHODS.has(method)) {
    return rpcError(id, -32601, `Method not allowed: ${typeof method === 'string' ? method : 'unknown'}`, 403)
  }

  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return rpcError(id, -32603, 'RPC proxy error', 502)
  }
}
