import { NextRequest, NextResponse } from 'next/server'
import { JUP_API_KEY, JUP_BASE, getForwardHeaders } from '@/lib/jupiterApi'
import { awardPoints, awardHoldPoints } from '@/lib/points'
import { tryUnlockAchievement } from '@/lib/achievements'
import { getVerifiedWallet } from '@/lib/walletAuth'

export async function POST(req: NextRequest) {
  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const body = await req.json()
  const { positionPubkey, ownerPubkey, marketId } = body

  if (!positionPubkey || !ownerPubkey) {
    return NextResponse.json(
      { error: 'positionPubkey and ownerPubkey required' },
      { status: 400 }
    )
  }

  // Verify the caller owns the position they're claiming
  if (ownerPubkey !== wallet) {
    return NextResponse.json({ error: 'Wallet mismatch' }, { status: 403 })
  }

  const fwd = getForwardHeaders(req)

  const res = await fetch(
    `${JUP_BASE}/positions/${encodeURIComponent(positionPubkey)}/claim`,
    {
      method: 'POST',
      headers: {
        'x-api-key': JUP_API_KEY,
        'Content-Type': 'application/json',
        ...fwd,
      },
      body: JSON.stringify({ ownerPubkey }),
    }
  )

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return NextResponse.json(
      { error: text || 'Failed to claim position' },
      { status: res.status }
    )
  }

  const data = await res.json()

  // Award points (fire-and-forget)
  const pointsWork: Promise<unknown>[] = [
    awardPoints(ownerPubkey, 'claim_won', positionPubkey),
  ]
  if (marketId) {
    pointsWork.push(awardHoldPoints(ownerPubkey, positionPubkey, marketId))
  }
  Promise.all(pointsWork).catch((err) => console.error('Points award error (claim):', err))

  // Achievements (collect results for toast)
  const newAchievements: { id: string; emoji: string; title: string; points: number }[] = []
  try {
    const push = (a: Awaited<ReturnType<typeof tryUnlockAchievement>>) => {
      if (a) newAchievements.push({ id: a.id, emoji: a.emoji, title: a.title, points: a.points })
    }
    push(await tryUnlockAchievement(ownerPubkey, 'win_trade'))
  } catch (err) {
    console.error('Achievement error (claim):', err)
  }

  return NextResponse.json({ ...data, newAchievements })
}
