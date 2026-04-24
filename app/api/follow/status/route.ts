import { NextRequest, NextResponse } from 'next/server'
import { isFollowing } from '@/lib/db'
import { getVerifiedWallet } from '@/lib/walletAuth'

const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export async function GET(req: NextRequest) {
  const follower = getVerifiedWallet(req)
  if (!follower) {
    // Unauthenticated viewers always see isFollowing: false — no error, keeps UI simple.
    return NextResponse.json({ isFollowing: false, authenticated: false })
  }

  const target = req.nextUrl.searchParams.get('target')
  if (!target || !WALLET_RE.test(target)) {
    return NextResponse.json({ error: 'Invalid target wallet' }, { status: 400 })
  }
  if (target === follower) {
    return NextResponse.json({ isFollowing: false, authenticated: true, self: true })
  }

  const following = await isFollowing(follower, target)
  return NextResponse.json({ isFollowing: following, authenticated: true })
}
