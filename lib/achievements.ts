import { unlockAchievement, insertPointEvent, getWeekStart } from './db'

// ── Achievement Definitions ─────────────────────────────

export interface AchievementDef {
  id: string
  emoji: string
  title: string
  description: string
  points: number
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'trade_3_markets',
    emoji: '🗺️',
    title: 'Market Explorer',
    description: 'Trade on 3 different markets in a week',
    points: 35,
  },
  {
    id: 'contrarian',
    emoji: '🎲',
    title: 'Against the Grain',
    description: 'Win a trade on the minority side (>60% against you)',
    points: 50,
  },
  {
    id: 'chatterbox',
    emoji: '💬',
    title: 'Chatterbox',
    description: 'Send messages on 3 different days this week',
    points: 35,
  },
  {
    id: 'hat_trick',
    emoji: '🎩',
    title: 'Hat Trick',
    description: 'Win 3 markets in one week',
    points: 50,
  },
  // Daily login streak — tiered, stacking
  {
    id: 'daily_login_3',
    emoji: '📅',
    title: 'Showing Up',
    description: 'Visit Mentioned 3 days this week',
    points: 25,
  },
  {
    id: 'daily_login_5',
    emoji: '🗓️',
    title: 'Regular',
    description: 'Visit Mentioned 5 days this week',
    points: 38,
  },
]

export const ACHIEVEMENT_MAP = Object.fromEntries(
  ACHIEVEMENTS.map(a => [a.id, a])
) as Record<string, AchievementDef>

// ── Unlock Logic ────────────────────────────────────────

export async function tryUnlockAchievement(
  wallet: string,
  achievementId: string,
  at?: Date,
): Promise<AchievementDef | null> {
  const def = ACHIEVEMENT_MAP[achievementId]
  if (!def) return null

  const week = getWeekStart(at)
  const unlocked = await unlockAchievement(wallet, achievementId, def.points, week)
  if (!unlocked) return null

  if (def.points > 0) {
    await insertPointEvent(wallet, 'achievement', def.points, `ach:${achievementId}:${week}`, undefined, at)
  }

  return def
}
