import {
  insertPointEvent,
  getMarketProfitByWallet,
  resolveWordPositionsPayout,
} from './db'


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
 * Score all participants after all words in a market are resolved.
 * Computes net = tokens_received - tokens_spent per wallet, applies multiplier,
 * floors at 0, and awards platform points.
 *
 * Idempotent via point_events unique constraint on (wallet, action, ref_id).
 */
export async function resolveAndScoreVirtualMarket(marketId: number): Promise<void> {
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
      )
    }
  }
}
