import { NextRequest, NextResponse } from 'next/server'
import { extractTradeEvents } from '@/lib/tradeParser'
import { insertTradeEvent, getLatestPoolQtys } from '@/lib/db'
import { PAID_PROGRAM_ID, SOLANA_CLUSTER } from '@/lib/solanaConfig'

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

  // Collect all events first, then process in order
  const allEvents: { event: ReturnType<typeof extractTradeEvents>[number]['event']; signature: string }[] = []

  for (const tx of transactions) {
    console.log('Webhook tx keys:', Object.keys(tx), 'signature:', tx.signature ?? 'MISSING')
    // Only index events from the active cluster's program, so a single endpoint
    // can serve both the devnet and mainnet Helius webhooks (config picks which).
    const events = extractTradeEvents(tx, PAID_PROGRAM_ID)
    allEvents.push(...events)
  }

  // Sort by timestamp to process in chronological order for buy/sell detection
  allEvents.sort((a, b) => a.event.timestamp - b.event.timestamp)

  // Seed prevQty from DB so the first event in a batch correctly detects buy vs sell
  const uniqueKeys = [...new Map(
    allEvents.map(({ event }) => [`${event.marketId}-${event.wordIndex}`, { marketId: event.marketId.toString(), wordIndex: event.wordIndex }])
  ).values()]
  const prevQty = await getLatestPoolQtys(uniqueKeys, SOLANA_CLUSTER)

  for (const { event, signature } of allEvents) {
    const wordKey = `${event.marketId}-${event.wordIndex}`
    const prev = prevQty.get(wordKey) ?? { yes: 0, no: 0 }

    // Determine buy/sell: if the relevant pool quantity increased, it's a buy
    const relevantBefore = event.direction === 0 ? prev.yes : prev.no
    const relevantAfter = event.direction === 0 ? event.newYesQty : event.newNoQty
    const isBuy = relevantAfter > relevantBefore

    // Update tracked quantities for subsequent events in this batch
    prevQty.set(wordKey, { yes: event.newYesQty, no: event.newNoQty })

    const wasInserted = await insertTradeEvent(event, signature, isBuy, SOLANA_CLUSTER)
    if (wasInserted) inserted++
    else skipped++
  }

  console.log(`Webhook [${SOLANA_CLUSTER}]: ${transactions.length} tx(s), ${inserted} inserted, ${skipped} skipped`)
  return NextResponse.json({ ok: true, inserted, skipped })
}
