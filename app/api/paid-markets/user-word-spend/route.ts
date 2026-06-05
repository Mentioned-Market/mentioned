import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Net USDC a wallet has committed to each (word, side) of a market:
//   net = Σ buy.cost − Σ sell.cost   (base units, 1e6 = $1)
// Buy `cost` is the gross USDC paid (fee-inclusive); sell `cost` is the net USDC
// received — so this is a faithful "money in − money out" per position. The
// frontend uses it to enforce a $2-per-(word,side) net-spend cap. Selling lowers
// the figure (so re-entry is allowed, by design), but it can't be inflated by
// price drift the way a mark-to-market measure can.
//
// Response: { spend: { "<wordIndex>:<0|1>": netBaseUnits } }  (0 = YES, 1 = NO)
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet')
  const marketId = req.nextUrl.searchParams.get('id')
  if (!wallet || wallet.length < 32) {
    return NextResponse.json({ error: 'wallet required' }, { status: 400 })
  }
  if (!marketId || !/^\d+$/.test(marketId)) {
    return NextResponse.json({ error: 'valid market id required' }, { status: 400 })
  }

  const rows = await pool.query(
    `SELECT word_index AS "wordIndex",
            direction,
            SUM(CASE WHEN is_buy THEN cost ELSE -cost END) AS net
       FROM trade_events
      WHERE trader = $1 AND market_id = $2
      GROUP BY word_index, direction`,
    [wallet, marketId],
  )

  const spend: Record<string, number> = {}
  for (const r of rows.rows) {
    spend[`${r.wordIndex}:${r.direction}`] = parseFloat(r.net)
  }

  return NextResponse.json({ spend })
}
