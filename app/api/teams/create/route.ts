import { NextRequest, NextResponse } from 'next/server'
import { createTeam } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const { name, wallet } = await req.json()

    if (!name || typeof name !== 'string' || !wallet || typeof wallet !== 'string') {
      return NextResponse.json({ error: 'name and wallet are required' }, { status: 400 })
    }

    const trimmed = name.trim()
    if (trimmed.length < 2 || trimmed.length > 30) {
      return NextResponse.json({ error: 'Team name must be 2–30 characters' }, { status: 400 })
    }

    const team = await createTeam(trimmed, wallet)
    return NextResponse.json({ team })
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === 'ALREADY_IN_TEAM') {
        return NextResponse.json({ error: 'You are already in a team' }, { status: 409 })
      }
      if (err.message.includes('teams_name_key') || err.message.includes('unique')) {
        return NextResponse.json({ error: 'That team name is already taken' }, { status: 409 })
      }
    }
    console.error('Team create error:', err)
    return NextResponse.json({ error: 'Failed to create team' }, { status: 500 })
  }
}
