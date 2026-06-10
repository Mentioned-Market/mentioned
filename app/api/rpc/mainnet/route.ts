import { NextRequest, NextResponse } from 'next/server'
import { getClientIp } from '@/lib/clientIp'
import { checkRateLimit } from '@/lib/rateLimit'
import { forwardRpc } from '@/lib/rpcUpstream'

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
//
// Resilience: forwardRpc fails over to the public mainnet endpoint when Helius is
// unreachable / 5xx / 429, so reads and sends degrade instead of hard-failing.

const PUBLIC_MAINNET = 'https://api.mainnet-beta.solana.com'

// Deliberately no NEXT_PUBLIC_* fallback: if the server var is missing we degrade
// to the public endpoint loudly (slow) rather than silently burning a browser key.
const RPC_URL = process.env.HELIUS_RPC_URL || PUBLIC_MAINNET

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
  'sendTransaction',           // Phantom + Privy sign-only broadcasts (lib/rpcSend)
  'getSignatureStatuses',      // confirmSignature polling (lib/rpcSend)
  'getMultipleAccounts',       // batched reads (forward-compat)
  'getAccountInfo',            // single-account reads
])

// A single JSON-RPC call — even one carrying a base64 transaction for simulate/send —
// is comfortably under this. Anything larger is either a batch or an abuse attempt.
const MAX_BODY_BYTES = 100 * 1024 // 100 KB

// Per-IP ceiling: a legit client polls getBalance every 10s (6/min) plus, per send,
// a blockhash + simulate + broadcast + up to ~15 confirmation polls — so a user
// placing a couple of quick trades across tabs can legitimately burst well past the
// old 60. 120 keeps generous headroom while still capping a single source. The
// limiter (lib/rateLimit) is per process; with N replicas the ceiling is N × this,
// which stops casual single-source abuse, not botnets (that's what the method
// allowlist + key rotation are for).
const RATE_LIMIT_MAX = 120

function rpcError(id: unknown, code: number, message: string, status: number) {
  return NextResponse.json(
    { jsonrpc: '2.0', id: id ?? null, error: { code, message } },
    { status }
  )
}

export async function POST(req: NextRequest) {
  // Per-IP rate limit first — cheapest rejection, before buffering the body.
  const ip = getClientIp(req)
  const limit = checkRateLimit('rpc-mainnet', ip, RATE_LIMIT_MAX)
  if (!limit.ok) {
    const res = rpcError(null, -32005, 'Rate limit exceeded', 429)
    res.headers.set('Retry-After', String(limit.retryAfter))
    return res
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
    const upstream = await forwardRpc(body, RPC_URL, PUBLIC_MAINNET)
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return rpcError(id, -32603, 'RPC proxy error', 502)
  }
}
