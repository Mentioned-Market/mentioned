import { NextRequest, NextResponse } from 'next/server'
import { searchProfiles, getProfileByWallet, searchCustomMarkets } from '@/lib/db'

const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''

  if (q.length < 2 || q.length > 44) {
    return NextResponse.json({ results: [], markets: [] })
  }

  try {
    // Run user + market searches in parallel
    const [usernameResults, walletProfile, marketResults] = await Promise.all([
      searchProfiles(q),
      WALLET_RE.test(q) ? getProfileByWallet(q) : Promise.resolve(null),
      searchCustomMarkets(q),
    ])

    // Build user results (wallet match first, then username matches)
    const users: { wallet: string; username: string | null; pfpEmoji: string | null }[] = []
    if (walletProfile) {
      users.push({
        wallet: walletProfile.wallet,
        username: walletProfile.username,
        pfpEmoji: walletProfile.pfp_emoji,
      })
    }
    for (const r of usernameResults) {
      if (!users.some(existing => existing.wallet === r.wallet)) {
        users.push({
          wallet: r.wallet,
          username: r.username,
          pfpEmoji: r.pfp_emoji,
        })
      }
    }

    // Build market results
    const markets = marketResults.map(m => ({
      id: m.id,
      title: m.title,
      slug: m.slug,
      status: m.status,
      coverImageUrl: m.cover_image_url,
    }))

    return NextResponse.json({ results: users, markets })
  } catch (err) {
    console.error('Search error:', err)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
