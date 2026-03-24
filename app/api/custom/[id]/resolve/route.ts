import { NextRequest, NextResponse } from 'next/server'
import {
  getCustomMarket,
  getCustomMarketWords,
  resolveCustomMarketWords,
  updateCustomMarketStatus,
} from '@/lib/db'
import { isAdmin } from '@/lib/adminAuth'
import { resolveAndScoreMarket } from '@/lib/customScoring'

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
  const { wallet, resolutions } = body as {
    wallet?: string
    resolutions?: { wordId: number; outcome: boolean }[]
  }

  if (!wallet || !resolutions || resolutions.length === 0) {
    return NextResponse.json(
      { error: 'wallet and resolutions are required' },
      { status: 400 },
    )
  }
  if (!isAdmin(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const market = await getCustomMarket(marketId)
  if (!market || market.status !== 'locked') {
    return NextResponse.json(
      { error: 'Market must be locked before resolving' },
      { status: 400 },
    )
  }

  await resolveCustomMarketWords(marketId, resolutions)

  // Check if all words are now resolved
  const words = await getCustomMarketWords(marketId)
  const allResolved = words.every(w => w.resolved_outcome !== null)

  if (allResolved) {
    // CAS: only transition if still locked (prevents double-scoring on concurrent requests)
    const updated = await updateCustomMarketStatus(marketId, 'resolved', 'locked')
    if (updated) {
      // Fire-and-forget scoring (idempotent via point_events dedup)
      resolveAndScoreMarket(marketId)
        .then(results => {
          console.log(`Scored custom market ${marketId}: ${results.length} participants`)
        })
        .catch(err => console.error(`Scoring error for market ${marketId}:`, err))
    }
  }

  return NextResponse.json({
    words,
    allResolved,
    message: allResolved ? 'Market resolved, scoring in progress' : 'Words updated, awaiting remaining resolutions',
  })
}
