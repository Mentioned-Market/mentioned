import { NextRequest, NextResponse } from 'next/server'
import { getRecentEventChatMessages, getEventChatMessagesBefore, insertEventChatMessage, getProfile, getChatPointsCountToday } from '@/lib/db'
import { awardPoints, POINT_CONFIG } from '@/lib/points'
import { tryUnlockAchievement } from '@/lib/achievements'
import { checkSlurs } from '@/lib/chatFilter'
import { getVerifiedWallet } from '@/lib/walletAuth'

const MAX_LENGTH = 200
const RATE_LIMIT_MS = 500
const lastSent = new Map<string, number>()

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('eventId')
  if (!eventId) {
    return NextResponse.json({ error: 'eventId required' }, { status: 400 })
  }

  // Backward pagination: older messages before a given id
  const beforeParam = req.nextUrl.searchParams.get('before')
  if (beforeParam) {
    const beforeId = parseInt(beforeParam, 10)
    if (isNaN(beforeId) || beforeId < 0) {
      return NextResponse.json({ error: 'Invalid before parameter' }, { status: 400 })
    }
    const result = await getEventChatMessagesBefore(eventId, beforeId, 50)
    return NextResponse.json(result)
  }

  // Forward polling: new messages after a given id
  const afterId = req.nextUrl.searchParams.get('after')
  const messages = await getRecentEventChatMessages(
    eventId,
    50,
    afterId ? parseInt(afterId, 10) : undefined,
  )
  return NextResponse.json(messages)
}

export async function POST(req: NextRequest) {
  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const body = await req.json()
  const { message, eventId } = body as {
    message?: string
    eventId?: string
  }

  if (!message?.trim() || !eventId) {
    return NextResponse.json(
      { error: 'message and eventId are required' },
      { status: 400 },
    )
  }

  const text = message.trim().slice(0, MAX_LENGTH)

  // Slur filter
  if (checkSlurs(text)) {
    return NextResponse.json({ error: 'Message contains prohibited language' }, { status: 400 })
  }

  // Simple rate limit per wallet
  const now = Date.now()
  const last = lastSent.get(wallet) ?? 0
  if (now - last < RATE_LIMIT_MS) {
    return NextResponse.json({ error: 'Slow down' }, { status: 429 })
  }
  lastSent.set(wallet, now)

  // Look up username
  const profile = await getProfile(wallet)
  const username =
    profile?.username ?? `${wallet.slice(0, 4)}...${wallet.slice(-4)}`

  const row = await insertEventChatMessage(eventId, wallet, username, text)

  // Award chat points up to daily cap (fire-and-forget)
  getChatPointsCountToday(wallet)
    .then((count) => {
      if (count < POINT_CONFIG.chat_message.dailyCap) {
        return awardPoints(wallet, 'chat_message')
      }
    })
    .catch((err) => console.error('Points award error (event chat):', err))

  // Chat achievements
  const newAchievements: { id: string; emoji: string; title: string; points: number }[] = []
  try {
    const push = (a: Awaited<ReturnType<typeof tryUnlockAchievement>>) => {
      if (a) newAchievements.push({ id: a.id, emoji: a.emoji, title: a.title, points: a.points })
    }
    push(await tryUnlockAchievement(wallet, 'send_chat'))
  } catch (err) {
    console.error('Achievement error (event chat):', err)
  }

  return NextResponse.json({ ...row, newAchievements })
}
