import { NextRequest, NextResponse } from 'next/server'
import {
  listCustomMarketsPublic,
  listCustomMarketsAdmin,
  createCustomMarket,
  addCustomMarketWords,
} from '@/lib/db'
import { isAdmin } from '@/lib/adminAuth'

export async function GET(req: NextRequest) {
  const admin = req.nextUrl.searchParams.get('admin') === 'true'
  const wallet = req.nextUrl.searchParams.get('wallet') || ''

  if (admin) {
    if (!isAdmin(wallet)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const markets = await listCustomMarketsAdmin()
    return NextResponse.json({ markets })
  }

  const markets = await listCustomMarketsPublic()
  return NextResponse.json({ markets })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { wallet, title, description, coverImageUrl, streamUrl, lockTime, words } = body as {
    wallet?: string
    title?: string
    description?: string
    coverImageUrl?: string
    streamUrl?: string
    lockTime?: string
    words?: string[]
  }

  if (!wallet || !title) {
    return NextResponse.json({ error: 'wallet and title are required' }, { status: 400 })
  }
  if (!isAdmin(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const market = await createCustomMarket(
    title,
    description ?? null,
    coverImageUrl ?? null,
    streamUrl ?? null,
    lockTime ?? null,
  )

  let marketWords: any[] = []
  if (words && words.length > 0) {
    marketWords = await addCustomMarketWords(market.id, words)
  }

  return NextResponse.json({ market, words: marketWords }, { status: 201 })
}
