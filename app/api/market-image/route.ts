import { NextRequest, NextResponse } from 'next/server'
import { getMarketImage, getMarketImages, getAllMarketImages, upsertMarketImage } from '@/lib/db'

export async function GET(req: NextRequest) {
  const marketId = req.nextUrl.searchParams.get('marketId')
  const marketIds = req.nextUrl.searchParams.get('marketIds')

  // All mode: no params — return every market image
  if (!marketId && !marketIds) {
    const images = await getAllMarketImages()
    return NextResponse.json({ images })
  }

  // Batch mode: ?marketIds=1,2,3
  if (marketIds) {
    const ids = marketIds.split(',').map((s) => s.trim()).filter(Boolean)
    const images = await getMarketImages(ids)
    return NextResponse.json({ images })
  }

  // Single mode: ?marketId=1
  const imageUrl = await getMarketImage(marketId!)
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
