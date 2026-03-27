import { NextRequest, NextResponse } from 'next/server'
import { getCustomMarket, addCustomMarketWords, removeCustomMarketWord } from '@/lib/db'
import { isAdmin } from '@/lib/adminAuth'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const marketId = parseInt(id, 10)
  if (isNaN(marketId)) {
    return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
  }

  const body = await req.json()
  const { wallet, words } = body as { wallet?: string; words?: string[] }

  if (!wallet || !words || words.length === 0) {
    return NextResponse.json({ error: 'wallet and words are required' }, { status: 400 })
  }
  if (!isAdmin(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const market = await getCustomMarket(marketId)
  if (!market || market.status !== 'draft') {
    return NextResponse.json(
      { error: 'Words can only be added to draft markets' },
      { status: 400 },
    )
  }

  const added = await addCustomMarketWords(marketId, words)
  return NextResponse.json({ words: added }, { status: 201 })
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
  const { wallet, wordId } = body as { wallet?: string; wordId?: number }

  if (!wallet || !wordId) {
    return NextResponse.json({ error: 'wallet and wordId are required' }, { status: 400 })
  }
  if (!isAdmin(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const market = await getCustomMarket(marketId)
  if (!market || market.status !== 'draft') {
    return NextResponse.json(
      { error: 'Words can only be removed from draft markets' },
      { status: 400 },
    )
  }

  const removed = await removeCustomMarketWord(marketId, wordId)
  if (!removed) {
    return NextResponse.json({ error: 'Word not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
