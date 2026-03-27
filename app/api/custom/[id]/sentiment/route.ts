import { NextRequest, NextResponse } from 'next/server'
import { getCustomMarket, getCustomMarketWords, getWordPools, getWordTraderCounts } from '@/lib/db'
import { virtualImpliedPrice } from '@/lib/virtualLmsr'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const marketId = parseInt(id, 10)
  if (isNaN(marketId)) {
    return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
  }

  const market = await getCustomMarket(marketId)
  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 })
  }

  const b = typeof market.b_parameter === 'string' ? parseFloat(market.b_parameter) : Number(market.b_parameter)

  const [words, pools, traderCounts] = await Promise.all([
    getCustomMarketWords(marketId),
    getWordPools(marketId),
    getWordTraderCounts(marketId),
  ])

  const poolMap = new Map(pools.map(p => [p.word_id, p]))
  const traderMap = new Map(traderCounts.map(t => [t.word_id, t.trader_count]))

  const wordData = words.map(w => {
    const pool = poolMap.get(w.id)
    const yesQty = pool ? parseFloat(pool.yes_qty) : 0
    const noQty = pool ? parseFloat(pool.no_qty) : 0
    const prices = virtualImpliedPrice(yesQty, noQty, b)
    return {
      word_id: w.id,
      word: w.word,
      yes_price: prices.yes,
      no_price: prices.no,
      yes_qty: yesQty,
      no_qty: noQty,
      trader_count: traderMap.get(w.id) ?? 0,
    }
  })

  return NextResponse.json({ words: wordData })
}
