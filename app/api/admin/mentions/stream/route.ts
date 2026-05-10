import { NextRequest } from 'next/server'
import { mentionStream } from '@/lib/mentionStream'
import { isAdmin } from '@/lib/adminAuth'
import { getVerifiedWallet } from '@/lib/walletAuth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const HEARTBEAT_INTERVAL = 25_000

export async function GET(req: NextRequest) {
  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!isAdmin(wallet)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const streamIdRaw = req.nextUrl.searchParams.get('streamId')
  const streamId = streamIdRaw ? parseInt(streamIdRaw, 10) : NaN
  if (!Number.isFinite(streamId) || streamId <= 0) {
    return new Response(JSON.stringify({ error: 'streamId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const encoder = new TextEncoder()
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let unsubscribe: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(': connected\n\n'))

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          cleanup()
        }
      }, HEARTBEAT_INTERVAL)

      unsubscribe = mentionStream.subscribe(streamId, (data) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          cleanup()
        }
      })

      req.signal.addEventListener('abort', () => {
        cleanup()
        try { controller.close() } catch {}
      })
    },
    cancel() {
      cleanup()
    },
  })

  function cleanup() {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null }
    if (unsubscribe) { unsubscribe(); unsubscribe = null }
  }

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
