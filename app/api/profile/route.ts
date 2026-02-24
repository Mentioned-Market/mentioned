import { NextRequest, NextResponse } from 'next/server'
import { getProfile, upsertProfile } from '@/lib/db'

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet')
  if (!wallet) {
    return NextResponse.json({ error: 'wallet is required' }, { status: 400 })
  }

  const profile = await getProfile(wallet)
  return NextResponse.json({ username: profile?.username ?? null })
}

export async function PUT(req: NextRequest) {
  const body = await req.json()
  const { wallet, username } = body as { wallet?: string; username?: string }

  if (!wallet || !username) {
    return NextResponse.json({ error: 'wallet and username are required' }, { status: 400 })
  }

  const trimmed = username.trim()

  if (!USERNAME_RE.test(trimmed)) {
    return NextResponse.json(
      { error: 'Username must be 3-20 characters, letters/numbers/underscores only' },
      { status: 400 },
    )
  }

  try {
    await upsertProfile(wallet, trimmed)
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const msg = (err as Error).message || ''
    if (msg.includes('user_profiles_username_key')) {
      return NextResponse.json({ error: 'Username is already taken' }, { status: 409 })
    }
    console.error('Profile upsert error:', err)
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
  }
}
