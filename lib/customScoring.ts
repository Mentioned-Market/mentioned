import {
  insertPointEvent,
  getMarketProfitByWallet,
  resolveWordPositionsPayout,
  getMarketPositionsForScoring,
  insertMarketResults,
  getCustomMarket,
  countMarketWinsThisWeek,
  hasContrarianWinTrade,
  getMarketLeaderboardForDiscord,
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
      // Hat trick — win 3 markets in one week
      countMarketWinsThisWeek(wallet)
        .then(wins => {
          if (wins >= 3) return tryUnlockAchievement(wallet, 'hat_trick', effectiveAt)
        })
        .catch(err => console.error(`Achievement error (hat_trick) for ${wallet}:`, err))
      // Contrarian — won on the minority side (>60% against them at trade time)
      hasContrarianWinTrade(wallet, marketId)
        .then(isContrarian => {
          if (isContrarian) return tryUnlockAchievement(wallet, 'contrarian', effectiveAt)
        })
        .catch(err => console.error(`Achievement error (contrarian) for ${wallet}:`, err))
    }
  }

  await postMarketResolvedDiscord(marketId).catch(err =>
    console.error(`Discord results post failed for market ${marketId}:`, err),
  )
}

function formatNetTokens(n: number): string {
  const rounded = Math.round(n)
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : ''
  return `${sign}${Math.abs(rounded).toLocaleString('en-US')}`
}

function formatPnlPct(net: number, spent: number): string {
  if (spent <= 0) return ''
  const pct = (net / spent) * 100
  const rounded = Math.round(pct)
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : ''
  return ` (${sign}${Math.abs(rounded)}%)`
}

function shortWallet(wallet: string): string {
  return `${wallet.slice(0, 4)}…${wallet.slice(-4)}`
}

/**
 * Post a ranked leaderboard to the Discord market-results channel.
 * Winners (net > 0) with a linked Discord ID are @-mentioned in the message content
 * so they receive a notification; the embed mirrors the on-site leaderboard layout.
 */
async function postMarketResolvedDiscord(marketId: number): Promise<void> {
  const webhookUrl = process.env.DISCORD_MARKET_RESULTS_WEBHOOK_URL
  if (!webhookUrl) return

  const [market, leaderboard] = await Promise.all([
    getCustomMarket(marketId),
    getMarketLeaderboardForDiscord(marketId),
  ])
  if (!market || leaderboard.length === 0) return

  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'https://mentioned.market').replace(/\/$/, '')
  const marketUrl = `${baseUrl}/free/${market.slug}`

  const rows = leaderboard.map((entry, i) => {
    const rank = `\`${String(i + 1).padStart(2, ' ')}.\``
    const emoji = entry.pfp_emoji ? `${entry.pfp_emoji} ` : ''
    const isWinner = entry.net_tokens > 0
    const display = isWinner && entry.discord_id
      ? `<@${entry.discord_id}>`
      : entry.username ?? shortWallet(entry.wallet)
    return `${rank} ${emoji}${display} — \`${formatNetTokens(entry.net_tokens)} tokens${formatPnlPct(entry.net_tokens, entry.total_spent)}\``
  })

  // Embed description limit is 4096 chars; trim conservatively and surface overflow count.
  let description = rows.join('\n')
  if (description.length > 4000) {
    const kept: string[] = []
    let total = 0
    for (const row of rows) {
      if (total + row.length + 1 > 3900) break
      kept.push(row)
      total += row.length + 1
    }
    kept.push(`_…and ${rows.length - kept.length} more_`)
    description = kept.join('\n')
  }

  // Build winner pings for the content field (embed mentions don't fire notifications).
  // Content limit is 2000 chars; truncate if a market has an unusually large winner set.
  const winnerPings: string[] = []
  let pingLen = 0
  for (const entry of leaderboard) {
    if (entry.net_tokens <= 0 || !entry.discord_id) continue
    const tag = `<@${entry.discord_id}>`
    if (pingLen + tag.length + 1 > 1900) break
    winnerPings.push(tag)
    pingLen += tag.length + 1
  }
  const content = winnerPings.length > 0 ? `Winners: ${winnerPings.join(' ')}` : undefined

  const embed = {
    title: `🏆 Market Resolved: ${market.title}`,
    url: marketUrl,
    description,
    color: 0x10b981,
    timestamp: new Date().toISOString(),
  }

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5000),
    body: JSON.stringify({
      content,
      embeds: [embed],
      allowed_mentions: { parse: ['users'] },
    }),
  })
}
