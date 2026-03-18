import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

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
}

export async function GET() {
  const result = await pool.query(
    `SELECT
       pt.id,
       pt.wallet,
       up.username,
       pt.market_id    AS "marketId",
       pt.event_id     AS "eventId",
       pt.is_yes       AS "isYes",
       pt.is_buy       AS "isBuy",
       pt.amount_usd   AS "amountUsd",
       pt.market_title AS "marketTitle",
       pt.created_at   AS "createdAt"
     FROM polymarket_trades pt
     LEFT JOIN user_profiles up ON up.wallet = pt.wallet
     ORDER BY pt.created_at DESC
     LIMIT 40`,
  )
  return NextResponse.json(result.rows)
}
