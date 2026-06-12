// ── Event treasury funding (SERVER-ONLY) ────────────────────────────────────
//
// Builds, signs, and broadcasts ONE transaction from the event treasury wallet
// that credits a recipient with USDC + SOL. Used by the event claim route to
// fund a fresh wallet so a new user can place a trade.
//
// SECURITY:
//   - The treasury secret key lives ONLY in the EVENT_FUNDER_SECRET_KEY env var
//     (server-side). It is never imported into client code and never logged.
//   - The recipient and amounts are passed in by the caller from the
//     authenticated session + server-side campaign config — never client input.
//   - Fund the treasury with ONLY the event budget so a key compromise caps the
//     blast radius at what's in the wallet.
//
// The cluster (mainnet/devnet), USDC mint, decimals, and keyed RPC all come from
// lib/solanaConfig, so this matches whatever network the paid markets run on.
//
// This module reads EVENT_FUNDER_SECRET_KEY and must only be imported from
// server code (API routes) — never from a client component.

import {
  address as toAddress,
  createSolanaRpc,
  createKeyPairSignerFromBytes,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageComputeUnitLimit,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
} from '@solana/kit'
import { getTransferSolInstruction } from '@solana-program/system'
import {
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getTransferCheckedInstruction,
} from '@solana-program/token'
import bs58 from 'bs58'
import {
  USDC_MINT,
  USDC_DECIMALS,
  getAssociatedTokenAddress,
} from './mentionMarketUsdc'
import { PAID_RPC_UPSTREAM } from './solanaConfig'
import { confirmSignature } from './rpcSend'

/**
 * Parse EVENT_FUNDER_SECRET_KEY into the 64-byte secret key.
 * Accepts either a JSON byte array (solana-keygen id.json format) or a base58
 * string (the Phantom "export private key" format). Both encode the full
 * 64-byte keypair (32 secret + 32 public).
 */
function loadTreasurySecretBytes(): Uint8Array {
  const raw = process.env.EVENT_FUNDER_SECRET_KEY?.trim()
  if (!raw) throw new Error('EVENT_FUNDER_SECRET_KEY is not set')
  let bytes: Uint8Array
  if (raw.startsWith('[')) {
    bytes = Uint8Array.from(JSON.parse(raw) as number[])
  } else {
    bytes = bs58.decode(raw)
  }
  if (bytes.length !== 64) {
    throw new Error(
      `EVENT_FUNDER_SECRET_KEY must decode to 64 bytes, got ${bytes.length}`,
    )
  }
  return bytes
}

export interface FundResult {
  signature: string
}

/**
 * Fund `recipient` with `usdcBaseUnits` USDC + `lamports` SOL from the treasury.
 * One transaction, treasury is fee payer:
 *   1. create the recipient's USDC ATA (idempotent — no-op if it exists)
 *   2. transfer USDC treasury-ATA → recipient-ATA
 *   3. transfer SOL treasury → recipient
 *
 * Throws on any failure (insufficient treasury funds, RPC error, on-chain
 * error, confirmation timeout). The caller releases the reserved code on throw
 * so the holder can retry. A ConfirmationTimeoutError means the tx MAY still
 * land — the caller must treat that case carefully (see the claim route).
 */
export async function fundEventWallet(
  recipient: string,
  usdcBaseUnits: bigint,
  lamports: bigint,
): Promise<FundResult> {
  const signer = await createKeyPairSignerFromBytes(loadTreasurySecretBytes())
  const recipientAddr = toAddress(recipient)

  const treasuryUsdc = await getAssociatedTokenAddress(USDC_MINT, signer.address)
  const recipientUsdc = await getAssociatedTokenAddress(USDC_MINT, recipientAddr)

  // 1. Create the recipient's USDC ATA if needed (treasury pays rent).
  const createAtaIx = await getCreateAssociatedTokenIdempotentInstructionAsync({
    payer: signer,
    owner: recipientAddr,
    mint: USDC_MINT,
  })

  // 2. USDC transfer (checked: verifies mint + decimals on-chain).
  const usdcIx = getTransferCheckedInstruction({
    source: treasuryUsdc,
    mint: USDC_MINT,
    destination: recipientUsdc,
    authority: signer,
    amount: usdcBaseUnits,
    decimals: USDC_DECIMALS,
  })

  // 3. SOL transfer.
  const solIx = getTransferSolInstruction({
    source: signer,
    destination: recipientAddr,
    amount: lamports,
  })

  const rpc = createSolanaRpc(PAID_RPC_UPSTREAM)
  const { value: blockhash } = await rpc.getLatestBlockhash().send()

  const txMsg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    // 3 simple instructions (ATA create + 2 transfers) fit well under this.
    (m) => setTransactionMessageComputeUnitLimit(80_000, m),
    (m) => appendTransactionMessageInstructions([createAtaIx, usdcIx, solIx], m),
  )

  const signedTx = await signTransactionMessageWithSigners(txMsg)
  const wireBase64 = getBase64EncodedWireTransaction(signedTx)
  const signature = getSignatureFromTransaction(signedTx)

  // Broadcast directly to the keyed upstream (server already holds the key, so
  // no proxy hop). Preflight on: surfaces an underfunded treasury immediately.
  const res = await fetch(PAID_RPC_UPSTREAM, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [
        wireBase64,
        {
          encoding: 'base64',
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 5,
        },
      ],
    }),
  })
  const json = await res.json()
  if (json.error) {
    throw new Error(json.error.message || JSON.stringify(json.error))
  }

  // Poll to confirmation against the same upstream (confirmSignature just does
  // getSignatureStatuses over fetch, which works server-side too).
  await confirmSignature(signature, { proxyUrl: PAID_RPC_UPSTREAM })

  return { signature }
}
