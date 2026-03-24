import { NextRequest, NextResponse } from 'next/server'
import { getUnlockedAchievements } from '@/lib/db'
import { ACHIEVEMENTS } from '@/lib/achievements'

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet')
  if (!wallet) {
    return NextResponse.json({ error: 'wallet is required' }, { status: 400 })
  }

  const unlocked = await getUnlockedAchievements(wallet)
  const unlockedMap = new Map(
    unlocked.map(u => [u.achievement_id, u.unlocked_at])
  )

  const achievements = ACHIEVEMENTS.map(a => ({
    ...a,
    unlocked: unlockedMap.has(a.id),
    unlockedAt: unlockedMap.get(a.id) ?? null,
  }))

  return NextResponse.json({ achievements })
}
