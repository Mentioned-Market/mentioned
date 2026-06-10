// Client-side helpers for broadcasting signed transactions through the
// same-origin RPC proxies and polling them to confirmation.
//
// All wallet flows (Phantom two-step, Privy sign-only) funnel through these two
// functions so retry, error-shaping, and confirmation semantics live in exactly
// one place. Server-side cluster choice/failover is the proxy's job — these
// helpers only ever talk to a same-origin route, never to a keyed endpoint.
//
// Send is safe to retry: a signed transaction is idempotent by signature, so
// re-broadcasting the same bytes can never double-execute.

import { MAINNET_RPC_PROXY } from './rpcProxy'

/** Thrown when confirmation polling times out. The transaction MAY STILL LAND —
 * callers must never present this as a definite failure. */
export class ConfirmationTimeoutError extends Error {
  constructor(public readonly signature: string) {
    super(
      `Transaction confirmation timed out — it may still go through. ` +
        `Check the signature before retrying: ${signature}`
    )
    this.name = 'ConfirmationTimeoutError'
  }
}

// btoa(String.fromCharCode(...bytes)) blows the call stack on large inputs;
// chunked conversion is safe for any transaction size.
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

async function postJsonRpc(
  proxyUrl: string,
  method: string,
  params: unknown[]
): Promise<{ result?: unknown; error?: { code?: number; message?: string } }> {
  const res = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })

  // Transient proxy/infra failures are retried by the callers below; signal
  // them distinctly from JSON-RPC-level errors (which are final).
  if (res.status === 429 || res.status >= 500) {
    const retryAfter = Number(res.headers.get('Retry-After'))
    const err = new Error(
      res.status === 429 ? 'RPC rate limit exceeded' : `RPC proxy error (${res.status})`
    ) as Error & { transient: boolean; retryAfterMs: number }
    err.transient = true
    err.retryAfterMs =
      Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 8_000) : 1_000
    throw err
  }

  try {
    return await res.json()
  } catch {
    // Non-JSON body (e.g. a CDN error page) — treat as a transient infra
    // failure, not something to surface to the user as a parse error.
    const err = new Error('RPC proxy returned an invalid response') as Error & {
      transient: boolean
      retryAfterMs: number
    }
    err.transient = true
    err.retryAfterMs = 1_000
    throw err
  }
}

/**
 * Broadcast a fully-signed transaction via the same-origin RPC proxy and
 * return its base58 signature.
 *
 * skipPreflight is intentional: every flow pre-simulates before the wallet
 * signs, so preflight would only add latency and a second chance to flake.
 * Retries once on transient failure (network error, proxy 5xx, 429) — safe
 * because broadcasting is idempotent by signature.
 */
export async function sendViaProxy(
  signedTxBytes: Uint8Array,
  proxyUrl: string = MAINNET_RPC_PROXY
): Promise<string> {
  const base64Tx = bytesToBase64(signedTxBytes)
  const params = [
    base64Tx,
    { encoding: 'base64', skipPreflight: true, preflightCommitment: 'confirmed' },
  ]

  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const json = await postJsonRpc(proxyUrl, 'sendTransaction', params)
      if (json.error) {
        // JSON-RPC errors (bad blockhash, insufficient funds, …) are final —
        // retrying the same bytes returns the same error.
        throw new Error(json.error.message || JSON.stringify(json.error))
      }
      if (typeof json.result !== 'string') {
        throw new Error('RPC returned no signature')
      }
      return json.result
    } catch (e) {
      lastError = e
      const transient =
        (e as { transient?: boolean }).transient === true || e instanceof TypeError // fetch network failure
      if (!transient || attempt === 1) throw e
      const waitMs = (e as { retryAfterMs?: number }).retryAfterMs ?? 1_000
      await new Promise((r) => setTimeout(r, waitMs))
    }
  }
  throw lastError // unreachable, satisfies control-flow analysis
}

/**
 * Poll a signature to 'confirmed' via the same-origin RPC proxy.
 *
 * Throws on an on-chain error, ConfirmationTimeoutError on timeout. Individual
 * poll failures (blip in the proxy or upstream) are tolerated — the loop just
 * tries again on the next tick, since a missed poll is not a failed transaction.
 */
export async function confirmSignature(
  signature: string,
  opts: { proxyUrl?: string; timeoutMs?: number } = {}
): Promise<void> {
  const proxyUrl = opts.proxyUrl ?? MAINNET_RPC_PROXY
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000)

  // Start fast (a tx often confirms in ~1s), back off toward 2.5s so a slow
  // confirmation doesn't hammer the proxy's per-IP budget.
  let intervalMs = 1_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs))
    intervalMs = Math.min(intervalMs + 500, 2_500)

    // Transport and verdict are deliberately separate scopes: only the fetch
    // itself may be swallowed (a missed poll is not a failed transaction);
    // an on-chain error verdict must always propagate.
    let json: Awaited<ReturnType<typeof postJsonRpc>>
    try {
      json = await postJsonRpc(proxyUrl, 'getSignatureStatuses', [
        [signature],
        { searchTransactionHistory: false },
      ])
    } catch {
      continue // transient poll failure — try again on the next tick
    }

    const status = (json.result as { value?: Array<{ err?: unknown; confirmationStatus?: string } | null> } | undefined)?.value?.[0]
    if (status?.err) {
      throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`)
    }
    if (
      status?.confirmationStatus === 'confirmed' ||
      status?.confirmationStatus === 'finalized'
    ) {
      return
    }
  }
  throw new ConfirmationTimeoutError(signature)
}
