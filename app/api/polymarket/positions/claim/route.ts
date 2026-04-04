import { NextRequest, NextResponse } from 'next/server'
import { JUP_API_KEY, JUP_BASE, getForwardHeaders } from '@/lib/jupiterApi'
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

  return NextResponse.json({ ...data, newAchievements: [] })
}
