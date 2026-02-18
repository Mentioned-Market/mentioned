import 'dotenv/config'
import pg from 'pg'
import { parseTradeEvent, type ParsedTradeEvent } from '../lib/tradeParser'

const PROGRAM_ID = '2oKQaiKx3C2qpkqFYGDdvEGTyBDJP85iuQtJ5vaPdFrU'
const RPC_URL = 'https://api.devnet.solana.com'

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
})

async function rpcCall(method: string, params: unknown[]) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const json = await res.json()
  if (json.error) throw new Error(`RPC error: ${json.error.message}`)
  return json.result
}

async function main() {
  console.log('Backfilling trade events from on-chain history...')

  // Get all transaction signatures for the program
  let allSignatures: { signature: string }[] = []
  let before: string | undefined
  const BATCH = 1000

  while (true) {
    const opts: Record<string, unknown> = { limit: BATCH }
    if (before) opts.before = before
    const sigs = await rpcCall('getSignaturesForAddress', [PROGRAM_ID, opts])
    if (!sigs || sigs.length === 0) break
    allSignatures.push(...sigs)
    before = sigs[sigs.length - 1].signature
    console.log(`  Fetched ${allSignatures.length} signatures so far...`)
    if (sigs.length < BATCH) break
    // Rate limit
    await new Promise((r) => setTimeout(r, 500))
  }

  console.log(`Found ${allSignatures.length} total signatures`)

  // Fetch transactions and extract trade events
  type EventWithSig = { event: ParsedTradeEvent; signature: string }
  const allEvents: EventWithSig[] = []

  for (let i = 0; i < allSignatures.length; i += 10) {
    const batch = allSignatures.slice(i, i + 10)
    const results = await Promise.all(
      batch.map(async (sig) => {
        try {
          const tx = await rpcCall('getTransaction', [
            sig.signature,
            { encoding: 'json', maxSupportedTransactionVersion: 0 },
          ])
          return { tx, signature: sig.signature }
        } catch {
          return null
        }
      })
    )

    for (const result of results) {
      if (!result?.tx?.meta?.logMessages) continue
      for (const log of result.tx.meta.logMessages) {
        if (!log.startsWith('Program data: ')) continue
        const b64 = log.slice('Program data: '.length)
        const event = parseTradeEvent(b64)
        if (event) {
          allEvents.push({ event, signature: result.signature })
        }
      }
    }

    if ((i + 10) % 50 === 0) {
      console.log(`  Processed ${Math.min(i + 10, allSignatures.length)}/${allSignatures.length} transactions, found ${allEvents.length} trade events`)
    }
    // Rate limit
    await new Promise((r) => setTimeout(r, 200))
  }

  console.log(`\nFound ${allEvents.length} total trade events`)

  // Sort chronologically for buy/sell detection
  allEvents.sort((a, b) => a.event.timestamp - b.event.timestamp)

  // Track global quantities per word to determine buy vs sell
  const prevQty = new Map<string, { yes: number; no: number }>()
  let inserted = 0
  let skipped = 0

  for (const { event, signature } of allEvents) {
    const wordKey = `${event.marketId}-${event.wordIndex}`
    const prev = prevQty.get(wordKey) || { yes: 0, no: 0 }

    const relevantBefore = event.direction === 0 ? prev.yes : prev.no
    const relevantAfter = event.direction === 0 ? event.newYesQty : event.newNoQty
    const isBuy = relevantAfter > relevantBefore

    prevQty.set(wordKey, { yes: event.newYesQty, no: event.newNoQty })

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
    if ((result.rowCount ?? 0) > 0) inserted++
    else skipped++
  }

  console.log(`\nBackfill complete: ${inserted} inserted, ${skipped} skipped (duplicates)`)
  await pool.end()
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
