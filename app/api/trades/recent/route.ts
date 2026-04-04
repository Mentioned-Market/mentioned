import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export interface RecentTradeItem {
  id: number
  wallet: string
  username: string | null
  marketId: string
  eventId: string
  isYes: boolean
  isBuy: boolean
  amountUsd: string
  marketTitle: string | null
  createdAt: string
  type: 'polymarket' | 'free'
  // free market extras
  wordLabel?: string
  cost?: number
  slug?: string | null
}

export async function GET() {
  const result = await pool.query(
    `SELECT
       pt.id::text           AS id,
       pt.wallet,
       up.username,
       pt.market_id          AS "marketId",
       pt.event_id           AS "eventId",
       pt.is_yes             AS "isYes",
       pt.is_buy             AS "isBuy",
       pt.amount_usd         AS "amountUsd",
       pt.market_title       AS "marketTitle",
       pt.created_at         AS "createdAt",
       'polymarket'          AS type,
       NULL::text            AS "wordLabel",
       NULL::numeric         AS cost,
       NULL::text            AS slug
     FROM polymarket_trades pt
     LEFT JOIN user_profiles up ON up.wallet = pt.wallet

     UNION ALL

     SELECT
       'free-' || cmt.id::text  AS id,
       cmt.wallet,
       up.username,
       cmt.market_id::text      AS "marketId",
       cmt.market_id::text      AS "eventId",
       (cmt.side = 'YES')       AS "isYes",
       (cmt.action = 'buy')     AS "isBuy",
       '0'                      AS "amountUsd",
       cm.title                 AS "marketTitle",
       cmt.created_at           AS "createdAt",
       'free'                   AS type,
       cmw.word                 AS "wordLabel",
       cmt.cost                 AS cost,
       cm.slug                  AS slug
     FROM custom_market_trades cmt
     LEFT JOIN user_profiles up ON up.wallet = cmt.wallet
     JOIN custom_markets cm ON cm.id = cmt.market_id
     JOIN custom_market_words cmw ON cmw.id = cmt.word_id

     ORDER BY "createdAt" DESC
     LIMIT 50`,
  )
  return NextResponse.json(result.rows)
}
