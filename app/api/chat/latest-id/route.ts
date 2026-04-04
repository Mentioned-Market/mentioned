import { NextRequest, NextResponse } from 'next/server'
import { getLatestChatId } from '@/lib/db'

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

  const result = await getLatestChatId(afterId)
  return NextResponse.json(result)
}
