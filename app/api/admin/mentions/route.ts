import { NextRequest, NextResponse } from 'next/server'
import { getMentionsForStream } from '@/lib/db'
import { isAdmin } from '@/lib/adminAuth'
import { getVerifiedWallet } from '@/lib/walletAuth'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!isAdmin(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const streamIdRaw = req.nextUrl.searchParams.get('streamId')
  const streamId = streamIdRaw ? parseInt(streamIdRaw, 10) : NaN
  if (!Number.isFinite(streamId) || streamId <= 0) {
    return NextResponse.json({ error: 'streamId is required' }, { status: 400 })
  }

  const words = await getMentionsForStream(streamId)
  if (words === null) {
    return NextResponse.json({ error: 'Stream not found' }, { status: 404 })
  }
  return NextResponse.json({ words })
}
