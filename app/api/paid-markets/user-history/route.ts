import { NextRequest, NextResponse } from 'next/server'
import { pool, getAllPaidMarketMetadata } from '@/lib/db'
import { fetchAllMarketsWithFallback } from '@/lib/mentionMarketUsdc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet')
  if (!wallet || wallet.length < 32) {
    return NextResponse.json({ error: 'wallet required' }, { status: 400 })
  }

  const [rows, allMetadata] = await Promise.all([
    pool.query(
      `SELECT
         te.signature,
         te.market_id    AS "marketId",
         te.word_index   AS "wordIndex",
         te.direction,
         te.is_buy       AS "isBuy",
         te.quantity,
         te.cost,
         te.fee,
         te.implied_price AS "impliedPrice",
         te.block_time   AS "blockTime"
       FROM trade_events te
       WHERE te.trader = $1
       ORDER BY te.block_time DESC
       LIMIT 200`,
      [wallet],
    ),
    getAllPaidMarketMetadata(),
  ])
  const allMarkets = await fetchAllMarketsWithFallback(allMetadata.map(m => m.market_id))

  const metaByMarketId = new Map(allMetadata.map(m => [m.market_id, m]))
  const wordsByMarketId = new Map(
    allMarkets.map(({ account }) => [account.marketId.toString(), account.words])
  )

  const trades = rows.rows.map(r => {
    const meta = metaByMarketId.get(r.marketId)
    const words = wordsByMarketId.get(r.marketId)
    const wordLabel = words?.[r.wordIndex]?.label ?? `Word ${r.wordIndex}`
    return {
      signature: r.signature,
      marketId: r.marketId,
      marketTitle: meta?.title ?? `Market #${r.marketId}`,
      coverImageUrl: meta?.cover_image_url ?? null,
      wordIndex: r.wordIndex,
      wordLabel,
      direction: r.direction === 0 ? 'YES' : 'NO',
      isBuy: r.isBuy,
      quantity: parseFloat(r.quantity),
      cost: parseFloat(r.cost),
      fee: parseFloat(r.fee),
      impliedPrice: parseFloat(r.impliedPrice),
      blockTime: r.blockTime,
    }
  })

  return NextResponse.json({ trades })
}
