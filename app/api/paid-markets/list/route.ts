import { NextResponse } from 'next/server'
import { fetchAllMarkets, impliedYesPrice, MarketStatus } from '@/lib/mentionMarketUsdc'
import { getAllPaidMarketMetadata } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface PaidMarketSummary {
  marketId: string
  title: string
  coverImageUrl: string | null
  status: number  // MarketStatus: 0=Open 1=Paused 2=Resolved
  wordCount: number
  words: { label: string; yesPrice: number; noPrice: number; outcome: boolean | null }[]
}

export async function GET() {
  const [markets, allMetadata] = await Promise.all([
    fetchAllMarkets(),
    getAllPaidMarketMetadata(),
  ])

  const metaByMarketId = new Map(allMetadata.map(m => [m.market_id, m]))

  const summaries: PaidMarketSummary[] = markets.map(({ account: mkt }) => {
    const meta = metaByMarketId.get(mkt.marketId.toString())
    const activeWords = mkt.words.slice(0, mkt.numWords)
    return {
      marketId: mkt.marketId.toString(),
      title: meta?.title ?? mkt.label ?? `Market #${mkt.marketId}`,
      coverImageUrl: meta?.cover_image_url ?? null,
      status: mkt.status,
      wordCount: mkt.numWords,
      words: activeWords.map(w => {
        const yp = impliedYesPrice(w, mkt.liquidityParamB)
        return { label: w.label, yesPrice: yp, noPrice: 1 - yp, outcome: w.outcome }
      }),
    }
  }).filter(m => m.status !== MarketStatus.Resolved || m.words.some(w => w.outcome !== null))

  return NextResponse.json({ markets: summaries })
}
