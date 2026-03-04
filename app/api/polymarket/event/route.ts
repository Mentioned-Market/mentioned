import { NextRequest } from 'next/server'
import { jupFetch, getForwardHeaders } from '@/lib/jupiterApi'

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('eventId')
  if (!eventId) {
    return new Response(JSON.stringify({ error: 'eventId required' }), { status: 400 })
  }
  return jupFetch(
    `/events/${encodeURIComponent(eventId)}?includeMarkets=true`,
    undefined,
    getForwardHeaders(req)
  )
}
