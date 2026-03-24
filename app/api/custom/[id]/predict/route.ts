import { NextRequest, NextResponse } from 'next/server'
import { getCustomMarket, getCustomMarketWords, upsertPrediction, lockCustomMarket } from '@/lib/db'
import { isMarketOpen } from '@/lib/customMarketUtils'

const RATE_LIMIT_MS = 500
const lastPrediction = new Map<string, number>()

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
  const { wallet, wordId, prediction } = body as {
    wallet?: string
    wordId?: number
    prediction?: boolean
  }

  if (!wallet || wordId === undefined || prediction === undefined) {
    return NextResponse.json(
      { error: 'wallet, wordId, and prediction are required' },
      { status: 400 },
    )
  }

  // Rate limit per wallet
  const now = Date.now()
  const last = lastPrediction.get(wallet) ?? 0
  if (now - last < RATE_LIMIT_MS) {
    return NextResponse.json({ error: 'Slow down' }, { status: 429 })
  }
  lastPrediction.set(wallet, now)

  const market = await getCustomMarket(marketId)
  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 })
  }

  // If lock_time has passed, atomically lock the market and reject
  if (market.status === 'open' && market.lock_time && new Date(market.lock_time) <= new Date()) {
    lockCustomMarket(marketId).catch(() => {}) // best-effort sync, non-blocking
    return NextResponse.json({ error: 'Market is locked' }, { status: 403 })
  }

  if (!isMarketOpen(market)) {
    return NextResponse.json({ error: 'Market is not open for predictions' }, { status: 403 })
  }

  // Validate word belongs to this market
  const words = await getCustomMarketWords(marketId)
  const word = words.find(w => w.id === wordId)
  if (!word) {
    return NextResponse.json({ error: 'Word not found in this market' }, { status: 400 })
  }

  const result = await upsertPrediction(marketId, wordId, wallet, prediction)
  return NextResponse.json({ prediction: result })
}
