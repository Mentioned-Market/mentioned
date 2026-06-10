import { NextResponse } from 'next/server'
import { impliedYesPrice, MarketStatus } from '@/lib/mentionMarketUsdc'
import { getPaidMarketTraderCounts } from '@/lib/db'
import { isAdmin } from '@/lib/adminAuth'
import { cached } from '@/lib/ttlCache'
import { getMarketsAndMetadataCached } from '@/lib/paidMarketsServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface PaidMarketSummary {
  marketId: string
  title: string
  coverImageUrl: string | null
  status: number  // MarketStatus: 0=Open 1=Paused 2=Resolved
  slug: string | null
  wordCount: number
  words: { label: string; yesPrice: number; noPrice: number; outcome: boolean | null }[]
  locksAt: string  // Unix seconds as string (bigint serialized)
  eventStartTime: string | null
  traderCount: number
}

export async function GET() {
  // This response is identical for every visitor and re-prices every market via
  // upstream RPC, so it's cached rather than rate-limited: one cache key means
  // a flood of callers can't amplify into more than one RPC fan-out per TTL, and
  // legit shared-IP traffic is never throttled. Stale-on-error keeps the markets
  // page populated through transient RPC blips.
  const summaries = await cached<PaidMarketSummary[]>(
    'paid:list',
    { ttlMs: 8_000, staleMs: 60_000 },
    computeMarketList,
  )
  return NextResponse.json({ markets: summaries })
}

async function computeMarketList(): Promise<PaidMarketSummary[]> {
  const { metadata: allMetadata, markets } = await getMarketsAndMetadataCached()
  const traderCounts = await getPaidMarketTraderCounts(allMetadata.map(m => m.market_id))

  const metaByMarketId = new Map(allMetadata.map(m => [m.market_id, m]))

  const summaries: PaidMarketSummary[] = markets
    // Public list: only markets WE created (admin authority), with metadata, and
    // not hidden. Keeps stranger-created on-chain markets and unreleased test
    // markets off the site.
    .filter(({ account: mkt }) => {
      const meta = metaByMarketId.get(mkt.marketId.toString())
      return !!meta && !meta.hidden && isAdmin(mkt.authority)
    })
    .map(({ account: mkt }) => {
    const meta = metaByMarketId.get(mkt.marketId.toString())
    const activeWords = mkt.words.slice(0, mkt.numWords)
    return {
      marketId: mkt.marketId.toString(),
      title: meta?.title ?? mkt.label ?? `Market #${mkt.marketId}`,
      coverImageUrl: meta?.cover_image_url ?? null,
      status: mkt.status,
      slug: meta?.slug ?? null,
      wordCount: mkt.numWords,
      words: activeWords.map(w => {
        const yp = impliedYesPrice(w, mkt.liquidityParamB)
        return { label: w.label, yesPrice: yp, noPrice: 1 - yp, outcome: w.outcome }
      }),
      locksAt: mkt.locksAt.toString(),
      eventStartTime: meta?.event_start_time ?? null,
      traderCount: traderCounts.get(mkt.marketId.toString()) ?? 0,
    }
  }).filter(m => m.status !== MarketStatus.Resolved || m.words.some(w => w.outcome !== null))

  // Sort: non-resolved by soonest lock time first, resolved markets last
  summaries.sort((a, b) => {
    const aResolved = a.status === MarketStatus.Resolved
    const bResolved = b.status === MarketStatus.Resolved
    if (aResolved && !bResolved) return 1
    if (!aResolved && bResolved) return -1
    return Number(BigInt(a.locksAt) - BigInt(b.locksAt))
  })

  return summaries
}
