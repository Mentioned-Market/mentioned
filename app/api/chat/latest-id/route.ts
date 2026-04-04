import { NextRequest, NextResponse } from 'next/server'
import { getLatestChatId } from '@/lib/db'
import { chatStream } from '@/lib/chatStream'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const afterParam = req.nextUrl.searchParams.get('after')
  let afterId: number | undefined
  if (afterParam) {
    afterId = parseInt(afterParam, 10)
    if (isNaN(afterId) || afterId < 0) {
      return NextResponse.json({ error: 'Invalid after parameter' }, { status: 400 })
    }
  }

  let latestId = chatStream.latestGlobalId

  // Cold start: no messages received via LISTEN yet — seed from DB once
  if (latestId === 0) {
    const dbResult = await getLatestChatId()
    latestId = dbResult.latestId
    chatStream.seedLatestGlobalId(latestId)
  }

  // Count is derived from sequential SERIAL IDs (no deletes on chat_messages)
  const count = afterId ? Math.max(0, latestId - afterId) : 0
  return NextResponse.json({ latestId, count })
}
