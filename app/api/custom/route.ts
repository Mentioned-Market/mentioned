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
  const { title, description, coverImageUrl, streamUrl, lockTime, bParameter, playTokens, words, urlPrefix, marketType, eventStartTime } = body as {
    title?: string
    description?: string
    coverImageUrl?: string
    streamUrl?: string
    lockTime?: string
    bParameter?: number
    playTokens?: number
    words?: string[]
    urlPrefix?: string
    marketType?: string
    eventStartTime?: string
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

  const mType = marketType === 'event' ? 'event' : 'continuous'

  const market = await createCustomMarket(
    title,
    description ?? null,
    coverImageUrl ?? null,
    streamUrl ?? null,
    lockTime ?? null,
    b,
    tokens,
    trimmedPrefix,
    mType,
    eventStartTime ?? null,
  )

  let marketWords: any[] = []
  if (words && words.length > 0) {
    marketWords = await addCustomMarketWords(market.id, words)
  }

  // Fire-and-forget: notify Discord new-markets channel
  const webhookUrl = process.env.DISCORD_NEW_MARKET_WEBHOOK_URL
  if (webhookUrl) {
    const wordList = marketWords.length > 0
      ? marketWords.map((w: { word: string }) => `\`${w.word}\``).join(', ')
      : '_No words added yet_'
    const marketUrl = `https://mentioned.market/custom/${market.slug}`
    const embed = {
      title: `🆕 New Market: ${market.title}`,
      description: market.description ?? undefined,
      url: marketUrl,
      color: 0x007AFF,
      fields: [
        { name: 'Words', value: wordList, inline: false },
        { name: 'Play Tokens', value: String(tokens), inline: true },
        ...(market.lock_time ? [{ name: 'Locks At', value: new Date(market.lock_time).toUTCString(), inline: false }] : []),
      ],
      timestamp: new Date().toISOString(),
    }
    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ embeds: [embed] }),
    }).catch((err) => console.error('New market Discord notification failed:', err))
  }

  return NextResponse.json({ market, words: marketWords }, { status: 201 })
}
