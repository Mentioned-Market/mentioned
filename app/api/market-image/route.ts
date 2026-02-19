import { NextRequest, NextResponse } from 'next/server'
import { getMarketImage, getMarketImages, upsertMarketImage } from '@/lib/db'

export async function GET(req: NextRequest) {
  const marketId = req.nextUrl.searchParams.get('marketId')
  const marketIds = req.nextUrl.searchParams.get('marketIds')

  // Batch mode: ?marketIds=1,2,3
  if (marketIds) {
    const ids = marketIds.split(',').map((s) => s.trim()).filter(Boolean)
    const images = await getMarketImages(ids)
    return NextResponse.json({ images })
  }

  // Single mode: ?marketId=1
  if (!marketId) {
    return NextResponse.json({ error: 'marketId or marketIds is required' }, { status: 400 })
  }

  const imageUrl = await getMarketImage(marketId)
  return NextResponse.json({ imageUrl })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { marketId, imageUrl } = body

  if (!marketId || !imageUrl) {
    return NextResponse.json(
      { error: 'marketId and imageUrl are required' },
      { status: 400 },
    )
  }

  await upsertMarketImage(String(marketId), imageUrl)
  return NextResponse.json({ ok: true })
}
