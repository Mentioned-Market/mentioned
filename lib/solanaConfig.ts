// ── Solana cluster configuration for the paid (on-chain USDC AMM) stack ──────
//
// Single source of truth for WHICH network the paid markets target. Mainnet is
// the live deployment and the default. To point the entire paid stack back at
// the devnet program (e.g. to validate a contract upgrade before promoting it),
// set NEXT_PUBLIC_SOLANA_CLUSTER=devnet — nothing else needs to change.
//
// Everything cluster-specific (program ID, USDC mint, RPC endpoint) is selected
// here so there are no hardcoded network values scattered through the codebase.

export type SolanaCluster = 'mainnet' | 'devnet'

// NEXT_PUBLIC_ so the choice is available in the browser bundle too (this is a
// cluster name, never a secret). Anything other than the literal 'devnet'
// resolves to mainnet (fail-safe to live).
export const SOLANA_CLUSTER: SolanaCluster =
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER === 'devnet' ? 'devnet' : 'mainnet'

const CONFIG = {
  mainnet: {
    programId: '7pL3oze39xX7NmGFtndTz3EjhkCP9AcoVtX6fVmxm9pn',
    usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Circle USDC on Solana
  },
  devnet: {
    programId: '9kSuebrHKKnFsgFcv5fc8S2gBazHA9Gki2NEWt2ft9tk',
    usdcMint: '6duUhxsjpsRasCSmvejAad4hH7aSyuBba99iZvsCsDum',
  },
} as const

const active = CONFIG[SOLANA_CLUSTER]

export const PAID_PROGRAM_ID = active.programId
export const PAID_USDC_MINT = active.usdcMint

// Public (keyless) endpoint for the active cluster. Used as the unset-var
// fallback below and as the outage failover target in /api/paid-rpc.
export const PAID_RPC_PUBLIC =
  SOLANA_CLUSTER === 'mainnet'
    ? 'https://api.mainnet-beta.solana.com'
    : 'https://api.devnet.solana.com'

// Keyed upstream RPC for the active cluster — SERVER-ONLY (no NEXT_PUBLIC), so the
// Helius API key never reaches the browser bundle. Read at runtime, so changing it
// in the host dashboard takes effect on restart with no rebuild. Used by the
// server-side paid routes and by the /api/paid-rpc proxy below. Falls back to the
// public cluster endpoint if unset (works for basic reads, not getProgramAccounts).
export const PAID_RPC_UPSTREAM =
  (SOLANA_CLUSTER === 'mainnet'
    ? process.env.HELIUS_MAINNET_RPC_URL
    : process.env.HELIUS_DEVNET_RPC_URL) ||
  PAID_RPC_PUBLIC

// What the paid SDK points its RPC client / fetches at:
//   - server (window undefined): the keyed upstream directly — no point proxying
//     server→server, and the key is already private there.
//   - browser: a same-origin proxy (/api/paid-rpc) that forwards to the upstream
//     server-side. No API key is shipped to the client, and there is no
//     NEXT_PUBLIC build-time inlining to manage. The SSR placeholder is never
//     fetched — all paid RPC runs inside browser effects/handlers.
export const PAID_RPC_URL =
  typeof window === 'undefined'
    ? PAID_RPC_UPSTREAM
    : `${window.location.origin}/api/paid-rpc`

// Human-readable cluster label for UI copy (e.g. "on Solana mainnet").
export const CLUSTER_LABEL = SOLANA_CLUSTER === 'mainnet' ? 'mainnet' : 'devnet'
