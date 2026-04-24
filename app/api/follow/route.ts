import { NextRequest, NextResponse } from 'next/server'
import { followUser, unfollowUser, getProfileByWallet } from '@/lib/db'
import { getVerifiedWallet } from '@/lib/walletAuth'

const RATE_LIMIT_MS = 1000
const lastAction = new Map<string, number>()
setInterval(() => {
  const cutoff = Date.now() - 60_000
  for (const [key, ts] of lastAction) {
    if (ts < cutoff) lastAction.delete(key)
  }
}, 600_000)

// Solana addresses are 32-44 base58 characters.
const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

function rateLimit(wallet: string): boolean {
  const now = Date.now()
  const last = lastAction.get(wallet) ?? 0
  if (now - last < RATE_LIMIT_MS) return false
  lastAction.set(wallet, now)
  return true
}

async function readTarget(req: NextRequest): Promise<string | null> {
  try {
    const body = await req.json()
    const target = body?.targetWallet
    if (typeof target !== 'string' || !WALLET_RE.test(target)) return null
    return target
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const follower = getVerifiedWallet(req)
  if (!follower) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!rateLimit(follower)) {
    return NextResponse.json({ error: 'Slow down' }, { status: 429 })
  }

  const followee = await readTarget(req)
  if (!followee) {
    return NextResponse.json({ error: 'Invalid target wallet' }, { status: 400 })
  }
  if (follower === followee) {
    return NextResponse.json({ error: 'You cannot follow yourself' }, { status: 400 })
  }

  // Reject follows to wallets that have never touched the platform.
  // A user is only "real" here if they have a profile row.
  const exists = await getProfileByWallet(followee)
  if (!exists) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  try {
    const inserted = await followUser(follower, followee)
    return NextResponse.json({ success: true, followed: inserted })
  } catch (err) {
    console.error('Follow error:', err)
    return NextResponse.json({ error: 'Failed to follow' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const follower = getVerifiedWallet(req)
  if (!follower) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!rateLimit(follower)) {
    return NextResponse.json({ error: 'Slow down' }, { status: 429 })
  }

  const followee = await readTarget(req)
  if (!followee) {
    return NextResponse.json({ error: 'Invalid target wallet' }, { status: 400 })
  }

  try {
    const removed = await unfollowUser(follower, followee)
    return NextResponse.json({ success: true, unfollowed: removed })
  } catch (err) {
    console.error('Unfollow error:', err)
    return NextResponse.json({ error: 'Failed to unfollow' }, { status: 500 })
  }
}
