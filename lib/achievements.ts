import { unlockAchievement, insertPointEvent } from './db'

// ── Achievement Definitions ─────────────────────────────

export interface AchievementDef {
  id: string
  emoji: string
  title: string
  description: string
  points: number
}

/**
 * Weekly achievements — rotated each week by replacing this array.
 * Each week's set should encourage a mix of actions (trading, chatting,
 * profile setup, free markets) so users engage broadly with the platform.
 *
 * When rotating: clear user_achievements table, update this array,
 * and redeploy / restart the server.
 */
export const ACHIEVEMENTS: AchievementDef[] = [
  // Week 1
  {
    id: 'place_trade',
    emoji: '🎯',
    title: 'Pull the Trigger',
    description: 'Place a trade on any Polymarket event',
    points: 100,
  },
  {
    id: 'win_trade',
    emoji: '🏆',
    title: 'Cashed Out',
    description: 'Claim a winning position',
    points: 150,
  },
  {
    id: 'send_chat',
    emoji: '💬',
    title: 'Say Something',
    description: 'Send a message in any chat',
    points: 75,
  },
  {
    id: 'set_profile',
    emoji: '🏷️',
    title: 'Make It Official',
    description: 'Set your username',
    points: 75,
  },
  {
    id: 'free_trade',
    emoji: '🎮',
    title: 'Play Money',
    description: 'Place a trade on a free market',
    points: 100,
  },
  {
    id: 'refer_friend',
    emoji: '🤝',
    title: 'Bring a Friend',
    description: 'Refer a new user to Mentioned',
    points: 150,
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
