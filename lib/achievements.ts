import { unlockAchievement, insertPointEvent } from './db'

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
    id: 'set_nickname',
    emoji: '🏷️',
    title: 'Named & Famed',
    description: 'Set a nickname on your profile',
    points: 75,
  },
  {
    id: 'first_trade',
    emoji: '🎯',
    title: 'First Shot',
    description: 'Place your first trade',
    points: 150,
  },
  {
    id: 'win_trade',
    emoji: '🏆',
    title: 'Winner Winner',
    description: 'Win a trade by claiming a winning position',
    points: 225,
  },
  {
    id: 'lose_trade',
    emoji: '💀',
    title: 'Battle Scarred',
    description: 'Close a losing position',
    points: 75,
  },
]

export const ACHIEVEMENT_MAP = Object.fromEntries(
  ACHIEVEMENTS.map(a => [a.id, a])
) as Record<string, AchievementDef>

// ── Unlock Logic ────────────────────────────────────────

/**
 * Try to unlock an achievement for a wallet.
 * Returns the achievement def if newly unlocked, or null if already had it.
 * Safe to call repeatedly — UNIQUE constraint deduplicates.
 */
export async function tryUnlockAchievement(
  wallet: string,
  achievementId: string,
): Promise<AchievementDef | null> {
  const def = ACHIEVEMENT_MAP[achievementId]
  if (!def) return null

  const unlocked = await unlockAchievement(wallet, achievementId, def.points)
  if (!unlocked) return null

  // Award bonus points
  if (def.points > 0) {
    await insertPointEvent(wallet, 'achievement', def.points, `ach:${achievementId}`)
  }

  return def
}
