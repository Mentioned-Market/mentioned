import { NextRequest } from 'next/server'
import { jupFetch } from '@/lib/jupiterApi'

export async function GET(req: NextRequest) {
  const ownerPubkey = req.nextUrl.searchParams.get('ownerPubkey')
  const marketId = req.nextUrl.searchParams.get('marketId')

  const params = new URLSearchParams()
  if (ownerPubkey) params.set('ownerPubkey', ownerPubkey)
  if (marketId) params.set('marketId', marketId)

  return jupFetch(`/positions?${params.toString()}`)
}
