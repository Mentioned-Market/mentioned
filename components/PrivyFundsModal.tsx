'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import {
  address as toAddress,
  AccountRole,
  type Instruction,
  getProgramDerivedAddress,
  getAddressEncoder,
  createSolanaRpc,
  mainnet,
} from '@solana/kit'
import {
  sendIxs,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  ASSOCIATED_TOKEN_PROGRAM,
} from '@/lib/mentionMarket'

// ── Token config ─────────────────────────────────────────

const MAINNET_URL =
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com'

const TOKENS = {
  SOL: { symbol: 'SOL', name: 'Solana', decimals: 9, mint: null as null },
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  },
  jupUSD: {
    symbol: 'jupUSD',
    name: 'Jupiter USD',
    decimals: 6,
    mint: 'JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD',
  },
} as const

type TokenKey = keyof typeof TOKENS

// ── Instruction builders ──────────────────────────────────

function buildSolTransferIx(from: string, to: string, lamports: bigint): Instruction {
  const data = new Uint8Array(12)
  const view = new DataView(data.buffer)
  view.setUint32(0, 2, true) // SystemProgram::Transfer
  view.setBigUint64(4, lamports, true)
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [
      { address: toAddress(from), role: AccountRole.WRITABLE_SIGNER },
      { address: toAddress(to), role: AccountRole.WRITABLE },
    ],
    data,
  }
}

function buildSplTransferIx(
  sourceAta: string,
  destAta: string,
  owner: string,
  amount: bigint,
): Instruction {
  const data = new Uint8Array(9)
  data[0] = 3 // SPL Token Transfer discriminator
  const view = new DataView(data.buffer)
  view.setBigUint64(1, amount, true)
  return {
    programAddress: TOKEN_PROGRAM,
    accounts: [
      { address: toAddress(sourceAta), role: AccountRole.WRITABLE },
      { address: toAddress(destAta), role: AccountRole.WRITABLE },
      { address: toAddress(owner), role: AccountRole.READONLY_SIGNER },
    ],
    data,
  }
}

async function buildCreateAtaIx(
  payer: string,
  owner: string,
  mint: string,
  ata: string,
): Promise<Instruction> {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    accounts: [
      { address: toAddress(payer), role: AccountRole.WRITABLE_SIGNER },
      { address: toAddress(ata), role: AccountRole.WRITABLE },
      { address: toAddress(owner), role: AccountRole.READONLY },
      { address: toAddress(mint), role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([1]), // create_idempotent
  }
}

async function deriveAta(owner: string, mint: string): Promise<string> {
  const encoder = getAddressEncoder()
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    seeds: [
      encoder.encode(toAddress(owner)),
      encoder.encode(TOKEN_PROGRAM),
      encoder.encode(toAddress(mint)),
    ],
  })
  return ata
}

// ── Component ─────────────────────────────────────────────

interface PrivyFundsModalProps {
  open: boolean
  onClose: () => void
}

export default function PrivyFundsModal({ open, onClose }: PrivyFundsModalProps) {
  const { publicKey, balance, signer } = useWallet()

  const [tab, setTab] = useState<'deposit' | 'withdraw'>('deposit')
  const [selectedToken, setSelectedToken] = useState<TokenKey>('SOL')
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Token balances
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null)
  const [jupUsdBalance, setJupUsdBalance] = useState<number | null>(null)
  const [balancesLoading, setBalancesLoading] = useState(false)

  const backdropRef = useRef<HTMLDivElement>(null)

  const fetchTokenBalances = useCallback(async () => {
    if (!publicKey) return
    setBalancesLoading(true)
    try {
      const rpc = createSolanaRpc(mainnet(MAINNET_URL))
      const result = await rpc
        .getTokenAccountsByOwner(
          toAddress(publicKey),
          { programId: TOKEN_PROGRAM },
          { encoding: 'jsonParsed' as any },
        )
        .send()

      let usdc = 0
      let jupUsd = 0

      for (const { account } of result.value) {
        const parsed = (account.data as any)?.parsed
        if (!parsed) continue
        const mint: string = parsed.info?.mint
        const rawAmount: string = parsed.info?.tokenAmount?.amount
        if (!mint || !rawAmount) continue

        if (mint === TOKENS.USDC.mint) {
          usdc = Number(rawAmount) / 10 ** TOKENS.USDC.decimals
        } else if (mint === TOKENS.jupUSD.mint) {
          jupUsd = Number(rawAmount) / 10 ** TOKENS.jupUSD.decimals
        }
      }

      setUsdcBalance(usdc)
      setJupUsdBalance(jupUsd)
    } catch {
      // silently fail — balances will show as null
    } finally {
      setBalancesLoading(false)
    }
  }, [publicKey])

  useEffect(() => {
    if (open) {
      setTab('deposit')
      setSelectedToken('SOL')
      setRecipient('')
      setAmount('')
      setError(null)
      setSuccess(null)
      setCopied(false)
      fetchTokenBalances()
    }
  }, [open, fetchTokenBalances])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open || !publicKey) return null

  const solBalance = balance ?? 0
  const tokenBalance =
    selectedToken === 'SOL'
      ? solBalance
      : selectedToken === 'USDC'
      ? (usdcBalance ?? 0)
      : (jupUsdBalance ?? 0)

  const maxSol = solBalance
  const maxToken = selectedToken === 'SOL' ? maxSol : tokenBalance

  const handleCopy = async () => {
    await navigator.clipboard.writeText(publicKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSend = async () => {
    if (!signer || !publicKey) return
    setError(null)
    setSuccess(null)

    const qty = parseFloat(amount)

    if (!recipient.trim()) {
      setError('Enter a recipient address')
      return
    }
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(recipient.trim())) {
      setError('Invalid Solana address')
      return
    }
    if (isNaN(qty) || qty <= 0) {
      setError('Enter a valid amount')
      return
    }
    if (qty > maxToken) {
      setError(`Insufficient ${selectedToken} balance`)
      return
    }

    setLoading(true)
    try {
      const ixs: Instruction[] = []

      if (selectedToken === 'SOL') {
        const lamports = BigInt(Math.round(qty * 10 ** TOKENS.SOL.decimals))
        ixs.push(buildSolTransferIx(publicKey, recipient.trim(), lamports))
      } else {
        const token = TOKENS[selectedToken]
        const mint = token.mint!
        const rawAmount = BigInt(Math.round(qty * 10 ** token.decimals))
        const sourceAta = await deriveAta(publicKey, mint)
        const destAta = await deriveAta(recipient.trim(), mint)

        // Idempotent ATA creation for recipient (no-op if already exists)
        ixs.push(await buildCreateAtaIx(publicKey, recipient.trim(), mint, destAta))
        ixs.push(buildSplTransferIx(sourceAta, destAta, publicKey, rawAmount))
      }

      await sendIxs(signer, ixs, MAINNET_URL)
      await fetchTokenBalances()

      setSuccess(`Sent ${qty} ${selectedToken} successfully`)
      setRecipient('')
      setAmount('')
    } catch (e: any) {
      setError(e?.message ?? 'Transaction failed')
    } finally {
      setLoading(false)
    }
  }

  const formatBalance = (bal: number | null, symbol: string) => {
    if (bal === null) return '—'
    return `${bal.toLocaleString(undefined, { maximumFractionDigits: symbol === 'SOL' ? 4 : 2 })} ${symbol}`
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose()
      }}
    >
      <div className="w-full max-w-sm mx-4 bg-neutral-900 border border-white/10 rounded-2xl shadow-card-hover animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <h2 className="text-white text-lg font-semibold">Wallet Funds</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Balances row */}
        <div className="flex gap-2 mx-5 mb-4">
          {(['SOL', 'USDC', 'jupUSD'] as TokenKey[]).map((key) => {
            const bal =
              key === 'SOL' ? solBalance : key === 'USDC' ? usdcBalance : jupUsdBalance
            return (
              <div
                key={key}
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-center"
              >
                <p className="text-neutral-400 text-[10px] font-medium mb-0.5">{key}</p>
                <p className="text-white text-xs font-semibold">
                  {balancesLoading && key !== 'SOL'
                    ? '...'
                    : bal !== null
                    ? bal.toLocaleString(undefined, {
                        maximumFractionDigits: key === 'SOL' ? 4 : 2,
                      })
                    : '—'}
                </p>
              </div>
            )
          })}
        </div>

        {/* Tabs */}
        <div className="flex mx-5 mb-4 bg-white/5 rounded-xl p-1 gap-1">
          {(['deposit', 'withdraw'] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t)
                setError(null)
                setSuccess(null)
              }}
              className={`flex-1 py-1.5 text-sm font-semibold rounded-lg transition-all duration-200 capitalize ${
                tab === t ? 'bg-white text-black' : 'text-neutral-400 hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'deposit' ? (
          <div className="px-5 pb-5">
            <p className="text-neutral-400 text-xs mb-3">
              Send SOL, USDC, or jupUSD to your embedded wallet address below.
            </p>
            <div className="bg-white/5 border border-white/10 rounded-xl p-3 mb-3">
              <p className="text-neutral-400 text-xs font-medium mb-1.5">Your wallet address</p>
              <p className="text-white text-xs font-mono break-all leading-relaxed">{publicKey}</p>
            </div>
            <button
              onClick={handleCopy}
              className="w-full h-10 flex items-center justify-center gap-2 bg-white text-black text-sm font-semibold rounded-xl hover:bg-neutral-100 transition-all duration-200"
            >
              {copied ? (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy Address
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="px-5 pb-5">
            {/* Token selector */}
            <div className="flex gap-1.5 mb-4">
              {(['SOL', 'USDC', 'jupUSD'] as TokenKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => {
                    setSelectedToken(key)
                    setAmount('')
                    setError(null)
                    setSuccess(null)
                  }}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-all duration-200 ${
                    selectedToken === key
                      ? 'bg-white text-black border-white'
                      : 'bg-transparent text-neutral-400 border-white/10 hover:border-white/30 hover:text-white'
                  }`}
                >
                  {key}
                </button>
              ))}
            </div>

            {/* Recipient */}
            <label className="text-neutral-400 text-xs font-medium block mb-1.5">
              Recipient address
            </label>
            <input
              type="text"
              placeholder="Solana address..."
              value={recipient}
              onChange={(e) => {
                setRecipient(e.target.value)
                setError(null)
              }}
              className="w-full h-10 px-3 mb-3 bg-white/5 border border-white/10 rounded-xl text-white text-xs font-mono placeholder:text-neutral-500 focus:outline-none focus:border-white/30 transition-colors"
            />

            {/* Amount */}
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-neutral-400 text-xs font-medium">
                Amount ({selectedToken})
              </label>
              <button
                onClick={() => setAmount(maxToken > 0 ? maxToken.toFixed(selectedToken === 'SOL' ? 4 : 2) : '0')}
                className="text-neutral-400 text-xs hover:text-white transition-colors"
              >
                {formatBalance(
                  selectedToken === 'SOL' ? solBalance : selectedToken === 'USDC' ? usdcBalance : jupUsdBalance,
                  selectedToken,
                )}{' '}
                available
              </button>
            </div>
            <div className="flex items-center gap-2 mb-4">
              <input
                type="number"
                step="any"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value)
                  setError(null)
                }}
                className="flex-1 h-10 px-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm font-medium placeholder:text-neutral-500 focus:outline-none focus:border-white/30 transition-colors"
              />
              <button
                onClick={() =>
                  setAmount(maxToken > 0 ? maxToken.toFixed(selectedToken === 'SOL' ? 4 : 2) : '0')
                }
                className="h-10 px-3 glass hover:bg-white/10 text-white text-xs font-semibold rounded-xl transition-all duration-200"
              >
                Max
              </button>
            </div>

            {error && <p className="text-apple-red text-xs mb-3">{error}</p>}
            {success && <p className="text-green-400 text-xs mb-3">{success}</p>}

            <button
              onClick={handleSend}
              disabled={loading || !recipient || !amount}
              className="w-full h-10 bg-white text-black text-sm font-semibold rounded-xl hover:bg-neutral-100 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? 'Sending...' : `Send ${selectedToken}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
