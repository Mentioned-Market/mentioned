import { NextRequest, NextResponse } from 'next/server'
import { getUserPredictions } from '@/lib/db'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const marketId = parseInt(id, 10)
  if (isNaN(marketId)) {
    return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
  }

  const wallet = req.nextUrl.searchParams.get('wallet')
  if (!wallet) {
    return NextResponse.json({ error: 'wallet is required' }, { status: 400 })
  }

  const predictions = await getUserPredictions(marketId, wallet)
  return NextResponse.json({ predictions })
}
