import { NextRequest, NextResponse } from 'next/server'
import { getCustomMarket, getCustomMarketWords, executeVirtualTrade, lockCustomMarket, getRecentCustomTradeCount, hasDiscordLinked, countTeamDistinctMarketsThisWeek } from '@/lib/db'
import { isMarketOpen } from '@/lib/customMarketUtils'
import { tryUnlockAchievement } from '@/lib/achievements'
import { getVerifiedWallet } from '@/lib/walletAuth'

// Per-request rate limit: 2 seconds between trades per wallet
const RATE_LIMIT_MS = 2000
const lastTrade = new Map<string, number>()

// Sliding window: max 30 trades per 5 minutes
const WINDOW_MAX_TRADES = 30
const WINDOW_SECONDS = 300

// Minimum trade size (tokens for buys)
const MIN_BUY_TOKENS = 1

setInterval(() => {
  const cutoff = Date.now() - 60_000
  for (const [key, ts] of lastTrade) {
    if (ts < cutoff) lastTrade.delete(key)
  }
}, 600_000)

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const marketId = parseInt(id, 10)
  if (isNaN(marketId)) {
    return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
  }

  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Rate limit per wallet (in-memory, fast path — before body parsing or DB work)
  const now = Date.now()
  const last = lastTrade.get(wallet) ?? 0
  if (now - last < RATE_LIMIT_MS) {
    return NextResponse.json({ error: 'Trading too fast — wait a moment' }, { status: 429 })
  }

  const body = await req.json()
  const { word_id, action, side, amount, amount_type, max_cost } = body as {
    word_id?: number
    action?: string
    side?: string
    amount?: number
    amount_type?: string
    max_cost?: number
  }

  if (word_id === undefined || !action || !side || amount === undefined) {
    return NextResponse.json(
      { error: 'word_id, action, side, and amount are required' },
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

  // Minimum trade size (early reject before any DB work)
  if (action === 'buy' && amount_type !== 'shares' && amount < MIN_BUY_TOKENS) {
    return NextResponse.json({ error: `Minimum trade is ${MIN_BUY_TOKENS} token` }, { status: 400 })
  }

  const amountType: 'tokens' | 'shares' = amount_type === 'shares' ? 'shares' : 'tokens'

  // Require Discord linked to trade on free markets
  const discordOk = await hasDiscordLinked(wallet)
  if (!discordOk) {
    return NextResponse.json(
      { error: 'You must link your Discord account to trade on free markets' },
      { status: 403 },
    )
  }

  // Sliding window rate limit (DB-backed, survives restarts)
  const recentCount = await getRecentCustomTradeCount(wallet, WINDOW_SECONDS)
  if (recentCount >= WINDOW_MAX_TRADES) {
    return NextResponse.json(
      { error: `Too many trades — limit is ${WINDOW_MAX_TRADES} per ${WINDOW_SECONDS / 60} minutes` },
      { status: 429 },
    )
  }

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

  // Validate word belongs to this market and is not resolved
  const words = await getCustomMarketWords(marketId)
  const word = words.find(w => w.id === word_id)
  if (!word) {
    return NextResponse.json({ error: 'Word not found in this market' }, { status: 400 })
  }
  if (word.resolved_outcome !== null) {
    return NextResponse.json({ error: 'This word has already been resolved' }, { status: 400 })
  }

  try {
    const result = await executeVirtualTrade(
      marketId, word_id, wallet, action, side as 'YES' | 'NO', amount, amountType,
      max_cost,
    )
    // Mark trade timestamp only after successful execution
    lastTrade.set(wallet, Date.now())
    // Free market achievements (fire-and-forget)
    const newAchievements: { id: string; emoji: string; title: string; points: number }[] = []
    try {
      const ach = await tryUnlockAchievement(wallet, 'free_trade')
      if (ach) newAchievements.push({ id: ach.id, emoji: ach.emoji, title: ach.title, points: ach.points })
    } catch (err) {
      console.error('Achievement error (custom trade):', err)
    }
    // Market Sweep — check if team has now traded on 5+ distinct markets this week
    try {
      const distinctCount = await countTeamDistinctMarketsThisWeek(wallet)
      if (distinctCount >= 5) {
        const ach = await tryUnlockAchievement(wallet, 'market_sweep')
        if (ach) newAchievements.push({ id: ach.id, emoji: ach.emoji, title: ach.title, points: ach.points })
      }
    } catch (err) {
      console.error('Achievement error (market_sweep):', err)
    }

    return NextResponse.json({
      trade_id: result.tradeId,
      cost: result.cost,
      shares: result.shares,
      new_yes_price: result.newYesPrice,
      new_no_price: result.newNoPrice,
      new_balance: result.newBalance,
      new_yes_shares: result.newYesShares,
      new_no_shares: result.newNoShares,
      newAchievements,
    })
  } catch (err: any) {
    if (err.message === 'Insufficient balance') {
      return NextResponse.json({ error: 'Insufficient play token balance' }, { status: 400 })
    }
    if (err.message === 'Insufficient shares') {
      return NextResponse.json({ error: 'Insufficient shares to sell' }, { status: 400 })
    }
    if (err.message === 'Trade too small') {
      return NextResponse.json({ error: 'Trade amount is too small' }, { status: 400 })
    }
    console.error('Trade error:', err)
    return NextResponse.json({ error: 'Trade failed' }, { status: 500 })
  }
}
