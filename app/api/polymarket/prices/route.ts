import { NextRequest, NextResponse } from 'next/server'

// Cache token IDs for 1 hour (they don't change)
const tokenCache = new Map<string, { yesToken: string; noToken: string; fetchedAt: number }>()
const TOKEN_CACHE_TTL = 60 * 60 * 1000

async function getClobTokenIds(marketId: string): Promise<{ yesToken: string; noToken: string } | null> {
  const cached = tokenCache.get(marketId)
  if (cached && Date.now() - cached.fetchedAt < TOKEN_CACHE_TTL) {
    return { yesToken: cached.yesToken, noToken: cached.noToken }
  }

  // Extract numeric ID from POLY-XXXXX or POLY-XXXXX-N format
  const match = marketId.match(/POLY-(\d+)/)
  if (!match) return null
  const numericId = match[1]

  try {
    const res = await fetch(`https://gamma-api.polymarket.com/markets/${numericId}`)
    if (!res.ok) return null
    const data = await res.json()

    const tokens = JSON.parse(data.clobTokenIds || '[]')
    if (tokens.length < 2) return null

    const result = { yesToken: tokens[0], noToken: tokens[1], fetchedAt: Date.now() }
    tokenCache.set(marketId, result)
    return { yesToken: result.yesToken, noToken: result.noToken }
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const marketId = req.nextUrl.searchParams.get('marketId')
  if (!marketId) {
    return NextResponse.json({ error: 'marketId required' }, { status: 400 })
  }

  const tokens = await getClobTokenIds(marketId)
  if (!tokens) {
    return NextResponse.json({ error: 'Could not resolve token IDs' }, { status: 404 })
  }

  const interval = req.nextUrl.searchParams.get('interval') || 'max'
  const fidelity = req.nextUrl.searchParams.get('fidelity') || '60'

  try {
    const res = await fetch(
      `https://clob.polymarket.com/prices-history?market=${tokens.yesToken}&interval=${interval}&fidelity=${fidelity}`
    )
    if (!res.ok) {
      return NextResponse.json({ error: 'Polymarket API error' }, { status: res.status })
    }
    const data = await res.json()
    return NextResponse.json({
      marketId,
      history: data.history || data || [],
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch price history' }, { status: 500 })
  }
}
