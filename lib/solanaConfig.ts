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

// NEXT_PUBLIC_ so the choice is available in the browser bundle too. Anything
// other than the literal 'devnet' resolves to mainnet (fail-safe to live).
export const SOLANA_CLUSTER: SolanaCluster =
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER === 'devnet' ? 'devnet' : 'mainnet'

// RPC resolution per cluster. The server var wins (unrestricted key — server
// requests carry no Origin header, so a domain-locked key would 401); in the
// browser the server var is undefined (Next only inlines NEXT_PUBLIC_*), so the
// bundle falls back to the domain-locked public key. Public-cluster URL is the
// last resort (no API key shipped). Keep dedicated paid keys separate from the
// app's general RPC so a browser-shipped key can stay domain-locked.
const CONFIG = {
  mainnet: {
    programId: '7pL3oze39xX7NmGFtndTz3EjhkCP9AcoVtX6fVmxm9pn',
    usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Circle USDC on Solana
    rpc: {
      server: process.env.HELIUS_MAINNET_RPC_URL,
      browser: process.env.NEXT_PUBLIC_HELIUS_MAINNET_RPC_URL,
      fallback: 'https://api.mainnet-beta.solana.com',
    },
  },
  devnet: {
    programId: '9kSuebrHKKnFsgFcv5fc8S2gBazHA9Gki2NEWt2ft9tk',
    usdcMint: '6duUhxsjpsRasCSmvejAad4hH7aSyuBba99iZvsCsDum',
    rpc: {
      server: process.env.HELIUS_DEVNET_RPC_URL,
      browser: process.env.NEXT_PUBLIC_HELIUS_DEVNET_RPC_URL,
      fallback: 'https://api.devnet.solana.com',
    },
  },
} as const

const active = CONFIG[SOLANA_CLUSTER]

export const PAID_PROGRAM_ID = active.programId
export const PAID_USDC_MINT = active.usdcMint
export const PAID_RPC_URL = active.rpc.server || active.rpc.browser || active.rpc.fallback

// Human-readable cluster label for UI copy (e.g. "on Solana mainnet").
export const CLUSTER_LABEL = SOLANA_CLUSTER === 'mainnet' ? 'mainnet' : 'devnet'
