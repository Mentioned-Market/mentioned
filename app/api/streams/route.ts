import { NextRequest, NextResponse } from 'next/server'
import {
  upsertEventStream,
  deleteEventStream,
  getEventStream,
  getAllEventStreams,
} from '@/lib/db'

// GET /api/streams?eventId=POLY-123  → single stream URL
// GET /api/streams                   → all streams (for admin)
export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('eventId')

  if (eventId) {
    const streamUrl = await getEventStream(eventId)
    return NextResponse.json({ eventId, streamUrl })
  }

  const streams = await getAllEventStreams()
  return NextResponse.json({ streams })
}

// POST /api/streams  { eventId, streamUrl }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { eventId, streamUrl } = body

    if (!eventId || !streamUrl) {
      return NextResponse.json({ error: 'eventId and streamUrl required' }, { status: 400 })
    }

    await upsertEventStream(eventId, streamUrl)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Stream upsert error:', err)
    return NextResponse.json({ error: 'Failed to save stream' }, { status: 500 })
  }
}

// DELETE /api/streams  { eventId }
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json()
    const { eventId } = body

    if (!eventId) {
      return NextResponse.json({ error: 'eventId required' }, { status: 400 })
    }

    await deleteEventStream(eventId)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Stream delete error:', err)
    return NextResponse.json({ error: 'Failed to delete stream' }, { status: 500 })
  }
}
