import { NextRequest, NextResponse } from 'next/server'
import { getMarketResults } from '@/lib/db'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const marketId = parseInt(id, 10)
  if (isNaN(marketId)) {
    return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
  }

  try {
    const leaderboard = await getMarketResults(marketId)
    return NextResponse.json({ leaderboard })
  } catch (err) {
    console.error('Results fetch error:', err)
    return NextResponse.json({ error: 'Failed to fetch results' }, { status: 500 })
  }
}
