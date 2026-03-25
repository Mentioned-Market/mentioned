import { NextRequest, NextResponse } from 'next/server'
import { getTradeHistory } from '@/lib/db'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const marketId = parseInt(id, 10)
  if (isNaN(marketId)) {
    return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
  }

  const wallet = req.nextUrl.searchParams.get('wallet') || undefined
  const limitParam = req.nextUrl.searchParams.get('limit')
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 200) : 50

  const trades = await getTradeHistory(marketId, limit, wallet)

  return NextResponse.json({
    trades: trades.map(t => ({
      id: t.id,
      wallet: t.wallet,
      username: t.username,
      word: t.word,
      action: t.action,
      side: t.side,
      shares: parseFloat(t.shares),
      cost: parseFloat(t.cost),
      yes_price: parseFloat(t.yes_price),
      created_at: t.created_at,
    })),
  })
}
