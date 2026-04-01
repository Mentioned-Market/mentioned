import { NextRequest, NextResponse } from 'next/server'
import {
  verifyPrivyToken,
  verifyPhantomSignIn,
  createSessionToken,
  SESSION_MAX_AGE,
} from '@/lib/walletAuth'

export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { type } = body as { type?: string }
  let wallet: string | null = null

  if (type === 'privy') {
    const { token } = body as { token?: string }
    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }
    wallet = await verifyPrivyToken(token)
  } else if (type === 'phantom') {
    const { wallet: w, signature, message } = body as {
      wallet?: string
      signature?: string
      message?: string
    }
    if (!w || !signature || !message) {
      return NextResponse.json({ error: 'wallet, signature, and message are required' }, { status: 400 })
    }
    if (!verifyPhantomSignIn(w, signature, message)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
    wallet = w
  } else {
    return NextResponse.json({ error: 'type must be "privy" or "phantom"' }, { status: 400 })
  }

  if (!wallet) {
    return NextResponse.json({ error: 'Verification failed' }, { status: 401 })
  }

  const sessionToken = createSessionToken(wallet)
  const res = NextResponse.json({ ok: true, wallet })

  res.cookies.set('session', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  })

  // Non-httpOnly flag so the client can detect an active session
  res.cookies.set('session_wallet', wallet, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  })

  return res
}
