import { NextRequest, NextResponse } from 'next/server'
import { JUP_API_KEY, JUP_BASE, getForwardHeaders } from '@/lib/jupiterApi'
import { awardHoldPoints } from '@/lib/points'
import { tryUnlockAchievement } from '@/lib/achievements'

export async function DELETE(req: NextRequest) {
  const body = await req.json()
  const { positionPubkey, ownerPubkey, marketId } = body

  if (!positionPubkey || !ownerPubkey) {
    return NextResponse.json(
      { error: 'positionPubkey and ownerPubkey required' },
      { status: 400 }
    )
  }

  const fwd = getForwardHeaders(req)

  const res = await fetch(
    `${JUP_BASE}/positions/${encodeURIComponent(positionPubkey)}`,
    {
      method: 'DELETE',
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
      { error: text || 'Failed to close position' },
      { status: res.status }
    )
  }

  const data = await res.json()

  // Award hold points (fire-and-forget)
  if (marketId) {
    awardHoldPoints(ownerPubkey, positionPubkey, marketId).catch((err) =>
      console.error('Points award error (close):', err)
    )
  }

  // Achievement (collect result for toast)
  const newAchievements: { id: string; emoji: string; title: string; points: number }[] = []
  try {
    const ach = await tryUnlockAchievement(ownerPubkey, 'lose_trade')
    if (ach) newAchievements.push({ id: ach.id, emoji: ach.emoji, title: ach.title, points: ach.points })
  } catch (err) {
    console.error('Achievement error (close):', err)
  }

  return NextResponse.json({ ...data, newAchievements })
}
