import { NextRequest, NextResponse } from 'next/server'
import { resolveMarketAtomic, logAdminAction } from '@/lib/db'
import { isAdmin } from '@/lib/adminAuth'
import { resolveAndScoreVirtualMarket } from '@/lib/customScoring'
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

  try {
    const { words, allResolved, statusUpdated } = await resolveMarketAtomic(marketId, resolutions)

    logAdminAction(wallet, 'resolve_market', String(marketId), { resolutions, allResolved })

    if (allResolved && statusUpdated) {
      // Fire-and-forget scoring (idempotent via point_events dedup)
      resolveAndScoreVirtualMarket(marketId)
        .then(() => console.log(`Scored virtual market ${marketId}`))
        .catch(err => console.error(`Scoring error for market ${marketId}:`, err))
    }

    return NextResponse.json({
      words,
      allResolved,
      message: allResolved ? 'Market resolved, scoring in progress' : 'Words updated, awaiting remaining resolutions',
    })
  } catch (err: any) {
    console.error('Resolve: error during resolution', err)
    const status = err.message?.includes('must be open or locked') ? 400 : 500
    return NextResponse.json({ error: err.message || 'Failed to resolve' }, { status })
  }
}
