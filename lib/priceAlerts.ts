// Server-only orchestrator for free-market price alerts.
//
// Called fire-and-forget from the trade route after a trade commits. Free-market
// prices only move on trades, so this is the single place a price crossing can be
// detected. claimTriggeredPriceAlerts() atomically flips matching active alerts to
// 'triggered' (one-shot, race-safe); we then DM each owner via the existing bot.

import { claimTriggeredPriceAlerts } from './db'
import { sendDiscordDM } from './discordBot'

/**
 * Detect alerts crossed by the word's new YES price and DM their owners.
 * Best-effort: never throws (caller is fire-and-forget). DMs run concurrently.
 */
export async function processPriceAlertsForWord(
  wordId: number,
  newYesPrice: number,
): Promise<void> {
  try {
    const triggered = await claimTriggeredPriceAlerts(wordId, newYesPrice)
    if (triggered.length === 0) return

    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'https://mentioned.market').replace(/\/$/, '')

    await Promise.allSettled(
      triggered.map(async (alert) => {
        if (!alert.discord_id) return
        const pct = Math.round(alert.side_price * 100)
        const arrow = alert.direction === 'above' ? '📈' : '📉'
        const url = alert.market_slug ? `${baseUrl}/free/${alert.market_slug}` : baseUrl
        const content =
          `${arrow} **Price alert** — **${alert.word}** ${alert.side} just hit **${pct}%** ` +
          `on **${alert.market_title}**.\nTrade now → ${url}`
        await sendDiscordDM(alert.discord_id, content)
      }),
    )
  } catch (err) {
    console.error('processPriceAlertsForWord error:', err)
  }
}
