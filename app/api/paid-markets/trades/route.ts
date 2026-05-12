import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const marketId = req.nextUrl.searchParams.get('id')
  if (!marketId) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  const result = await pool.query(
    `SELECT
       te.signature,
       te.market_id    AS "marketId",
       te.word_index   AS "wordIndex",
       te.direction,
       te.is_buy       AS "isBuy",
       te.quantity,
       te.cost,
       te.implied_price AS "impliedPrice",
       te.trader,
       te.block_time   AS "blockTime",
       up.username
     FROM trade_events te
     LEFT JOIN user_profiles up ON up.wallet = te.trader
     WHERE te.market_id = $1
     ORDER BY te.block_time DESC
     LIMIT 30`,
    [marketId],
  )

  const trades = result.rows.map(r => ({
    signature: r.signature,
    wordIndex: r.wordIndex,
    direction: r.direction === 0 ? 'YES' : 'NO',
    isBuy: r.isBuy,
    quantity: parseFloat(r.quantity),
    cost: parseFloat(r.cost),
    impliedPrice: parseFloat(r.impliedPrice),
    trader: r.trader,
    username: r.username ?? null,
    blockTime: r.blockTime,
  }))

  return NextResponse.json({ trades })
}
