import pg from 'pg'
import type { ParsedTradeEvent } from './tradeParser'

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
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
}

export async function getProfile(wallet: string): Promise<ProfileRow | null> {
  const result = await pool.query(
    `SELECT wallet, username, pfp_emoji FROM user_profiles WHERE wallet = $1`,
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
 * Insert a point event. Returns awarded points, or null if deduped (ON CONFLICT DO NOTHING).
 */
export async function insertPointEvent(
  wallet: string,
  action: string,
  points: number,
  refId?: string,
  metadata?: Record<string, unknown>,
): Promise<number | null> {
  const result = await pool.query(
    `INSERT INTO point_events (wallet, action, points, ref_id, metadata)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (wallet, action, ref_id) WHERE ref_id IS NOT NULL DO NOTHING
     RETURNING points`,
    [wallet, action, points, refId ?? null, metadata ? JSON.stringify(metadata) : null],
  )
  return result.rows[0]?.points ?? null
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

// ── Custom Markets ───────────────────────────────────

export interface CustomMarketRow {
  id: number
  title: string
  description: string | null
  cover_image_url: string | null
  stream_url: string | null
  status: string
  lock_time: string | null
  created_at: string
  updated_at: string
}

export interface CustomMarketWordRow {
  id: number
  market_id: number
  word: string
  resolved_outcome: boolean | null
}

export interface CustomMarketPredictionRow {
  id: number
  market_id: number
  word_id: number
  wallet: string
  prediction: boolean
  created_at: string
  updated_at: string
}

export interface WordSentiment {
  word_id: number
  word: string
  yes_count: number
  no_count: number
  total: number
  yes_pct: number
  resolved_outcome: boolean | null
}

export async function createCustomMarket(
  title: string,
  description: string | null,
  coverImageUrl: string | null,
  streamUrl: string | null,
  lockTime: string | null,
): Promise<CustomMarketRow> {
  const result = await pool.query(
    `INSERT INTO custom_markets (title, description, cover_image_url, stream_url, lock_time)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [title, description, coverImageUrl, streamUrl, lockTime],
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

export interface WordSentimentCompact {
  word_id: number
  market_id: number
  word: string
  yes_pct: number
  no_pct: number
}

export interface CustomMarketListRow extends CustomMarketRow {
  word_count: number
  prediction_count: number
  words_sentiment: WordSentimentCompact[]
}

export async function listCustomMarketsPublic(): Promise<CustomMarketListRow[]> {
  const [marketsResult, sentimentResult] = await Promise.all([
    pool.query(
      `SELECT m.*,
         COALESCE(w.cnt, 0)::int AS word_count,
         COALESCE(p.cnt, 0)::int AS prediction_count
       FROM custom_markets m
       LEFT JOIN (SELECT market_id, COUNT(*)::int AS cnt FROM custom_market_words GROUP BY market_id) w ON w.market_id = m.id
       LEFT JOIN (SELECT market_id, COUNT(DISTINCT wallet)::int AS cnt FROM custom_market_predictions GROUP BY market_id) p ON p.market_id = m.id
       WHERE m.status IN ('open', 'locked', 'resolved')
       ORDER BY m.created_at DESC`,
    ),
    pool.query(
      `SELECT
         w.id AS word_id,
         w.market_id,
         w.word,
         COUNT(p.id) FILTER (WHERE p.prediction = true)::int AS yes_count,
         COUNT(p.id)::int AS total
       FROM custom_market_words w
       INNER JOIN custom_markets m ON m.id = w.market_id AND m.status IN ('open', 'locked', 'resolved')
       LEFT JOIN custom_market_predictions p ON p.word_id = w.id
       GROUP BY w.id
       ORDER BY w.id`,
    ),
  ])

  const sentimentByMarket = new Map<number, WordSentimentCompact[]>()
  for (const r of sentimentResult.rows) {
    const yesPct = r.total > 0 ? Math.round((r.yes_count / r.total) * 100) : 50
    const entry: WordSentimentCompact = {
      word_id: r.word_id,
      market_id: r.market_id,
      word: r.word,
      yes_pct: yesPct,
      no_pct: 100 - yesPct,
    }
    const arr = sentimentByMarket.get(r.market_id) || []
    arr.push(entry)
    sentimentByMarket.set(r.market_id, arr)
  }

  return marketsResult.rows.map((m: any) => ({
    ...m,
    words_sentiment: sentimentByMarket.get(m.id) || [],
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
  const values: (number | string)[] = []
  const placeholders: string[] = []
  words.forEach((word, i) => {
    values.push(marketId, word.trim())
    placeholders.push(`($${i * 2 + 1}, $${i * 2 + 2})`)
  })
  const result = await pool.query(
    `INSERT INTO custom_market_words (market_id, word) VALUES ${placeholders.join(', ')} RETURNING *`,
    values,
  )
  return result.rows
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
    cases.push(`WHEN id = $${paramIndex} THEN $${paramIndex + 1}`)
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

// -- Predictions --

export async function upsertPrediction(
  marketId: number,
  wordId: number,
  wallet: string,
  prediction: boolean,
): Promise<CustomMarketPredictionRow> {
  const result = await pool.query(
    `INSERT INTO custom_market_predictions (market_id, word_id, wallet, prediction)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (market_id, word_id, wallet) DO UPDATE SET
       prediction = EXCLUDED.prediction,
       updated_at = NOW()
     RETURNING *`,
    [marketId, wordId, wallet, prediction],
  )
  return result.rows[0]
}

export async function getUserPredictions(
  marketId: number,
  wallet: string,
): Promise<CustomMarketPredictionRow[]> {
  const result = await pool.query(
    `SELECT * FROM custom_market_predictions WHERE market_id = $1 AND wallet = $2`,
    [marketId, wallet],
  )
  return result.rows
}

export async function getAllMarketPredictions(
  marketId: number,
): Promise<Map<string, CustomMarketPredictionRow[]>> {
  const result = await pool.query(
    `SELECT * FROM custom_market_predictions WHERE market_id = $1`,
    [marketId],
  )
  const byWallet = new Map<string, CustomMarketPredictionRow[]>()
  for (const row of result.rows) {
    const arr = byWallet.get(row.wallet) || []
    arr.push(row)
    byWallet.set(row.wallet, arr)
  }
  return byWallet
}

export async function getWordSentiment(marketId: number): Promise<WordSentiment[]> {
  const result = await pool.query(
    `SELECT
       w.id AS word_id,
       w.word,
       w.resolved_outcome,
       COUNT(p.id) FILTER (WHERE p.prediction = true)::int AS yes_count,
       COUNT(p.id) FILTER (WHERE p.prediction = false)::int AS no_count,
       COUNT(p.id)::int AS total
     FROM custom_market_words w
     LEFT JOIN custom_market_predictions p ON p.word_id = w.id
     WHERE w.market_id = $1
     GROUP BY w.id
     ORDER BY w.id`,
    [marketId],
  )
  return result.rows.map((r: any) => ({
    ...r,
    yes_pct: r.total > 0 ? Math.round((r.yes_count / r.total) * 100) : 50,
  }))
}

export async function getWordSentimentAtLockTime(marketId: number): Promise<WordSentiment[]> {
  const result = await pool.query(
    `SELECT
       w.id AS word_id,
       w.word,
       w.resolved_outcome,
       COUNT(p.id) FILTER (WHERE p.prediction = true)::int AS yes_count,
       COUNT(p.id) FILTER (WHERE p.prediction = false)::int AS no_count,
       COUNT(p.id)::int AS total
     FROM custom_market_words w
     LEFT JOIN custom_market_predictions p ON p.word_id = w.id
       AND p.updated_at <= (SELECT lock_time FROM custom_markets WHERE id = $1)
     WHERE w.market_id = $1
     GROUP BY w.id
     ORDER BY w.id`,
    [marketId],
  )
  return result.rows.map((r: any) => ({
    ...r,
    yes_pct: r.total > 0 ? Math.round((r.yes_count / r.total) * 100) : 50,
  }))
}

export async function getMarketParticipantWallets(marketId: number): Promise<string[]> {
  const result = await pool.query(
    `SELECT DISTINCT wallet FROM custom_market_predictions WHERE market_id = $1`,
    [marketId],
  )
  return result.rows.map((r: { wallet: string }) => r.wallet)
}

export async function getCustomMarketPredictionCount(marketId: number): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(DISTINCT wallet)::int AS cnt FROM custom_market_predictions WHERE market_id = $1`,
    [marketId],
  )
  return result.rows[0]?.cnt ?? 0
}

export { pool }
