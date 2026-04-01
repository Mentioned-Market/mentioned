import { NextRequest, NextResponse } from 'next/server'
import {
  listCustomMarketsPublic,
  listCustomMarketsAdmin,
  createCustomMarket,
  addCustomMarketWords,
} from '@/lib/db'
import { isAdmin } from '@/lib/adminAuth'
import { getVerifiedWallet } from '@/lib/walletAuth'

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
  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!isAdmin(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await req.json()
  const { title, description, coverImageUrl, streamUrl, lockTime, bParameter, playTokens, words, urlPrefix } = body as {
    title?: string
    description?: string
    coverImageUrl?: string
    streamUrl?: string
    lockTime?: string
    bParameter?: number
    playTokens?: number
    words?: string[]
    urlPrefix?: string
  }

  if (!title || !urlPrefix?.trim()) {
    return NextResponse.json({ error: 'title and urlPrefix are required' }, { status: 400 })
  }

  const b = bParameter ?? 500
  if (typeof b !== 'number' || b < 10 || b > 10000) {
    return NextResponse.json({ error: 'bParameter must be between 10 and 10000' }, { status: 400 })
  }
  const tokens = playTokens ?? 1000
  if (typeof tokens !== 'number' || tokens < 100 || tokens > 10000) {
    return NextResponse.json({ error: 'playTokens must be between 100 and 10000' }, { status: 400 })
  }

  const trimmedPrefix = urlPrefix!.trim().toUpperCase()
  if (!/^[A-Z0-9]+$/.test(trimmedPrefix)) {
    return NextResponse.json({ error: 'URL prefix must contain only letters and numbers' }, { status: 400 })
  }

  const market = await createCustomMarket(
    title,
    description ?? null,
    coverImageUrl ?? null,
    streamUrl ?? null,
    lockTime ?? null,
    b,
    tokens,
    trimmedPrefix,
  )

  let marketWords: any[] = []
  if (words && words.length > 0) {
    marketWords = await addCustomMarketWords(market.id, words)
  }

  return NextResponse.json({ market, words: marketWords }, { status: 201 })
}
