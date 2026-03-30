import {
  insertPointEvent,
  getChatPointsCountToday,
  getEarliestTradeTime,
} from './db'

// ── Config ───────────────────────────────────────────────

export const POINT_CONFIG = {
  trade_placed: { points: 10, description: 'Placed a trade', dailyCap: 20, minAmountUsd: 1 },
  first_trade:  { points: 100, description: 'First ever trade on Mentioned' },
  claim_won:    { points: 50, description: 'Claimed a winning position' },
  chat_message: { points: 2, description: 'Sent a chat message', dailyCap: 10 },
  hold_1h:      { points: 5, description: 'Held a position for 1+ hour' },
  hold_4h:      { points: 15, description: 'Held a position for 4+ hours' },
  hold_24h:     { points: 30, description: 'Held a position for 24+ hours' },
  achievement:  { points: 0, description: 'Achievement unlocked' },
} as const

type PointAction = keyof typeof POINT_CONFIG

// ── Helpers ──────────────────────────────────────────────

export function getWeekStart(): Date {
  const now = new Date()
  const day = now.getUTCDay() // 0=Sun, 1=Mon
  const diff = day === 0 ? 6 : day - 1
  const monday = new Date(now)
  monday.setUTCDate(now.getUTCDate() - diff)
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

/**
 * One-time first trade bonus. Uses wallet as refId so it can only fire once.
 */
export async function checkAndAwardFirstTrade(wallet: string): Promise<void> {
  await awardPoints(wallet, 'first_trade', wallet)
}

/**
 * Award hold tier points for a position. Calculates duration from earliest
 * polymarket_trades record for this wallet+market and awards all applicable
 * tiers not yet awarded.
 */
export async function awardHoldPoints(
  wallet: string,
  positionPubkey: string,
  marketId: string,
): Promise<void> {
  const openTime = await getEarliestTradeTime(wallet, marketId)
  if (!openTime) return

  const heldMs = Date.now() - openTime.getTime()

  const tiers: { action: PointAction; thresholdMs: number }[] = [
    { action: 'hold_1h',  thresholdMs: 3_600_000 },
    { action: 'hold_4h',  thresholdMs: 14_400_000 },
    { action: 'hold_24h', thresholdMs: 86_400_000 },
  ]

  for (const { action, thresholdMs } of tiers) {
    if (heldMs >= thresholdMs) {
      const refId = `${positionPubkey}:${action}`
      await awardPoints(wallet, action, refId)
    }
  }
}
