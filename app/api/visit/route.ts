import { NextRequest, NextResponse } from 'next/server'
import { recordVisitAndGetWeekCount } from '@/lib/db'
import { tryUnlockAchievement } from '@/lib/achievements'
import { getVerifiedWallet } from '@/lib/walletAuth'
import { getClientIp } from '@/lib/clientIp'

// Tier thresholds and their achievement IDs in ascending order
const LOGIN_TIERS = [
  { days: 3, id: 'daily_login_3' },
  { days: 5, id: 'daily_login_5' },
  { days: 7, id: 'daily_login_7' },
] as const

export async function POST(req: NextRequest) {
  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const ip = getClientIp(req)
  const userAgent = req.headers.get('user-agent') || null

  let weekCount: number
  try {
    weekCount = await recordVisitAndGetWeekCount(wallet, ip, userAgent)
  } catch (err) {
    console.error('Visit record error:', err)
    return NextResponse.json({ error: 'Failed to record visit' }, { status: 500 })
  }

  // Award any newly crossed tier achievements (tryUnlockAchievement is idempotent)
  const newAchievements: { id: string; emoji: string; title: string; points: number }[] = []
  for (const tier of LOGIN_TIERS) {
    if (weekCount >= tier.days) {
      try {
        const ach = await tryUnlockAchievement(wallet, tier.id)
        if (ach) newAchievements.push({ id: ach.id, emoji: ach.emoji, title: ach.title, points: ach.points })
      } catch (err) {
        console.error(`Achievement error (${tier.id}):`, err)
      }
    }
  }

  return NextResponse.json({ weekCount, newAchievements })
}
