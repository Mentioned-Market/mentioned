import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/adminAuth'
import { upsertPaidMarketMetadata, getPaidMarketMetadata, getAllPaidMarketMetadata } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (id) {
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: 'Invalid market id' }, { status: 400 })
    }
    const meta = await getPaidMarketMetadata(BigInt(id))
    if (!meta) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(meta)
  }

  const all = await getAllPaidMarketMetadata()
  return NextResponse.json(all)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { wallet, marketId, title, description, coverImageUrl, streamUrl } = body

  if (!wallet || !isAdmin(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  if (!marketId || !/^\d+$/.test(String(marketId))) {
    return NextResponse.json({ error: 'Valid marketId is required' }, { status: 400 })
  }
  if (!title?.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const meta = await upsertPaidMarketMetadata(BigInt(marketId), {
    title: title.trim(),
    description: description?.trim() || null,
    coverImageUrl: coverImageUrl?.trim() || null,
    streamUrl: streamUrl?.trim() || null,
  })

  return NextResponse.json(meta)
}
