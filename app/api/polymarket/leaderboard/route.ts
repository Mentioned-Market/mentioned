import { NextResponse } from 'next/server'
import { getPolymarketTradersSince, pool } from '@/lib/db'
import { JUP_API_KEY, JUP_BASE } from '@/lib/jupiterApi'

// ── Types ────────────────────────────────────────────

interface LeaderboardEntry {
  wallet: string
  username: string | null
  pnl: number
  winningTrades: number
  totalTrades: number
  volume: number
}

interface CachedLeaderboard {
  data: LeaderboardEntry[]
  weekStart: string
  fetchedAt: number
}

// ── Cache ────────────────────────────────────────────

let cache: CachedLeaderboard | null = null
const CACHE_TTL_MS = 3 * 60 * 1000 // 3 minutes

// ── Helpers ──────────────────────────────────────────

function getWeekStart(): Date {
  const now = new Date()
  const day = now.getUTCDay() // 0=Sun, 1=Mon
  const diff = day === 0 ? 6 : day - 1
  const monday = new Date(now)
  monday.setUTCDate(now.getUTCDate() - diff)
  monday.setUTCHours(0, 0, 0, 0)
  return monday
}

async function fetchJupiterHistory(wallet: string): Promise<any[]> {
  const params = new URLSearchParams({ ownerPubkey: wallet })

  const res = await fetch(`${JUP_BASE}/history?${params}`, {
    headers: { 'x-api-key': JUP_API_KEY },
  })

  if (!res.ok) return []
  const json = await res.json()
  return json.data || json || []
}

// ── Route ────────────────────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const debug = searchParams.get('debug') === '1'
  const weekStart = getWeekStart()
  const now = new Date()
  const startTs = Math.floor(weekStart.getTime() / 1000)
  const endTs = Math.floor(now.getTime() / 1000)

  // Return cache if fresh (skip in debug mode)
  if (
    !debug &&
    cache &&
    cache.weekStart === weekStart.toISOString() &&
    Date.now() - cache.fetchedAt < CACHE_TTL_MS
  ) {
    return NextResponse.json({
      data: cache.data,
      weekStart: cache.weekStart,
      cached: true,
    })
  }

  try {
    // 1. Get wallets that traded through Mentioned this week
    const wallets = await getPolymarketTradersSince(weekStart)

    if (wallets.length === 0) {
      const empty: LeaderboardEntry[] = []
      cache = { data: empty, weekStart: weekStart.toISOString(), fetchedAt: Date.now() }
      return NextResponse.json({ data: empty, weekStart: weekStart.toISOString() })
    }

    // 2. Fetch Jupiter history for each wallet (batched concurrency)
    const BATCH_SIZE = 5
    const entries: LeaderboardEntry[] = []

    for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
      const batch = wallets.slice(i, i + BATCH_SIZE)
      const results = await Promise.all(
        batch.map(async (wallet) => {
          const allEvents = await fetchJupiterHistory(wallet)
          // Filter to current week client-side
          const events = allEvents.filter(
            (e: any) => (Number(e.timestamp) || 0) >= startTs && (Number(e.timestamp) || 0) <= endTs
          )

          if (debug) {
            console.log(`[leaderboard debug] wallet=${wallet} startTs=${startTs} endTs=${endTs} allEvents=${allEvents.length} filtered=${events.length}`)
            for (const e of allEvents.slice(0, 5)) {
              console.log(`[leaderboard debug] event:`, JSON.stringify(e, null, 2))
            }
          }

          const fills = events.filter((e: any) => e.eventType === 'order_filled')
          const claims = events.filter((e: any) =>
            e.eventType === 'payout_claimed' ||
            e.eventType === 'settle_position'
          )

          const pnl = claims.reduce(
            (sum: number, e: any) => sum + (Number(e.realizedPnl) || 0),
            0,
          )
          const winningTrades = claims.filter(
            (e: any) => (Number(e.realizedPnl) || 0) > 0,
          ).length
          const volume = fills.reduce(
            (sum: number, e: any) => sum + Math.abs(Number(e.totalCostUsd) || 0),
            0,
          )

          const debugInfo = debug ? {
            totalEvents: events.length,
            eventTypes: events.map((e: any) => e.eventType),
            rawEvents: events.slice(0, 5),
          } : undefined

          return {
            wallet,
            username: null as string | null,
            pnl,
            winningTrades,
            totalTrades: fills.length,
            volume,
            ...(debugInfo ? { _debug: debugInfo } : {}),
          }
        }),
      )
      entries.push(...results)
    }

    // 3. Batch-fetch usernames
    if (entries.length > 0) {
      const profileResult = await pool.query(
        `SELECT wallet, username FROM user_profiles WHERE wallet = ANY($1)`,
        [entries.map((e) => e.wallet)],
      )
      const usernameMap: Record<string, string> = {}
      for (const row of profileResult.rows) {
        usernameMap[row.wallet] = row.username
      }
      for (const entry of entries) {
        entry.username = usernameMap[entry.wallet] || null
      }
    }

    // 4. Sort by P&L descending
    entries.sort((a, b) => b.pnl - a.pnl)

    // 5. Cache and return
    cache = {
      data: entries,
      weekStart: weekStart.toISOString(),
      fetchedAt: Date.now(),
    }

    return NextResponse.json({
      data: entries,
      weekStart: weekStart.toISOString(),
    })
  } catch (err) {
    console.error('Leaderboard error:', err)
    return NextResponse.json(
      { error: 'Failed to compute leaderboard' },
      { status: 500 },
    )
  }
}
