import { NextRequest, NextResponse } from 'next/server'
import { createRpc, getMarketPDA, getVaultAddress } from '@/lib/mentionMarketUsdc'
import { SOLANA_CLUSTER } from '@/lib/solanaConfig'
import { getClientIp } from '@/lib/clientIp'
import { checkRateLimit } from '@/lib/rateLimit'
import { cached } from '@/lib/ttlCache'

// Shared, cached market snapshot for the market detail page.
//
// Every viewer of /market/[id] previously polled the market account +
// vault balance through /api/paid-rpc individually (2 RPC calls per viewer per
// 12s). The data is identical for all viewers, so this route serves it from one
// cache: N concurrent viewers cost ~2 upstream calls per TTL window total —
// flat in user count, which matters most during live events when viewer counts
// spike.
//
// The response carries the RAW base64 account bytes, not a decoded JSON shape.
// The client decodes with the same deserializeMarketAccount it already uses for
// direct RPC reads, so there is no serialization schema to drift out of sync
// with the on-chain layout — this route is byte-for-byte equivalent to a
// getAccountInfo, just shared and cached.
//
// TTL is 3s, deliberately under the client's +4s post-trade refetch delay, so a
// trader's own refresh always lands past the cache window and sees their trade.
// Nonexistent ids are cached too (negative caching) so id-rotation can't mint
// upstream fan-outs; the id-format check plus per-IP limit bound key cardinality.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TTL_MS = 3_000
const STALE_MS = 30_000

// On-chain market ids are u64s assigned by the admin flow as BigInt(Date.now())
// (13 digits today). Accept any decimal that fits in a u64; the BigInt bound
// check below rejects overflow, and together they keep cache-key cardinality
// bounded to plausible ids.
const ID_PATTERN = /^\d{1,20}$/
const U64_MAX = 18_446_744_073_709_551_615n

interface MarketSnapshot {
  /** base64-encoded market account data, or null if the account doesn't exist */
  account: string | null
  /** vault USDC balance in base units, as a decimal string */
  vaultAmount: string
}

async function computeSnapshot(marketId: bigint): Promise<MarketSnapshot> {
  const rpc = createRpc()
  const [pda] = await getMarketPDA(marketId)
  const vaultAddr = await getVaultAddress(marketId)

  const [accountRes, vaultRes] = await Promise.all([
    rpc.getAccountInfo(pda, { encoding: 'base64' }).send(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rpc as any).getTokenAccountBalance(vaultAddr).send().catch(() => null),
  ])

  const raw = accountRes.value?.data
  const account = raw == null ? null : typeof raw === 'string' ? raw : raw[0]
  const vaultAmount: string = vaultRes?.value?.amount ?? '0'
  return { account, vaultAmount }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const rl = checkRateLimit('paid:market', getClientIp(req), 120)
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  const id = params.id
  if (!ID_PATTERN.test(id) || BigInt(id) > U64_MAX) {
    return NextResponse.json({ error: 'invalid market id' }, { status: 400 })
  }

  try {
    const snapshot = await cached(
      `paid:market:${SOLANA_CLUSTER}:${id}`,
      { ttlMs: TTL_MS, staleMs: STALE_MS },
      () => computeSnapshot(BigInt(id)),
    )
    if (snapshot.account === null) {
      return NextResponse.json({ error: 'market not found' }, { status: 404 })
    }
    return NextResponse.json(snapshot)
  } catch {
    return NextResponse.json({ error: 'failed to load market' }, { status: 502 })
  }
}
