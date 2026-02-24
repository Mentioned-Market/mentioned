import { NextRequest, NextResponse } from 'next/server'
import { getRecentChatMessages, insertChatMessage, getProfile } from '@/lib/db'

const MAX_LENGTH = 200
const RATE_LIMIT_MS = 500
const lastSent = new Map<string, number>()

export async function GET(req: NextRequest) {
  const afterId = req.nextUrl.searchParams.get('after')
  const messages = await getRecentChatMessages(
    50,
    afterId ? parseInt(afterId, 10) : undefined,
  )
  return NextResponse.json(messages)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { wallet, message } = body as { wallet?: string; message?: string }

  if (!wallet || !message?.trim()) {
    return NextResponse.json({ error: 'wallet and message are required' }, { status: 400 })
  }

  const text = message.trim().slice(0, MAX_LENGTH)

  // Simple rate limit per wallet
  const now = Date.now()
  const last = lastSent.get(wallet) ?? 0
  if (now - last < RATE_LIMIT_MS) {
    return NextResponse.json({ error: 'Slow down' }, { status: 429 })
  }
  lastSent.set(wallet, now)

  // Look up username
  const profile = await getProfile(wallet)
  const username = profile?.username ?? `${wallet.slice(0, 4)}...${wallet.slice(-4)}`

  const row = await insertChatMessage(wallet, username, text)
  return NextResponse.json(row)
}
