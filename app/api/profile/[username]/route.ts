import { NextRequest, NextResponse } from 'next/server'
import {
  getProfileByUsername,
  getProfileByWallet,
  getWalletPointTotal,
  getWalletWeeklyPoints,
  getWalletFreeMarketPositions,
  getWalletFreeMarketTrades,
  getWalletFreeMarketStats,
  getWalletPointHistory,
} from '@/lib/db'
import { getWeekStart } from '@/lib/points'

export const dynamic = 'force-dynamic'

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/
const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export async function GET(
  _req: NextRequest,
  { params }: { params: { username: string } },
) {
  const { username: identifier } = params

  let wallet: string
  let username: string | null
  let created_at: string | null
  let pfp_emoji: string | null = null

  if (WALLET_RE.test(identifier)) {
    const profile = await getProfileByWallet(identifier)
    wallet = identifier
    username = profile?.username ?? null
    created_at = profile?.created_at ?? null
    pfp_emoji = profile?.pfp_emoji ?? null
  } else if (USERNAME_RE.test(identifier)) {
    const profile = await getProfileByUsername(identifier)
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }
    wallet = profile.wallet
    username = profile.username
    created_at = profile.created_at
    pfp_emoji = profile.pfp_emoji ?? null
  } else {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const weekStart = getWeekStart()

  const [allTimePoints, weeklyPoints, freePositions, freeTrades, freeStats, pointHistory] = await Promise.all([
    getWalletPointTotal(wallet),
    getWalletWeeklyPoints(wallet, weekStart),
    getWalletFreeMarketPositions(wallet),
    getWalletFreeMarketTrades(wallet, 200),
    getWalletFreeMarketStats(wallet),
    getWalletPointHistory(wallet),
  ])

  return NextResponse.json({
    username,
    wallet,
    pfpEmoji: pfp_emoji,
    createdAt: created_at,
    positions: [],
    history: [],
    stats: {
      positionsCount: 0,
      totalVolume: 0,
      totalValue: 0,
      unrealizedPnl: 0,
      realizedPnl: 0,
      totalPnl: 0,
      tradesCount: 0,
      biggestWin: 0,
      allTimePoints,
      weeklyPoints,
    },
    freeMarket: {
      positions: freePositions,
      trades: freeTrades,
      stats: freeStats,
    },
    pointHistory,
  })
}
