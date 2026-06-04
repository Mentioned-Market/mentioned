import { NextRequest, NextResponse } from 'next/server'
import { listMarketSeries, type ListMarketSeriesFilters } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const q = sp.get('q')?.slice(0, 64) || undefined
  const sortRaw = sp.get('sort')
  const sort: ListMarketSeriesFilters['sort'] =
    sortRaw === 'recent' || sortRaw === 'markets' || sortRaw === 'volume' ? sortRaw : 'recent'
  const limit = Math.min(Math.max(parseInt(sp.get('limit') || '100', 10) || 100, 1), 300)

  try {
    const series = await listMarketSeries({ q, sort, limit })
    return NextResponse.json({ series })
  } catch (err) {
    console.error('GET /api/knowledge error:', err)
    return NextResponse.json({ error: 'Failed to load market series' }, { status: 500 })
  }
}
