import { NextRequest, NextResponse } from 'next/server'
import { pool, getBulkPointTotals } from '@/lib/db'
import { getWeekStart } from '@/lib/points'

export async function GET(req: NextRequest) {
  const sort = req.nextUrl.searchParams.get('sort') ?? 'weekly'
  const weekStart = getWeekStart()

  try {
    // 1. Get all wallets with point events
    const walletsResult = await pool.query(
      `SELECT DISTINCT wallet FROM point_events`,
    )
    const wallets: string[] = walletsResult.rows.map((r: { wallet: string }) => r.wallet)

    if (wallets.length === 0) {
      return NextResponse.json({ data: [], weekStart: weekStart.toISOString() })
    }

    // 2. Aggregate point totals in one query
    const totals = await getBulkPointTotals(wallets, weekStart)

    // 3. Fetch usernames
    const profileResult = await pool.query(
      `SELECT wallet, username FROM user_profiles WHERE wallet = ANY($1)`,
      [wallets],
    )
    const usernameMap: Record<string, string> = {}
    for (const row of profileResult.rows) {
      usernameMap[row.wallet] = row.username
    }

    // 4. Build response rows
    const data = totals.map((t) => ({
      wallet: t.wallet,
      username: usernameMap[t.wallet] ?? null,
      weeklyPoints: t.weekly,
      allTimePoints: t.all_time,
      breakdown: {
        trades: t.trade_count,
        wins: t.win_count,
        chats: t.chat_count,
        holds: t.hold_count,
      },
    }))

    // 5. Sort
    if (sort === 'alltime') {
      data.sort((a, b) => b.allTimePoints - a.allTimePoints)
    } else {
      data.sort((a, b) => b.weeklyPoints - a.weeklyPoints)
    }

    return NextResponse.json({ data, weekStart: weekStart.toISOString() })
  } catch (err) {
    console.error('Points leaderboard error:', err)
    return NextResponse.json({ error: 'Failed to fetch points leaderboard' }, { status: 500 })
  }
}
