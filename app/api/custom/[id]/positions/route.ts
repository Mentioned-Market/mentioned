import { NextRequest, NextResponse } from 'next/server'
import { getCustomMarket, getUserPositions, getUserBalance } from '@/lib/db'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const marketId = parseInt(id, 10)
  if (isNaN(marketId)) {
    return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
  }

  const wallet = req.nextUrl.searchParams.get('wallet')
  if (!wallet) {
    return NextResponse.json({ error: 'wallet is required' }, { status: 400 })
  }

  const market = await getCustomMarket(marketId)
  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 })
  }

  const [positions, balanceRow] = await Promise.all([
    getUserPositions(marketId, wallet),
    getUserBalance(marketId, wallet),
  ])

  return NextResponse.json({
    balance: balanceRow ? parseFloat(balanceRow.balance) : market.play_tokens,
    starting_balance: market.play_tokens,
    positions: positions.map(p => ({
      word_id: p.word_id,
      word: p.word,
      yes_shares: parseFloat(p.yes_shares),
      no_shares: parseFloat(p.no_shares),
      tokens_spent: parseFloat(p.tokens_spent),
      tokens_received: parseFloat(p.tokens_received),
    })),
  })
}
