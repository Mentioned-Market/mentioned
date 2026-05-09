import { NextRequest, NextResponse } from 'next/server'
import {
  createMonitoredStream,
  getMonitoredStreamByEvent,
  type MonitoredStreamRow,
} from '@/lib/db'
import { isAdmin } from '@/lib/adminAuth'
import { getVerifiedWallet } from '@/lib/walletAuth'

const SUPPORTED_HOSTS = /(twitch\.tv|youtube\.com|youtu\.be)$/i

export async function GET(req: NextRequest): Promise<NextResponse> {
  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!isAdmin(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const eventId = req.nextUrl.searchParams.get('eventId')
  if (!eventId) {
    return NextResponse.json({ error: 'eventId is required' }, { status: 400 })
  }

  const row = await getMonitoredStreamByEvent(eventId)
  return NextResponse.json({ stream: row })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!isAdmin(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  let body: {
    eventId?: string
    streamUrl?: string
    workerPool?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const eventId = (body.eventId ?? '').trim()
  const streamUrl = (body.streamUrl ?? '').trim()
  const workerPool = (body.workerPool ?? 'cloud').trim() || 'cloud'

  if (!eventId) {
    return NextResponse.json({ error: 'eventId is required' }, { status: 400 })
  }
  if (!streamUrl) {
    return NextResponse.json({ error: 'streamUrl is required' }, { status: 400 })
  }

  // Light URL sanity check. Cloud workers handle twitch/youtube; local
  // workers handle local-audio:// URLs. Anything else is rejected up-front
  // rather than letting the worker fail later.
  if (!isSupportedUrl(streamUrl, workerPool)) {
    return NextResponse.json(
      {
        error:
          workerPool === 'cloud'
            ? 'streamUrl must be a twitch.tv or youtube.com URL'
            : 'streamUrl must start with local-audio:// for local workers',
      },
      { status: 400 },
    )
  }

  // Refuse if there's already an active row for this event. Caller must
  // cancel it first.
  const existing = await getMonitoredStreamByEvent(eventId)
  if (existing && (existing.status === 'pending' || existing.status === 'live')) {
    return NextResponse.json(
      {
        error: `Already monitoring this event (status=${existing.status}). Force-end before starting a new run.`,
        stream: existing,
      },
      { status: 409 },
    )
  }

  let row: MonitoredStreamRow
  try {
    row = await createMonitoredStream({ eventId, streamUrl, workerPool, createdBy: wallet })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Failed to create monitored stream: ${msg}` }, { status: 500 })
  }

  return NextResponse.json({ stream: row })
}

function isSupportedUrl(url: string, workerPool: string): boolean {
  if (workerPool === 'cloud') {
    try {
      const u = new URL(url)
      return SUPPORTED_HOSTS.test(u.hostname)
    } catch {
      return false
    }
  }
  // Local workers consume local-audio:// — opaque identifier validated
  // worker-side against env config.
  return url.startsWith('local-audio://')
}
