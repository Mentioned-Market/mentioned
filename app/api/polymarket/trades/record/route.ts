import { NextRequest, NextResponse } from 'next/server'
import { insertPolymarketTrade } from '@/lib/db'
import { awardPoints, checkAndAwardFirstTrade } from '@/lib/points'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { wallet, marketId, eventId, isYes, isBuy, side, amountUsd, txSignature } = body

    if (!wallet || !marketId || !eventId || isYes === undefined || !side || !amountUsd) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const trade = await insertPolymarketTrade(
      wallet,
      marketId,
      eventId,
      isYes,
      isBuy ?? true,
      side,
      String(amountUsd),
      txSignature,
    )

    // Award points (fire-and-forget — do not block response)
    Promise.all([
      awardPoints(wallet, 'trade_placed', String(trade.id)),
      checkAndAwardFirstTrade(wallet),
    ]).catch((err) => console.error('Points award error (trade):', err))

    return NextResponse.json({ success: true, tradeId: trade.id })
  } catch (err) {
    console.error('Record trade error:', err)
    return NextResponse.json({ error: 'Failed to record trade' }, { status: 500 })
  }
}
