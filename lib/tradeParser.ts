// Anchor event discriminator: sha256("event:TradeEvent")[0..8]
const TRADE_EVENT_DISC = new Uint8Array([189, 219, 127, 211, 78, 230, 97, 238])

export interface ParsedTradeEvent {
  marketId: bigint
  wordIndex: number
  direction: number // 0=YES, 1=NO
  quantity: number  // shares (divided by 1e9)
  cost: number      // SOL (divided by 1e9)
  fee: number
  newYesQty: number
  newNoQty: number
  impliedPrice: number // 0..1
  trader: string       // base58 pubkey
  timestamp: number    // unix seconds
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function base58Encode(bytes: Uint8Array): string {
  const digits = [0]
  for (const byte of bytes) {
    let carry = byte
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8
      digits[j] = carry % 58
      carry = (carry / 58) | 0
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = (carry / 58) | 0
    }
  }
  let str = ''
  for (const byte of bytes) {
    if (byte === 0) str += '1'
    else break
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    str += BASE58_ALPHABET[digits[i]]
  }
  return str
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Parse a base64-encoded Anchor event into a TradeEvent.
 * Returns null if the discriminator doesn't match or data is too short.
 */
export function parseTradeEvent(base64Data: string): ParsedTradeEvent | null {
  const raw = Buffer.from(base64Data, 'base64')
  const data = new Uint8Array(raw)

  if (data.length < 106) return null
  if (!arraysEqual(data.slice(0, 8), TRADE_EVENT_DISC)) return null

  const dv = new DataView(data.buffer, data.byteOffset)

  return {
    marketId: dv.getBigUint64(8, true),
    wordIndex: data[16],
    direction: data[17],
    quantity: Number(dv.getBigUint64(18, true)) / 1e9,
    cost: Number(dv.getBigUint64(26, true)) / 1e9,
    fee: Number(dv.getBigUint64(34, true)) / 1e9,
    newYesQty: Number(dv.getBigInt64(42, true)) / 1e9,
    newNoQty: Number(dv.getBigInt64(50, true)) / 1e9,
    impliedPrice: Number(dv.getBigUint64(58, true)) / 1e9,
    trader: base58Encode(data.slice(66, 98)),
    timestamp: Number(dv.getBigInt64(98, true)),
  }
}

/**
 * Extract all TradeEvents from a Helius webhook transaction payload.
 */
export function extractTradeEvents(
  tx: { signature?: string; meta?: { logMessages?: string[] } }
): { event: ParsedTradeEvent; signature: string }[] {
  const results: { event: ParsedTradeEvent; signature: string }[] = []
  const sig = tx.signature ?? ''
  const logs = tx.meta?.logMessages ?? []

  for (const log of logs) {
    if (!log.startsWith('Program data: ')) continue
    const b64 = log.slice('Program data: '.length)
    const event = parseTradeEvent(b64)
    if (event) {
      results.push({ event, signature: sig })
    }
  }

  return results
}
