import { NextRequest, NextResponse } from 'next/server'
import { getCustomMarket, addCustomMarketWords, removeCustomMarketWord } from '@/lib/db'
import { isAdmin } from '@/lib/adminAuth'
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
  const { words } = body as { words?: string[] }

  if (!words || words.length === 0) {
    return NextResponse.json({ error: 'words are required' }, { status: 400 })
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

  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!isAdmin(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await req.json()
  const { wordId } = body as { wordId?: number }

  if (!wordId) {
    return NextResponse.json({ error: 'wordId is required' }, { status: 400 })
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
