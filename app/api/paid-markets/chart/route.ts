import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { SOLANA_CLUSTER } from '@/lib/solanaConfig'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'Valid market id required' }, { status: 400 })
  }

  const result = await pool.query(
    `SELECT word_index, implied_price, block_time, cost
     FROM trade_events
     WHERE market_id = $1 AND cluster = $2
     ORDER BY block_time ASC
     LIMIT 2000`,
    [id, SOLANA_CLUSTER],
  )

  const byWord = new Map<number, { t: number; p: number }[]>()
  let totalVolume = 0
  for (const row of result.rows) {
    const idx: number = row.word_index
    if (!byWord.has(idx)) byWord.set(idx, [])
    byWord.get(idx)!.push({
      t: Math.floor(new Date(row.block_time).getTime() / 1000),
      p: parseFloat(row.implied_price),
    })
    totalVolume += parseFloat(row.cost)
  }

  const words = Array.from(byWord.entries()).map(([wordIndex, history]) => ({
    wordIndex,
    history,
  }))

  return NextResponse.json({ words, totalVolume })
}
