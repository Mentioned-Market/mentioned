import { NextRequest, NextResponse } from 'next/server'
import { JUP_API_KEY, JUP_BASE, getForwardHeaders } from '@/lib/jupiterApi'
import { getVerifiedWallet } from '@/lib/walletAuth'

export async function POST(req: NextRequest) {
  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const fwd = getForwardHeaders(req)

    const res = await fetch(`${JUP_BASE}/orders`, {
      method: 'POST',
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
