import { NextRequest, NextResponse } from 'next/server'
import { cancelMonitoredStream, pool } from '@/lib/db'
import { isAdmin } from '@/lib/adminAuth'
import { getVerifiedWallet } from '@/lib/walletAuth'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params
  const streamId = parseInt(id, 10)
  if (!Number.isFinite(streamId)) {
    return NextResponse.json({ error: 'Invalid stream id' }, { status: 400 })
  }

  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!isAdmin(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  // Verify the row exists and is in a state where canceling makes sense.
  const existing = await pool.query<{ status: string }>(
    `SELECT status FROM monitored_streams WHERE id = $1`,
    [streamId],
  )
  if (existing.rowCount === 0) {
    return NextResponse.json({ error: 'Stream not found' }, { status: 404 })
  }
  const status = existing.rows[0].status
  if (status !== 'pending' && status !== 'live') {
    return NextResponse.json(
      { error: `Stream is already ${status}; nothing to cancel` },
      { status: 409 },
    )
  }

  await cancelMonitoredStream(streamId)
  return NextResponse.json({ ok: true })
}
