import { NextRequest, NextResponse } from 'next/server'
import { pool, getBulkPointTotals } from '@/lib/db'
import { getWeekStart } from '@/lib/points'

const LEADERBOARD_LIMIT = 100

export async function GET(req: NextRequest) {
  const sort = req.nextUrl.searchParams.get('sort') ?? 'weekly'
  const week = req.nextUrl.searchParams.get('week') === 'last' ? 'last' : 'current'
  const wallet = req.nextUrl.searchParams.get('wallet')

  // Current week: [thisMonday, ∞).  Last week: [prevMonday, thisMonday).
  const thisWeekStart = getWeekStart()
  const weekStart = week === 'last'
    ? new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000)
    : thisWeekStart
  const weekEnd: Date | null = week === 'last' ? thisWeekStart : null

  try {
    // 1. Get all wallets with point events
    const walletsResult = await pool.query(
      `SELECT DISTINCT wallet FROM point_events`,
    )
    const wallets: string[] = walletsResult.rows.map((r: { wallet: string }) => r.wallet)

    if (wallets.length === 0) {
      return NextResponse.json({
        data: [],
        userEntry: null,
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd?.toISOString() ?? null,
        week,
      })
    }

    // 2. Aggregate point totals in one query
    const totals = await getBulkPointTotals(wallets, weekStart, weekEnd)

    // 3. Fetch usernames + pfp
    const profileResult = await pool.query(
      `SELECT wallet, username, pfp_emoji FROM user_profiles WHERE wallet = ANY($1)`,
      [wallets],
    )
    const profileMap: Record<string, { username: string; pfp_emoji: string | null }> = {}
    for (const row of profileResult.rows) {
      profileMap[row.wallet] = { username: row.username, pfp_emoji: row.pfp_emoji ?? null }
    }

    // 4. Build response rows
    const buildEntry = (t: { wallet: string; weekly: number; all_time: number; chat_count: number }) => ({
      wallet: t.wallet,
      username: profileMap[t.wallet]?.username ?? null,
      pfpEmoji: profileMap[t.wallet]?.pfp_emoji ?? null,
      weeklyPoints: t.weekly,
      allTimePoints: t.all_time,
      breakdown: {
        chats: t.chat_count,
      },
    })

    const data = totals.map(buildEntry)

    // 5. Sort
    if (sort === 'alltime') {
      data.sort((a, b) => b.allTimePoints - a.allTimePoints)
    } else {
      data.sort((a, b) => b.weeklyPoints - a.weeklyPoints)
    }

    // 6. Find user entry before truncating, if they're outside the top N
    let userEntry = null
    if (wallet) {
      const userIdx = data.findIndex(e => e.wallet === wallet)
      if (userIdx >= LEADERBOARD_LIMIT) {
        userEntry = data[userIdx]
      }
      // If userIdx is -1 (no points) or within top N, userEntry stays null
      // (frontend handles the no-points case, and top-N users appear in data)
    }

    // 7. Truncate to top N
    const top = data.slice(0, LEADERBOARD_LIMIT)

    return NextResponse.json({
      data: top,
      userEntry,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd?.toISOString() ?? null,
      week,
    })
  } catch (err) {
    console.error('Points leaderboard error:', err)
    return NextResponse.json({ error: 'Failed to fetch points leaderboard' }, { status: 500 })
  }
}
