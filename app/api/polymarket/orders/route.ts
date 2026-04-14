import { NextRequest, NextResponse } from 'next/server'
import { JUP_API_KEY, JUP_BASE, getForwardHeaders } from '@/lib/jupiterApi'
import { getVerifiedWallet } from '@/lib/walletAuth'

const RATE_LIMIT_MS = 1000
const lastOrder = new Map<string, number>()
setInterval(() => {
  const cutoff = Date.now() - 60_000
  for (const [key, ts] of lastOrder) {
    if (ts < cutoff) lastOrder.delete(key)
  }
}, 600_000)

export async function POST(req: NextRequest) {
  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const now = Date.now()
  const last = lastOrder.get(wallet) ?? 0
  if (now - last < RATE_LIMIT_MS) {
    return NextResponse.json({ error: 'Slow down' }, { status: 429 })
  }
  lastOrder.set(wallet, now)

  try {
    const raw = await req.json()
    // Whitelist allowed fields to prevent unexpected data reaching Jupiter
    const ALLOWED_FIELDS = [
      'marketId', 'side', 'type', 'amount', 'price', 'ownerPubkey', 'outcomeId', 'userPubkey',
      'isBuy', 'isYes', 'depositAmount', 'maxBuyPriceUsd', 'depositMint',
    ]
    const body: Record<string, unknown> = {}
    for (const key of ALLOWED_FIELDS) {
      if (key in raw) body[key] = raw[key]
    }
    const fwd = getForwardHeaders(req)

    const res = await fetch(`${JUP_BASE}/orders`, {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: {
        'x-api-key': JUP_API_KEY,
        'Content-Type': 'application/json',
        ...fwd,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return NextResponse.json(
        { error: text || 'Failed to create order' },
        { status: res.status }
      )
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
