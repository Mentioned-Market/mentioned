import { NextRequest } from 'next/server'
import { jupFetch, getForwardHeaders } from '@/lib/jupiterApi'

export async function GET(req: NextRequest) {
  const marketId = req.nextUrl.searchParams.get('marketId')
  if (!marketId) {
    return new Response(JSON.stringify({ error: 'marketId required' }), { status: 400 })
  }
  return jupFetch(
    `/orderbook/${encodeURIComponent(marketId)}`,
    undefined,
    getForwardHeaders(req)
  )
}
