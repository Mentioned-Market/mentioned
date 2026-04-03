import { NextRequest, NextResponse } from 'next/server'
import { jupFetch, getForwardHeaders } from '@/lib/jupiterApi'

export const dynamic = 'force-dynamic'

// In-memory cache with stale-while-revalidate behavior
const cache: Record<string, { data: unknown; ts: number; refreshing: boolean }> = {}
const TTL = 30_000 // 30 seconds

async function fetchFromJupiter(category: string, headers: Record<string, string>) {
  const res = await jupFetch(
    `/events?provider=polymarket&category=${encodeURIComponent(category)}`,
    undefined,
    headers,
  )
  return res.json()
}

export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get('category') || 'mentions'
  const key = `polymarket:${category}`
  const now = Date.now()
  const entry = cache[key]

  // Cache hit and fresh — return immediately
  if (entry && now - entry.ts < TTL) {
    return NextResponse.json(entry.data)
  }

  // Cache hit but stale — return stale data, refresh in background
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
