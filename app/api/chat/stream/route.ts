import { NextRequest } from 'next/server'
import { chatStream } from '@/lib/chatStream'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CHANNEL_RE = /^(global|event_[a-zA-Z0-9._-]{1,128})$/
const HEARTBEAT_INTERVAL = 25_000

export async function GET(req: NextRequest) {
  const channel = req.nextUrl.searchParams.get('channel')
  if (!channel || !CHANNEL_RE.test(channel)) {
    return new Response(JSON.stringify({ error: 'Invalid channel' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const encoder = new TextEncoder()
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let unsubscribe: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      // Initial connection confirmation
      controller.enqueue(encoder.encode(': connected\n\n'))

      // Heartbeat to keep the connection alive through Railway's proxy
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          cleanup()
        }
      }, HEARTBEAT_INTERVAL)

      // Subscribe to chat channel
      unsubscribe = chatStream.subscribe(channel, (data) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          cleanup()
        }
      })

      // Cleanup when client disconnects
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
