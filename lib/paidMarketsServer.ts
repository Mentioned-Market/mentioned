// SERVER-ONLY shared cache for paid-market on-chain state.
//
// Every wallet-scoped paid read route (list, user-positions, user-history,
// wallet-summary) needs the same two inputs: the paid_market_metadata rows and
// the on-chain market accounts (one getAccountInfo per market via
// fetchAllMarketsWithFallback). The per-wallet response caches in those routes
// only help a single wallet polling — they don't share the market fan-out
// ACROSS wallets, so upstream RPC cost scaled with user count. This cache makes
// it scale with market count instead: at most one fan-out per TTL window
// process-wide, no matter how many wallets are being served.
//
// The cached value holds live bigints (no serialization happens here) — routes
// keep doing their own JSON shaping exactly as before.
//
// Do not import from client components: this pulls in lib/db (pg). The TTL is
// deliberately at-or-below the routes' own response caches so worst-case
// staleness stays within what the list route already accepts.

import { cached } from './ttlCache'
import { fetchAllMarketsWithFallback, UsdcMarketAccount } from './mentionMarketUsdc'
import { getAllPaidMarketMetadata, PaidMarketMetadata } from './db'
import { SOLANA_CLUSTER } from './solanaConfig'
import type { Address } from '@solana/kit'

export interface PaidMarketsSnapshot {
  metadata: PaidMarketMetadata[]
  markets: Array<{ pubkey: Address; account: UsdcMarketAccount }>
}

const TTL_MS = 5_000
// Stale-on-error window: during an RPC/DB blip, serving a ≤60s-old snapshot
// keeps positions/list pages populated instead of erroring.
const STALE_MS = 60_000

/**
 * Metadata rows + on-chain market accounts, cached process-wide.
 * Single-flight: concurrent callers across all routes share one fan-out.
 */
export function getMarketsAndMetadataCached(): Promise<PaidMarketsSnapshot> {
  return cached<PaidMarketsSnapshot>(
    `paid:markets:${SOLANA_CLUSTER}`,
    { ttlMs: TTL_MS, staleMs: STALE_MS },
    async () => {
      const metadata = await getAllPaidMarketMetadata()
      const markets = await fetchAllMarketsWithFallback(metadata.map(m => m.market_id))
      return { metadata, markets }
    },
  )
}
