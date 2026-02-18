import { NextRequest, NextResponse } from 'next/server'
import { getTradesByWord } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const marketId = searchParams.get('marketId')
  const wordIndex = parseInt(searchParams.get('wordIndex') || '0')
  const limit = Math.min(parseInt(searchParams.get('limit') || '500'), 1000)

  if (!marketId) {
    return NextResponse.json({ error: 'Provide marketId query param' }, { status: 400 })
  }

  const rows = await getTradesByWord(marketId, wordIndex, limit)

  const points = rows.map((r) => ({
    timestamp: r.block_time,
    impliedPrice: parseFloat(r.implied_price),
    direction: r.direction === 0 ? 'YES' : 'NO',
    quantity: parseFloat(r.quantity),
    cost: parseFloat(r.cost),
  }))

  return NextResponse.json({ points })
}
