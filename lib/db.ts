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
}

export async function getProfile(wallet: string): Promise<ProfileRow | null> {
  const result = await pool.query(
    `SELECT wallet, username FROM user_profiles WHERE wallet = $1`,
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
): Promise<PolymarketTradeRow> {
  const result = await pool.query(
    `INSERT INTO polymarket_trades (wallet, market_id, event_id, is_yes, is_buy, side, amount_usd, tx_signature)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [wallet, marketId, eventId, isYes, isBuy, side, amountUsd, txSignature || null],
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

export { pool }
