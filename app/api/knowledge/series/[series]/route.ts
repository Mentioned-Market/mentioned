import { NextRequest, NextResponse } from 'next/server'
import { getSeriesDetail } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { series: string } }) {
  const decoded = decodeURIComponent(params.series || '').slice(0, 64)
  if (!decoded.trim()) {
    return NextResponse.json({ error: 'Series required' }, { status: 400 })
  }
  try {
    const detail = await getSeriesDetail(decoded)
    if (!detail) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 })
    }
    return NextResponse.json(detail)
  } catch (err) {
    console.error('GET /api/knowledge/series/[series] error:', err)
    return NextResponse.json({ error: 'Failed to load series detail' }, { status: 500 })
  }
}
