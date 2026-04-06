import { unlockAchievement, insertPointEvent, getWeekStart } from './db'

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
 *
 * Daily login tiers (daily_login_3 / _5 / _7) are permanent fixtures —
 * they are awarded by POST /api/visit based on the user_visit_logs table
 * and should always be present here.
 */
export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'send_chat',
    emoji: '💬',
    title: 'Say Something',
    description: 'Send a message in any chat',
    points: 40,
  },
  {
    id: 'set_profile',
    emoji: '🏷️',
    title: 'Make It Official',
    description: 'Set your username',
    points: 40,
  },
  {
    id: 'free_trade',
    emoji: '🎮',
    title: 'Play Money',
    description: 'Place a trade on a free market',
    points: 60,
  },
  {
    id: 'win_free_trade',
    emoji: '🏆',
    title: 'Cashed Out',
    description: 'Win a free market trade',
    points: 100,
  },
  {
    id: 'refer_friend',
    emoji: '🤝',
    title: 'Bring a Friend',
    description: 'Refer a new user to Mentioned',
    points: 100,
  },
  // Daily login streak — tiered, stacking
  {
    id: 'daily_login_3',
    emoji: '📅',
    title: 'Showing Up',
    description: 'Visit Mentioned 3 days this week',
    points: 50,
  },
  {
    id: 'daily_login_5',
    emoji: '🗓️',
    title: 'Regular',
    description: 'Visit Mentioned 5 days this week',
    points: 75,
  },
  {
    id: 'daily_login_7',
    emoji: '🔥',
    title: 'Every Day',
    description: 'Visit Mentioned every day this week',
    points: 100,
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

  // Award bonus points — ref_id includes week_start so the same achievement ID
  // can be awarded again in a new week without hitting the ON CONFLICT dedup.
  if (def.points > 0) {
    await insertPointEvent(wallet, 'achievement', def.points, `ach:${achievementId}:${getWeekStart()}`)
  }

  return def
}
