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

  // Pending rows have no spawned worker yet — the worker's onStreamCanceled
  // handler early-returns when there's no active StreamWorker, so a NOTIFY
  // alone would leave the row stuck in 'pending'. UPDATE directly here. The
  // CAS clause races safely with the worker's own pending→live CAS: if we
  // win, the worker's claim affects 0 rows and bails out; if the worker
  // wins, our UPDATE affects 0 rows and we fall through to the NOTIFY path
  // below so its stop() handles the live teardown.
  if (status === 'pending') {
    const cancelRes = await pool.query(
      `UPDATE monitored_streams
          SET status = 'ended',
              ended_at = NOW(),
              updated_at = NOW()
        WHERE id = $1 AND status = 'pending'`,
      [streamId],
    )
    if ((cancelRes.rowCount ?? 0) > 0) {
      return NextResponse.json({ ok: true })
    }
    // Lost the race — row is now 'live'. Fall through to the NOTIFY path.
  }

  await cancelMonitoredStream(streamId)
  return NextResponse.json({ ok: true })
}
