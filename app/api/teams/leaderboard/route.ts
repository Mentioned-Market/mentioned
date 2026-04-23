import { NextResponse } from 'next/server'
import { getTeamLeaderboard } from '@/lib/db'
import { getWeekStart } from '@/lib/points'

export async function GET() {
  try {
    const weekStart = getWeekStart()
    const entries = await getTeamLeaderboard(weekStart)
    return NextResponse.json({ data: entries, weekStart: weekStart.toISOString() })
  } catch (err) {
    console.error('Team leaderboard error:', err)
    return NextResponse.json({ error: 'Failed to fetch team leaderboard' }, { status: 500 })
  }
}
