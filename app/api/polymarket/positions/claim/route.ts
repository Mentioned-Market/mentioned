import { NextRequest, NextResponse } from 'next/server'
import { JUP_API_KEY, JUP_BASE, getForwardHeaders } from '@/lib/jupiterApi'
import { awardPoints, awardHoldPoints } from '@/lib/points'

export async function POST(req: NextRequest) {
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

  return NextResponse.json(data)
}
