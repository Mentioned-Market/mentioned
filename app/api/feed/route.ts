import { NextRequest, NextResponse } from 'next/server'
import { getFollowFeed, type ActivityRow } from '@/lib/db'
import { getVerifiedWallet } from '@/lib/walletAuth'
import type { ActivityMetadata, FeedItem } from '@/lib/activity'

function toFeedItem(row: ActivityRow): FeedItem | null {
  // Re-shape the JSONB metadata into a discriminated union the client can pattern-match on.
  const base = row.metadata as Record<string, unknown>
  let activity: ActivityMetadata
  switch (row.activity_type) {
    case 'polymarket_trade':
    case 'onchain_trade':
    case 'free_trade':
    case 'achievement_unlocked':
      activity = { type: row.activity_type, ...base } as ActivityMetadata
      break
    default:
      // Unknown / future type — skip rather than crash the client.
      return null
  }
  return {
    id: row.id,
    actorWallet: row.actor_wallet,
    actorUsername: row.actor_username,
    actorPfpEmoji: row.actor_pfp_emoji,
    createdAt: row.created_at,
    activity,
  }
}

export async function GET(req: NextRequest) {
  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const rawLimit = req.nextUrl.searchParams.get('limit')
  const rawCursor = req.nextUrl.searchParams.get('cursor')
  const limit = rawLimit ? Math.min(Math.max(parseInt(rawLimit, 10) || 20, 1), 50) : 20
  const cursorId = rawCursor && /^\d+$/.test(rawCursor) ? rawCursor : null

  try {
    const rows = await getFollowFeed(wallet, { limit, cursorId })
    const items = rows.map(toFeedItem).filter((x): x is FeedItem => x !== null)
    const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null
    return NextResponse.json({ items, nextCursor })
  } catch (err) {
    console.error('Feed fetch error:', err)
    return NextResponse.json({ error: 'Failed to load feed' }, { status: 500 })
  }
}
