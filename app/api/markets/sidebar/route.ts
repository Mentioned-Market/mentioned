import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { getWeekStart } from '@/lib/points'

export const dynamic = 'force-dynamic'

// 5-minute cache — sidebar data doesn't need to be real-time
let cachedData: unknown = null
let cacheExpires = 0
const CACHE_TTL = 5 * 60 * 1000

export async function GET() {
  if (cachedData && Date.now() < cacheExpires) {
    return NextResponse.json(cachedData)
  }

  const weekStart = getWeekStart()

  const [tradersResult, wordsResult] = await Promise.all([
    pool.query<{
      wallet: string
      weekly_points: string
      username: string | null
      pfp_emoji: string | null
    }>(
      `SELECT pe.wallet, SUM(pe.points)::int AS weekly_points,
              up.username, up.pfp_emoji
       FROM point_events pe
       LEFT JOIN user_profiles up ON up.wallet = pe.wallet
       WHERE pe.created_at >= $1
       GROUP BY pe.wallet, up.username, up.pfp_emoji
       ORDER BY weekly_points DESC
       LIMIT 5`,
      [weekStart],
    ),

    pool.query<{
      word: string
      market_title: string
      slug: string
      trade_count: number
    }>(
      `SELECT w.word, m.title AS market_title, m.slug,
              COUNT(t.id)::int AS trade_count
       FROM custom_market_trades t
       JOIN custom_market_words w ON w.id = t.word_id
       JOIN custom_markets m ON m.id = t.market_id
       WHERE t.created_at > NOW() - INTERVAL '7 days'
         AND m.status IN ('open', 'locked')
       GROUP BY w.word, m.title, m.slug
       ORDER BY trade_count DESC
       LIMIT 8`,
    ),
  ])

  const data = {
    topTraders: tradersResult.rows.map(r => ({
      wallet: r.wallet,
      username: r.username,
      pfpEmoji: r.pfp_emoji,
      weeklyPoints: Number(r.weekly_points),
    })),
    trendingWords: wordsResult.rows,
    weekStart: weekStart.toISOString(),
  }

  cachedData = data
  cacheExpires = Date.now() + CACHE_TTL

  return NextResponse.json(data)
}
