import { NextRequest, NextResponse } from 'next/server'
import { getTeamByWallet } from '@/lib/db'

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet')
  if (!wallet) return NextResponse.json({ team: null })

  try {
    const team = await getTeamByWallet(wallet)
    return NextResponse.json({ team })
  } catch (err) {
    console.error('My team error:', err)
    return NextResponse.json({ error: 'Failed to fetch team' }, { status: 500 })
  }
}
