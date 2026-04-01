import { NextRequest, NextResponse } from 'next/server'
import {
  getCustomMarket,
  getCustomMarketWords,
  resolveCustomMarketWords,
  updateCustomMarketStatus,
} from '@/lib/db'
import { isAdmin } from '@/lib/adminAuth'
import { resolveWordPositions, resolveAndScoreVirtualMarket } from '@/lib/customScoring'
import { getVerifiedWallet } from '@/lib/walletAuth'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const marketId = parseInt(id, 10)
  if (isNaN(marketId)) {
    return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
  }

  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!isAdmin(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await req.json()
  const { resolutions } = body as {
    resolutions?: { wordId: number; outcome: boolean }[]
  }

  if (!resolutions || resolutions.length === 0) {
    return NextResponse.json(
      { error: 'resolutions are required' },
      { status: 400 },
    )
  }

  let market, words
  try {
    market = await getCustomMarket(marketId)
  } catch (err: any) {
    console.error('Resolve: failed to fetch market', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  if (!market || market.status !== 'locked') {
    return NextResponse.json(
      { error: 'Market must be locked before resolving' },
      { status: 400 },
    )
  }

  try {
    await resolveCustomMarketWords(marketId, resolutions)

    // Compute payouts for each resolved word
    for (const { wordId, outcome } of resolutions) {
      await resolveWordPositions(marketId, wordId, outcome ? 'YES' : 'NO')
    }

    // Check if all words are now resolved
    words = await getCustomMarketWords(marketId)
  } catch (err: any) {
    console.error('Resolve: error during resolution', err)
    return NextResponse.json({ error: err.message || 'Failed to resolve words' }, { status: 500 })
  }

  const allResolved = words.every(w => w.resolved_outcome !== null)

  if (allResolved) {
    // CAS: only transition if still locked (prevents double-scoring on concurrent requests)
    const updated = await updateCustomMarketStatus(marketId, 'resolved', 'locked')
    if (updated) {
      // Fire-and-forget scoring (idempotent via point_events dedup)
      resolveAndScoreVirtualMarket(marketId)
        .then(() => console.log(`Scored virtual market ${marketId}`))
        .catch(err => console.error(`Scoring error for market ${marketId}:`, err))
    }
  }

  return NextResponse.json({
    words,
    allResolved,
    message: allResolved ? 'Market resolved, scoring in progress' : 'Words updated, awaiting remaining resolutions',
  })
}
