import { NextRequest, NextResponse } from 'next/server'
import { getCustomMarket, updateCustomMarketStatus, lockCustomMarket } from '@/lib/db'
import { isAdmin } from '@/lib/adminAuth'
import { isValidStatusTransition } from '@/lib/customMarketUtils'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const marketId = parseInt(id, 10)
  if (isNaN(marketId)) {
    return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
  }

  const body = await req.json()
  const { wallet, status } = body as { wallet?: string; status?: string }

  if (!wallet || !status) {
    return NextResponse.json({ error: 'wallet and status are required' }, { status: 400 })
  }
  if (!isAdmin(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const market = await getCustomMarket(marketId)
  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 })
  }

  if (!isValidStatusTransition(market.status, status)) {
    return NextResponse.json(
      { error: `Cannot transition from ${market.status} to ${status}` },
      { status: 400 },
    )
  }

  // Atomic lock: set lock_time + status in a single query
  if (status === 'locked') {
    const updated = await lockCustomMarket(marketId)
    return NextResponse.json({ market: updated })
  }

  const updated = await updateCustomMarketStatus(marketId, status)
  return NextResponse.json({ market: updated })
}
