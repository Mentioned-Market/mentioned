import { NextRequest, NextResponse } from 'next/server'
import { setTutorialFlag } from '@/lib/db'

export async function POST(req: NextRequest) {
  const { wallet, flag } = await req.json() as { wallet?: string; flag?: string }

  if (!wallet || !flag) {
    return NextResponse.json({ error: 'wallet and flag required' }, { status: 400 })
  }

  // Validate flag name to prevent arbitrary JSONB key injection
  if (!/^[a-z0-9_]{1,64}$/.test(flag)) {
    return NextResponse.json({ error: 'Invalid flag name' }, { status: 400 })
  }

  try {
    await setTutorialFlag(wallet, flag)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Tutorial flag error:', err)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
}
