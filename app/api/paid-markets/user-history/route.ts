import { NextRequest, NextResponse } from 'next/server'
import { pool, getAllPaidMarketMetadata } from '@/lib/db'
import { fetchAllMarketsWithFallback } from '@/lib/mentionMarketUsdc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 10_000 base units = 0.01 shares — treat a net position below this as fully closed.
const SHARE_DUST = 10_000

// A realized, per-position P&L summary for a closed/resolved Mention Market position.
// Closed = the word resolved (won/lost) OR the user sold out of it entirely.
export interface ClosedPosition {
  marketId: string
  marketTitle: string
  coverImageUrl: string | null
  wordIndex: number
  wordLabel: string
  outcomeLabel: 'Won' | 'Lost' | 'Sold'   // how the position closed
  costBasisUsdc: number   // total USDC paid into the word (buys, fee-inclusive)
  proceedsUsdc: number    // sell proceeds + redeem payout (all fee-adjusted on-chain)
  realizedPnlUsdc: number // proceedsUsdc - costBasisUsdc
  closedAt: string        // block_time of the last trade on this word
}

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet')
  if (!wallet || wallet.length < 32) {
    return NextResponse.json({ error: 'wallet required' }, { status: 400 })
  }

  const [rows, allMetadata] = await Promise.all([
    pool.query(
      `SELECT
         te.signature,
         te.market_id    AS "marketId",
         te.word_index   AS "wordIndex",
         te.direction,
         te.is_buy       AS "isBuy",
         te.quantity,
         te.cost,
         te.fee,
         te.implied_price AS "impliedPrice",
         te.block_time   AS "blockTime"
       FROM trade_events te
       WHERE te.trader = $1
       ORDER BY te.block_time DESC
       LIMIT 5000`,
      [wallet],
    ),
    getAllPaidMarketMetadata(),
  ])
  const allMarkets = await fetchAllMarketsWithFallback(allMetadata.map(m => m.market_id))

  const metaByMarketId = new Map(allMetadata.map(m => [m.market_id, m]))
  const wordsByMarketId = new Map(
    allMarkets.map(({ account }) => [account.marketId.toString(), account.words])
  )

  // ── Recent trade list (unchanged shape — consumed by the profile page) ──────
  const trades = rows.rows.slice(0, 200).map(r => {
    const meta = metaByMarketId.get(r.marketId)
    const words = wordsByMarketId.get(r.marketId)
    const wordLabel = words?.[r.wordIndex]?.label ?? `Word ${r.wordIndex}`
    return {
      signature: r.signature,
      marketId: r.marketId,
      marketTitle: meta?.title ?? `Market #${r.marketId}`,
      coverImageUrl: meta?.cover_image_url ?? null,
      wordIndex: r.wordIndex,
      wordLabel,
      direction: r.direction === 0 ? 'YES' : 'NO',
      isBuy: r.isBuy,
      quantity: parseFloat(r.quantity),
      cost: parseFloat(r.cost),
      fee: parseFloat(r.fee),
      impliedPrice: parseFloat(r.impliedPrice),
      blockTime: r.blockTime,
    }
  })

  // ── Per-position realized P&L (grouped over ALL of the wallet's trades) ─────
  // cost/fee semantics (verified against the contract): a buy's `cost` is the
  // gross USDC paid (fee included); a sell's `cost` is the net USDC received
  // (fee already deducted). Redeem payout is 1:1 — each winning share (1e6 base
  // units) pays 1 USDC (1e6 base units) — so we infer it from net winning shares
  // rather than indexing RedemptionEvents.
  interface Agg {
    marketId: string
    wordIndex: number
    buyYesQty: number; buyYesCost: number; sellYesQty: number; sellYesCost: number
    buyNoQty: number;  buyNoCost: number;  sellNoQty: number;  sellNoCost: number
    lastTime: string
  }
  const aggMap = new Map<string, Agg>()
  for (const r of rows.rows) {
    const key = `${r.marketId}:${r.wordIndex}`
    let a = aggMap.get(key)
    if (!a) {
      a = {
        marketId: r.marketId, wordIndex: r.wordIndex,
        buyYesQty: 0, buyYesCost: 0, sellYesQty: 0, sellYesCost: 0,
        buyNoQty: 0,  buyNoCost: 0,  sellNoQty: 0,  sellNoCost: 0,
        lastTime: r.blockTime,
      }
      aggMap.set(key, a)
    }
    const qty = parseFloat(r.quantity)
    const cost = parseFloat(r.cost)
    const isYes = r.direction === 0
    if (r.isBuy) {
      if (isYes) { a.buyYesQty += qty; a.buyYesCost += cost }
      else       { a.buyNoQty  += qty; a.buyNoCost  += cost }
    } else {
      if (isYes) { a.sellYesQty += qty; a.sellYesCost += cost }
      else       { a.sellNoQty  += qty; a.sellNoCost  += cost }
    }
    if (new Date(r.blockTime) > new Date(a.lastTime)) a.lastTime = r.blockTime
  }

  const closedPositions: ClosedPosition[] = []
  for (const a of aggMap.values()) {
    const words = wordsByMarketId.get(a.marketId)
    const word = words?.[a.wordIndex]
    const outcome: boolean | null = word?.outcome ?? null
    const meta = metaByMarketId.get(a.marketId)

    const netYes = a.buyYesQty - a.sellYesQty
    const netNo  = a.buyNoQty  - a.sellNoQty
    const costBasis = a.buyYesCost + a.buyNoCost
    const sellProceeds = a.sellYesCost + a.sellNoCost

    let outcomeLabel: ClosedPosition['outcomeLabel']
    let redeemPayout = 0
    if (outcome !== null) {
      // Resolved: winning net shares redeem 1:1, losing shares expire worthless.
      const winNet = outcome ? netYes : netNo
      redeemPayout = Math.max(0, winNet)
      outcomeLabel = redeemPayout > 0 ? 'Won' : 'Lost'
    } else if (Math.abs(netYes) < SHARE_DUST && Math.abs(netNo) < SHARE_DUST) {
      // Unresolved but the user sold out of the word entirely.
      outcomeLabel = 'Sold'
    } else {
      // Still holding into an unresolved word — this is an OPEN position, skip.
      continue
    }

    const proceeds = sellProceeds + redeemPayout
    closedPositions.push({
      marketId: a.marketId,
      marketTitle: meta?.title ?? `Market #${a.marketId}`,
      coverImageUrl: meta?.cover_image_url ?? null,
      wordIndex: a.wordIndex,
      wordLabel: word?.label ?? `Word ${a.wordIndex}`,
      outcomeLabel,
      costBasisUsdc: costBasis,
      proceedsUsdc: proceeds,
      realizedPnlUsdc: proceeds - costBasis,
      closedAt: a.lastTime,
    })
  }

  closedPositions.sort((x, y) => new Date(y.closedAt).getTime() - new Date(x.closedAt).getTime())

  return NextResponse.json({ trades, closedPositions })
}
