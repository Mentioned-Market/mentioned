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
  // Profile
  {
    id: 'set_nickname',
    emoji: '🏷️',
    title: 'Named & Famed',
    description: 'Set a nickname on your profile',
    points: 75,
  },
  {
    id: 'set_pfp',
    emoji: '🎨',
    title: 'Fresh Fit',
    description: 'Set a profile picture emoji',
    points: 50,
  },
  // Trading basics
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
  // Trade milestones
  {
    id: '10_trades',
    emoji: '📊',
    title: 'Getting Started',
    description: 'Place 10 trades',
    points: 100,
  },
  {
    id: '50_trades',
    emoji: '🔥',
    title: 'On Fire',
    description: 'Place 50 trades',
    points: 250,
  },
  {
    id: '100_trades',
    emoji: '💯',
    title: 'Centurion',
    description: 'Place 100 trades',
    points: 500,
  },
  // Win milestones
  {
    id: '3_wins',
    emoji: '🎰',
    title: 'Hat Trick',
    description: 'Win 3 trades',
    points: 150,
  },
  {
    id: '10_wins',
    emoji: '👑',
    title: 'King of the Hill',
    description: 'Win 10 trades',
    points: 400,
  },
  // Chat
  {
    id: 'first_chat',
    emoji: '💬',
    title: 'Say Something',
    description: 'Send your first chat message',
    points: 50,
  },
  {
    id: '50_chats',
    emoji: '📢',
    title: 'Loud Mouth',
    description: 'Send 50 chat messages',
    points: 150,
  },
  // Free markets
  {
    id: 'first_free_trade',
    emoji: '🎮',
    title: 'Free Player',
    description: 'Place your first free market trade',
    points: 75,
  },
  {
    id: 'free_market_win',
    emoji: '🏅',
    title: 'Play Money Pro',
    description: 'Win a free market',
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
