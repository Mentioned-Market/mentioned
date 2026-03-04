import { NextRequest } from 'next/server'
import { jupFetch, getForwardHeaders } from '@/lib/jupiterApi'

export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get('category') || 'esports'
  return jupFetch(
    `/events?provider=polymarket&category=${encodeURIComponent(category)}`,
    undefined,
    getForwardHeaders(req)
  )
}
