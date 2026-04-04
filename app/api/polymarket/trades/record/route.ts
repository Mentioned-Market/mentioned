import { NextRequest, NextResponse } from 'next/server'
import { insertPolymarketTrade } from '@/lib/db'
import { getVerifiedWallet } from '@/lib/walletAuth'

export async function POST(req: NextRequest) {
  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { marketId, eventId, isYes, isBuy, side, amountUsd, txSignature, marketTitle } = body

    if (!marketId || !eventId || isYes === undefined || !side || !amountUsd) {
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
      marketTitle ?? null,
    )

    return NextResponse.json({ success: true, tradeId: trade.id, newAchievements: [] })
  } catch (err) {
    console.error('Record trade error:', err)
    return NextResponse.json({ error: 'Failed to record trade' }, { status: 500 })
  }
}
