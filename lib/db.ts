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
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

pool.on('connect', (client) => {
  client.query('SET statement_timeout = 30000').catch(() => {})
})

// ── TTL Cache ────────────────────────────────────────────
interface CacheEntry<T> { value: T; expires: number }

class TtlCache<T> {
  private store = new Map<string, CacheEntry<T>>()
  private defaultTtlMs: number

  constructor(defaultTtlMs: number) {
    this.defaultTtlMs = defaultTtlMs
    // Sweep expired entries every 60s
    setInterval(() => {
      const now = Date.now()
      for (const [key, entry] of this.store) {
        if (entry.expires <= now) this.store.delete(key)
      }
    }, 60_000)
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (entry.expires <= Date.now()) { this.store.delete(key); return undefined }
    return entry.value
  }

  set(key: string, value: T, ttlMs?: number): void {
    this.store.set(key, { value, expires: Date.now() + (ttlMs ?? this.defaultTtlMs) })
  }

  delete(key: string): void { this.store.delete(key) }

  deleteByPrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key)
    }
  }
}

const discordCache = new TtlCache<boolean>(15 * 60_000)  // 15 min for linked
const DISCORD_UNLINKED_TTL = 10_000                       // 10s for unlinked
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const marketCache = new TtlCache<any>(15_000)             // 15s
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wordsCache = new TtlCache<any>(15_000)              // 15s

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
  locked_at: string | null
}

export async function getProfile(wallet: string): Promise<ProfileRow | null> {
  const result = await pool.query(
    `SELECT wallet, username, pfp_emoji, discord_id, discord_username, locked_at FROM user_profiles WHERE wallet = $1`,
    [wallet],
  )
  return result.rows[0] || null
}


export async function getProfileByUsername(
  username: string,
): Promise<(ProfileRow & { created_at: string; locked_at: string | null }) | null> {
  const result = await pool.query(
    `SELECT wallet, username, pfp_emoji, created_at, locked_at FROM user_profiles WHERE LOWER(username) = LOWER($1)`,
    [username],
  )
  return result.rows[0] || null
}

/** Escape SQL LIKE/ILIKE wildcards so user input is matched literally */
function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&')
}

export async function searchProfiles(query: string): Promise<Pick<ProfileRow, 'wallet' | 'username' | 'pfp_emoji'>[]> {
  const result = await pool.query(
    `SELECT wallet, username, pfp_emoji FROM user_profiles WHERE username ILIKE $1 ESCAPE '\\' ORDER BY username LIMIT 10`,
    [`%${escapeLike(query)}%`],
  )
  return result.rows
}

export async function searchCustomMarkets(query: string): Promise<{ id: number; title: string; slug: string; status: string; cover_image_url: string | null }[]> {
  const result = await pool.query(
    `SELECT id, title, slug, status, cover_image_url FROM custom_markets WHERE title ILIKE $1 ESCAPE '\\' AND status != 'draft' ORDER BY status, title LIMIT 10`,
    [`%${escapeLike(query)}%`],
  )
  return result.rows
}

export async function getProfileByWallet(
  wallet: string,
): Promise<(ProfileRow & { created_at: string; locked_at: string | null }) | null> {
  const result = await pool.query(
    `SELECT wallet, username, pfp_emoji, created_at, locked_at FROM user_profiles WHERE wallet = $1`,
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

/**
 * Throws WALLET_LOCKED if the wallet exists and has been admin-locked.
 * Used to prevent locked users from changing their discord_id (which would
 * free up the previously-banned Discord for re-link on a fresh wallet).
 */
async function assertNotLocked(wallet: string): Promise<void> {
  const result = await pool.query(
    `SELECT 1 FROM user_profiles WHERE wallet = $1 AND locked_at IS NOT NULL LIMIT 1`,
    [wallet],
  )
  if (result.rows.length > 0) throw new Error('WALLET_LOCKED')
}

export async function linkDiscord(
  wallet: string,
  discordId: string,
  discordUsername: string,
): Promise<void> {
  await assertNotLocked(wallet)
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
  discordCache.set(wallet, true)
}

export async function unlinkDiscord(wallet: string): Promise<void> {
  await assertNotLocked(wallet)
  await pool.query(
    `UPDATE user_profiles SET discord_id = NULL, discord_username = NULL, updated_at = NOW() WHERE wallet = $1`,
    [wallet],
  )
  discordCache.set(wallet, false, DISCORD_UNLINKED_TTL)
}

export async function getWalletByDiscordId(discordId: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT wallet FROM user_profiles WHERE discord_id = $1`,
    [discordId],
  )
  return result.rows[0]?.wallet || null
}

/**
 * Get the Discord ID for a wallet (if linked). Used for account-age checks.
 */
export async function getDiscordIdByWallet(wallet: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT discord_id FROM user_profiles WHERE wallet = $1`,
    [wallet],
  )
  return result.rows[0]?.discord_id || null
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

/** Lightweight query for unread badge — returns latest id and optional count since afterId */
export async function getLatestChatId(
  afterId?: number,
): Promise<{ latestId: number; count: number }> {
  if (afterId) {
    const result = await pool.query(
      `SELECT COALESCE(MAX(id), 0)::int AS latest_id, COUNT(*)::int AS count
       FROM chat_messages WHERE id > $1`,
      [afterId],
    )
    return { latestId: result.rows[0].latest_id, count: result.rows[0].count }
  }
  const result = await pool.query(
    `SELECT COALESCE(MAX(id), 0)::int AS latest_id FROM chat_messages`,
  )
  return { latestId: result.rows[0].latest_id, count: 0 }
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

/** Backward cursor pagination for event chat — returns older messages before a given id */
export async function getEventChatMessagesBefore(
  eventId: string,
  beforeId: number,
  limit = 50,
): Promise<{ messages: EventChatRow[]; hasMore: boolean }> {
  const result = await pool.query(
    `SELECT m.*, p.pfp_emoji
     FROM event_chat_messages m
     LEFT JOIN user_profiles p ON p.wallet = m.wallet
     WHERE m.event_id = $1 AND m.id < $2
     ORDER BY m.id DESC
     LIMIT $3`,
    [eventId, beforeId, limit + 1],
  )
  const hasMore = result.rows.length > limit
  const messages = (hasMore ? result.rows.slice(0, limit) : result.rows).reverse()
  return { messages, hasMore }
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

// ── Monitored streams (transcript-worker) ───────────────────

export interface MonitoredStreamRow {
  id: number
  event_id: string
  stream_url: string
  status: 'pending' | 'live' | 'ended' | 'error'
  source: 'twitch' | 'youtube' | 'local-audio' | null
  started_at: string | null
  ended_at: string | null
  minutes_used: string
  cost_cents: number
  error_message: string | null
  created_by: string
  worker_pool: string
  kind: 'live' | 'vod'
  created_at: string
  updated_at: string
}

/**
 * Look up the most relevant monitored_streams row for an event_id, or null.
 * Multiple rows may exist (one per historical run); this returns the active
 * row (status pending/live) when one exists, otherwise the most recent
 * terminal row. Drives the admin status pill.
 */
export async function getMonitoredStreamByEvent(
  eventId: string,
): Promise<MonitoredStreamRow | null> {
  const res = await pool.query<MonitoredStreamRow>(
    `SELECT * FROM monitored_streams
      WHERE event_id = $1
      ORDER BY (status IN ('pending', 'live')) DESC, created_at DESC
      LIMIT 1`,
    [eventId],
  )
  return res.rows[0] ?? null
}

/**
 * Insert a new monitored_streams row in 'pending' state and emit
 * NOTIFY stream_added so the right worker can claim it. Terminal rows
 * (ended/error) for the same event_id are preserved as historical runs
 * (their segments + mentions remain accessible). The partial unique index
 * idx_monitored_streams_event_active blocks a second active row — caller
 * should pre-check via getMonitoredStreamByEvent or handle the resulting
 * unique-violation.
 *
 * Returns the new row's id. The worker performs CAS pending→live and starts
 * the pipeline.
 */
export async function createMonitoredStream(input: {
  eventId: string
  streamUrl: string
  workerPool: string
  kind: 'live' | 'vod'
  createdBy: string
}): Promise<MonitoredStreamRow> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const insertRes = await client.query<MonitoredStreamRow>(
      `INSERT INTO monitored_streams
         (event_id, stream_url, status, worker_pool, kind, created_by)
       VALUES ($1, $2, 'pending', $3, $4, $5)
       RETURNING *`,
      [input.eventId, input.streamUrl, input.workerPool, input.kind, input.createdBy],
    )
    const row = insertRes.rows[0]

    await client.query('SELECT pg_notify($1, $2)', [
      'stream_added',
      JSON.stringify({ streamId: row.id }),
    ])

    await client.query('COMMIT')
    return row
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/**
 * Tell the worker to end this stream. Emits NOTIFY stream_canceled. The
 * worker performs the actual teardown + status transition; we don't UPDATE
 * status here so the worker stays the source of truth for terminal state.
 */
export async function cancelMonitoredStream(streamId: number): Promise<void> {
  await pool.query('SELECT pg_notify($1, $2)', [
    'stream_canceled',
    JSON.stringify({ streamId }),
  ])
}

// ── Word mentions (admin live counter) ────────────────────────────────

export interface WordMentionRow {
  id: number
  stream_id: number
  word_index: number
  word: string
  matched_text: string
  segment_id: number | null
  stream_offset_ms: number
  snippet: string
  confidence: number | null
  superseded: boolean
  created_at: string
}

export interface MentionWordSummary {
  word_index: number
  word: string
  mention_threshold: number
  match_variants: string[]
  count: number
  avg_confidence: number | null
  recent: WordMentionRow[]
}

/**
 * Per-word mention summary for a single monitored_streams run, joined with
 * the market's word list so words with zero mentions still appear.
 *
 * Scoped by stream_id (not event_id) so historical re-runs don't pollute
 * the live counter — see specs/live_transcription_spec.md "Open Items"
 * note about partial unique index allowing multiple terminal rows.
 *
 * The market's word list is pulled from custom_market_words via the
 * stream's event_id ('custom_<marketId>').
 */
export async function getMentionsForStream(streamId: number): Promise<MentionWordSummary[] | null> {
  const streamRes = await pool.query<{ event_id: string }>(
    `SELECT event_id FROM monitored_streams WHERE id = $1`,
    [streamId],
  )
  const row = streamRes.rows[0]
  if (!row) return null

  // v1 supports free markets only. event_id is 'custom_<marketId>'.
  const marketId = row.event_id.startsWith('custom_')
    ? parseInt(row.event_id.slice('custom_'.length), 10)
    : NaN
  if (Number.isNaN(marketId)) return []

  // Three independent queries — words list (per market), aggregates and
  // last-5 (per stream). Run them in parallel; they don't depend on each
  // other and Postgres handles concurrent SELECTs trivially.
  const [wordsRes, aggRes, recentRes] = await Promise.all([
    pool.query<{
      id: number
      word: string
      mention_threshold: number
      match_variants: string[]
    }>(
      `SELECT id, word, mention_threshold,
              COALESCE(match_variants, ARRAY[]::TEXT[]) AS match_variants
         FROM custom_market_words
        WHERE market_id = $1
        ORDER BY id`,
      [marketId],
    ),
    // Aggregates per word_index. word_index in word_mentions is the row id
    // from custom_market_words (see services/transcript-worker streamWorker
    // configures matcher with custom_market_words.id as the wordIndex).
    pool.query<{
      word_index: number
      cnt: string
      avg_conf: string | null
    }>(
      `SELECT word_index,
              COUNT(*)::TEXT AS cnt,
              AVG(confidence)::TEXT AS avg_conf
         FROM word_mentions
        WHERE stream_id = $1 AND superseded = FALSE
        GROUP BY word_index`,
      [streamId],
    ),
    // Last 5 active mentions per word_index in one round-trip via window fn.
    pool.query<WordMentionRow & { rn: string }>(
      `SELECT * FROM (
         SELECT id, stream_id, word_index, word, matched_text, segment_id,
                stream_offset_ms, snippet, confidence, superseded, created_at,
                ROW_NUMBER() OVER (PARTITION BY word_index ORDER BY created_at DESC) AS rn
           FROM word_mentions
          WHERE stream_id = $1 AND superseded = FALSE
       ) t
        WHERE rn <= 5
        ORDER BY word_index, rn`,
      [streamId],
    ),
  ])

  const aggByWordIndex = new Map(
    aggRes.rows.map((r) => [
      r.word_index,
      {
        count: Number(r.cnt),
        avg_confidence: r.avg_conf == null ? null : Number(r.avg_conf),
      },
    ]),
  )
  const recentByWordIndex = new Map<number, WordMentionRow[]>()
  for (const r of recentRes.rows) {
    const list = recentByWordIndex.get(r.word_index) ?? []
    const { rn: _rn, ...rest } = r
    list.push(rest as WordMentionRow)
    recentByWordIndex.set(r.word_index, list)
  }

  return wordsRes.rows.map((w) => {
    const agg = aggByWordIndex.get(w.id)
    return {
      word_index: w.id,
      word: w.word,
      mention_threshold: w.mention_threshold,
      match_variants: w.match_variants,
      count: agg?.count ?? 0,
      avg_confidence: agg?.avg_confidence ?? null,
      recent: recentByWordIndex.get(w.id) ?? [],
    }
  })
}

/**
 * Mark a mention as superseded (admin's "false positive" action). Returns
 * the updated row so the API can echo it back, plus the stream_id needed
 * to scope the SSE notification. NOTIFY is emitted by the caller so the
 * payload can include the type='dismiss' discriminator the SSE consumer
 * expects.
 */
export async function dismissWordMention(
  mentionId: number,
  adminWallet: string,
): Promise<WordMentionRow | null> {
  const result = await pool.query<WordMentionRow>(
    `UPDATE word_mentions
        SET superseded = TRUE,
            superseded_by = $2,
            superseded_at = NOW()
      WHERE id = $1 AND superseded = FALSE
      RETURNING id, stream_id, word_index, word, matched_text, segment_id,
                stream_offset_ms, snippet, confidence, superseded, created_at`,
    [mentionId, adminWallet],
  )
  if (result.rows.length === 0) {
    // Already-dismissed or doesn't exist — fetch to disambiguate.
    const cur = await pool.query<WordMentionRow>(
      `SELECT id, stream_id, word_index, word, matched_text, segment_id,
              stream_offset_ms, snippet, confidence, superseded, created_at
         FROM word_mentions WHERE id = $1`,
      [mentionId],
    )
    return cur.rows[0] ?? null
  }
  await pool.query('SELECT pg_notify($1, $2)', [
    'word_mention',
    JSON.stringify({
      type: 'dismiss',
      streamId: result.rows[0].stream_id,
      wordIndex: result.rows[0].word_index,
      mentionId,
    }),
  ])
  return result.rows[0]
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
  // Cache the "is a Discord linked?" answer (rarely changes, 15 min TTL is fine).
  let isLinked: boolean
  const cached = discordCache.get(wallet)
  if (cached !== undefined) {
    isLinked = cached
  } else {
    const result = await pool.query(
      `SELECT 1 FROM user_profiles WHERE wallet = $1 AND discord_id IS NOT NULL`,
      [wallet],
    )
    isLinked = result.rows.length > 0
    discordCache.set(wallet, isLinked, isLinked ? undefined : DISCORD_UNLINKED_TTL)
  }

  if (!isLinked) return false

  // Lock state is queried fresh every call — admins lock via raw SQL UPDATE,
  // which doesn't go through any cache-invalidating code path. Caching this
  // would let a locked user keep earning points (chat, resolution payouts,
  // referral bonuses) until the 15-min TTL expired.
  const lockResult = await pool.query(
    `SELECT 1 FROM user_profiles WHERE wallet = $1 AND locked_at IS NOT NULL LIMIT 1`,
    [wallet],
  )
  return lockResult.rows.length === 0
}

const REFERRAL_BONUS_RATE = 0.05 // 5% mutual bonus

// Referral bonuses paused during Arena competition (May 4 – May 18 2026 BST)
const ARENA_REFERRAL_PAUSE_START = new Date('2026-05-03T23:00:00.000Z')
const ARENA_REFERRAL_PAUSE_END   = new Date('2026-05-17T23:00:00.000Z')
function referralBonusEnabled(): boolean {
  const now = new Date()
  return now < ARENA_REFERRAL_PAUSE_START || now >= ARENA_REFERRAL_PAUSE_END
}

/**
 * Insert a point event. Returns awarded points, or null if deduped (ON CONFLICT DO NOTHING).
 * Points are only awarded to wallets with a linked Discord account.
 * Also awards 10% referral bonus to both referrer and referred if a relationship exists.
 *
 * `createdAt` overrides the row's timestamp — used for backdating market-resolution
 * payouts to the market's lock_time so they land in the correct weekly bucket.
 * Defaults to NOW() in the DB. Propagates to derived referral bonuses so they share the same week.
 */
export async function insertPointEvent(
  wallet: string,
  action: string,
  points: number,
  refId?: string,
  metadata?: Record<string, unknown>,
  createdAt?: Date,
): Promise<number | null> {
  const discordLinked = await hasDiscordLinked(wallet)
  if (!discordLinked) return null

  const createdAtIso = createdAt ? createdAt.toISOString() : null
  const result = await pool.query(
    `INSERT INTO point_events (wallet, action, points, ref_id, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()))
     ON CONFLICT (wallet, action, ref_id) WHERE ref_id IS NOT NULL DO NOTHING
     RETURNING points`,
    [wallet, action, points, refId ?? null, metadata ? JSON.stringify(metadata) : null, createdAtIso],
  )
  const awarded = result.rows[0]?.points ?? null
  if (awarded === null || awarded === 0) return awarded

  // Don't award referral bonus on referral_bonus events (prevent recursion)
  if (action === 'referral_bonus') return awarded

  // Referral bonuses paused during Arena competition
  if (!referralBonusEnabled()) return awarded

  const bonus = Math.floor(awarded * REFERRAL_BONUS_RATE)
  if (bonus <= 0) return awarded

  // Mutual 10% referral bonus:
  // If this wallet was referred by someone → referrer gets 10%
  const referrer = await getReferrer(wallet)
  if (referrer) {
    await pool.query(
      `INSERT INTO point_events (wallet, action, points, ref_id, metadata, created_at)
       VALUES ($1, 'referral_bonus', $2, $3, $4, COALESCE($5::timestamptz, NOW()))
       ON CONFLICT (wallet, action, ref_id) WHERE ref_id IS NOT NULL DO NOTHING`,
      [referrer, bonus, `ref:${wallet}:${action}:${refId ?? '_'}`,
       JSON.stringify({ fromWallet: wallet, originalAction: action }),
       createdAtIso],
    )
  }

  // If this wallet referred others → each referred user gets 10%
  await pool.query(
    `INSERT INTO point_events (wallet, action, points, ref_id, metadata, created_at)
     SELECT up.wallet, 'referral_bonus', $1, $2, $3, COALESCE($5::timestamptz, NOW())
     FROM user_profiles up
     WHERE up.referred_by = $4
     ON CONFLICT (wallet, action, ref_id) WHERE ref_id IS NOT NULL DO NOTHING`,
    [bonus, `ref:${wallet}:${action}:${refId ?? '_'}`,
     JSON.stringify({ fromWallet: wallet, originalAction: action }),
     wallet, createdAtIso],
  )

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

export interface PointTotalsRow {
  wallet: string
  all_time: number
  weekly: number
  chat_count: number
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

/**
 * Aggregate point totals for a list of wallets (single query, no N+1).
 * `weekEnd` is exclusive — pass null/undefined for the open-ended current week.
 * Pass an explicit `weekEnd` to query a closed historical range (e.g. last week).
 */
export async function getBulkPointTotals(
  wallets: string[],
  weekStart: Date,
  weekEnd?: Date | null,
): Promise<PointTotalsRow[]> {
  if (wallets.length === 0) return []
  const endIso = weekEnd ? weekEnd.toISOString() : null
  const result = await pool.query(
    `SELECT
       wallet,
       COALESCE(SUM(points), 0)::int AS all_time,
       COALESCE(SUM(points) FILTER (
         WHERE created_at >= $2
           AND ($3::timestamptz IS NULL OR created_at < $3)
       ), 0)::int AS weekly,
       COALESCE(COUNT(*) FILTER (WHERE action = 'chat_message'), 0)::int AS chat_count
     FROM point_events
     WHERE wallet = ANY($1)
     GROUP BY wallet`,
    [wallets, weekStart.toISOString(), endIso],
  )
  return result.rows
}

// ── Achievements ─────────────────────────────────────

/** Returns the ISO Monday of the UTC week containing `at` (default: now) as a YYYY-MM-DD string. */
export function getWeekStart(at?: Date): string {
  const ref = at ?? new Date()
  const day = ref.getUTCDay() // 0=Sun, 1=Mon, ...
  const diff = (day === 0 ? -6 : 1 - day) // days to subtract to get to Monday
  const monday = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate() + diff))
  return monday.toISOString().slice(0, 10)
}

/**
 * Insert an achievement unlock. Returns true if newly inserted (not a dupe for the week).
 * `weekStart` (YYYY-MM-DD) defaults to the current UTC week — pass an explicit value
 * when backdating an unlock derived from a market that ended in a prior week.
 */
export async function unlockAchievement(
  wallet: string,
  achievementId: string,
  points: number,
  weekStart?: string,
): Promise<boolean> {
  const week = weekStart ?? getWeekStart()
  const result = await pool.query(
    `INSERT INTO user_achievements (wallet, achievement_id, points_awarded, week_start)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (wallet, achievement_id, week_start) DO NOTHING
     RETURNING id`,
    [wallet, achievementId, points, week],
  )
  return (result.rowCount ?? 0) > 0
}

/**
 * Get achievements unlocked this week for a wallet (for PFP unlock validation).
 */
export async function getUnlockedAchievements(
  wallet: string,
): Promise<{ achievement_id: string; unlocked_at: string }[]> {
  const weekStart = getWeekStart()
  const result = await pool.query(
    `SELECT achievement_id, unlocked_at FROM user_achievements WHERE wallet = $1 AND week_start = $2`,
    [wallet, weekStart],
  )
  return result.rows
}

/**
 * Award points for any this-week achievements that were earned before Discord was linked.
 * Safe to call after linkDiscord — insertPointEvent deduplicates via ON CONFLICT.
 */
export async function backfillAchievementPoints(wallet: string): Promise<void> {
  const weekStart = getWeekStart()
  const result = await pool.query(
    `SELECT ua.achievement_id, ua.points_awarded
     FROM user_achievements ua
     WHERE ua.wallet = $1
       AND ua.week_start = $2
       AND ua.points_awarded > 0
       AND NOT EXISTS (
         SELECT 1 FROM point_events pe
         WHERE pe.wallet = $1
           AND pe.action = 'achievement'
           AND pe.ref_id = 'ach:' || ua.achievement_id || ':' || $2
       )`,
    [wallet, weekStart],
  )
  for (const row of result.rows) {
    await insertPointEvent(wallet, 'achievement', row.points_awarded, `ach:${row.achievement_id}:${weekStart}`)
  }
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

/** Count recent custom market trades for a wallet within a time window */
export async function getRecentCustomTradeCount(wallet: string, windowSeconds: number): Promise<number> {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c FROM custom_market_trades WHERE wallet = $1 AND created_at > NOW() - make_interval(secs => $2)`,
    [wallet, windowSeconds],
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
  is_featured: boolean
  market_type: string
  event_start_time: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface CustomMarketWordRow {
  id: number
  market_id: number
  word: string
  resolved_outcome: boolean | null
  mention_threshold: number
  match_variants: string[]
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
  marketType: string = 'continuous',
  eventStartTime: string | null = null,
): Promise<CustomMarketRow> {
  const slug = generateSlug(urlPrefix)
  const result = await pool.query(
    `INSERT INTO custom_markets (title, description, cover_image_url, stream_url, lock_time, b_parameter, play_tokens, slug, market_type, event_start_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [title, description, coverImageUrl, streamUrl, lockTime, bParameter, playTokens, slug, marketType, eventStartTime],
  )
  return result.rows[0]
}

const UPDATABLE_MARKET_FIELDS = ['title', 'description', 'cover_image_url', 'stream_url', 'lock_time', 'market_type', 'event_start_time'] as const

export async function updateCustomMarket(
  id: number,
  fields: Partial<Pick<CustomMarketRow, 'title' | 'description' | 'cover_image_url' | 'stream_url' | 'lock_time' | 'market_type' | 'event_start_time'>>,
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
  marketCache.delete(String(id))
  return result.rows[0] || null
}

export async function deleteCustomMarket(id: number): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM custom_markets WHERE id = $1`,
    [id],
  )
  marketCache.delete(String(id))
  wordsCache.delete(String(id))
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
  marketCache.delete(String(id))
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
  marketCache.delete(String(id))
  return result.rows[0] || null
}

/**
 * Set one market as featured (and unset all others atomically).
 * Passing featured=false just unsets the flag for this market.
 */
export async function setCustomMarketFeatured(id: number, featured: boolean): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (featured) {
      // Clear any existing featured market first
      await client.query(`UPDATE custom_markets SET is_featured = FALSE WHERE is_featured = TRUE`)
    }
    const result = await client.query(
      `UPDATE custom_markets SET is_featured = $1, updated_at = NOW() WHERE id = $2`,
      [featured, id],
    )
    await client.query('COMMIT')
    marketCache.delete(String(id))
    return (result.rowCount ?? 0) > 0
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function getCustomMarket(id: number): Promise<CustomMarketRow | null> {
  const key = String(id)
  const cached = marketCache.get(key)
  if (cached !== undefined) return cached

  const result = await pool.query(
    `SELECT * FROM custom_markets WHERE id = $1`,
    [id],
  )
  const market = result.rows[0] || null
  marketCache.set(key, market)
  return market
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

// Markets stay listed while open/locked. Resolved markets stay visible until
// the later of: 48 hours after the market's "closing time" OR the end of the
// UTC week containing that closing time (i.e. next Monday 00:00 UTC).
//
// Closing time = GREATEST(lock_time, resolved_at):
//   - Continuous markets may resolve all words before lock_time. For those we
//     still anchor the grace window on lock_time so users get the expected
//     "end of week / 48h" visibility after the scheduled close.
//   - Markets that resolve at/after lock_time anchor on resolved_at.
//   - If lock_time is NULL, GREATEST returns resolved_at.
//
// Legacy rows with NULL resolved_at fall off immediately.
const PUBLIC_LISTING_FILTER = `(
  m.status IN ('open', 'locked')
  OR (
    m.status = 'resolved'
    AND m.resolved_at IS NOT NULL
    AND NOW() < GREATEST(
      GREATEST(m.lock_time, m.resolved_at) + INTERVAL '48 hours',
      (date_trunc('week', GREATEST(m.lock_time, m.resolved_at) AT TIME ZONE 'UTC') + INTERVAL '7 days') AT TIME ZONE 'UTC'
    )
  )
)`

export async function listCustomMarketsPublic(): Promise<CustomMarketListRow[]> {
  const [marketsResult, poolsResult] = await Promise.all([
    pool.query(
      `SELECT m.*,
         COALESCE(w.cnt, 0)::int AS word_count,
         COALESCE(p.cnt, 0)::int AS trader_count
       FROM custom_markets m
       LEFT JOIN (SELECT market_id, COUNT(*)::int AS cnt FROM custom_market_words GROUP BY market_id) w ON w.market_id = m.id
       LEFT JOIN (SELECT market_id, COUNT(DISTINCT wallet)::int AS cnt FROM custom_market_positions GROUP BY market_id) p ON p.market_id = m.id
       WHERE ${PUBLIC_LISTING_FILTER}
       ORDER BY
         CASE m.status WHEN 'open' THEN 0 WHEN 'locked' THEN 1 ELSE 2 END ASC,
         m.lock_time ASC NULLS LAST
       LIMIT 200`,
    ),
    pool.query(
      `SELECT w.id AS word_id, w.market_id, w.word, w.resolved_outcome,
              COALESCE(p.yes_qty, 0) AS yes_qty, COALESCE(p.no_qty, 0) AS no_qty
       FROM custom_market_words w
       INNER JOIN custom_markets m ON m.id = w.market_id AND ${PUBLIC_LISTING_FILTER}
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
    wordsCache.delete(String(marketId))
    return result.rows
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function getCustomMarketWords(marketId: number): Promise<CustomMarketWordRow[]> {
  const key = String(marketId)
  const cached = wordsCache.get(key)
  if (cached !== undefined) return cached

  const result = await pool.query(
    `SELECT * FROM custom_market_words WHERE market_id = $1 ORDER BY id`,
    [marketId],
  )
  wordsCache.set(key, result.rows)
  return result.rows
}

export async function removeCustomMarketWord(marketId: number, wordId: number): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM custom_market_words WHERE id = $1 AND market_id = $2`,
    [wordId, marketId],
  )
  wordsCache.delete(String(marketId))
  return (result.rowCount ?? 0) > 0
}

/**
 * Update mention_threshold and/or match_variants on a custom_market_words
 * row. Returns the updated row, or null if no row matched. Either field
 * may be omitted; only provided fields are updated.
 *
 * Allowed regardless of market status — admin may need to tune thresholds
 * mid-event.
 */
export async function updateCustomMarketWord(
  marketId: number,
  wordId: number,
  patch: { mentionThreshold?: number; matchVariants?: string[] },
): Promise<CustomMarketWordRow | null> {
  const sets: string[] = []
  const values: (number | string[])[] = []
  let i = 1
  if (patch.mentionThreshold !== undefined) {
    sets.push(`mention_threshold = $${i++}`)
    values.push(patch.mentionThreshold)
  }
  if (patch.matchVariants !== undefined) {
    sets.push(`match_variants = $${i++}`)
    values.push(patch.matchVariants)
  }
  if (sets.length === 0) {
    const cur = await pool.query<CustomMarketWordRow>(
      `SELECT * FROM custom_market_words WHERE id = $1 AND market_id = $2`,
      [wordId, marketId],
    )
    return cur.rows[0] ?? null
  }
  values.push(wordId, marketId)
  const result = await pool.query<CustomMarketWordRow>(
    `UPDATE custom_market_words SET ${sets.join(', ')}
       WHERE id = $${i++} AND market_id = $${i}
       RETURNING *`,
    values,
  )
  wordsCache.delete(String(marketId))
  return result.rows[0] ?? null
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

/**
 * Atomically resolve words and apply payouts within a single transaction.
 * Acquires FOR UPDATE lock on the market row to prevent double-resolution.
 * Returns the updated words and whether all words are now resolved.
 */
export async function resolveMarketAtomic(
  marketId: number,
  resolutions: { wordId: number; outcome: boolean }[],
): Promise<{ words: CustomMarketWordRow[]; allResolved: boolean; statusUpdated: boolean }> {
  if (resolutions.length === 0) throw new Error('No resolutions provided')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Lock market row and verify status (allow resolving words while market is open or locked)
    const marketResult = await client.query(
      'SELECT status FROM custom_markets WHERE id = $1 FOR UPDATE',
      [marketId],
    )
    const market = marketResult.rows[0]
    if (!market || (market.status !== 'open' && market.status !== 'locked')) {
      await client.query('ROLLBACK')
      throw new Error('Market must be open or locked before resolving')
    }

    // Filter out words that are already resolved (prevent double payouts)
    const existingWords = await client.query(
      'SELECT id, resolved_outcome FROM custom_market_words WHERE market_id = $1 AND id IN (' +
        resolutions.map((_, i) => `$${i + 2}`).join(', ') + ') FOR UPDATE',
      [marketId, ...resolutions.map(r => r.wordId)],
    )
    const alreadyResolved = new Set(
      existingWords.rows.filter((w: any) => w.resolved_outcome !== null).map((w: any) => w.id),
    )
    const pending = resolutions.filter(r => !alreadyResolved.has(r.wordId))

    // Apply word resolutions (only for words not yet resolved)
    if (pending.length > 0) {
      const cases: string[] = []
      const ids: number[] = []
      const values: (number | boolean)[] = [marketId]
      let paramIndex = 2

      for (const { wordId, outcome } of pending) {
        cases.push(`WHEN id = $${paramIndex} THEN $${paramIndex + 1}::boolean`)
        values.push(wordId, outcome)
        ids.push(wordId)
        paramIndex += 2
      }

      values.push(...ids)
      const idPlaceholders = ids.map((_, i) => `$${paramIndex + i}`).join(', ')

      await client.query(
        `UPDATE custom_market_words SET resolved_outcome = CASE ${cases.join(' ')} END WHERE market_id = $1 AND id IN (${idPlaceholders}) AND resolved_outcome IS NULL`,
        values,
      )

      // Apply payouts only for newly resolved words
      for (const { wordId, outcome } of pending) {
        const outcomeStr = outcome ? 'YES' : 'NO'
        await client.query(
          `UPDATE custom_market_positions
           SET tokens_received = tokens_received + CASE WHEN $2 = 'YES' THEN yes_shares ELSE no_shares END,
               updated_at = NOW()
           WHERE word_id = $1`,
          [wordId, outcomeStr],
        )
      }
    }

    // Check if all words are resolved
    const wordsResult = await client.query(
      'SELECT * FROM custom_market_words WHERE market_id = $1 ORDER BY id',
      [marketId],
    )
    const words = wordsResult.rows as CustomMarketWordRow[]
    const allResolved = words.every(w => w.resolved_outcome !== null)

    // Update status to resolved if all words done
    let statusUpdated = false
    if (allResolved) {
      const updateResult = await client.query(
        `UPDATE custom_markets SET status = 'resolved', resolved_at = NOW(), updated_at = NOW() WHERE id = $1 AND status IN ('open', 'locked') RETURNING id`,
        [marketId],
      )
      statusUpdated = (updateResult.rowCount ?? 0) > 0
    }

    await client.query('COMMIT')
    wordsCache.delete(String(marketId))
    return { words, allResolved, statusUpdated }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
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

// -- Market Results --

export interface MarketPositionForScoring {
  wallet: string
  word_id: number
  word: string
  outcome: 'YES' | 'NO'
  yes_shares: number
  no_shares: number
  tokens_spent: number
  tokens_received: number
}

export async function getMarketPositionsForScoring(
  marketId: number,
): Promise<MarketPositionForScoring[]> {
  const result = await pool.query(
    `SELECT p.wallet,
            p.word_id,
            w.word,
            CASE WHEN w.resolved_outcome = TRUE THEN 'YES' ELSE 'NO' END AS outcome,
            p.yes_shares::float AS yes_shares,
            p.no_shares::float AS no_shares,
            p.tokens_spent::float AS tokens_spent,
            p.tokens_received::float AS tokens_received
     FROM custom_market_positions p
     JOIN custom_market_words w ON w.id = p.word_id
     WHERE p.market_id = $1
       AND w.resolved_outcome IS NOT NULL
       AND (p.yes_shares > 0 OR p.no_shares > 0 OR p.tokens_spent > 0)
     ORDER BY p.wallet, w.word`,
    [marketId],
  )
  return result.rows
}

export async function insertMarketResults(
  marketId: number,
  rows: MarketPositionForScoring[],
): Promise<void> {
  if (rows.length === 0) return
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const r of rows) {
      const net = r.tokens_received - r.tokens_spent
      await client.query(
        `INSERT INTO custom_market_results
           (market_id, wallet, word_id, word, outcome, yes_shares, no_shares, tokens_spent, tokens_received, net_tokens)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (market_id, wallet, word_id) DO NOTHING`,
        [marketId, r.wallet, r.word_id, r.word, r.outcome, r.yes_shares, r.no_shares, r.tokens_spent, r.tokens_received, net],
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export interface MarketResultEntry {
  wallet: string
  username: string | null
  pfp_emoji: string | null
  total_spent: number
  total_received: number
  net_tokens: number
  pnl_pct: number | null
  points_earned: number
  words: {
    word_id: number
    word: string
    outcome: 'YES' | 'NO'
    yes_shares: number
    no_shares: number
    tokens_spent: number
    tokens_received: number
    net_tokens: number
  }[]
}

export async function getMarketResults(marketId: number): Promise<MarketResultEntry[]> {
  const result = await pool.query(
    `SELECT
       r.wallet,
       up.username,
       up.pfp_emoji,
       r.word_id,
       r.word,
       r.outcome,
       r.yes_shares::float AS yes_shares,
       r.no_shares::float AS no_shares,
       r.tokens_spent::float AS tokens_spent,
       r.tokens_received::float AS tokens_received,
       r.net_tokens::float AS net_tokens
     FROM custom_market_results r
     LEFT JOIN user_profiles up ON up.wallet = r.wallet
     WHERE r.market_id = $1
     ORDER BY r.wallet, r.word`,
    [marketId],
  )

  // Group by wallet
  const walletMap = new Map<string, MarketResultEntry>()
  for (const row of result.rows) {
    if (!walletMap.has(row.wallet)) {
      walletMap.set(row.wallet, {
        wallet: row.wallet,
        username: row.username ?? null,
        pfp_emoji: row.pfp_emoji ?? null,
        total_spent: 0,
        total_received: 0,
        net_tokens: 0,
        pnl_pct: null,
        points_earned: 0,
        words: [],
      })
    }
    const entry = walletMap.get(row.wallet)!
    entry.total_spent += row.tokens_spent
    entry.total_received += row.tokens_received
    entry.net_tokens += row.net_tokens
    entry.words.push({
      word_id: row.word_id,
      word: row.word,
      outcome: row.outcome,
      yes_shares: row.yes_shares,
      no_shares: row.no_shares,
      tokens_spent: row.tokens_spent,
      tokens_received: row.tokens_received,
      net_tokens: row.net_tokens,
    })
  }

  // Compute derived fields and sort by net_tokens desc
  return Array.from(walletMap.values())
    .map(entry => ({
      ...entry,
      pnl_pct: entry.total_spent > 0 ? (entry.net_tokens / entry.total_spent) * 100 : null,
      points_earned: Math.max(0, Math.floor(entry.net_tokens * 0.5)),
    }))
    .sort((a, b) => b.net_tokens - a.net_tokens)
}

// -- Admin Audit Log --

export async function logAdminAction(
  wallet: string,
  action: string,
  targetId?: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `INSERT INTO admin_audit_log (wallet, action, target_id, payload) VALUES ($1, $2, $3, $4)`,
    [wallet, action, targetId ?? null, payload ? JSON.stringify(payload) : null],
  ).catch(err => console.error('Admin audit log error:', err))
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
  maxCost?: number,
): Promise<VirtualTradeResult> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 1. Lock market row and verify it's open for trading
    const marketResult = await client.query(
      'SELECT status, lock_time, b_parameter, play_tokens FROM custom_markets WHERE id = $1 FOR UPDATE',
      [marketId],
    )
    const market = marketResult.rows[0]
    if (!market) throw new Error('Market not found')
    if (market.status !== 'open') throw new Error('Market is not open for trading')
    if (market.lock_time && new Date(market.lock_time) <= new Date()) throw new Error('Market is locked')
    const b = parseFloat(market.b_parameter)

    // 2. Check word is not already resolved
    const wordResult = await client.query(
      'SELECT resolved_outcome FROM custom_market_words WHERE id = $1 AND market_id = $2',
      [wordId, marketId],
    )
    if (!wordResult.rows[0]) throw new Error('Word not found')
    if (wordResult.rows[0].resolved_outcome !== null) throw new Error('Word is already resolved')

    // 3. Lock pool row
    const poolResult = await client.query(
      'SELECT * FROM custom_market_word_pools WHERE word_id = $1 FOR UPDATE',
      [wordId],
    )
    const poolRow = poolResult.rows[0]
    if (!poolRow) throw new Error('Pool not found for word')

    const yesQty = parseFloat(poolRow.yes_qty)
    const noQty = parseFloat(poolRow.no_qty)

    // 4. Get or create balance (lazy creation with FOR UPDATE)
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

    // 5. Get current position (or defaults)
    const posResult = await client.query(
      'SELECT * FROM custom_market_positions WHERE word_id = $1 AND wallet = $2 FOR UPDATE',
      [wordId, wallet],
    )
    const pos = posResult.rows[0]
    let curYesShares = pos ? parseFloat(pos.yes_shares) : 0
    let curNoShares = pos ? parseFloat(pos.no_shares) : 0
    let curTokensSpent = pos ? parseFloat(pos.tokens_spent) : 0
    let curTokensReceived = pos ? parseFloat(pos.tokens_received) : 0

    // 6. Compute cost/shares
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

    // Minimum trade size guards
    if (shares < 0.01) throw new Error('Trade too small')
    if (action === 'buy' && cost < 1) throw new Error('Trade too small')

    // Slippage protection
    if (action === 'buy' && maxCost !== undefined && cost > maxCost) {
      throw new Error('Slippage exceeded')
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

// ── Visit tracking ───────────────────────────────────────

/**
 * Record a visit for today. Idempotent — UNIQUE (wallet, visit_date) prevents duplicates.
 * Returns the number of distinct days visited this week (Mon–Sun UTC).
 *
 * `ip` and `userAgent` are captured for multi-account-abuse detection.
 * On a same-day re-visit, the most recent IP/UA wins (so a network change
 * mid-day surfaces in the logs); existing values are preserved if the new
 * call doesn't supply them.
 */
export async function recordVisitAndGetWeekCount(
  wallet: string,
  ip: string | null = null,
  userAgent: string | null = null,
): Promise<number> {
  const now = new Date()

  // ISO week starts Monday
  const day = now.getUTCDay() // 0=Sun
  const diffToMonday = day === 0 ? 6 : day - 1
  const monday = new Date(now)
  monday.setUTCDate(now.getUTCDate() - diffToMonday)
  monday.setUTCHours(0, 0, 0, 0)
  const weekStart = monday.toISOString().slice(0, 10)
  const todayStr = now.toISOString().slice(0, 10)

  await pool.query(
    `INSERT INTO user_visit_logs (wallet, visit_date, week_start, ip, user_agent)
     VALUES ($1, $2, $3, $4::inet, $5)
     ON CONFLICT (wallet, visit_date) DO UPDATE SET
       ip         = COALESCE(EXCLUDED.ip,         user_visit_logs.ip),
       user_agent = COALESCE(EXCLUDED.user_agent, user_visit_logs.user_agent)`,
    [wallet, todayStr, weekStart, ip, userAgent],
  )

  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(DISTINCT visit_date) AS count
     FROM user_visit_logs
     WHERE wallet = $1 AND week_start = $2`,
    [wallet, weekStart],
  )

  return parseInt(result.rows[0].count, 10)
}

// ── Teams ────────────────────────────────────────────

const MIN_DISCORD_AGE_DAYS = 30

function discordAccountAgeDays(discordId: string): number {
  const createdAt = new Date(Number(BigInt(discordId) >> 22n) + 1420070400000)
  return (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24)
}

async function assertDiscordEligible(wallet: string): Promise<void> {
  const result = await pool.query(
    `SELECT discord_id, locked_at FROM user_profiles WHERE wallet = $1`,
    [wallet],
  )
  const row = result.rows[0]
  if (row?.locked_at) throw new Error('WALLET_LOCKED')
  if (!row?.discord_id) throw new Error('DISCORD_REQUIRED')
  const ageDays = discordAccountAgeDays(row.discord_id)
  if (ageDays < MIN_DISCORD_AGE_DAYS) throw new Error('DISCORD_TOO_NEW')
}

export async function assertDiscordTradingEligible(wallet: string): Promise<void> {
  const result = await pool.query(
    `SELECT discord_id, locked_at FROM user_profiles WHERE wallet = $1`,
    [wallet],
  )
  const row = result.rows[0]
  if (row?.locked_at) throw new Error('WALLET_LOCKED')
  if (!row?.discord_id) throw new Error('DISCORD_REQUIRED')
  const ageDays = discordAccountAgeDays(row.discord_id)
  if (ageDays < MIN_DISCORD_AGE_DAYS) throw new Error('DISCORD_TOO_NEW')
}

export interface TeamRow {
  id: number
  name: string
  slug: string
  join_code: string
  created_by: string
  created_at: string
  pfp_data: string | null
  bio: string | null
  x_url: string | null
}

export interface TeamMemberRow {
  team_id: number
  wallet: string
  role: string
  joined_at: string
  username: string | null
  pfp_emoji: string | null
}

export interface TeamLeaderboardEntry {
  team_id: number
  team_name: string
  team_slug: string
  member_count: number
  weekly_points: number
  all_time_points: number
}

const TEAM_MAX_MEMBERS = 3

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50)
}

function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  const bytes = crypto.randomBytes(6)
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length]
  }
  return code
}

export async function createTeam(name: string, wallet: string): Promise<TeamRow> {
  await assertDiscordEligible(wallet)
  const join_code = generateJoinCode()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Check this wallet isn't already on a team
    const existing = await client.query(
      `SELECT team_id FROM team_members WHERE wallet = $1`,
      [wallet],
    )
    if ((existing.rowCount ?? 0) > 0) {
      throw new Error('ALREADY_IN_TEAM')
    }

    const slug = slugify(name)
    const teamRes = await client.query<TeamRow>(
      `INSERT INTO teams (name, slug, join_code, created_by) VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, slug, join_code, wallet],
    )
    const team = teamRes.rows[0]

    await client.query(
      `INSERT INTO team_members (team_id, wallet, role) VALUES ($1, $2, 'captain')`,
      [team.id, wallet],
    )

    await client.query('COMMIT')
    return team
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function joinTeam(join_code: string, wallet: string): Promise<TeamRow> {
  await assertDiscordEligible(wallet)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Check wallet isn't already on a team
    const existing = await client.query(
      `SELECT team_id FROM team_members WHERE wallet = $1`,
      [wallet],
    )
    if ((existing.rowCount ?? 0) > 0) {
      throw new Error('ALREADY_IN_TEAM')
    }

    const teamRes = await client.query<TeamRow>(
      `SELECT * FROM teams WHERE join_code = $1`,
      [join_code.toUpperCase()],
    )
    if ((teamRes.rowCount ?? 0) === 0) {
      throw new Error('INVALID_CODE')
    }
    const team = teamRes.rows[0]

    const countRes = await client.query(
      `SELECT COUNT(*)::int AS c FROM team_members WHERE team_id = $1`,
      [team.id],
    )
    if ((countRes.rows[0]?.c ?? 0) >= TEAM_MAX_MEMBERS) {
      throw new Error('TEAM_FULL')
    }

    await client.query(
      `INSERT INTO team_members (team_id, wallet, role) VALUES ($1, $2, 'member')`,
      [team.id, wallet],
    )

    await client.query('COMMIT')
    return team
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}


export async function getTeamByWallet(wallet: string): Promise<(TeamRow & { role: string }) | null> {
  const result = await pool.query(
    `SELECT t.*, tm.role
     FROM teams t
     JOIN team_members tm ON tm.team_id = t.id
     WHERE tm.wallet = $1`,
    [wallet],
  )
  return result.rows[0] ?? null
}

export async function getTeamById(teamId: number): Promise<TeamRow | null> {
  const result = await pool.query(`SELECT * FROM teams WHERE id = $1`, [teamId])
  return result.rows[0] ?? null
}

export async function getTeamBySlug(slug: string): Promise<TeamRow | null> {
  const result = await pool.query(`SELECT * FROM teams WHERE slug = $1`, [slug])
  return result.rows[0] ?? null
}

export async function getTeamPfpData(slug: string): Promise<string | null> {
  const result = await pool.query<{ pfp_data: string | null }>(
    `SELECT pfp_data FROM teams WHERE slug = $1`, [slug]
  )
  return result.rows[0]?.pfp_data ?? null
}

export async function setTeamPfp(teamId: number, pfpData: string): Promise<void> {
  await pool.query(`UPDATE teams SET pfp_data = $1 WHERE id = $2`, [pfpData, teamId])
}

export async function updateTeamName(teamId: number, name: string): Promise<void> {
  await pool.query(`UPDATE teams SET name = $1 WHERE id = $2`, [name.trim(), teamId])
}

export async function updateTeamBio(teamId: number, bio: string): Promise<void> {
  await pool.query(`UPDATE teams SET bio = $1 WHERE id = $2`, [bio.trim() || null, teamId])
}

export async function updateTeamXUrl(teamId: number, xUrl: string | null): Promise<void> {
  await pool.query(`UPDATE teams SET x_url = $1 WHERE id = $2`, [xUrl || null, teamId])
}

/**
 * Count distinct markets traded by all members of the team the given wallet
 * belongs to, within the current week (Mon 00:00 UTC).
 * Returns 0 if the wallet is not in a team.
 */
export async function countTeamDistinctMarketsThisWeek(wallet: string): Promise<number> {
  const result = await pool.query<{ c: string }>(
    `SELECT COUNT(DISTINCT t.market_id)::text AS c
     FROM custom_market_trades t
     JOIN team_members tm ON tm.wallet = t.wallet
     JOIN team_members me ON me.team_id = tm.team_id AND me.wallet = $1
     WHERE t.created_at >= date_trunc('week', NOW() AT TIME ZONE 'UTC')`,
    [wallet],
  )
  return parseInt(result.rows[0]?.c ?? '0', 10)
}

/**
 * Returns true if every member of the wallet's team has placed at least one
 * free-market trade today (UTC). Used to trigger the Full House achievement.
 * Returns false if the wallet has no team or the team has fewer than 3 members.
 */
export async function checkTeamFullHouseToday(wallet: string): Promise<boolean> {
  const result = await pool.query<{ all_traded: boolean }>(
    `SELECT
       COUNT(DISTINCT tm.wallet) FILTER (
         WHERE EXISTS (
           SELECT 1 FROM custom_market_trades t
           WHERE t.wallet = tm.wallet
             AND t.created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
         )
       ) = COUNT(DISTINCT tm.wallet)
       AND COUNT(DISTINCT tm.wallet) = 3
       AS all_traded
     FROM team_members me
     JOIN team_members tm ON tm.team_id = me.team_id
     WHERE me.wallet = $1`,
    [wallet],
  )
  return result.rows[0]?.all_traded ?? false
}

export async function getTeamMembers(teamId: number): Promise<TeamMemberRow[]> {
  const result = await pool.query(
    `SELECT tm.*, up.username, up.pfp_emoji
     FROM team_members tm
     LEFT JOIN user_profiles up ON up.wallet = tm.wallet
     WHERE tm.team_id = $1
     ORDER BY CASE WHEN tm.role = 'captain' THEN 0 ELSE 1 END, tm.joined_at ASC`,
    [teamId],
  )
  return result.rows
}

export async function getTeamLeaderboard(
  compStart: Date,
  compEnd: Date,
): Promise<TeamLeaderboardEntry[]> {
  const now = new Date()
  // Before comp starts: show all-time points (preview).
  // During/after comp: use compStart as the floor — pre-join points earned during the comp count toward the team.
  const windowStart = now < compStart ? new Date(0) : compStart
  const result = await pool.query(
    `SELECT
       t.id AS team_id,
       t.name AS team_name,
       t.slug AS team_slug,
       COUNT(DISTINCT tm.wallet)::int AS member_count,
       COALESCE(SUM(pe.points) FILTER (
         WHERE pe.created_at >= $1
           AND pe.created_at < $2
       ), 0)::int AS weekly_points,
       COALESCE(SUM(pe.points), 0)::int AS all_time_points
     FROM teams t
     JOIN team_members tm ON tm.team_id = t.id
     LEFT JOIN point_events pe ON pe.wallet = tm.wallet
     GROUP BY t.id, t.name, t.slug
     ORDER BY weekly_points DESC`,
    [windowStart.toISOString(), compEnd.toISOString()],
  )
  return result.rows
}

export async function getTeamMemberPointTotals(
  teamId: number,
  compStart: Date,
  compEnd: Date,
): Promise<{ wallet: string; weekly: number; all_time: number; username: string | null; pfp_emoji: string | null }[]> {
  const now = new Date()
  const windowStart = now < compStart ? new Date(0) : compStart
  const result = await pool.query(
    `SELECT
       tm.wallet,
       up.username,
       up.pfp_emoji,
       COALESCE(SUM(pe.points) FILTER (
         WHERE pe.created_at >= $2
           AND pe.created_at < $3
       ), 0)::int AS weekly,
       COALESCE(SUM(pe.points), 0)::int AS all_time
     FROM team_members tm
     LEFT JOIN user_profiles up ON up.wallet = tm.wallet
     LEFT JOIN point_events pe ON pe.wallet = tm.wallet
     WHERE tm.team_id = $1
     GROUP BY tm.wallet, up.username, up.pfp_emoji
     ORDER BY weekly DESC`,
    [teamId, windowStart.toISOString(), compEnd.toISOString()],
  )
  return result.rows
}

// ── Feedback ─────────────────────────────────────────────────────────────────

export interface FeedbackData {
  honestThoughts: string
  sadIfGone: string
  improvements: string
  realMoney: string
  extra?: string
}

export async function insertFeedback(wallet: string, data: FeedbackData): Promise<boolean> {
  try {
    const result = await pool.query(
      `INSERT INTO feedback_submissions (wallet, honest_thoughts, sad_if_gone, improvements, real_money, extra)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (wallet) DO NOTHING
       RETURNING id`,
      [wallet, data.honestThoughts, data.sadIfGone, data.improvements, data.realMoney, data.extra ?? null],
    )
    return result.rows.length > 0
  } catch {
    return false
  }
}

export async function hasFeedbackSubmitted(wallet: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM feedback_submissions WHERE wallet = $1`,
    [wallet],
  )
  return result.rows.length > 0
}

export { pool }
