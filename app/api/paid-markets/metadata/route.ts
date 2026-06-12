import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/adminAuth'
import { upsertPaidMarketMetadata, getPaidMarketMetadata, getAllPaidMarketMetadata, getPaidMarketMetadataBySlug, setPaidMarketHidden } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const slug = searchParams.get('slug')

  if (id) {
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: 'Invalid market id' }, { status: 400 })
    }
    const meta = await getPaidMarketMetadata(BigInt(id))
    if (!meta) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(meta)
  }

  if (slug) {
    const meta = await getPaidMarketMetadataBySlug(slug)
    if (!meta) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(meta)
  }

  const all = await getAllPaidMarketMetadata()
  return NextResponse.json(all)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { wallet, marketId, title, description, coverImageUrl, streamUrl, urlPrefix, eventStartTime } = body

  if (!wallet || !isAdmin(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  if (!marketId || !/^\d+$/.test(String(marketId))) {
    return NextResponse.json({ error: 'Valid marketId is required' }, { status: 400 })
  }
  if (!title?.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  try {
    const meta = await upsertPaidMarketMetadata(BigInt(marketId), {
      title: title.trim(),
      description: description?.trim() || null,
      coverImageUrl: coverImageUrl?.trim() || null,
      streamUrl: streamUrl?.trim() || null,
      urlPrefix: urlPrefix?.trim() || null,
      eventStartTime: eventStartTime?.trim() || null,
    })
    return NextResponse.json(meta)
  } catch (err: any) {
    console.error('upsertPaidMarketMetadata error:', err)
    return NextResponse.json({ error: err?.message || 'Database error' }, { status: 500 })
  }
}

// Toggle a paid market's public visibility (admin-only).
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { wallet, marketId, hidden } = body

  if (!wallet || !isAdmin(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  if (!marketId || !/^\d+$/.test(String(marketId))) {
    return NextResponse.json({ error: 'Valid marketId is required' }, { status: 400 })
  }
  if (typeof hidden !== 'boolean') {
    return NextResponse.json({ error: 'hidden (boolean) is required' }, { status: 400 })
  }

  try {
    const meta = await setPaidMarketHidden(BigInt(marketId), hidden)
    if (!meta) return NextResponse.json({ error: 'Market not found on this cluster' }, { status: 404 })
    return NextResponse.json(meta)
  } catch (err: any) {
    console.error('setPaidMarketHidden error:', err)
    return NextResponse.json({ error: err?.message || 'Database error' }, { status: 500 })
  }
}
