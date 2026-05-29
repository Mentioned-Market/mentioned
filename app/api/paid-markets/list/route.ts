import { NextResponse } from 'next/server'
import { fetchAllMarketsWithFallback, impliedYesPrice, MarketStatus } from '@/lib/mentionMarketUsdc'
import { getAllPaidMarketMetadata } from '@/lib/db'

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
}

export async function GET() {
  const allMetadata = await getAllPaidMarketMetadata()
  const markets = await fetchAllMarketsWithFallback(allMetadata.map(m => m.market_id))

  const metaByMarketId = new Map(allMetadata.map(m => [m.market_id, m]))

  const summaries: PaidMarketSummary[] = markets.map(({ account: mkt }) => {
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

  return NextResponse.json({ markets: summaries })
}
