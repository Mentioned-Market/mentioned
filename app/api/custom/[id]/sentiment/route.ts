import { NextRequest, NextResponse } from 'next/server'
import { getWordSentiment } from '@/lib/db'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const marketId = parseInt(id, 10)
  if (isNaN(marketId)) {
    return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
  }

  const sentiment = await getWordSentiment(marketId)
  return NextResponse.json({ sentiment })
}
