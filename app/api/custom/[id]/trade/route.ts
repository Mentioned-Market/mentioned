import { NextRequest, NextResponse } from 'next/server'
import { getCustomMarket, getCustomMarketWords, executeVirtualTrade, lockCustomMarket } from '@/lib/db'
import { isMarketOpen } from '@/lib/customMarketUtils'

const RATE_LIMIT_MS = 500
const lastTrade = new Map<string, number>()

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const marketId = parseInt(id, 10)
  if (isNaN(marketId)) {
    return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
  }

  const body = await req.json()
  const { wallet, word_id, action, side, amount, amount_type } = body as {
    wallet?: string
    word_id?: number
    action?: string
    side?: string
    amount?: number
    amount_type?: string
  }

  if (!wallet || word_id === undefined || !action || !side || amount === undefined) {
    return NextResponse.json(
      { error: 'wallet, word_id, action, side, and amount are required' },
      { status: 400 },
    )
  }

  if (action !== 'buy' && action !== 'sell') {
    return NextResponse.json({ error: 'action must be "buy" or "sell"' }, { status: 400 })
  }
  if (side !== 'YES' && side !== 'NO') {
    return NextResponse.json({ error: 'side must be "YES" or "NO"' }, { status: 400 })
  }
  if (typeof amount !== 'number' || amount <= 0) {
    return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
  }
  if (amount_type && amount_type !== 'tokens' && amount_type !== 'shares') {
    return NextResponse.json({ error: 'amount_type must be "tokens" or "shares"' }, { status: 400 })
  }

  const amountType: 'tokens' | 'shares' = amount_type === 'shares' ? 'shares' : 'tokens'

  // Rate limit per wallet
  const now = Date.now()
  const last = lastTrade.get(wallet) ?? 0
  if (now - last < RATE_LIMIT_MS) {
    return NextResponse.json({ error: 'Slow down' }, { status: 429 })
  }
  lastTrade.set(wallet, now)

  const market = await getCustomMarket(marketId)
  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 })
  }

  // If lock_time has passed, atomically lock the market and reject
  if (market.status === 'open' && market.lock_time && new Date(market.lock_time) <= new Date()) {
    lockCustomMarket(marketId).catch(() => {})
    return NextResponse.json({ error: 'Market is locked' }, { status: 403 })
  }

  if (!isMarketOpen(market)) {
    return NextResponse.json({ error: 'Market is not open for trading' }, { status: 403 })
  }

  // Validate word belongs to this market
  const words = await getCustomMarketWords(marketId)
  const word = words.find(w => w.id === word_id)
  if (!word) {
    return NextResponse.json({ error: 'Word not found in this market' }, { status: 400 })
  }

  try {
    const result = await executeVirtualTrade(
      marketId, word_id, wallet, action, side as 'YES' | 'NO', amount, amountType,
    )
    return NextResponse.json({
      trade_id: result.tradeId,
      cost: result.cost,
      shares: result.shares,
      new_yes_price: result.newYesPrice,
      new_no_price: result.newNoPrice,
      new_balance: result.newBalance,
      new_yes_shares: result.newYesShares,
      new_no_shares: result.newNoShares,
    })
  } catch (err: any) {
    if (err.message === 'Insufficient balance') {
      return NextResponse.json({ error: 'Insufficient play token balance' }, { status: 400 })
    }
    if (err.message === 'Insufficient shares') {
      return NextResponse.json({ error: 'Insufficient shares to sell' }, { status: 400 })
    }
    console.error('Trade error:', err)
    return NextResponse.json({ error: 'Trade failed' }, { status: 500 })
  }
}
