import { NextRequest, NextResponse } from 'next/server'
import { getClientIp } from '@/lib/clientIp'
import { PAID_RPC_UPSTREAM } from '@/lib/solanaConfig'

// Same-origin passthrough to the paid (USDC AMM) cluster RPC. The browser talks to
// this route so the Helius API key stays server-side (read from HELIUS_MAINNET_RPC_URL
// / HELIUS_DEVNET_RPC_URL via lib/solanaConfig) instead of being inlined into the
// client bundle via a NEXT_PUBLIC_* var. One keyed var, never shipped to users, and
// no NEXT_PUBLIC build-time inlining to manage.
//
// Hardened like /api/rpc/mainnet because it relays access to a keyed endpoint:
//  - per-IP rate limit  → caps aggregate calls from a single source
//  - method allowlist  → only the methods the paid client actually uses, all ≤1 credit
//  - getProgramAccounts → never allowed (10 credits; the client falls back to
//                          per-market getAccountInfo via fetchAllMarketsWithFallback)
//  - no batch requests  → one POST maps to exactly one upstream call
//  - body-size cap      → a single legit call (incl. a base64 tx) is tiny

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Methods the paid browser flow calls (reads + the raw-sign broadcast path). Every
// entry is ≤1 credit. getProgramAccounts is deliberately excluded — the admin/list
// seed from DB-known market IDs and backfill via getAccountInfo, so it's never needed
// client-side. Keep this list tight: add a method only once a client path needs it.
const ALLOWED_METHODS = new Set([
  'getAccountInfo',          // fetchMarket / fetchLpPosition / getProgramAccounts fallback
  'getTokenAccountBalance',  // fetchVaultBalance / fetchUsdcBalance / fetchTokenBalance
  'getLatestBlockhash',      // sendInstructions
  'simulateTransaction',     // sendInstructions pre-flight
  'sendTransaction',         // sendInstructions broadcast
  'getSignatureStatuses',    // sendInstructions confirmation poll
])

const MAX_BODY_BYTES = 100 * 1024 // 100 KB — a single call, even with a base64 tx, is well under this

// Per-IP sliding-window rate limit. Paid loads come in bursts (a few getAccountInfo +
// vault/LP reads per market, then a sign/simulate/send/poll sequence per trade), so the
// ceiling is more generous than the general proxy while still 1-for-1 credit-capped.
// In-memory, therefore per instance — effective ceiling is N replicas × this.
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const RATE_LIMIT_MAX = 240
const rateLimitMap = new Map<string, number[]>()

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

setInterval(() => {
  const now = Date.now()
  for (const [ip, timestamps] of rateLimitMap) {
    const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
    if (recent.length === 0) rateLimitMap.delete(ip)
    else rateLimitMap.set(ip, recent)
  }
}, 5 * 60 * 1000)

function rpcError(id: unknown, code: number, message: string, status: number) {
  return NextResponse.json(
    { jsonrpc: '2.0', id: id ?? null, error: { code, message } },
    { status }
  )
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  if (ip) {
    const retryAfter = rateLimitRetryAfter(ip)
    if (retryAfter > 0) {
      const res = rpcError(null, -32005, 'Rate limit exceeded', 429)
      res.headers.set('Retry-After', String(retryAfter))
      return res
    }
  }

  const contentLength = Number(req.headers.get('content-length') || 0)
  if (contentLength > MAX_BODY_BYTES) {
    return rpcError(null, -32600, 'Request too large', 413)
  }

  const body = await req.text()
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    return rpcError(null, -32600, 'Request too large', 413)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return rpcError(null, -32700, 'Parse error', 400)
  }

  // Reject batch requests so one POST can't fan out into many upstream calls.
  if (Array.isArray(parsed)) {
    return rpcError(null, -32600, 'Batch requests are not allowed', 400)
  }

  const { id, method } = (parsed ?? {}) as { id?: unknown; method?: unknown }
  if (typeof method !== 'string' || !ALLOWED_METHODS.has(method)) {
    return rpcError(id, -32601, `Method not allowed: ${typeof method === 'string' ? method : 'unknown'}`, 403)
  }

  try {
    const res = await fetch(PAID_RPC_UPSTREAM, {
      method: 'POST',
      cache: 'no-store',
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
