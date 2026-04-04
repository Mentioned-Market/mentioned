import crypto from 'crypto'
import pg from 'pg'
import type { ParsedTradeEvent } from './tradeParser'
import { virtualImpliedPrice, virtualBuyCost, virtualSellReturn, sharesForTokens } from './virtualLmsr'

const dbUrl = process.env.DATABASE_URL ?? ''
const sslDisabled = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')
  || dbUrl.includes('sslmode=disable') || process.env.DB_SSL === 'false'

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: sslDisabled ? false : { rejectUnauthorized: false },
  max: 10,
})

export interface TradeRow {
  id: number
  signature: string
  market_id: string
  word_index: number
  direction: number
  is_buy: boolean
  quantity: string
  cost: string
  fee: string
  new_yes_qty: string
  new_no_qty: string
  implied_price: string
  trader: string
  block_time: string
}

/**
 * Insert a trade event. Uses ON CONFLICT to skip duplicates (Helius may retry).
 */
export async function insertTradeEvent(
  event: ParsedTradeEvent,
  signature: string,
  isBuy: boolean,
): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO trade_events
       (signature, market_id, word_index, direction, is_buy, quantity, cost, fee,
        new_yes_qty, new_no_qty, implied_price, trader, block_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, to_timestamp($13))
     ON CONFLICT (signature, market_id, word_index, trader) DO NOTHING`,
    [
      signature,
      event.marketId.toString(),
      event.wordIndex,
      event.direction,
      isBuy,
      event.quantity,
      event.cost,
      event.fee,
      event.newYesQty,
      event.newNoQty,
      event.impliedPrice,
      event.trader,
      event.timestamp,
    ],
  )
  return (result.rowCount ?? 0) > 0
}

/**
 * Fetch trades for a market, ordered by time descending.
 */
export async function getTradesByMarket(
  marketId: string,
  limit = 100,
  before?: string,
): Promise<TradeRow[]> {
  const params: (string | number)[] = [marketId, limit]
  let query = `
    SELECT * FROM trade_events
    WHERE market_id = $1
  `
  if (before) {
    query += ` AND block_time < $3`
    params.push(before)
  }
  query += ` ORDER BY block_time DESC LIMIT $2`

  const result = await pool.query(query, params)
  return result.rows
}

/**
 * Fetch trades for a specific trader, ordered by time descending.
 */
export async function getTradesByTrader(
  trader: string,
  limit = 100,
  before?: string,
): Promise<TradeRow[]> {
  const params: (string | number)[] = [trader, limit]
  let query = `
    SELECT * FROM trade_events
    WHERE trader = $1
  `
  if (before) {
    query += ` AND block_time < $3`
    params.push(before)
  }
  query += ` ORDER BY block_time DESC LIMIT $2`

  const result = await pool.query(query, params)
  return result.rows
}

/**
 * Fetch trades for a specific market + word, ordered by time ascending (for charts).
 */
export async function getTradesByWord(
  marketId: string,
  wordIndex: number,
  limit = 500,
): Promise<TradeRow[]> {
  const result = await pool.query(
    `SELECT * FROM trade_events
     WHERE market_id = $1 AND word_index = $2
     ORDER BY block_time ASC
     LIMIT $3`,
    [marketId, wordIndex, limit],
  )
  return result.rows
}

// ── Transcripts ─────────────────────────────────────────

export interface TranscriptRow {
  id: number
  market_id: string
  transcript: string
  source_url: string | null
  submitted_by: string
  created_at: string
}

export async function upsertTranscript(
  marketId: string,
  transcript: string,
  sourceUrl: string | null,
  submittedBy: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO market_transcripts (market_id, transcript, source_url, submitted_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (market_id) DO UPDATE SET
       transcript = EXCLUDED.transcript,
       source_url = EXCLUDED.source_url,
       submitted_by = EXCLUDED.submitted_by,
       created_at = NOW()`,
    [marketId, transcript, sourceUrl, submittedBy],
  )
}

export async function getTranscript(
  marketId: string,
): Promise<TranscriptRow | null> {
  const result = await pool.query(
    `SELECT * FROM market_transcripts WHERE market_id = $1`,
    [marketId],
  )
  return result.rows[0] || null
}

// ── Market Metadata ────────────────────────────────────

export interface MarketMetadataRow {
  id: number
  market_id: string
  image_url: string | null
  created_at: string
}

export async function upsertMarketImage(
  marketId: string,
  imageUrl: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO market_metadata (market_id, image_url)
     VALUES ($1, $2)
     ON CONFLICT (market_id) DO UPDATE SET
       image_url = EXCLUDED.image_url`,
    [marketId, imageUrl],
  )
}

export async function getMarketImage(
  marketId: string,
): Promise<string | null> {
  const result = await pool.query(
    `SELECT image_url FROM market_metadata WHERE market_id = $1`,
    [marketId],
  )
  return result.rows[0]?.image_url || null
}

export async function getMarketImages(
  marketIds: string[],
): Promise<Record<string, string>> {
  if (marketIds.length === 0) return {}
  const result = await pool.query(
    `SELECT market_id, image_url FROM market_metadata WHERE market_id = ANY($1) AND image_url IS NOT NULL`,
    [marketIds],
  )
  const map: Record<string, string> = {}
  for (const row of result.rows) {
    map[row.market_id] = row.image_url
  }
  return map
}

export async function getAllMarketImages(): Promise<Record<string, string>> {
  const result = await pool.query(
    `SELECT market_id, image_url FROM market_metadata WHERE image_url IS NOT NULL`,
  )
  const map: Record<string, string> = {}
  for (const row of result.rows) {
    map[row.market_id] = row.image_url
  }
  return map
}

export async function getVolumeByMarkets(
  marketIds: string[],
): Promise<Record<string, number>> {
  if (marketIds.length === 0) return {}
  const result = await pool.query(
    `SELECT market_id, COALESCE(SUM(ABS(cost)), 0) as total_cost
     FROM trade_events
     WHERE market_id = ANY($1)
     GROUP BY market_id`,
    [marketIds],
  )
  const map: Record<string, number> = {}
  for (const row of result.rows) {
    map[row.market_id] = parseFloat(row.total_cost)
  }
  return map
}

// ── User Profiles ─────────────────────────────────────

export interface ProfileRow {
  wallet: string
  username: string
  pfp_emoji: string | null
  discord_id: string | null
  discord_username: string | null
}

export async function getProfile(wallet: string): Promise<ProfileRow | null> {
  const result = await pool.query(
    `SELECT wallet, username, pfp_emoji, discord_id, discord_username FROM user_profiles WHERE wallet = $1`,
    [wallet],
  )
  return result.rows[0] || null
}


export async function getProfileByUsername(username: string): Promise<(ProfileRow & { created_at: string }) | null> {
  const result = await pool.query(
    `SELECT wallet, username, pfp_emoji, created_at FROM user_profiles WHERE LOWER(username) = LOWER($1)`,
    [username],
  )
  return result.rows[0] || null
}

export async function getProfileByWallet(wallet: string): Promise<(ProfileRow & { created_at: string }) | null> {
  const result = await pool.query(
    `SELECT wallet, username, pfp_emoji, created_at FROM user_profiles WHERE wallet = $1`,
    [wallet],
  )
  return result.rows[0] || null
}

export async function upsertProfile(
  wallet: string,
  username: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO user_profiles (wallet, username, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (wallet) DO UPDATE SET
       username = EXCLUDED.username,
       updated_at = NOW()`,
    [wallet, username],
  )
}

export async function updatePfpEmoji(
  wallet: string,
  pfpEmoji: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE user_profiles SET pfp_emoji = $2, updated_at = NOW() WHERE wallet = $1`,
    [wallet, pfpEmoji],
  )
}

export async function linkDiscord(
  wallet: string,
  discordId: string,
  discordUsername: string,
): Promise<void> {
  // Ensure the wallet row exists (upsert with minimal data), then set discord fields
  await pool.query(
    `INSERT INTO user_profiles (wallet, username, discord_id, discord_username, updated_at)
     VALUES ($1, $1, $2, $3, NOW())
     ON CONFLICT (wallet) DO UPDATE SET
       discord_id = EXCLUDED.discord_id,
       discord_username = EXCLUDED.discord_username,
       updated_at = NOW()`,
    [wallet, discordId, discordUsername],
  )
}

export async function unlinkDiscord(wallet: string): Promise<void> {
  await pool.query(
    `UPDATE user_profiles SET discord_id = NULL, discord_username = NULL, updated_at = NOW() WHERE wallet = $1`,
    [wallet],
  )
}

export async function getWalletByDiscordId(discordId: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT wallet FROM user_profiles WHERE discord_id = $1`,
    [discordId],
  )
  return result.rows[0]?.wallet || null
}

// ── Referrals ─────────────────────────────────────────

/**
 * Generate a unique referral code for a wallet. If one already exists, return it.
 * Format: first 4 chars of username (or wallet) + 4 random alphanumeric chars.
 */
export async function ensureReferralCode(wallet: string): Promise<string> {
  // Return existing code if present
  const existing = await pool.query(
    `SELECT referral_code FROM user_profiles WHERE wallet = $1 AND referral_code IS NOT NULL`,
    [wallet],
  )
  if (existing.rows[0]?.referral_code) return existing.rows[0].referral_code

  // Generate code: username prefix + random suffix
  const profile = await pool.query(
    `SELECT username FROM user_profiles WHERE wallet = $1`,
    [wallet],
  )
  const base = (profile.rows[0]?.username || wallet).slice(0, 4).toUpperCase()
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no ambiguous chars

  for (let attempt = 0; attempt < 10; attempt++) {
    let suffix = ''
    for (let i = 0; i < 4; i++) suffix += chars[Math.floor(Math.random() * chars.length)]
    const code = `${base}${suffix}`
    try {
      const res = await pool.query(
        `UPDATE user_profiles SET referral_code = $2, updated_at = NOW()
         WHERE wallet = $1 AND referral_code IS NULL
         RETURNING referral_code`,
        [wallet, code],
      )
      if (res.rows[0]) return res.rows[0].referral_code
      // referral_code was set between our SELECT and UPDATE — re-read
      const recheck = await pool.query(
        `SELECT referral_code FROM user_profiles WHERE wallet = $1`,
        [wallet],
      )
      if (recheck.rows[0]?.referral_code) return recheck.rows[0].referral_code
    } catch (err: unknown) {
      const msg = (err as Error).message || ''
      if (msg.includes('idx_profile_referral_code')) continue // collision, retry
      throw err
    }
  }
  throw new Error('Failed to generate unique referral code after 10 attempts')
}

/**
 * Look up the wallet that owns a referral code.
 */
export async function getWalletByReferralCode(code: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT wallet FROM user_profiles WHERE UPPER(referral_code) = UPPER($1)`,
    [code],
  )
  return result.rows[0]?.wallet || null
}

/**
 * Apply a referral relationship. Sets referred_by on the referee's profile.
 * Returns true if applied, false if already referred or self-referral.
 */
export async function applyReferral(refereeWallet: string, referrerWallet: string): Promise<boolean> {
  if (refereeWallet === referrerWallet) return false
  // Prevent circular referrals (A referred B, then B tries to refer A)
  const existing = await pool.query(
    `SELECT referred_by FROM user_profiles WHERE wallet = $1`,
    [referrerWallet],
  )
  if (existing.rows[0]?.referred_by === refereeWallet) return false
  const result = await pool.query(
    `UPDATE user_profiles SET referred_by = $2, updated_at = NOW()
     WHERE wallet = $1 AND referred_by IS NULL
     RETURNING wallet`,
    [refereeWallet, referrerWallet],
  )
  return result.rows.length > 0
}

/**
 * Get the referrer wallet for a given wallet (if any).
 */
export async function getReferrer(wallet: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT referred_by FROM user_profiles WHERE wallet = $1`,
    [wallet],
  )
  return result.rows[0]?.referred_by || null
}

/**
 * Count how many users a wallet has referred.
 */
export async function getReferralCount(wallet: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*) as cnt FROM user_profiles WHERE referred_by = $1`,
    [wallet],
  )
  return parseInt(result.rows[0]?.cnt ?? '0', 10)
}

/**
 * Get referral stats for a wallet: code, count referred, total bonus points earned.
 */
export async function getReferralStats(wallet: string): Promise<{
  referralCode: string | null
  referralCount: number
  referredBy: string | null
  bonusPointsEarned: number
}> {
  const [profileRes, countRes, bonusRes] = await Promise.all([
    pool.query(
      `SELECT referral_code, referred_by FROM user_profiles WHERE wallet = $1`,
      [wallet],
    ),
    pool.query(
      `SELECT COUNT(*) as cnt FROM user_profiles WHERE referred_by = $1`,
      [wallet],
    ),
    pool.query(
      `SELECT COALESCE(SUM(points), 0) as total FROM point_events
       WHERE wallet = $1 AND action = 'referral_bonus'`,
      [wallet],
    ),
  ])
  return {
    referralCode: profileRes.rows[0]?.referral_code || null,
    referralCount: parseInt(countRes.rows[0]?.cnt ?? '0', 10),
    referredBy: profileRes.rows[0]?.referred_by || null,
    bonusPointsEarned: parseInt(bonusRes.rows[0]?.total ?? '0', 10),
  }
}

/**
 * Get the list of users referred by a wallet.
 */
export async function getReferredUsers(wallet: string): Promise<{ wallet: string; username: string; createdAt: string }[]> {
  const result = await pool.query(
    `SELECT wallet, username, created_at FROM user_profiles WHERE referred_by = $1 ORDER BY created_at DESC`,
    [wallet],
  )
  return result.rows.map((r: any) => ({ wallet: r.wallet, username: r.username, createdAt: r.created_at }))
}

// ── Chat Messages ────────────────────────────────────

export interface ChatRow {
  id: number
  wallet: string
  username: string
  message: string
  created_at: string
}

export async function insertChatMessage(
  wallet: string,
  username: string,
  message: string,
): Promise<ChatRow> {
  const result = await pool.query(
    `INSERT INTO chat_messages (wallet, username, message)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [wallet, username, message],
  )
  return result.rows[0]
}

export async function getRecentChatMessages(
  limit = 50,
  afterId?: number,
): Promise<ChatRow[]> {
  if (afterId) {
    const result = await pool.query(
      `SELECT * FROM chat_messages WHERE id > $1 ORDER BY id ASC LIMIT $2`,
      [afterId, limit],
    )
    return result.rows
  }
  const result = await pool.query(
    `SELECT * FROM (
       SELECT * FROM chat_messages ORDER BY id DESC LIMIT $1
     ) sub ORDER BY id ASC`,
    [limit],
  )
  return result.rows
}

// ── Polymarket Trades ────────────────────────────────

export interface PolymarketTradeRow {
  id: number
  wallet: string
  market_id: string
  event_id: string
  is_yes: boolean
  is_buy: boolean
  side: string
  amount_usd: string
  tx_signature: string | null
  created_at: string
}

export async function insertPolymarketTrade(
  wallet: string,
  marketId: string,
  eventId: string,
  isYes: boolean,
  isBuy: boolean,
  side: string,
  amountUsd: string,
  txSignature?: string,
  marketTitle?: string | null,
): Promise<PolymarketTradeRow> {
  const result = await pool.query(
    `INSERT INTO polymarket_trades (wallet, market_id, event_id, is_yes, is_buy, side, amount_usd, tx_signature, market_title)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [wallet, marketId, eventId, isYes, isBuy, side, amountUsd, txSignature || null, marketTitle ?? null],
  )
  return result.rows[0]
}

export async function getPolymarketTradersSince(
  since: Date,
): Promise<string[]> {
  const result = await pool.query(
    `SELECT DISTINCT wallet FROM polymarket_trades WHERE created_at >= $1`,
    [since.toISOString()],
  )
  return result.rows.map((r: { wallet: string }) => r.wallet)
}

export async function getAllPolymarketTraders(): Promise<string[]> {
  const result = await pool.query(
    `SELECT DISTINCT wallet FROM polymarket_trades`,
  )
  return result.rows.map((r: { wallet: string }) => r.wallet)
}

// ── Event Chat Messages ──────────────────────────────

export interface EventChatRow {
  id: number
  event_id: string
  wallet: string
  username: string
  message: string
  created_at: string
  pfp_emoji: string | null
}

export async function insertEventChatMessage(
  eventId: string,
  wallet: string,
  username: string,
  message: string,
): Promise<EventChatRow> {
  const result = await pool.query(
    `INSERT INTO event_chat_messages (event_id, wallet, username, message)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [eventId, wallet, username, message],
  )
  return result.rows[0]
}

export async function getRecentEventChatMessages(
  eventId: string,
  limit = 50,
  afterId?: number,
): Promise<EventChatRow[]> {
  if (afterId) {
    const result = await pool.query(
      `SELECT m.*, p.pfp_emoji
       FROM event_chat_messages m
       LEFT JOIN user_profiles p ON p.wallet = m.wallet
       WHERE m.event_id = $1 AND m.id > $2
       ORDER BY m.id ASC LIMIT $3`,
      [eventId, afterId, limit],
    )
    return result.rows
  }
  const result = await pool.query(
    `SELECT * FROM (
       SELECT m.*, p.pfp_emoji
       FROM event_chat_messages m
       LEFT JOIN user_profiles p ON p.wallet = m.wallet
       WHERE m.event_id = $1
       ORDER BY m.id DESC LIMIT $2
     ) sub ORDER BY id ASC`,
    [eventId, limit],
  )
  return result.rows
}

// ── Event Streams ─────────────────────────────────────

export async function upsertEventStream(
  eventId: string,
  streamUrl: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO event_streams (event_id, stream_url, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (event_id) DO UPDATE SET stream_url = $2, updated_at = NOW()`,
    [eventId, streamUrl],
  )
}

export async function deleteEventStream(eventId: string): Promise<void> {
  await pool.query(`DELETE FROM event_streams WHERE event_id = $1`, [eventId])
}

export async function getEventStream(eventId: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT stream_url FROM event_streams WHERE event_id = $1`,
    [eventId],
  )
  return result.rows[0]?.stream_url ?? null
}

export async function getAllEventStreams(): Promise<{ eventId: string; streamUrl: string; updatedAt: string }[]> {
  const result = await pool.query(
    `SELECT event_id, stream_url, updated_at FROM event_streams ORDER BY updated_at DESC`,
  )
  return result.rows.map((r: any) => ({
    eventId: r.event_id,
    streamUrl: r.stream_url,
    updatedAt: r.updated_at,
  }))
}

// ── Point Events ──────────────────────────────────────

/**
 * Check if a wallet has a linked Discord account.
 */
export async function hasDiscordLinked(wallet: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM user_profiles WHERE wallet = $1 AND discord_id IS NOT NULL`,
    [wallet],
  )
  return result.rows.length > 0
}

const REFERRAL_BONUS_RATE = 0.10 // 10% mutual bonus

/**
 * Insert a point event. Returns awarded points, or null if deduped (ON CONFLICT DO NOTHING).
 * Points are only awarded to wallets with a linked Discord account.
 * Also awards 10% referral bonus to both referrer and referred if a relationship exists.
 */
export async function insertPointEvent(
  wallet: string,
  action: string,
  points: number,
  refId?: string,
  metadata?: Record<string, unknown>,
): Promise<number | null> {
  const discordLinked = await hasDiscordLinked(wallet)
  if (!discordLinked) return null

  const result = await pool.query(
    `INSERT INTO point_events (wallet, action, points, ref_id, metadata)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (wallet, action, ref_id) WHERE ref_id IS NOT NULL DO NOTHING
     RETURNING points`,
    [wallet, action, points, refId ?? null, metadata ? JSON.stringify(metadata) : null],
  )
  const awarded = result.rows[0]?.points ?? null
  if (awarded === null || awarded === 0) return awarded

  // Don't award referral bonus on referral_bonus events (prevent recursion)
  if (action === 'referral_bonus') return awarded

  const bonus = Math.floor(awarded * REFERRAL_BONUS_RATE)
  if (bonus <= 0) return awarded

  // Mutual 10% referral bonus:
  // If this wallet was referred by someone → referrer gets 10%
  const referrer = await getReferrer(wallet)
  if (referrer) {
    await pool.query(
      `INSERT INTO point_events (wallet, action, points, ref_id, metadata)
       VALUES ($1, 'referral_bonus', $2, $3, $4)
       ON CONFLICT (wallet, action, ref_id) WHERE ref_id IS NOT NULL DO NOTHING`,
      [referrer, bonus, `ref:${wallet}:${action}:${refId ?? '_'}`,
       JSON.stringify({ fromWallet: wallet, originalAction: action })],
    )
  }

  // If this wallet referred others → each referred user gets 10%
  const referred = await pool.query(
    `SELECT wallet FROM user_profiles WHERE referred_by = $1`,
    [wallet],
  )
  for (const row of referred.rows) {
    await pool.query(
      `INSERT INTO point_events (wallet, action, points, ref_id, metadata)
       VALUES ($1, 'referral_bonus', $2, $3, $4)
       ON CONFLICT (wallet, action, ref_id) WHERE ref_id IS NOT NULL DO NOTHING`,
      [row.wallet, bonus, `ref:${wallet}:${action}:${refId ?? '_'}`,
       JSON.stringify({ fromWallet: wallet, originalAction: action })],
    )
  }

  return awarded
}

/**
 * Count chat_message point events for a wallet since UTC midnight today.
 */
export async function getChatPointsCountToday(wallet: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*) as cnt FROM point_events
     WHERE wallet = $1
       AND action = 'chat_message'
       AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')`,
    [wallet],
  )
  return parseInt(result.rows[0]?.cnt ?? '0', 10)
}

/**
 * Count trade_placed point events for a wallet since UTC midnight today.
 */
export async function getTradePointsCountToday(wallet: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*) as cnt FROM point_events
     WHERE wallet = $1
       AND action = 'trade_placed'
       AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')`,
    [wallet],
  )
  return parseInt(result.rows[0]?.cnt ?? '0', 10)
}

/**
 * Get the earliest trade time for a wallet+marketId combination from polymarket_trades.
 */
export async function getEarliestTradeTime(
  wallet: string,
  marketId: string,
): Promise<Date | null> {
  const result = await pool.query(
    `SELECT MIN(created_at) as earliest FROM polymarket_trades
     WHERE wallet = $1 AND market_id = $2`,
    [wallet, marketId],
  )
  const ts = result.rows[0]?.earliest
  return ts ? new Date(ts) : null
}

export interface PointTotalsRow {
  wallet: string
  all_time: number
  weekly: number
  trade_count: number
  win_count: number
  chat_count: number
  hold_count: number
}

/**
 * Aggregate point totals for a list of wallets (single query, no N+1).
 */
export async function getWalletPointTotal(wallet: string): Promise<number> {
  const result = await pool.query(
    `SELECT COALESCE(SUM(points), 0)::int AS total FROM point_events WHERE wallet = $1`,
    [wallet],
  )
  return result.rows[0]?.total ?? 0
}

export async function getWalletWeeklyPoints(wallet: string, weekStart: Date): Promise<number> {
  const result = await pool.query(
    `SELECT COALESCE(SUM(points), 0)::int AS total FROM point_events WHERE wallet = $1 AND created_at >= $2`,
    [wallet, weekStart.toISOString()],
  )
  return result.rows[0]?.total ?? 0
}

export async function getWalletPointHistory(wallet: string): Promise<{ points: number; created_at: string }[]> {
  const result = await pool.query(
    `SELECT points, created_at FROM point_events WHERE wallet = $1 ORDER BY created_at ASC`,
    [wallet],
  )
  return result.rows
}

export async function getBulkPointTotals(
  wallets: string[],
  weekStart: Date,
): Promise<PointTotalsRow[]> {
  if (wallets.length === 0) return []
  const result = await pool.query(
    `SELECT
       wallet,
       COALESCE(SUM(points), 0)::int AS all_time,
       COALESCE(SUM(points) FILTER (WHERE created_at >= $2), 0)::int AS weekly,
       COALESCE(COUNT(*) FILTER (WHERE action = 'trade_placed'), 0)::int AS trade_count,
       COALESCE(COUNT(*) FILTER (WHERE action = 'claim_won'), 0)::int AS win_count,
       COALESCE(COUNT(*) FILTER (WHERE action = 'chat_message'), 0)::int AS chat_count,
       COALESCE(COUNT(*) FILTER (WHERE action IN ('hold_1h', 'hold_4h', 'hold_24h')), 0)::int AS hold_count
     FROM point_events
     WHERE wallet = ANY($1)
     GROUP BY wallet`,
    [wallets, weekStart.toISOString()],
  )
  return result.rows
}

// ── Achievements ─────────────────────────────────────

/**
 * Insert an achievement unlock. Returns true if newly inserted (not a dupe).
 */
export async function unlockAchievement(
  wallet: string,
  achievementId: string,
  points: number,
): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO user_achievements (wallet, achievement_id, points_awarded)
     VALUES ($1, $2, $3)
     ON CONFLICT (wallet, achievement_id) DO NOTHING
     RETURNING id`,
    [wallet, achievementId, points],
  )
  return (result.rowCount ?? 0) > 0
}

/**
 * Get all unlocked achievements for a wallet.
 */
export async function getUnlockedAchievements(
  wallet: string,
): Promise<{ achievement_id: string; unlocked_at: string }[]> {
  const result = await pool.query(
    `SELECT achievement_id, unlocked_at FROM user_achievements WHERE wallet = $1`,
    [wallet],
  )
  return result.rows
}

// ── Achievement count helpers ────────────────────────

/** Count polymarket trades for a wallet */
export async function getPolymarketTradeCount(wallet: string): Promise<number> {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c FROM polymarket_trades WHERE wallet = $1`,
    [wallet],
  )
  return r.rows[0]?.c ?? 0
}

/** Count polymarket wins (claims) for a wallet */
export async function getPolymarketWinCount(wallet: string): Promise<number> {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c FROM point_events WHERE wallet = $1 AND action = 'claim_won'`,
    [wallet],
  )
  return r.rows[0]?.c ?? 0
}

/** Count chat messages for a wallet (global + event) */
export async function getChatMessageCount(wallet: string): Promise<number> {
  const r = await pool.query(
    `SELECT (
       (SELECT COUNT(*) FROM chat_messages WHERE wallet = $1) +
       (SELECT COUNT(*) FROM event_chat_messages WHERE wallet = $1)
     )::int AS c`,
    [wallet],
  )
  return r.rows[0]?.c ?? 0
}

/** Count custom (free) market trades for a wallet */
export async function getCustomMarketTradeCount(wallet: string): Promise<number> {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c FROM custom_market_trades WHERE wallet = $1`,
    [wallet],
  )
  return r.rows[0]?.c ?? 0
}

// -- Wallet-level free market aggregates --

export async function getWalletFreeMarketPositions(wallet: string): Promise<
  (CustomMarketPositionRow & { word: string; market_title: string; market_status: string })[]
> {
  const result = await pool.query(
    `SELECT p.*, w.word, m.title AS market_title, m.status AS market_status, m.slug AS market_slug
     FROM custom_market_positions p
     JOIN custom_market_words w ON w.id = p.word_id
     JOIN custom_markets m ON m.id = p.market_id
     WHERE p.wallet = $1
       AND (p.yes_shares::numeric > 0 OR p.no_shares::numeric > 0)
     ORDER BY p.updated_at DESC`,
    [wallet],
  )
  return result.rows
}

export async function getWalletFreeMarketTrades(wallet: string, limit: number = 50): Promise<
  (CustomMarketTradeRow & { word: string; market_title: string })[]
> {
  const result = await pool.query(
    `SELECT t.*, w.word, m.title AS market_title, m.slug AS market_slug
     FROM custom_market_trades t
     JOIN custom_market_words w ON w.id = t.word_id
     JOIN custom_markets m ON m.id = t.market_id
     WHERE t.wallet = $1
     ORDER BY t.created_at DESC
     LIMIT $2`,
    [wallet, limit],
  )
  return result.rows
}

export async function getWalletFreeMarketStats(wallet: string): Promise<{
  totalMarkets: number
  totalTrades: number
  totalTokensSpent: number
  totalTokensReceived: number
  activePositions: number
  totalPoints: number
}> {
  const result = await pool.query(
    `SELECT
       COUNT(DISTINCT p.market_id)::int AS total_markets,
       (SELECT COUNT(*)::int FROM custom_market_trades WHERE wallet = $1) AS total_trades,
       COALESCE(SUM(p.tokens_spent::numeric), 0)::float AS total_tokens_spent,
       COALESCE(SUM(p.tokens_received::numeric), 0)::float AS total_tokens_received,
       COALESCE(SUM(CASE WHEN p.yes_shares::numeric > 0 OR p.no_shares::numeric > 0 THEN 1 ELSE 0 END), 0)::int AS active_positions,
       (SELECT COALESCE(SUM(points), 0)::int FROM point_events WHERE wallet = $1 AND action = 'custom_market_win') AS total_points
     FROM custom_market_positions p
     WHERE p.wallet = $1`,
    [wallet],
  )
  const r = result.rows[0]
  return {
    totalMarkets: r?.total_markets ?? 0,
    totalTrades: r?.total_trades ?? 0,
    totalTokensSpent: r?.total_tokens_spent ?? 0,
    totalTokensReceived: r?.total_tokens_received ?? 0,
    activePositions: r?.active_positions ?? 0,
    totalPoints: r?.total_points ?? 0,
  }
}

// ── Custom Markets ───────────────────────────────────

export interface CustomMarketRow {
  id: number
  title: string
  description: string | null
  cover_image_url: string | null
  stream_url: string | null
  status: string
  lock_time: string | null
  b_parameter: number
  play_tokens: number
  slug: string
  created_at: string
  updated_at: string
}

export interface CustomMarketWordRow {
  id: number
  market_id: number
  word: string
  resolved_outcome: boolean | null
}

export interface CustomMarketPoolRow {
  word_id: number
  yes_qty: string
  no_qty: string
  updated_at: string
}

export interface CustomMarketPositionRow {
  id: number
  market_id: number
  word_id: number
  wallet: string
  yes_shares: string
  no_shares: string
  tokens_spent: string
  tokens_received: string
  updated_at: string
}

export interface CustomMarketBalanceRow {
  market_id: number
  wallet: string
  balance: string
}

export interface CustomMarketTradeRow {
  id: number
  market_id: number
  word_id: number
  wallet: string
  action: string
  side: string
  shares: string
  cost: string
  yes_price: string
  no_price: string
  created_at: string
}

export interface CustomMarketPriceHistoryRow {
  id: number
  word_id: number
  yes_price: string
  no_price: string
  recorded_at: string
}

function generateSlug(prefix: string): string {
  const hex = crypto.randomBytes(3).toString('hex')
  return `${prefix}-${hex}`
}

export async function createCustomMarket(
  title: string,
  description: string | null,
  coverImageUrl: string | null,
  streamUrl: string | null,
  lockTime: string | null,
  bParameter: number,
  playTokens: number,
  urlPrefix: string,
): Promise<CustomMarketRow> {
  const slug = generateSlug(urlPrefix)
  const result = await pool.query(
    `INSERT INTO custom_markets (title, description, cover_image_url, stream_url, lock_time, b_parameter, play_tokens, slug)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [title, description, coverImageUrl, streamUrl, lockTime, bParameter, playTokens, slug],
  )
  return result.rows[0]
}

const UPDATABLE_MARKET_FIELDS = ['title', 'description', 'cover_image_url', 'stream_url', 'lock_time'] as const

export async function updateCustomMarket(
  id: number,
  fields: Partial<Pick<CustomMarketRow, 'title' | 'description' | 'cover_image_url' | 'stream_url' | 'lock_time'>>,
): Promise<CustomMarketRow | null> {
  const setClauses: string[] = []
  const values: (string | number | null)[] = []
  let paramIndex = 1

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && (UPDATABLE_MARKET_FIELDS as readonly string[]).includes(key)) {
      setClauses.push(`"${key}" = $${paramIndex}`)
      values.push(value as string | null)
      paramIndex++
    }
  }

  if (setClauses.length === 0) return getCustomMarket(id)

  setClauses.push('updated_at = NOW()')
  values.push(id)

  const result = await pool.query(
    `UPDATE custom_markets SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values,
  )
  return result.rows[0] || null
}

export async function deleteCustomMarket(id: number): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM custom_markets WHERE id = $1`,
    [id],
  )
  return (result.rowCount ?? 0) > 0
}

export async function updateCustomMarketStatus(
  id: number,
  status: string,
  expectedCurrentStatus?: string,
): Promise<CustomMarketRow | null> {
  const query = expectedCurrentStatus
    ? `UPDATE custom_markets SET status = $1, updated_at = NOW() WHERE id = $2 AND status = $3 RETURNING *`
    : `UPDATE custom_markets SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`
  const params = expectedCurrentStatus ? [status, id, expectedCurrentStatus] : [status, id]
  const result = await pool.query(query, params)
  return result.rows[0] || null
}

export async function lockCustomMarket(id: number): Promise<CustomMarketRow | null> {
  const result = await pool.query(
    `UPDATE custom_markets
     SET status = 'locked',
         lock_time = COALESCE(lock_time, NOW()),
         updated_at = NOW()
     WHERE id = $1 AND status = 'open'
     RETURNING *`,
    [id],
  )
  return result.rows[0] || null
}

export async function getCustomMarket(id: number): Promise<CustomMarketRow | null> {
  const result = await pool.query(
    `SELECT * FROM custom_markets WHERE id = $1`,
    [id],
  )
  return result.rows[0] || null
}

export async function getCustomMarketBySlug(slug: string): Promise<CustomMarketRow | null> {
  const result = await pool.query(
    `SELECT * FROM custom_markets WHERE slug = $1`,
    [slug],
  )
  return result.rows[0] || null
}

export interface CustomMarketWordPrice {
  word_id: number
  market_id: number
  word: string
  yes_price: number
  no_price: number
  resolved_outcome: boolean | null
}

export interface CustomMarketListRow extends CustomMarketRow {
  word_count: number
  trader_count: number
  words_prices: CustomMarketWordPrice[]
}

export async function listCustomMarketsPublic(): Promise<CustomMarketListRow[]> {
  const [marketsResult, poolsResult] = await Promise.all([
    pool.query(
      `SELECT m.*,
         COALESCE(w.cnt, 0)::int AS word_count,
         COALESCE(p.cnt, 0)::int AS trader_count
       FROM custom_markets m
       LEFT JOIN (SELECT market_id, COUNT(*)::int AS cnt FROM custom_market_words GROUP BY market_id) w ON w.market_id = m.id
       LEFT JOIN (SELECT market_id, COUNT(DISTINCT wallet)::int AS cnt FROM custom_market_positions GROUP BY market_id) p ON p.market_id = m.id
       WHERE m.status IN ('open', 'locked', 'resolved')
       ORDER BY m.created_at DESC`,
    ),
    pool.query(
      `SELECT w.id AS word_id, w.market_id, w.word, w.resolved_outcome,
              COALESCE(p.yes_qty, 0) AS yes_qty, COALESCE(p.no_qty, 0) AS no_qty
       FROM custom_market_words w
       INNER JOIN custom_markets m ON m.id = w.market_id AND m.status IN ('open', 'locked', 'resolved')
       LEFT JOIN custom_market_word_pools p ON p.word_id = w.id
       ORDER BY w.id`,
    ),
  ])

  const bByMarket = new Map<number, number>()
  for (const m of marketsResult.rows) {
    bByMarket.set(m.id, parseFloat(m.b_parameter))
  }

  const pricesByMarket = new Map<number, CustomMarketWordPrice[]>()
  for (const r of poolsResult.rows) {
    const b = bByMarket.get(r.market_id) || 500
    const yesQty = parseFloat(r.yes_qty)
    const noQty = parseFloat(r.no_qty)
    const prices = virtualImpliedPrice(yesQty, noQty, b)
    const isResolved = r.resolved_outcome !== null
    const entry: CustomMarketWordPrice = {
      word_id: r.word_id,
      market_id: r.market_id,
      word: r.word,
      yes_price: isResolved ? (r.resolved_outcome ? 1 : 0) : prices.yes,
      no_price: isResolved ? (r.resolved_outcome ? 0 : 1) : prices.no,
      resolved_outcome: r.resolved_outcome ?? null,
    }
    const arr = pricesByMarket.get(r.market_id) || []
    arr.push(entry)
    pricesByMarket.set(r.market_id, arr)
  }

  return marketsResult.rows.map((m: any) => ({
    ...m,
    words_prices: pricesByMarket.get(m.id) || [],
  }))
}

export interface CustomMarketAdminRow extends CustomMarketRow {
  words: CustomMarketWordRow[]
}

export async function listCustomMarketsAdmin(): Promise<CustomMarketAdminRow[]> {
  const [marketsResult, wordsResult] = await Promise.all([
    pool.query(`SELECT * FROM custom_markets ORDER BY created_at DESC`),
    pool.query(`SELECT * FROM custom_market_words ORDER BY id`),
  ])

  const wordsByMarket = new Map<number, CustomMarketWordRow[]>()
  for (const w of wordsResult.rows) {
    const arr = wordsByMarket.get(w.market_id) || []
    arr.push(w)
    wordsByMarket.set(w.market_id, arr)
  }

  return marketsResult.rows.map((m: CustomMarketRow) => ({
    ...m,
    words: wordsByMarket.get(m.id) || [],
  }))
}

// -- Words --

export async function addCustomMarketWords(
  marketId: number,
  words: string[],
): Promise<CustomMarketWordRow[]> {
  if (words.length === 0) return []
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const values: (number | string)[] = []
    const placeholders: string[] = []
    words.forEach((word, i) => {
      values.push(marketId, word.trim())
      placeholders.push(`($${i * 2 + 1}, $${i * 2 + 2})`)
    })
    const result = await client.query(
      `INSERT INTO custom_market_words (market_id, word) VALUES ${placeholders.join(', ')} RETURNING *`,
      values,
    )
    // Create pool rows for each word atomically
    if (result.rows.length > 0) {
      const poolPlaceholders = result.rows.map((_: CustomMarketWordRow, i: number) => `($${i + 1})`).join(', ')
      const poolValues = result.rows.map((r: CustomMarketWordRow) => r.id)
      await client.query(
        `INSERT INTO custom_market_word_pools (word_id) VALUES ${poolPlaceholders}`,
        poolValues,
      )
    }
    await client.query('COMMIT')
    return result.rows
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function getCustomMarketWords(marketId: number): Promise<CustomMarketWordRow[]> {
  const result = await pool.query(
    `SELECT * FROM custom_market_words WHERE market_id = $1 ORDER BY id`,
    [marketId],
  )
  return result.rows
}

export async function removeCustomMarketWord(marketId: number, wordId: number): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM custom_market_words WHERE id = $1 AND market_id = $2`,
    [wordId, marketId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function resolveCustomMarketWords(
  marketId: number,
  resolutions: { wordId: number; outcome: boolean }[],
): Promise<void> {
  if (resolutions.length === 0) return
  const cases: string[] = []
  const ids: number[] = []
  const values: (number | boolean)[] = []
  let paramIndex = 1

  // First param is market_id for the WHERE clause
  values.push(marketId)
  paramIndex++

  for (const { wordId, outcome } of resolutions) {
    cases.push(`WHEN id = $${paramIndex} THEN $${paramIndex + 1}::boolean`)
    values.push(wordId, outcome)
    ids.push(wordId)
    paramIndex += 2
  }

  values.push(...ids)
  const idPlaceholders = ids.map((_, i) => `$${paramIndex + i}`).join(', ')

  await pool.query(
    `UPDATE custom_market_words SET resolved_outcome = CASE ${cases.join(' ')} END WHERE market_id = $1 AND id IN (${idPlaceholders})`,
    values,
  )
}

// -- Pools --

export async function getWordPools(marketId: number): Promise<CustomMarketPoolRow[]> {
  const result = await pool.query(
    `SELECT p.* FROM custom_market_word_pools p
     JOIN custom_market_words w ON w.id = p.word_id
     WHERE w.market_id = $1
     ORDER BY p.word_id`,
    [marketId],
  )
  return result.rows
}

// -- Positions & Balances --

export async function getUserPositions(
  marketId: number,
  wallet: string,
): Promise<(CustomMarketPositionRow & { word: string })[]> {
  const result = await pool.query(
    `SELECT p.*, w.word FROM custom_market_positions p
     JOIN custom_market_words w ON w.id = p.word_id
     WHERE p.market_id = $1 AND p.wallet = $2
     ORDER BY p.word_id`,
    [marketId, wallet],
  )
  return result.rows
}

export async function getUserBalance(
  marketId: number,
  wallet: string,
): Promise<CustomMarketBalanceRow | null> {
  const result = await pool.query(
    `SELECT * FROM custom_market_balances WHERE market_id = $1 AND wallet = $2`,
    [marketId, wallet],
  )
  return result.rows[0] || null
}

export async function getMarketTraderCount(marketId: number): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(DISTINCT wallet)::int AS cnt FROM custom_market_positions WHERE market_id = $1`,
    [marketId],
  )
  return result.rows[0]?.cnt ?? 0
}

export async function getWordTraderCounts(
  marketId: number,
): Promise<{ word_id: number; trader_count: number }[]> {
  const result = await pool.query(
    `SELECT word_id, COUNT(DISTINCT wallet)::int AS trader_count
     FROM custom_market_positions WHERE market_id = $1
     GROUP BY word_id`,
    [marketId],
  )
  return result.rows
}

// -- Trade History --

export async function getTradeHistory(
  marketId: number,
  limit: number = 50,
  wallet?: string,
): Promise<(CustomMarketTradeRow & { username: string | null; word: string })[]> {
  const params: (number | string)[] = [marketId]
  let walletClause = ''
  if (wallet) {
    walletClause = ` AND t.wallet = $2`
    params.push(wallet)
  }
  params.push(limit)
  const limitParam = `$${params.length}`
  const result = await pool.query(
    `SELECT t.*, up.username, w.word
     FROM custom_market_trades t
     LEFT JOIN user_profiles up ON up.wallet = t.wallet
     JOIN custom_market_words w ON w.id = t.word_id
     WHERE t.market_id = $1${walletClause}
     ORDER BY t.created_at DESC
     LIMIT ${limitParam}`,
    params,
  )
  return result.rows
}

// -- Price History --

export async function getPriceHistory(wordId: number): Promise<CustomMarketPriceHistoryRow[]> {
  const result = await pool.query(
    `SELECT * FROM custom_market_price_history WHERE word_id = $1 ORDER BY recorded_at ASC`,
    [wordId],
  )
  return result.rows
}

export async function getPriceHistoryForMarket(
  marketId: number,
): Promise<(CustomMarketPriceHistoryRow & { word: string })[]> {
  const result = await pool.query(
    `SELECT ph.*, w.word FROM custom_market_price_history ph
     JOIN custom_market_words w ON w.id = ph.word_id
     WHERE w.market_id = $1
     ORDER BY ph.recorded_at ASC`,
    [marketId],
  )
  return result.rows
}

// -- Scoring Queries --

export async function getMarketProfitByWallet(
  marketId: number,
): Promise<{ wallet: string; tokens_spent: number; tokens_received: number }[]> {
  const result = await pool.query(
    `SELECT wallet,
            SUM(tokens_spent)::numeric AS tokens_spent,
            SUM(tokens_received)::numeric AS tokens_received
     FROM custom_market_positions WHERE market_id = $1
     GROUP BY wallet`,
    [marketId],
  )
  return result.rows.map((r: any) => ({
    wallet: r.wallet,
    tokens_spent: parseFloat(r.tokens_spent),
    tokens_received: parseFloat(r.tokens_received),
  }))
}

export async function resolveWordPositionsPayout(
  wordId: number,
  outcome: 'YES' | 'NO',
): Promise<void> {
  await pool.query(
    `UPDATE custom_market_positions
     SET tokens_received = tokens_received + CASE WHEN $2 = 'YES' THEN yes_shares ELSE no_shares END,
         updated_at = NOW()
     WHERE word_id = $1`,
    [wordId, outcome],
  )
}

// -- Virtual Trade (transactional) --

export interface VirtualTradeResult {
  tradeId: number
  cost: number
  shares: number
  newYesPrice: number
  newNoPrice: number
  newBalance: number
  newYesShares: number
  newNoShares: number
}

export async function executeVirtualTrade(
  marketId: number,
  wordId: number,
  wallet: string,
  action: 'buy' | 'sell',
  side: 'YES' | 'NO',
  amount: number,
  amountType: 'tokens' | 'shares',
): Promise<VirtualTradeResult> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 1. Lock pool row
    const poolResult = await client.query(
      'SELECT * FROM custom_market_word_pools WHERE word_id = $1 FOR UPDATE',
      [wordId],
    )
    const poolRow = poolResult.rows[0]
    if (!poolRow) throw new Error('Pool not found for word')

    const yesQty = parseFloat(poolRow.yes_qty)
    const noQty = parseFloat(poolRow.no_qty)

    // 2. Get market for b_parameter and play_tokens
    const marketResult = await client.query(
      'SELECT b_parameter, play_tokens FROM custom_markets WHERE id = $1',
      [marketId],
    )
    const market = marketResult.rows[0]
    if (!market) throw new Error('Market not found')
    const b = parseFloat(market.b_parameter)

    // 3. Get or create balance (lazy creation with FOR UPDATE)
    let balanceResult = await client.query(
      'SELECT balance FROM custom_market_balances WHERE market_id = $1 AND wallet = $2 FOR UPDATE',
      [marketId, wallet],
    )
    if (balanceResult.rows.length === 0) {
      balanceResult = await client.query(
        'INSERT INTO custom_market_balances (market_id, wallet, balance) VALUES ($1, $2, $3) RETURNING balance',
        [marketId, wallet, market.play_tokens],
      )
    }
    let balance = parseFloat(balanceResult.rows[0].balance)

    // 4. Get current position (or defaults)
    const posResult = await client.query(
      'SELECT * FROM custom_market_positions WHERE word_id = $1 AND wallet = $2 FOR UPDATE',
      [wordId, wallet],
    )
    const pos = posResult.rows[0]
    let curYesShares = pos ? parseFloat(pos.yes_shares) : 0
    let curNoShares = pos ? parseFloat(pos.no_shares) : 0
    let curTokensSpent = pos ? parseFloat(pos.tokens_spent) : 0
    let curTokensReceived = pos ? parseFloat(pos.tokens_received) : 0

    // 5. Compute cost/shares
    let shares: number
    let cost: number

    if (action === 'buy') {
      if (amountType === 'tokens') {
        shares = sharesForTokens(yesQty, noQty, side, amount, b)
        cost = virtualBuyCost(yesQty, noQty, side, shares, b)
        // Clamp cost to not exceed the requested token amount
        if (cost > amount) {
          cost = amount
          shares = sharesForTokens(yesQty, noQty, side, cost, b)
        }
      } else {
        shares = amount
        cost = virtualBuyCost(yesQty, noQty, side, shares, b)
      }
      if (cost > balance + 0.000001) throw new Error('Insufficient balance')
      cost = Math.min(cost, balance) // clamp for float precision
    } else {
      shares = amount // sells always in shares
      const held = side === 'YES' ? curYesShares : curNoShares
      if (shares > held + 0.000001) throw new Error('Insufficient shares')
      shares = Math.min(shares, held)
      cost = virtualSellReturn(yesQty, noQty, side, shares, b)
    }

    // 6. Update pool quantities
    const newYesQty = side === 'YES'
      ? (action === 'buy' ? yesQty + shares : yesQty - shares)
      : yesQty
    const newNoQty = side === 'NO'
      ? (action === 'buy' ? noQty + shares : noQty - shares)
      : noQty

    await client.query(
      'UPDATE custom_market_word_pools SET yes_qty = $1, no_qty = $2, updated_at = NOW() WHERE word_id = $3',
      [newYesQty, newNoQty, wordId],
    )

    // 7. Upsert position
    if (action === 'buy') {
      if (side === 'YES') curYesShares += shares
      else curNoShares += shares
      curTokensSpent += cost
    } else {
      if (side === 'YES') curYesShares -= shares
      else curNoShares -= shares
      curTokensReceived += cost
    }

    await client.query(
      `INSERT INTO custom_market_positions (market_id, word_id, wallet, yes_shares, no_shares, tokens_spent, tokens_received)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (word_id, wallet) DO UPDATE SET
         yes_shares = $4, no_shares = $5, tokens_spent = $6, tokens_received = $7, updated_at = NOW()`,
      [marketId, wordId, wallet, curYesShares, curNoShares, curTokensSpent, curTokensReceived],
    )

    // 8. Update balance
    const newBalance = action === 'buy' ? balance - cost : balance + cost
    await client.query(
      'UPDATE custom_market_balances SET balance = $1 WHERE market_id = $2 AND wallet = $3',
      [newBalance, marketId, wallet],
    )

    // 9. Compute new implied price
    const newPrices = virtualImpliedPrice(newYesQty, newNoQty, b)

    // 10. Insert trade record
    const tradeResult = await client.query(
      `INSERT INTO custom_market_trades (market_id, word_id, wallet, action, side, shares, cost, yes_price, no_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [marketId, wordId, wallet, action, side, shares, cost, newPrices.yes, newPrices.no],
    )

    // 11. Insert price history
    await client.query(
      'INSERT INTO custom_market_price_history (word_id, yes_price, no_price) VALUES ($1, $2, $3)',
      [wordId, newPrices.yes, newPrices.no],
    )

    await client.query('COMMIT')

    return {
      tradeId: tradeResult.rows[0].id,
      cost,
      shares,
      newYesPrice: newPrices.yes,
      newNoPrice: newPrices.no,
      newBalance,
      newYesShares: curYesShares,
      newNoShares: curNoShares,
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export { pool }
