import { NextRequest, NextResponse } from 'next/server'
import { getTradesByMarket, getTradesByTrader } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const marketId = searchParams.get('marketId')
  const trader = searchParams.get('trader')
  const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500)
  const before = searchParams.get('before')

  if (!marketId && !trader) {
    return NextResponse.json({ error: 'Provide marketId or trader query param' }, { status: 400 })
  }

  const rows = marketId
    ? await getTradesByMarket(marketId, limit, before || undefined)
    : await getTradesByTrader(trader!, limit, before || undefined)

  const trades = rows.map((r) => ({
    signature: r.signature,
    marketId: r.market_id,
    wordIndex: r.word_index,
    direction: r.direction === 0 ? 'YES' : 'NO',
    isBuy: r.is_buy,
    quantity: parseFloat(r.quantity),
    cost: parseFloat(r.cost),
    fee: parseFloat(r.fee),
    newYesQty: parseFloat(r.new_yes_qty),
    newNoQty: parseFloat(r.new_no_qty),
    impliedPrice: parseFloat(r.implied_price),
    trader: r.trader,
    timestamp: r.block_time,
  }))

  const cursor = trades.length > 0 ? trades[trades.length - 1].timestamp : null

  return NextResponse.json({ trades, cursor })
}
