import { NextRequest, NextResponse } from 'next/server'
import {
  getCustomMarket,
  getCustomMarketWords,
  getWordPools,
  getMarketTraderCount,
  updateCustomMarket,
  deleteCustomMarket,
} from '@/lib/db'
import { isAdmin } from '@/lib/adminAuth'
import { virtualImpliedPrice } from '@/lib/virtualLmsr'
import { getVerifiedWallet } from '@/lib/walletAuth'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const marketId = parseInt(id, 10)
  if (isNaN(marketId)) {
    return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
  }

  const market = await getCustomMarket(marketId)
  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 })
  }

  const b = parseFloat(String(market.b_parameter))

  const [words, pools, traderCount] = await Promise.all([
    getCustomMarketWords(marketId),
    getWordPools(marketId),
    getMarketTraderCount(marketId),
  ])

  const poolMap = new Map(pools.map(p => [p.word_id, p]))
  const wordsWithPrices = words.map(w => {
    const pool = poolMap.get(w.id)
    const yesQty = pool ? parseFloat(pool.yes_qty) : 0
    const noQty = pool ? parseFloat(pool.no_qty) : 0
    const prices = virtualImpliedPrice(yesQty, noQty, b)
    const isResolved = w.resolved_outcome !== null
    return {
      ...w,
      yes_price: isResolved ? (w.resolved_outcome ? 1 : 0) : prices.yes,
      no_price: isResolved ? (w.resolved_outcome ? 0 : 1) : prices.no,
      yes_qty: yesQty,
      no_qty: noQty,
    }
  })

  return NextResponse.json({ market, words: wordsWithPrices, traderCount })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const marketId = parseInt(id, 10)
  if (isNaN(marketId)) {
    return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
  }

  const wallet = getVerifiedWallet(req)
  if (!wallet || !isAdmin(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await req.json()
  const { market_type: rawMarketType, ...rest } = body as {
    title?: string
    description?: string
    cover_image_url?: string
    stream_url?: string
    lock_time?: string
    market_type?: string
    event_start_time?: string
  }

  const fields = {
    ...rest,
    ...(rawMarketType !== undefined && { market_type: rawMarketType === 'event' ? 'event' : 'continuous' }),
  }

  const market = await updateCustomMarket(marketId, fields)
  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 })
  }

  return NextResponse.json({ market })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const marketId = parseInt(id, 10)
  if (isNaN(marketId)) {
    return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
  }

  const wallet = getVerifiedWallet(req)
  if (!wallet || !isAdmin(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const deleted = await deleteCustomMarket(marketId)
  if (!deleted) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
