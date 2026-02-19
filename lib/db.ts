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

export { pool }
