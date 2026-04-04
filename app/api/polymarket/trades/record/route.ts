import { NextRequest, NextResponse } from 'next/server'
import { insertPolymarketTrade, getTradePointsCountToday } from '@/lib/db'
import { awardPoints, checkAndAwardFirstTrade, POINT_CONFIG } from '@/lib/points'
import { tryUnlockAchievement } from '@/lib/achievements'
import { getVerifiedWallet } from '@/lib/walletAuth'

const RATE_LIMIT_MS = 1000
const lastRecord = new Map<string, number>()
setInterval(() => {
  const cutoff = Date.now() - 60_000
  for (const [key, ts] of lastRecord) {
    if (ts < cutoff) lastRecord.delete(key)
  }
}, 600_000)

export async function POST(req: NextRequest) {
  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const now = Date.now()
  const last = lastRecord.get(wallet) ?? 0
  if (now - last < RATE_LIMIT_MS) {
    return NextResponse.json({ error: 'Slow down' }, { status: 429 })
  }
  lastRecord.set(wallet, now)

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

    // Award points (fire-and-forget — do not block response)
    const tradePointsCfg = POINT_CONFIG.trade_placed
    const awardTradePoints = async () => {
      if (Number(amountUsd) < tradePointsCfg.minAmountUsd) return
      const todayCount = await getTradePointsCountToday(wallet)
      if (todayCount >= tradePointsCfg.dailyCap) return
      await awardPoints(wallet, 'trade_placed', String(trade.id))
    }
    Promise.all([
      awardTradePoints(),
      checkAndAwardFirstTrade(wallet),
    ]).catch((err) => console.error('Points award error (trade):', err))

    // Achievements (collect results for toast)
    const newAchievements: { id: string; emoji: string; title: string; points: number }[] = []
    try {
      const push = (a: Awaited<ReturnType<typeof tryUnlockAchievement>>) => {
        if (a) newAchievements.push({ id: a.id, emoji: a.emoji, title: a.title, points: a.points })
      }
      push(await tryUnlockAchievement(wallet, 'place_trade'))
    } catch (err) {
      console.error('Achievement error (trade):', err)
    }

    return NextResponse.json({ success: true, tradeId: trade.id, newAchievements })
  } catch (err) {
    console.error('Record trade error:', err)
    return NextResponse.json({ error: 'Failed to record trade' }, { status: 500 })
  }
}
