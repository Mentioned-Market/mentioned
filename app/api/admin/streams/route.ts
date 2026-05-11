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
    kind?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const eventId = (body.eventId ?? '').trim()
  const streamUrl = (body.streamUrl ?? '').trim()
  const workerPool = (body.workerPool ?? 'cloud').trim() || 'cloud'
  const kindRaw = (body.kind ?? 'live').trim()
  const kind: 'live' | 'vod' = kindRaw === 'vod' ? 'vod' : 'live'

  if (!eventId) {
    return NextResponse.json({ error: 'eventId is required' }, { status: 400 })
  }
  if (!streamUrl) {
    return NextResponse.json({ error: 'streamUrl is required' }, { status: 400 })
  }

  // VOD jobs only run on the cloud worker — Deepgram fetches the file
  // itself, no local audio device involved.
  if (kind === 'vod' && workerPool !== 'cloud') {
    return NextResponse.json(
      { error: "VOD jobs must use workerPool='cloud'" },
      { status: 400 },
    )
  }

  // URL validation differs per (kind, workerPool):
  //  - live + cloud  → twitch.tv/<channel> or youtube.com (no /videos/<id>)
  //  - live + local  → local-audio://...
  //  - vod  + cloud  → twitch.tv/videos/<id> or youtube.com/watch?v=<id>
  if (!isSupportedUrl(streamUrl, workerPool, kind)) {
    return NextResponse.json(
      { error: explainUnsupportedUrl(streamUrl, workerPool, kind) },
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
    row = await createMonitoredStream({ eventId, streamUrl, workerPool, kind, createdBy: wallet })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Failed to create monitored stream: ${msg}` }, { status: 500 })
  }

  return NextResponse.json({ stream: row })
}

function explainUnsupportedUrl(url: string, workerPool: string, kind: 'live' | 'vod'): string {
  if (workerPool !== 'cloud') {
    return 'streamUrl must start with local-audio:// for local workers'
  }
  try {
    const u = new URL(url)
    if (kind === 'live') {
      if (/(^|\.)twitch\.tv$/i.test(u.hostname) && /^\/videos(\/|$)/i.test(u.pathname)) {
        return 'Twitch VODs (twitch.tv/videos/...) cannot be monitored as live streams — switch the kind to "VOD" or use a live channel URL like twitch.tv/<channel>.'
      }
      return 'streamUrl must be a live twitch.tv/<channel> or youtube.com URL'
    }
    // kind === 'vod'
    return 'streamUrl must be a Twitch VOD (twitch.tv/videos/<id>) or YouTube watch URL'
  } catch {
    return 'streamUrl is not a valid URL'
  }
}

function isSupportedUrl(url: string, workerPool: string, kind: 'live' | 'vod'): boolean {
  if (workerPool !== 'cloud') {
    return url.startsWith('local-audio://')
  }
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (!SUPPORTED_HOSTS.test(u.hostname)) return false

  if (kind === 'live') {
    // Reject Twitch VODs from the live path — the streaming pipeline
    // assumes real-time audio.
    if (/(^|\.)twitch\.tv$/i.test(u.hostname) && /^\/videos(\/|$)/i.test(u.pathname)) {
      return false
    }
    return true
  }
  // kind === 'vod': accept Twitch VOD paths and any YouTube watch URL.
  if (/(^|\.)twitch\.tv$/i.test(u.hostname)) {
    return /^\/videos\/\d+/.test(u.pathname)
  }
  if (/(^|\.)(youtube\.com|youtu\.be)$/i.test(u.hostname)) {
    // youtube.com/watch?v=... or youtu.be/<id>
    return true
  }
  return false
}
