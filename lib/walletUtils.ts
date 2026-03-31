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

/**
 * Pre-simulate a transaction via our own RPC with sigVerify disabled.
 * This catches errors before Phantom sees the tx, avoiding the
 * "This dApp could be malicious" simulation warning.
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
 * Send a signed transaction via RPC and return the signature.
 */
async function sendRawTransaction(signedTxBytes: Uint8Array): Promise<string> {
  const base64Tx = btoa(String.fromCharCode(...signedTxBytes))
  const res = await fetch(MAINNET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [
        base64Tx,
        {
          encoding: 'base64',
          skipPreflight: true,
          preflightCommitment: 'confirmed',
        },
      ],
    }),
  })
  const json = await res.json()
  if (json.error) {
    throw new Error(`sendTransaction failed: ${json.error.message || JSON.stringify(json.error)}`)
  }
  return json.result as string
}

/**
 * Sign and send a base64-encoded transaction using whatever wallet is connected.
 *
 * For Phantom: uses signTransaction (sign-only) first so the wallet signature
 * comes first, then sends via RPC. This avoids Phantom's Lighthouse flagging
 * transactions with multiple signers where the wallet isn't the first signer.
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

  await preSimulate(txBytes)

  // Use signTransaction so wallet signs first (Phantom Lighthouse requirement).
  // If signTransaction is available, use the two-step flow.
  // Otherwise fall back to signAndSendTransaction.
  if ('solana:signTransaction' in wallet.features) {
    const signFeature = wallet.features[
      'solana:signTransaction'
    ] as SignTransactionFeature

    const [result] = await signFeature.signTransaction({
      transaction: txBytes,
      account,
      chain,
    })

    // Send the wallet-signed transaction via RPC
    return sendRawTransaction(result.signedTransaction)
  }

  // Fallback: signAndSendTransaction (single-signer transactions)
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
