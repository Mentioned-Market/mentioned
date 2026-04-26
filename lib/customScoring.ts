import {
  insertPointEvent,
  getMarketProfitByWallet,
  resolveWordPositionsPayout,
  getMarketPositionsForScoring,
  insertMarketResults,
  getCustomMarket,
} from './db'
import { tryUnlockAchievement } from './achievements'


export const VIRTUAL_MARKET_POINTS_MULTIPLIER = 0.5

/**
 * Compute and store resolution payouts for a single word.
 * Each correct share pays 1 token (YES shares if YES resolves, NO shares if NO resolves).
 */
export async function resolveWordPositions(
  marketId: number,
  wordId: number,
  outcome: 'YES' | 'NO',
): Promise<void> {
  await resolveWordPositionsPayout(wordId, outcome)
}

/**
 * Pick the timestamp that the resulting points should be recorded against.
 * Uses lock_time when it has already passed, so a market resolved after its lock
 * lands its payouts in the week the market actually ran. Falls back to now() for
 * early resolutions and for markets without a scheduled lock_time.
 */
function effectiveResolutionTime(lockTime: string | null, now: Date = new Date()): Date {
  if (!lockTime) return now
  const lock = new Date(lockTime)
  if (isNaN(lock.getTime())) return now
  return lock < now ? lock : now
}

/**
 * Score all participants after all words in a market are resolved.
 * Computes net = tokens_received - tokens_spent per wallet, applies multiplier,
 * floors at 0, and awards platform points.
 * Also snapshots per-word P&L into custom_market_results for the leaderboard.
 *
 * Points and the win_free_trade achievement are backdated to the market's
 * effective end time so a late resolve (e.g. Monday morning for a Sunday market)
 * still credits the previous week's leaderboard.
 *
 * Idempotent via point_events unique constraint on (wallet, action, ref_id).
 */
export async function resolveAndScoreVirtualMarket(marketId: number): Promise<void> {
  // Snapshot per-word positions for the results leaderboard
  const positions = await getMarketPositionsForScoring(marketId)
  await insertMarketResults(marketId, positions).catch(err =>
    console.error(`Results snapshot error for market ${marketId}:`, err),
  )

  const market = await getCustomMarket(marketId)
  const effectiveAt = effectiveResolutionTime(market?.lock_time ?? null)

  const profits = await getMarketProfitByWallet(marketId)

  for (const { wallet, tokens_spent, tokens_received } of profits) {
    const net = tokens_received - tokens_spent
    const points = Math.max(0, Math.floor(net * VIRTUAL_MARKET_POINTS_MULTIPLIER))
    if (points > 0) {
      await insertPointEvent(
        wallet,
        'custom_market_win',
        points,
        `custom_${marketId}`,
        { marketId, net, multiplier: VIRTUAL_MARKET_POINTS_MULTIPLIER },
        effectiveAt,
      )
      // Award win achievement (idempotent within a week)
      tryUnlockAchievement(wallet, 'win_free_trade', effectiveAt).catch(err =>
        console.error(`Achievement error (win_free_trade) for ${wallet}:`, err),
      )
    }
  }
}
