import { NextRequest, NextResponse } from 'next/server'
import { getTeamBySlug, getTeamMembers, getTeamMemberPointTotals } from '@/lib/db'
import { getWeekStart } from '@/lib/points'

export async function GET(
  _req: NextRequest,
  { params }: { params: { name: string } },
) {
  const slug = params.name
  if (!slug) return NextResponse.json({ error: 'Invalid team name' }, { status: 400 })

  try {
    const weekStart = getWeekStart()
    const team = await getTeamBySlug(slug)

    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

    const [members, memberPoints] = await Promise.all([
      getTeamMembers(team.id),
      getTeamMemberPointTotals(team.id, weekStart),
    ])

    const pointMap = new Map(memberPoints.map(m => [m.wallet, m]))

    const membersWithPoints = members.map(m => ({
      ...m,
      weekly_points: pointMap.get(m.wallet)?.weekly ?? 0,
      all_time_points: pointMap.get(m.wallet)?.all_time ?? 0,
    }))

    const weeklyTotal = membersWithPoints.reduce((s, m) => s + m.weekly_points, 0)
    const allTimeTotal = membersWithPoints.reduce((s, m) => s + m.all_time_points, 0)

    return NextResponse.json({
      team,
      members: membersWithPoints,
      weeklyTotal,
      allTimeTotal,
      weekStart: weekStart.toISOString(),
    })
  } catch (err) {
    console.error('Team profile error:', err)
    return NextResponse.json({ error: 'Failed to fetch team' }, { status: 500 })
  }
}
