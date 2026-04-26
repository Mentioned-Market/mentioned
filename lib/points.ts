import { insertPointEvent } from './db'

// ── Config ───────────────────────────────────────────────

export const POINT_CONFIG = {
  chat_message:      { points: 2,  description: 'Sent a chat message', dailyCap: 10 },
  custom_market_win: { points: 0,  description: 'Won points on a free market (variable)' },
  achievement:       { points: 0,  description: 'Achievement unlocked' },
} as const

export type PointAction = keyof typeof POINT_CONFIG

// ── Helpers ──────────────────────────────────────────────

export function getWeekStart(at?: Date): Date {
  const ref = at ?? new Date()
  const day = ref.getUTCDay() // 0=Sun, 1=Mon
  const diff = day === 0 ? 6 : day - 1
  const monday = new Date(ref)
  monday.setUTCDate(ref.getUTCDate() - diff)
  monday.setUTCHours(0, 0, 0, 0)
  return monday
}

// ── Core award function ──────────────────────────────────

/**
 * Award points to a wallet. Returns points awarded, or null if deduped/capped.
 * Fire-and-forget safe — wrap in try/catch in routes.
 */
export async function awardPoints(
  wallet: string,
  action: PointAction,
  refId?: string,
  metadata?: Record<string, unknown>,
): Promise<number | null> {
  const { points } = POINT_CONFIG[action]
  return insertPointEvent(wallet, action, points, refId, metadata)
}
