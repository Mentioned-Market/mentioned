import { NextResponse } from 'next/server'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set('session', '', {
    maxAge: 0,
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  })
  res.cookies.set('session_wallet', '', {
    maxAge: 0,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  })
  return res
}
