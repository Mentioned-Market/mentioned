import { NextRequest } from 'next/server'
import { jupFetch, getForwardHeaders } from '@/lib/jupiterApi'

export async function GET(req: NextRequest) {
  const ownerPubkey = req.nextUrl.searchParams.get('ownerPubkey')
  if (!ownerPubkey) {
    return new Response(JSON.stringify({ error: 'ownerPubkey required' }), { status: 400 })
  }
  return jupFetch(
    `/orders?ownerPubkey=${encodeURIComponent(ownerPubkey)}`,
    undefined,
    getForwardHeaders(req)
  )
}
