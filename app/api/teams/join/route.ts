import { NextRequest, NextResponse } from 'next/server'
import { joinTeam } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const { code, wallet } = await req.json()

    if (!code || typeof code !== 'string' || !wallet || typeof wallet !== 'string') {
      return NextResponse.json({ error: 'code and wallet are required' }, { status: 400 })
    }

    const team = await joinTeam(code.trim(), wallet)
    return NextResponse.json({ team })
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === 'ALREADY_IN_TEAM') {
        return NextResponse.json({ error: 'You are already in a team' }, { status: 409 })
      }
      if (err.message === 'INVALID_CODE') {
        return NextResponse.json({ error: 'Invalid join code' }, { status: 404 })
      }
      if (err.message === 'TEAM_FULL') {
        return NextResponse.json({ error: 'This team is full (max 3 members)' }, { status: 409 })
      }
    }
    console.error('Team join error:', err)
    return NextResponse.json({ error: 'Failed to join team' }, { status: 500 })
  }
}
