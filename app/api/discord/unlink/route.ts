import { NextRequest, NextResponse } from 'next/server'
import { unlinkDiscord } from '@/lib/db'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { wallet } = body as { wallet?: string }

  if (!wallet) {
    return NextResponse.json({ error: 'wallet is required' }, { status: 400 })
  }

  try {
    await unlinkDiscord(wallet)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Discord unlink error:', err)
    return NextResponse.json({ error: 'Failed to unlink Discord' }, { status: 500 })
  }
}
