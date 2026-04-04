import { NextRequest, NextResponse } from 'next/server'
import { extractTradeEvents } from '@/lib/tradeParser'
import { insertTradeEvent } from '@/lib/db'

export async function POST(req: NextRequest) {
  const secret = process.env.HELIUS_WEBHOOK_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')
    if (auth !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const body = await req.json()

  // Helius sends an array of transactions
  const transactions = Array.isArray(body) ? body : [body]
  let inserted = 0
  let skipped = 0

  // Track global quantities per word to determine buy vs sell
  const prevQty = new Map<string, { yes: number; no: number }>()

  // Collect all events first, then process in order
  const allEvents: { event: ReturnType<typeof extractTradeEvents>[number]['event']; signature: string }[] = []

  for (const tx of transactions) {
    // Log top-level keys for debugging Helius payload format
    console.log('Webhook tx keys:', Object.keys(tx), 'signature:', tx.signature ?? 'MISSING')
    const events = extractTradeEvents(tx)
    allEvents.push(...events)
  }

  // Sort by timestamp to process in chronological order for buy/sell detection
  allEvents.sort((a, b) => a.event.timestamp - b.event.timestamp)

  for (const { event, signature } of allEvents) {
    const wordKey = `${event.marketId}-${event.wordIndex}`
    const prev = prevQty.get(wordKey) || { yes: 0, no: 0 }

    // Determine buy/sell: if the relevant quantity increased, it's a buy
    const relevantBefore = event.direction === 0 ? prev.yes : prev.no
    const relevantAfter = event.direction === 0 ? event.newYesQty : event.newNoQty
    const isBuy = relevantAfter > relevantBefore

    // Update tracked quantities
    prevQty.set(wordKey, { yes: event.newYesQty, no: event.newNoQty })

    const wasInserted = await insertTradeEvent(event, signature, isBuy)
    if (wasInserted) inserted++
    else skipped++
  }

  console.log(`Webhook: ${transactions.length} tx(s), ${inserted} inserted, ${skipped} skipped`)
  return NextResponse.json({ ok: true, inserted, skipped })
}
