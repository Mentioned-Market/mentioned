import { NextRequest, NextResponse } from 'next/server'
import { createTeam } from '@/lib/db'

function isValidWallet(w: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w)
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

export async function POST(req: NextRequest) {
  try {
    const { name, wallet } = await req.json()

    if (!name || typeof name !== 'string' || !wallet || typeof wallet !== 'string') {
      return NextResponse.json({ error: 'name and wallet are required' }, { status: 400 })
    }
    if (!isValidWallet(wallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 })
    }

    const trimmed = name.replace(CONTROL_CHARS, '').trim()
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
      if (err.message === 'DISCORD_REQUIRED') {
        return NextResponse.json({ error: 'You must link your Discord account before creating a team' }, { status: 403 })
      }
      if (err.message === 'DISCORD_TOO_NEW') {
        return NextResponse.json({ error: 'Your Discord account must be at least 30 days old to create a team' }, { status: 403 })
      }
      if (err.message.includes('teams_name_key') || err.message.includes('unique')) {
        return NextResponse.json({ error: 'That team name is already taken' }, { status: 409 })
      }
    }
    console.error('Team create error:', err)
    return NextResponse.json({ error: 'Failed to create team' }, { status: 500 })
  }
}
