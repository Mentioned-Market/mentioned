import { NextRequest, NextResponse } from 'next/server'
import {
  getCustomMarket,
  getCustomMarketWords,
  getWordSentiment,
  updateCustomMarket,
  deleteCustomMarket,
  getCustomMarketPredictionCount,
} from '@/lib/db'
import { isAdmin } from '@/lib/adminAuth'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const marketId = parseInt(id, 10)
  if (isNaN(marketId)) {
    return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
  }

  const market = await getCustomMarket(marketId)
  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 })
  }

  const [words, sentiment, predictionCount] = await Promise.all([
    getCustomMarketWords(marketId),
    getWordSentiment(marketId),
    getCustomMarketPredictionCount(marketId),
  ])

  return NextResponse.json({ market, words, sentiment, predictionCount })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const marketId = parseInt(id, 10)
  if (isNaN(marketId)) {
    return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
  }

  const body = await req.json()
  const { wallet, ...fields } = body as {
    wallet?: string
    title?: string
    description?: string
    cover_image_url?: string
    stream_url?: string
    lock_time?: string
  }

  if (!wallet || !isAdmin(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const market = await updateCustomMarket(marketId, fields)
  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 })
  }

  return NextResponse.json({ market })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const marketId = parseInt(id, 10)
  if (isNaN(marketId)) {
    return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
  }

  const body = await req.json()
  if (!body.wallet || !isAdmin(body.wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const deleted = await deleteCustomMarket(marketId)
  if (!deleted) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
