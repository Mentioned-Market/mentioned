import { NextRequest, NextResponse } from 'next/server'
import { getProfileByUsername, getProfileByWallet, getWalletPointTotal } from '@/lib/db'
import { JUP_API_KEY, JUP_BASE } from '@/lib/jupiterApi'

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
  let created_at: string | null
  let pfp_emoji: string | null = null

  if (WALLET_RE.test(identifier)) {
    const profile = await getProfileByWallet(identifier)
    wallet = identifier
    username = profile?.username ?? null
    created_at = profile?.created_at ?? null
    pfp_emoji = profile?.pfp_emoji ?? null
  } else if (USERNAME_RE.test(identifier)) {
    const profile = await getProfileByUsername(identifier)
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }
    wallet = profile.wallet
    username = profile.username
    created_at = profile.created_at
    pfp_emoji = profile.pfp_emoji ?? null
  } else {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const posParams = new URLSearchParams({ ownerPubkey: wallet })
  const histParams = new URLSearchParams({ ownerPubkey: wallet })

  const [posRes, histRes, allTimePoints] = await Promise.all([
    fetch(`${JUP_BASE}/positions?${posParams}`, { cache: 'no-store', headers: { 'x-api-key': JUP_API_KEY } })
      .then(r => r.ok ? r.json() : { data: [] })
      .catch(() => ({ data: [] })),
    fetch(`${JUP_BASE}/history?${histParams}`, { cache: 'no-store', headers: { 'x-api-key': JUP_API_KEY } })
      .then(r => r.ok ? r.json() : { data: [] })
      .catch(() => ({ data: [] })),
    getWalletPointTotal(wallet),
  ])

  const positions: Record<string, unknown>[] = posRes.data ?? []
  const history: Record<string, unknown>[] = (histRes.data ?? [])
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
      (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0),
    )

  const unrealizedPnl = positions.reduce(
    (sum: number, p: Record<string, unknown>) => sum + (Number(p.pnlUsd) || 0), 0,
  )
  const realizedPnl = history.reduce(
    (sum: number, h: Record<string, unknown>) => sum + (Number(h.realizedPnl) || 0), 0,
  )
  const totalVolume = history.reduce(
    (sum: number, h: Record<string, unknown>) => sum + (Number(h.depositAmountUsd) || 0), 0,
  )
  const tradesCount = history.filter(
    (h: Record<string, unknown>) => h.eventType === 'order_filled',
  ).length
  const totalValue = positions.reduce(
    (sum: number, p: Record<string, unknown>) => sum + (Number(p.sizeUsd) || 0), 0,
  )
  const SETTLEMENT_TYPES = new Set(['settle_position', 'payout_claimed'])
  const biggestWin = history.reduce((max: number, h: Record<string, unknown>) => {
    const realized = Number(h.realizedPnl) || 0
    // For claim/settle events Jupiter often leaves realizedPnl = 0 and uses payoutAmountUsd instead
    const effective = realized !== 0
      ? realized
      : SETTLEMENT_TYPES.has(h.eventType as string) ? Number(h.payoutAmountUsd) || 0 : 0
    return Math.max(max, effective)
  }, 0)

  return NextResponse.json({
    username,
    wallet,
    pfpEmoji: pfp_emoji,
    createdAt: created_at,
    positions,
    history,
    stats: {
      positionsCount: positions.length,
      totalVolume,
      totalValue,
      unrealizedPnl,
      realizedPnl,
      totalPnl: unrealizedPnl + realizedPnl,
      tradesCount,
      biggestWin,
      allTimePoints,
    },
  })
}
