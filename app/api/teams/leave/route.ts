import { NextRequest, NextResponse } from 'next/server'
import { leaveTeam } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const { wallet } = await req.json()

    if (!wallet || typeof wallet !== 'string') {
      return NextResponse.json({ error: 'wallet is required' }, { status: 400 })
    }

    await leaveTeam(wallet)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Team leave error:', err)
    return NextResponse.json({ error: 'Failed to leave team' }, { status: 500 })
  }
}
