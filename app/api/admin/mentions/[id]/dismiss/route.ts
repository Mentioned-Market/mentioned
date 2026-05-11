import { NextRequest, NextResponse } from 'next/server'
import { dismissWordMention } from '@/lib/db'
import { isAdmin } from '@/lib/adminAuth'
import { getVerifiedWallet } from '@/lib/walletAuth'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!isAdmin(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { id } = await params
  const mentionId = parseInt(id, 10)
  if (!Number.isFinite(mentionId) || mentionId <= 0) {
    return NextResponse.json({ error: 'Invalid mention id' }, { status: 400 })
  }

  const row = await dismissWordMention(mentionId, wallet)
  if (!row) {
    return NextResponse.json({ error: 'Mention not found' }, { status: 404 })
  }
  return NextResponse.json({ mention: row })
}
