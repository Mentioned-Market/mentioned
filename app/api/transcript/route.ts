import { NextRequest, NextResponse } from 'next/server'
import { getTranscript, upsertTranscript } from '@/lib/db'

export async function GET(req: NextRequest) {
  const marketId = req.nextUrl.searchParams.get('marketId')
  if (!marketId) {
    return NextResponse.json({ error: 'marketId is required' }, { status: 400 })
  }

  const row = await getTranscript(marketId)
  if (!row) {
    return NextResponse.json({ transcript: null })
  }

  return NextResponse.json({
    transcript: row.transcript,
    sourceUrl: row.source_url,
    submittedBy: row.submitted_by,
    createdAt: row.created_at,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { marketId, transcript, sourceUrl, submittedBy } = body

  if (!marketId || !transcript || !submittedBy) {
    return NextResponse.json(
      { error: 'marketId, transcript, and submittedBy are required' },
      { status: 400 },
    )
  }

  await upsertTranscript(
    String(marketId),
    transcript,
    sourceUrl || null,
    submittedBy,
  )

  return NextResponse.json({ ok: true })
}
