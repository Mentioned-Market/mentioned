import { NextRequest, NextResponse } from 'next/server'
import { searchProfiles, getProfileByWallet } from '@/lib/db'

const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''

  if (q.length < 2 || q.length > 44) {
    return NextResponse.json({ results: [] })
  }

  try {
    const results: { wallet: string; username: string | null; pfpEmoji: string | null }[] = []

    // If query looks like a wallet address, try exact wallet lookup first
    if (WALLET_RE.test(q)) {
      const walletProfile = await getProfileByWallet(q)
      if (walletProfile) {
        results.push({
          wallet: walletProfile.wallet,
          username: walletProfile.username,
          pfpEmoji: walletProfile.pfp_emoji,
        })
      }
    }

    // Search by username substring
    const usernameResults = await searchProfiles(q)
    for (const r of usernameResults) {
      if (!results.some(existing => existing.wallet === r.wallet)) {
        results.push({
          wallet: r.wallet,
          username: r.username,
          pfpEmoji: r.pfp_emoji,
        })
      }
    }

    return NextResponse.json({ results })
  } catch (err) {
    console.error('Profile search error:', err)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
