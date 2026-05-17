import { NextRequest, NextResponse } from 'next/server'
import {
  getProfileByUsername,
  getProfileByWallet,
  getWalletPopupData,
} from '@/lib/db'

export const dynamic = 'force-dynamic'

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/
const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export async function GET(
  _req: NextRequest,
  { params }: { params: { username: string } },
) {
  const { username: identifier } = params

  let wallet: string
  let username: string | null
  let pfp_emoji: string | null = null
  let created_at: string | null = null

  if (WALLET_RE.test(identifier)) {
    const profile = await getProfileByWallet(identifier)
    wallet = identifier
    username = profile?.username ?? null
    pfp_emoji = profile?.pfp_emoji ?? null
    created_at = profile?.created_at ?? null
  } else if (USERNAME_RE.test(identifier)) {
    const profile = await getProfileByUsername(identifier)
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }
    wallet = profile.wallet
    username = profile.username
    pfp_emoji = profile.pfp_emoji ?? null
    created_at = profile.created_at
  } else {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const data = await getWalletPopupData(wallet)

  return NextResponse.json({
    username,
    wallet,
    pfpEmoji: pfp_emoji,
    createdAt: created_at,
    ...data,
  })
}
