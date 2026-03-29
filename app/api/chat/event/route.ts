import { NextRequest, NextResponse } from 'next/server'
import { getRecentEventChatMessages, insertEventChatMessage, getProfile, getChatPointsCountToday, getChatMessageCount } from '@/lib/db'
import { awardPoints, POINT_CONFIG } from '@/lib/points'
import { tryUnlockAchievement } from '@/lib/achievements'

const MAX_LENGTH = 200
const RATE_LIMIT_MS = 500
const lastSent = new Map<string, number>()

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('eventId')
  if (!eventId) {
    return NextResponse.json({ error: 'eventId required' }, { status: 400 })
  }

  const afterId = req.nextUrl.searchParams.get('after')
  const messages = await getRecentEventChatMessages(
    eventId,
    50,
    afterId ? parseInt(afterId, 10) : undefined,
  )
  return NextResponse.json(messages)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { wallet, message, eventId } = body as {
    wallet?: string
    message?: string
    eventId?: string
  }

  if (!wallet || !message?.trim() || !eventId) {
    return NextResponse.json(
      { error: 'wallet, message, and eventId are required' },
      { status: 400 },
    )
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
    push(await tryUnlockAchievement(wallet, 'first_chat'))
    const msgCount = await getChatMessageCount(wallet)
    if (msgCount >= 50) push(await tryUnlockAchievement(wallet, '50_chats'))
  } catch (err) {
    console.error('Achievement error (event chat):', err)
  }

  return NextResponse.json({ ...row, newAchievements })
}
