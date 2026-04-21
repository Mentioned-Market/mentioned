'use client'

import { getWallets } from '@wallet-standard/app'

const SOLANA_CHAIN = 'solana:mainnet-beta'
const MAINNET_URL =
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com'

interface SignAndSendFeature {
  signAndSendTransaction(
    ...inputs: Array<{ transaction: Uint8Array; account: any; chain?: string }>
  ): Promise<Array<{ signature: Uint8Array }>>
}

interface SignTransactionFeature {
  signTransaction(
    ...inputs: Array<{ transaction: Uint8Array; account: any; chain?: string }>
  ): Promise<Array<{ signedTransaction: Uint8Array }>>
}

const SIG_LENGTH = 64
const ZERO_SIG = new Uint8Array(SIG_LENGTH) // 64 zero bytes = empty signature slot

/**
 * Read the compact-u16 encoded signature count from a serialized transaction.
 * Returns [count, bytesConsumed].
 */
function readCompactU16(bytes: Uint8Array, offset: number): [number, number] {
  let val = 0
  let consumed = 0
  let shift = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const b = bytes[offset + consumed]
    consumed++
    val |= (b & 0x7f) << shift
    if ((b & 0x80) === 0) break
    shift += 7
  }
  return [val, consumed]
}

/**
 * Strip all non-zero signatures from a serialized transaction,
 * saving them for later restoration. This lets Phantom see a
 * "clean" transaction with no pre-existing unknown signatures,
 * avoiding Lighthouse warnings.
 *
 * Returns the stripped tx bytes and a map of index → saved signature.
 */
function stripSignatures(txBytes: Uint8Array): {
  stripped: Uint8Array
  saved: Map<number, Uint8Array>
} {
  const [sigCount, headerLen] = readCompactU16(txBytes, 0)
  const saved = new Map<number, Uint8Array>()
  const stripped = new Uint8Array(txBytes) // copy

  for (let i = 0; i < sigCount; i++) {
    const start = headerLen + i * SIG_LENGTH
    const sig = txBytes.slice(start, start + SIG_LENGTH)
    // Check if this sig slot is non-zero (already signed by someone)
    const isNonZero = sig.some((b) => b !== 0)
    if (isNonZero) {
      saved.set(i, sig)
      // Zero it out so Phantom sees an unsigned slot
      stripped.set(ZERO_SIG, start)
    }
  }

  return { stripped, saved }
}

/**
 * Restore previously saved signatures back into a signed transaction.
 */
function restoreSignatures(
  signedBytes: Uint8Array,
  saved: Map<number, Uint8Array>
): Uint8Array {
  const [, headerLen] = readCompactU16(signedBytes, 0)
  const restored = new Uint8Array(signedBytes) // copy

  for (const [idx, sig] of saved) {
    const start = headerLen + idx * SIG_LENGTH
    restored.set(sig, start)
  }

  return restored
}

/**
 * Pre-simulate a transaction via our own RPC with sigVerify disabled.
 */
async function preSimulate(txBytes: Uint8Array): Promise<void> {
  const base64Tx = btoa(String.fromCharCode(...txBytes))
  const res = await fetch(MAINNET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'simulateTransaction',
      params: [
        base64Tx,
        {
          encoding: 'base64',
          sigVerify: false,
          replaceRecentBlockhash: true,
        },
      ],
    }),
  })
  const json = await res.json()
  const err = json?.result?.value?.err
  if (err) {
    throw new Error(`Transaction simulation failed: ${JSON.stringify(err)}`)
  }
}

/**
 * Send a signed transaction via the server-side RPC proxy and return the signature.
 */
async function sendRawTransaction(signedTxBytes: Uint8Array): Promise<string> {
  const base64Tx = btoa(String.fromCharCode(...signedTxBytes))
  const res = await fetch('/api/rpc/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: base64Tx }),
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(`sendTransaction failed: ${json.error || 'Unknown error'}`)
  }
  return json.signature as string
}

/**
 * Sign and send a base64-encoded transaction using whatever wallet is connected.
 *
 * For Phantom with multi-signer transactions:
 * 1. Strip existing signatures from Jupiter's pre-signed transaction
 * 2. Have Phantom sign the clean transaction (wallet signs first)
 * 3. Restore Jupiter's signatures back into the signed transaction
 * 4. Send the fully-signed transaction via RPC
 *
 * This follows Phantom's recommended signing order to avoid Lighthouse warnings.
 */
export async function signAndSendTx(
  transaction: string,
  ownerPubkey: string,
  walletType: 'phantom' | 'privy'
): Promise<string> {
  const txBytes = Uint8Array.from(atob(transaction), (c) => c.charCodeAt(0))

  if (walletType === 'phantom') {
    return signAndSendPhantom(txBytes, ownerPubkey)
  } else {
    return signAndSendPrivy(txBytes, ownerPubkey)
  }
}

async function signAndSendPhantom(
  txBytes: Uint8Array,
  ownerPubkey: string
): Promise<string> {
  const wallets = getWallets().get()
  const wallet = wallets.find((w) => w.name === 'Phantom')
  if (!wallet) throw new Error('Phantom wallet not found')

  const account = wallet.accounts.find((a) => a.address === ownerPubkey)
  if (!account) throw new Error('Wallet account not found')

  const chain =
    account.chains.find((c) => c.startsWith('solana:')) || SOLANA_CHAIN

  // Pre-simulate the original transaction (with all signatures)
  await preSimulate(txBytes)

  // Check if signTransaction is available for the two-step flow
  if ('solana:signTransaction' in wallet.features) {
    const signFeature = wallet.features[
      'solana:signTransaction'
    ] as SignTransactionFeature

    // Strip existing signatures so Phantom sees a clean transaction
    const { stripped, saved } = stripSignatures(txBytes)

    // Phantom signs first (clean transaction, no unknown signatures)
    const [result] = await signFeature.signTransaction({
      transaction: stripped,
      account,
      chain,
    })

    // Restore the other signers' signatures
    const fullySigned = restoreSignatures(result.signedTransaction, saved)

    // Send via RPC
    return sendRawTransaction(fullySigned)
  }

  // Fallback: signAndSendTransaction
  const signAndSend = wallet.features[
    'solana:signAndSendTransaction'
  ] as SignAndSendFeature

  const [result] = await signAndSend.signAndSendTransaction({
    transaction: txBytes,
    account,
    chain,
  })
  return Array.from(result.signature)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function signAndSendPrivy(
  txBytes: Uint8Array,
  ownerPubkey: string
): Promise<string> {
  const wallet = getPrivySolanaProvider()
  if (!wallet) throw new Error('Privy Solana wallet not connected')

  const wallets = getWallets().get()

  for (const w of wallets) {
    if (!('solana:signAndSendTransaction' in w.features)) continue
    const account = w.accounts.find((a) => a.address === ownerPubkey)
    if (!account) continue

    const signAndSend = w.features[
      'solana:signAndSendTransaction'
    ] as SignAndSendFeature
    const chain =
      account.chains.find((c) => c.startsWith('solana:')) || SOLANA_CHAIN

    const [result] = await signAndSend.signAndSendTransaction({
      transaction: txBytes,
      account,
      chain,
    })
    return Array.from(result.signature)
      .map((b: number) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  throw new Error('No wallet-standard wallet found for Privy address')
}

/**
 * Module-level store for the Privy Solana wallet reference.
 */
let _privySolanaProvider: any = null

export function setPrivySolanaProvider(provider: any) {
  _privySolanaProvider = provider
}

function getPrivySolanaProvider(): any {
  return _privySolanaProvider
}
