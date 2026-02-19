import { NextRequest, NextResponse } from 'next/server'
import { getVolumeByMarkets } from '@/lib/db'

export async function GET(req: NextRequest) {
  const marketIds = req.nextUrl.searchParams.get('marketIds')
  if (!marketIds) {
    return NextResponse.json({ error: 'marketIds is required' }, { status: 400 })
  }

  const ids = marketIds.split(',').map((s) => s.trim()).filter(Boolean)
  const volumes = await getVolumeByMarkets(ids)
  return NextResponse.json({ volumes })
}
