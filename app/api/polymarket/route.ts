import { NextRequest, NextResponse } from 'next/server'
import { jupFetch, getForwardHeaders } from '@/lib/jupiterApi'

export const dynamic = 'force-dynamic'

// In-memory cache with stale-while-revalidate behavior
const cache: Record<string, { data: unknown; ts: number; refreshing: boolean }> = {}
const TTL = 30_000       // serve from cache without revalidating
const MAX_STALE = 120_000 // beyond this, block on fresh fetch instead of serving stale

async function fetchFromJupiter(category: string, headers: Record<string, string>) {
  const res = await jupFetch(
    `/events?provider=polymarket&category=${encodeURIComponent(category)}`,
    undefined,
    headers,
  )
  return res.json()
}

const ALLOWED_CATEGORIES = new Set(['mentions', 'sports', 'crypto', 'politics', 'culture', 'news'])

export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get('category') || 'mentions'
  if (!ALLOWED_CATEGORIES.has(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }
  const key = `polymarket:${category}`
  const now = Date.now()
  const entry = cache[key]

  // Cache hit and fresh — return immediately
  if (entry && now - entry.ts < TTL) {
    return NextResponse.json(entry.data)
  }

  // Cache hit but too old — treat as cache miss, block on fresh fetch
  if (entry && now - entry.ts >= MAX_STALE) {
    const data = await fetchFromJupiter(category, getForwardHeaders(req))
    cache[key] = { data, ts: Date.now(), refreshing: false }
    return NextResponse.json(data)
  }

  // Cache hit, stale but within MAX_STALE — return stale, refresh in background
  if (entry && !entry.refreshing) {
    entry.refreshing = true
    fetchFromJupiter(category, getForwardHeaders(req))
      .then(data => { cache[key] = { data, ts: Date.now(), refreshing: false } })
      .catch(() => { entry.refreshing = false })
    return NextResponse.json(entry.data)
  }

  // Cache miss — block on fetch
  const data = await fetchFromJupiter(category, getForwardHeaders(req))
  cache[key] = { data, ts: now, refreshing: false }
  return NextResponse.json(data)
}
