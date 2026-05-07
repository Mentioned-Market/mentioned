import { NextRequest, NextResponse } from 'next/server'
import { unlinkDiscord } from '@/lib/db'
import { getVerifiedWallet } from '@/lib/walletAuth'

export async function POST(req: NextRequest) {
  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  try {
    await unlinkDiscord(wallet)
    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof Error && err.message === 'WALLET_LOCKED') {
      return NextResponse.json({ error: 'Account locked' }, { status: 403 })
    }
    console.error('Discord unlink error:', err)
    return NextResponse.json({ error: 'Failed to unlink Discord' }, { status: 500 })
  }
}
