import { NextRequest } from 'next/server'
import { jupFetch, getForwardHeaders } from '@/lib/jupiterApi'

export async function GET(req: NextRequest) {
  const ownerPubkey = req.nextUrl.searchParams.get('ownerPubkey')
  if (!ownerPubkey) {
    return new Response(JSON.stringify({ error: 'ownerPubkey required' }), { status: 400 })
  }

  const params = new URLSearchParams({ ownerPubkey })

  const start = req.nextUrl.searchParams.get('start')
  const end = req.nextUrl.searchParams.get('end')
  if (start) params.set('start', start)
  if (end) params.set('end', end)

  return jupFetch(
    `/history?${params.toString()}`,
    undefined,
    getForwardHeaders(req)
  )
}
