import { NextRequest, NextResponse } from 'next/server'
import { getCustomMarketBySlug } from '@/lib/db'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  if (!slug) {
    return NextResponse.json({ error: 'slug is required' }, { status: 400 })
  }

  const market = await getCustomMarketBySlug(slug)
  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 })
  }

  return NextResponse.json({ id: market.id })
}
