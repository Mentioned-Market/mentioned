import { NextResponse } from 'next/server'
import { getTeamLeaderboard } from '@/lib/db'
import { COMP_START, COMP_END } from '@/lib/teamComp'

export async function GET() {
  try {
    const entries = await getTeamLeaderboard(COMP_START, COMP_END)
    return NextResponse.json({ data: entries, compStart: COMP_START.toISOString(), compEnd: COMP_END.toISOString() })
  } catch (err) {
    console.error('Team leaderboard error:', err)
    return NextResponse.json({ error: 'Failed to fetch team leaderboard' }, { status: 500 })
  }
}
