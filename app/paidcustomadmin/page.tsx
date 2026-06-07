'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import MentionedSpinner from '@/components/MentionedSpinner'
import {
  fetchAllMarketsWithFallback,
  fetchLpPosition,
  fetchVaultBalance,
  createCreateMarketIx,
  createPauseMarketIx,
  createResolveWordIx,
  createLockWordIx,
  createDepositLiquidityIx,
  createWithdrawLiquidityIx,
  createWithdrawFeesIx,
  createAtaIx,
  sendInstructions,
  formatUsdc,
  statusLabel,
  statusColor,
  MarketStatus,
  USDC_MINT,
  USDC_PRECISION,
  type UsdcMarketAccount,
  type LpPosition,
} from '@/lib/mentionMarketUsdc'
import { CLUSTER_LABEL } from '@/lib/solanaConfig'
import type { Address } from '@solana/kit'

interface MarketWithMeta {
  pubkey: Address
  account: UsdcMarketAccount
  vaultBalance?: bigint
  lpPosition?: LpPosition | null
}

// --- LMSR liquidity-parameter helpers (F-03 solvency cap + dynamic defaults) ---
//
// On-chain create_market enforces, for dynamic-b markets (errors.rs: InvalidBParameter):
//   base_b_per_usdc * num_words * ln(2)*1e6 <= 1e12
//   → base_b_per_usdc <= 1e12 / (num_words * 693_148)
// The cap tightens as word count grows because every word shares one vault.
//
// We run pure dynamic-b (initial_b = 0): b is rewritten on each deposit to
//   b = base_b_per_usdc * vault / 1e6
// so base_b_per_usdc is "USDC of b gained per USDC of LP". Targeting b = 10 USDC at a
// 50 USDC reference vault → base_b = 10 * 1e6 / 50 = 200_000, which keeps 1-2 USDC
// trades meaningfully swingy (~±5% per 1 USDC) without whiplash.
const LMSR_LN2_SCALED = 693_148          // ln(2) * 1e6 — matches the contract constant
const F03_NUMERATOR = 1_000_000_000_000  // 1e12 = PRECISION^2
const F03_SAFETY_MARGIN = 0.99           // stay 1% under the hard cap
const TARGET_B_USDC = 10                 // desired b at the reference vault
const REFERENCE_LP_USDC = 50             // reference vault size for the target
const TARGET_BASE_B = Math.round((TARGET_B_USDC * 1_000_000) / REFERENCE_LP_USDC) // 200_000

/** Hard on-chain cap on base_b_per_usdc for a given word count (F-03 solvency). */
function f03BaseBCap(numWords: number): number {
  if (numWords <= 0) return TARGET_BASE_B
  return Math.floor(F03_NUMERATOR / (numWords * LMSR_LN2_SCALED))
}

/** Recommended base_b_per_usdc: the target, stepped down to fit the F-03 cap. */
function recommendedBaseB(numWords: number): number {
  const safeCap = Math.floor(f03BaseBCap(Math.max(1, numWords)) * F03_SAFETY_MARGIN)
  return Math.min(TARGET_BASE_B, safeCap)
}

/** Effective b (in USDC) a base_b_per_usdc yields at a given vault size. */
function bAtVault(baseBPerUsdc: number, vaultUsdc: number): number {
  return (baseBPerUsdc * vaultUsdc) / 1_000_000
}

/** Rough YES-price move for a 1 USDC trade from 0.5, given b in USDC (~sigmoid(2/b)). */
function approxMovePct(bUsdc: number): number {
  if (bUsdc <= 0) return 0
  return (1 / (1 + Math.exp(-2 / bUsdc)) - 0.5) * 100
}

/**
 * LMSR worst-case LP loss (USDC) for a dynamic-b market: numWords × b × ln(2),
 * where b = base_b_per_usdc × deposit / 1e6. Illustrative for a sole LP funding
 * the vault with `depositUsdc`.
 */
function worstCaseLpLossUsdc(baseBPerUsdc: number, numWords: number, depositUsdc: number): number {
  // b (base units) = base_b_per_usdc × deposit(base units) / 1e6 = base_b_per_usdc × depositUsdc
  const bBaseUnits = baseBPerUsdc * depositUsdc
  return (numWords * bBaseUnits * 0.693147) / 1_000_000
}

export default function PaidCustomAdminPage() {
  const { publicKey, signer, signOnly } = useWallet()

  const [isAdmin, setIsAdmin] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [markets, setMarkets] = useState<MarketWithMeta[]>([])
  const [hiddenMap, setHiddenMap] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [txPending, setTxPending] = useState(false)

  // Create form
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [coverImageUrl, setCoverImageUrl] = useState('')
  const [streamUrl, setStreamUrl] = useState('')
  const [urlPrefix, setUrlPrefix] = useState('')
  const [wordsInput, setWordsInput] = useState('')
  const [eventStartTime, setEventStartTime] = useState('')
  const [locksAt, setLocksAt] = useState('')
  const [tradeFeeBps, setTradeFeeBps] = useState('100')
  const [initialB, setInitialB] = useState('0')
  const [baseBPerUsdc, setBaseBPerUsdc] = useState(String(recommendedBaseB(0)))
  const [baseBManual, setBaseBManual] = useState(false)
  const [creating, setCreating] = useState(false)

  const parsedWords = useMemo(
    () => wordsInput.split(/[,\n]+/).map(w => w.trim()).filter(Boolean),
    [wordsInput]
  )

  // Auto-fill base_b_per_usdc from the live word count until the admin overrides it.
  useEffect(() => {
    if (baseBManual) return
    setBaseBPerUsdc(String(recommendedBaseB(parsedWords.length)))
  }, [parsedWords.length, baseBManual])

  // Live LMSR liquidity hints for the create form.
  const numWords = parsedWords.length
  const baseBNum = Number(baseBPerUsdc) || 0
  const baseBCap = f03BaseBCap(Math.max(1, numWords))
  const baseBOverCap = baseBNum > baseBCap
  const bUsdcAt50 = bAtVault(baseBNum, REFERENCE_LP_USDC)

  // Expanded market
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Per-market deposit amount
  const [depositAmounts, setDepositAmounts] = useState<Record<string, string>>({})
  const [withdrawShares, setWithdrawShares] = useState<Record<string, string>>({})

  // Resolution state: marketId -> wordIndex -> outcome
  const [resolutions, setResolutions] = useState<Record<string, Record<number, boolean | null>>>({})

  // Edit metadata state per market
  interface EditState {
    title: string
    description: string
    coverImageUrl: string
    streamUrl: string
    eventStartTime: string
    urlPrefix: string
    existingSlug: string | null
    saving: boolean
    saveMsg: { type: 'success' | 'error'; text: string } | null
  }
  const [editStates, setEditStates] = useState<Record<string, EditState>>({})

  const show = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 6000)
  }

  const fetchMarkets = useCallback(async () => {
    if (!publicKey) return
    setLoading(true)
    setLoadError(null)
    try {
      // getProgramAccounts is flaky / rate-limited on Helius, so seed the fetch
      // with the DB-known market IDs — fetchAllMarketsWithFallback backfills any
      // that getProgramAccounts misses via the reliable getAccountInfo path.
      let knownIds: string[] = []
      const hidden: Record<string, boolean> = {}
      try {
        const metaRes = await fetch('/api/paid-markets/metadata')
        if (metaRes.ok) {
          const allMeta = await metaRes.json()
          if (Array.isArray(allMeta)) {
            knownIds = allMeta.map((m: { market_id: string }) => m.market_id)
            for (const m of allMeta as { market_id: string; hidden?: boolean }[]) {
              hidden[m.market_id] = !!m.hidden
            }
          }
        }
      } catch { /* fall back to getProgramAccounts-only */ }
      setHiddenMap(hidden)
      // Already admin-only: knownIds come from DB metadata, and metadata can only
      // be created via the admin-gated POST — so this never shows others' markets.
      const all = await fetchAllMarketsWithFallback(knownIds)
      // Enrich each market independently: a transient vault/LP RPC failure on one
      // market must NOT reject the whole batch and wipe the list. fetchLpPosition
      // in particular has no internal catch, so guard per-market here.
      const enriched = await Promise.all(
        all.map(async ({ pubkey, account }) => {
          let vaultBalance = 0n
          let lpPosition: LpPosition | null = null
          try {
            ;[vaultBalance, lpPosition] = await Promise.all([
              fetchVaultBalance(account.marketId),
              fetchLpPosition(account.marketId, publicKey as Address),
            ])
          } catch (e) {
            console.warn('vault/LP fetch failed for market', account.marketId.toString(), e)
          }
          return { pubkey, account, vaultBalance, lpPosition }
        })
      )
      setMarkets(enriched)
      if (enriched.length === 0 && knownIds.length > 0) {
        setLoadError(`Loaded 0 of ${knownIds.length} known markets — the RPC returned no account data. Check the browser console / network tab for the failing request.`)
      }
    } catch (err) {
      console.error('Failed to fetch on-chain markets', err)
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [publicKey])

  useEffect(() => {
    if (!publicKey) {
      setIsAdmin(false)
      setAuthChecked(true)
      return
    }
    fetch(`/api/auth/admin?wallet=${publicKey}`)
      .then(res => res.json())
      .then(json => setIsAdmin(json.admin === true))
      .catch(() => setIsAdmin(false))
      .finally(() => setAuthChecked(true))
  }, [publicKey])

  useEffect(() => {
    if (isAdmin) fetchMarkets()
  }, [isAdmin, fetchMarkets])

  async function toggleExpand(pubkey: string, account: UsdcMarketAccount) {
    if (expandedId === pubkey) {
      setExpandedId(null)
      return
    }
    setExpandedId(pubkey)
    const res: Record<number, boolean | null> = {}
    account.words.forEach(w => {
      if (w.outcome === null) res[w.wordIndex] = null
    })
    setResolutions(prev => ({ ...prev, [pubkey]: res }))

    // Fetch and populate edit state with existing metadata
    if (!editStates[pubkey]) {
      try {
        const r = await fetch(`/api/paid-markets/metadata?id=${account.marketId.toString()}`)
        const meta = r.ok ? await r.json() : null
        const toDatetimeLocal = (val: string | null | undefined) => {
          if (!val) return ''
          const d = new Date(val)
          if (isNaN(d.getTime())) return ''
          return d.toISOString().slice(0, 16)
        }
        setEditStates(prev => ({
          ...prev,
          [pubkey]: {
            title: meta?.title ?? account.label,
            description: meta?.description ?? '',
            coverImageUrl: meta?.cover_image_url ?? '',
            streamUrl: meta?.stream_url ?? '',
            eventStartTime: toDatetimeLocal(meta?.event_start_time),
            urlPrefix: '',
            existingSlug: meta?.slug ?? null,
            saving: false,
            saveMsg: null,
          },
        }))
      } catch {
        setEditStates(prev => ({
          ...prev,
          [pubkey]: {
            title: account.label,
            description: '',
            coverImageUrl: '',
            streamUrl: '',
            eventStartTime: '',
            urlPrefix: '',
            existingSlug: null,
            saving: false,
            saveMsg: null,
          },
        }))
      }
    }
  }

  async function handleCreate() {
    if (!publicKey || !signer || !label.trim()) {
      show('Label is required', 'error')
      return
    }
    const words = parsedWords
    if (words.length === 0) {
      show('At least one word is required', 'error')
      return
    }
    if (words.length > 8) {
      show('Maximum 8 words', 'error')
      return
    }

    if (!locksAt) {
      show('Trading lock time is required', 'error')
      return
    }

    setCreating(true)
    try {
      const marketId = BigInt(Date.now())
      const locksAtTs = BigInt(Math.floor(new Date(locksAt).getTime() / 1000))
      // NB: `parseInt('0') || 50` would coerce a real 0 fee back to 50 (0 is falsy).
      const parsedFee = parseInt(tradeFeeBps, 10)
      const feeBps = Number.isNaN(parsedFee) ? 50 : Math.max(0, Math.min(1000, parsedFee))
      const initB = BigInt(initialB || '0')
      const requestedBaseB = Number(baseBPerUsdc)
      const baseBCapForWords = f03BaseBCap(words.length)
      if (!Number.isFinite(requestedBaseB) || requestedBaseB <= 0) {
        show('b per USDC must be a positive number', 'error')
        return
      }
      if (requestedBaseB > baseBCapForWords) {
        show(`b per USDC ${requestedBaseB.toLocaleString()} exceeds the F-03 solvency cap (${baseBCapForWords.toLocaleString()}) for ${words.length} word${words.length === 1 ? '' : 's'}. Lower it to ≤ ${Math.floor(baseBCapForWords * F03_SAFETY_MARGIN).toLocaleString()}.`, 'error')
        return
      }
      const bPerUsdc = BigInt(requestedBaseB)

      const ix = await createCreateMarketIx(
        publicKey as Address,
        marketId,
        label.trim(),
        words,
        locksAtTs,
        publicKey as Address, // resolver = authority
        feeBps,
        initB,
        bPerUsdc
      )

      await sendInstructions(signer, signOnly!, [ix])

      // Persist metadata to DB (best-effort — on-chain tx already succeeded)
      await fetch('/api/paid-markets/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: publicKey,
          marketId: marketId.toString(),
          title: label.trim(),
          description: description.trim() || undefined,
          coverImageUrl: coverImageUrl.trim() || undefined,
          streamUrl: streamUrl.trim() || undefined,
          urlPrefix: urlPrefix.trim() || undefined,
          eventStartTime: eventStartTime.trim() || undefined,
        }),
      })

      show(`Market "${label.trim()}" created on-chain`)
      setLabel('')
      setDescription('')
      setCoverImageUrl('')
      setStreamUrl('')
      setUrlPrefix('')
      setEventStartTime('')
      setLocksAt('')
      setWordsInput('')
      setTradeFeeBps('100')
      setInitialB('0')
      setBaseBManual(false)
      setBaseBPerUsdc(String(recommendedBaseB(0)))
      await fetchMarkets()
    } catch (err: any) {
      show(err?.message || 'Failed to create market', 'error')
    } finally {
      setCreating(false)
    }
  }

  async function handleToggleVisibility(market: MarketWithMeta) {
    if (!publicKey) return
    const marketId = market.account.marketId.toString()
    const next = !(hiddenMap[marketId] ?? true)
    setTxPending(true)
    try {
      const res = await fetch('/api/paid-markets/metadata', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: publicKey, marketId, hidden: next }),
      })
      if (!res.ok) throw new Error((await res.json())?.error || 'Failed to update visibility')
      setHiddenMap(prev => ({ ...prev, [marketId]: next }))
      show(next ? 'Market hidden from the site' : 'Market is now live on the site')
    } catch (err: any) {
      show(err?.message || 'Failed to update visibility', 'error')
    } finally {
      setTxPending(false)
    }
  }

  async function handlePause(market: MarketWithMeta) {
    if (!publicKey || !signer) return
    setTxPending(true)
    try {
      const ix = await createPauseMarketIx(publicKey as Address, market.account.marketId)
      await sendInstructions(signer, signOnly!, [ix])
      show(`Market ${market.account.status === MarketStatus.Open ? 'paused' : 'unpaused'}`)
      await fetchMarkets()
    } catch (err: any) {
      show(err?.message || 'Failed to toggle pause', 'error')
    } finally {
      setTxPending(false)
    }
  }

  async function handleResolveWords(market: MarketWithMeta) {
    if (!publicKey || !signer || !signOnly) {
      show('Wallet not ready — connect Phantom and try again', 'error')
      return
    }
    const wordResolutions = resolutions[market.pubkey] || {}
    const toResolve = Object.entries(wordResolutions)
      .filter(([, outcome]) => outcome !== null)
      .map(([idx, outcome]) => ({ wordIndex: parseInt(idx), outcome: outcome! }))

    if (toResolve.length === 0) {
      show('Select YES or NO for at least one word first', 'error')
      return
    }

    setTxPending(true)
    try {
      const ixs = await Promise.all(
        toResolve.map(({ wordIndex, outcome }) =>
          createResolveWordIx(publicKey as Address, market.account.marketId, wordIndex, outcome)
        )
      )
      await sendInstructions(signer, signOnly, ixs)
      show(`Resolved ${toResolve.length} word(s)`)
      await fetchMarkets()
    } catch (err: any) {
      show(err?.message || 'Failed to resolve words', 'error')
    } finally {
      setTxPending(false)
    }
  }

  async function handleLockWord(market: MarketWithMeta, wordIndex: number, locked: boolean) {
    if (!publicKey || !signer) return
    setTxPending(true)
    try {
      const ix = await createLockWordIx(publicKey as Address, market.account.marketId, wordIndex, locked)
      await sendInstructions(signer, signOnly!, [ix])
      show(`Word ${locked ? 'locked' : 'unlocked'} for resolution`)
      await fetchMarkets()
    } catch (err: any) {
      show(err?.message || 'Failed to update lock', 'error')
    } finally {
      setTxPending(false)
    }
  }

  async function handleDepositLiquidity(market: MarketWithMeta) {
    if (!publicKey || !signer) return
    const amountStr = depositAmounts[market.pubkey] || ''
    const amount = parseFloat(amountStr)
    if (!amount || amount <= 0) {
      show('Enter a valid USDC amount', 'error')
      return
    }

    setTxPending(true)
    try {
      const amountBase = BigInt(Math.round(amount * 1_000_000))
      const ataIx = await createAtaIx(publicKey as Address, publicKey as Address, USDC_MINT)
      const ix = await createDepositLiquidityIx(publicKey as Address, market.account.marketId, amountBase)
      await sendInstructions(signer, signOnly!, [ataIx, ix])
      show(`Deposited ${amount} USDC`)
      setDepositAmounts(prev => ({ ...prev, [market.pubkey]: '' }))
      await fetchMarkets()
    } catch (err: any) {
      show(err?.message || 'Failed to deposit liquidity', 'error')
    } finally {
      setTxPending(false)
    }
  }

  async function handleWithdrawLiquidity(market: MarketWithMeta) {
    if (!publicKey || !signer) return
    const sharesStr = withdrawShares[market.pubkey] || ''
    const shares = parseFloat(sharesStr)
    if (!shares || shares <= 0) {
      show('Enter a valid shares amount', 'error')
      return
    }

    setTxPending(true)
    try {
      const sharesBase = BigInt(Math.round(shares * 1_000_000))
      const ix = await createWithdrawLiquidityIx(publicKey as Address, market.account.marketId, sharesBase)
      await sendInstructions(signer, signOnly!, [ix])
      show(`Withdrawn ${shares} shares`)
      setWithdrawShares(prev => ({ ...prev, [market.pubkey]: '' }))
      await fetchMarkets()
    } catch (err: any) {
      show(err?.message || 'Failed to withdraw liquidity', 'error')
    } finally {
      setTxPending(false)
    }
  }

  async function handleWithdrawFees(market: MarketWithMeta) {
    if (!publicKey || !signer) return
    setTxPending(true)
    try {
      const ix = await createWithdrawFeesIx(publicKey as Address, market.account.marketId)
      await sendInstructions(signer, signOnly!, [ix])
      show(`Fees withdrawn`)
      await fetchMarkets()
    } catch (err: any) {
      show(err?.message || 'Failed to withdraw fees', 'error')
    } finally {
      setTxPending(false)
    }
  }

  function setAllWordResolutions(market: MarketWithMeta, outcome: boolean) {
    const res: Record<number, boolean | null> = {}
    market.account.words
      .filter(w => w.outcome === null)
      .forEach(w => { res[w.wordIndex] = outcome })
    setResolutions(prev => ({ ...prev, [market.pubkey]: res }))
  }

  function updateEditState(pubkey: string, patch: Partial<EditState>) {
    setEditStates(prev => ({ ...prev, [pubkey]: { ...prev[pubkey], ...patch } }))
  }

  async function handleSaveMetadata(market: MarketWithMeta) {
    const es = editStates[market.pubkey]
    if (!es || !publicKey) return
    if (!es.title.trim()) {
      updateEditState(market.pubkey, { saveMsg: { type: 'error', text: 'Title is required' } })
      return
    }
    updateEditState(market.pubkey, { saving: true, saveMsg: null })
    try {
      const res = await fetch('/api/paid-markets/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: publicKey,
          marketId: market.account.marketId.toString(),
          title: es.title.trim(),
          description: es.description.trim() || undefined,
          coverImageUrl: es.coverImageUrl.trim() || undefined,
          streamUrl: es.streamUrl.trim() || undefined,
          eventStartTime: es.eventStartTime || undefined,
          urlPrefix: es.urlPrefix.trim() || undefined,
        }),
      })
      if (!res.ok) {
        let errMsg = 'Save failed'
        try {
          const json = await res.json()
          errMsg = json.error || errMsg
        } catch {}
        throw new Error(errMsg)
      }
      const saved = await res.json()
      updateEditState(market.pubkey, {
        saving: false,
        urlPrefix: '',
        existingSlug: saved.slug ?? es.existingSlug,
        saveMsg: { type: 'success', text: 'Market details saved' },
      })
    } catch (err: any) {
      updateEditState(market.pubkey, { saving: false, saveMsg: { type: 'error', text: err?.message || 'Save failed' } })
    }
  }

  if (!authChecked) {
    return (
      <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
        <div className="layout-container flex h-full grow flex-col">
          <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
            <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
              <Header />
              <main className="flex-1 flex items-center justify-center">
                <MentionedSpinner className="" />
              </main>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!publicKey || !isAdmin) {
    return (
      <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
        <div className="layout-container flex h-full grow flex-col">
          <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
            <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
              <Header />
              <main className="flex-1 flex flex-col items-center justify-center gap-2">
                <p className="text-neutral-400 text-sm">
                  {!publicKey
                    ? 'Nice try. Connect your wallet first, anon.'
                    : 'You shall not pass. This area is for admins only.'}
                </p>
              </main>
              <Footer />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
            <Header />
            <main className="py-4 md:py-6 animate-fade-in">
              <h1 className="text-2xl md:text-3xl font-bold text-white mb-1">On-Chain Markets Admin</h1>
              <p className="text-neutral-400 text-sm mb-6">Create and manage USDC prediction markets on Solana {CLUSTER_LABEL}</p>

              {message && (
                <div className={`mb-4 px-4 py-2 rounded-lg text-sm font-mono break-all ${message.type === 'success' ? 'bg-apple-green/10 text-apple-green' : 'bg-apple-red/10 text-apple-red'}`}>
                  {message.text}
                </div>
              )}

              {/* Create Market Form */}
              <div className="glass rounded-xl p-5 md:p-6 mb-8">
                <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider mb-5">
                  Create Market
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                      Label <span className="text-apple-red">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Will @POTUS mention these words?"
                      value={label}
                      onChange={e => setLabel(e.target.value)}
                      maxLength={64}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                    />
                    <p className="text-[10px] text-neutral-600 mt-1 px-1">Max 64 chars</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-400 mb-1.5">Event Start Time</label>
                    <input
                      type="datetime-local"
                      value={eventStartTime}
                      onChange={e => setEventStartTime(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                    />
                    <p className="text-[10px] text-neutral-600 mt-1 px-1">Optional — when the event starts</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                      Trading Locks At <span className="text-apple-red">*</span>
                    </label>
                    <input
                      type="datetime-local"
                      value={locksAt}
                      onChange={e => setLocksAt(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                    />
                    <p className="text-[10px] text-neutral-600 mt-1 px-1">Trading freezes at this time on-chain</p>
                  </div>
                </div>

                <div className="mb-4">
                  <label className="block text-xs font-medium text-neutral-400 mb-1.5">Description</label>
                  <textarea
                    placeholder="Optional market description shown to users"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    rows={2}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20 resize-none"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-neutral-400 mb-1.5">Cover Image URL</label>
                    <input
                      type="url"
                      placeholder="https://..."
                      value={coverImageUrl}
                      onChange={e => setCoverImageUrl(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-400 mb-1.5">Stream URL</label>
                    <input
                      type="url"
                      placeholder="YouTube or Twitch URL"
                      value={streamUrl}
                      onChange={e => setStreamUrl(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-400 mb-1.5">URL Prefix</label>
                    <input
                      type="text"
                      placeholder="e.g. COSTCO → /paid/COSTCO-a1b2c3"
                      value={urlPrefix}
                      onChange={e => setUrlPrefix(e.target.value.replace(/[^a-zA-Z0-9-]/g, ''))}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                    />
                  </div>
                </div>

                <div className="mb-4">
                  <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                    Words <span className="text-apple-red">*</span>
                  </label>
                  <textarea
                    placeholder="Comma or newline separated, e.g. economy, inflation, jobs"
                    value={wordsInput}
                    onChange={e => setWordsInput(e.target.value)}
                    rows={3}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20 resize-none transition-colors"
                  />
                  <div className="mt-1 px-1">
                    <p className="text-[10px] text-neutral-600">Max 8 words, each max 32 chars</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
                  <div>
                    <label className="block text-xs font-medium text-neutral-400 mb-1.5">Trade Fee (bps)</label>
                    <input
                      type="number"
                      placeholder="50"
                      value={tradeFeeBps}
                      onChange={e => setTradeFeeBps(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                      min="0"
                      max="1000"
                    />
                    <p className="text-[10px] text-neutral-600 mt-1 px-1">100 = 1%</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-400 mb-1.5">Initial b (USDC base units)</label>
                    <input
                      type="number"
                      placeholder="0"
                      value={initialB}
                      onChange={e => setInitialB(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                      min="0"
                    />
                    <p className="text-[10px] text-neutral-600 mt-1 px-1">0 = pure dynamic-b (recommended): b scales with LP deposits. Set &gt;0 only for a fixed floor.</p>
                  </div>
                  <div>
                    <label className="flex items-center justify-between text-xs font-medium text-neutral-400 mb-1.5">
                      <span>b per USDC (scaled 1e6)</span>
                      {baseBManual && (
                        <button
                          type="button"
                          onClick={() => { setBaseBManual(false); setBaseBPerUsdc(String(recommendedBaseB(numWords))) }}
                          className="text-[10px] text-apple-blue hover:underline"
                        >
                          use recommended
                        </button>
                      )}
                    </label>
                    <input
                      type="number"
                      placeholder={String(recommendedBaseB(numWords))}
                      value={baseBPerUsdc}
                      onChange={e => { setBaseBPerUsdc(e.target.value); setBaseBManual(true) }}
                      className={`w-full bg-white/5 border rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none transition-colors ${baseBOverCap ? 'border-apple-red/60 focus:border-apple-red' : 'border-white/10 focus:border-white/20'}`}
                      min="1"
                    />
                    <div className="mt-1 px-1 space-y-0.5">
                      <p className="text-[10px] text-neutral-600">
                        {numWords > 0 ? `${numWords} word${numWords === 1 ? '' : 's'} · ` : ''}cap {baseBCap.toLocaleString()} · b ≈ {bUsdcAt50.toFixed(1)} USDC at 50 USDC LP (~±{approxMovePct(bUsdcAt50).toFixed(1)}% / 1 USDC trade)
                      </p>
                      {baseBOverCap ? (
                        <p className="text-[10px] text-apple-red">Exceeds the F-03 solvency cap for {numWords} word{numWords === 1 ? '' : 's'} — on-chain create will reject.</p>
                      ) : !baseBManual && recommendedBaseB(numWords) < TARGET_BASE_B ? (
                        <p className="text-[10px] text-yellow-500">Stepped down from {TARGET_BASE_B.toLocaleString()} to fit the F-03 cap at {numWords} words.</p>
                      ) : null}
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleCreate}
                  disabled={creating || !signer}
                  className="px-5 py-2.5 bg-apple-blue text-white text-sm font-semibold rounded-lg hover:bg-apple-blue/80 transition-colors disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create Market On-Chain'}
                </button>
              </div>

              {/* Markets List */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">
                    On-Chain Markets
                  </h2>
                  <button
                    onClick={fetchMarkets}
                    disabled={loading}
                    className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
                  >
                    {loading ? 'Loading...' : 'Refresh'}
                  </button>
                </div>

                {loading && <MentionedSpinner />}

                {!loading && loadError && (
                  <p className="text-apple-red text-xs py-3 text-center break-words px-4">
                    Failed to load markets: {loadError}
                  </p>
                )}

                {!loading && markets.length === 0 && !loadError && (
                  <p className="text-neutral-500 text-sm py-8 text-center">No on-chain markets found</p>
                )}

                {!loading && markets.length > 0 && (
                  <div className="space-y-3">
                    {markets.map(market => {
                      const mk = market.account
                      const isExpanded = expandedId === market.pubkey
                      const wordRes = resolutions[market.pubkey] || {}
                      const isHidden = hiddenMap[mk.marketId.toString()] ?? true

                      return (
                        <div key={market.pubkey} className="rounded-xl border border-white/5 overflow-hidden">
                          {/* Header row */}
                          <div
                            onClick={() => toggleExpand(market.pubkey, mk)}
                            className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-white/[0.03] transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="text-xs font-mono text-neutral-600 hidden sm:block truncate max-w-[100px]">
                                {market.pubkey.slice(0, 8)}...
                              </span>
                              <span className="text-sm font-medium truncate">{mk.label}</span>
                              <span className={`text-xs font-semibold shrink-0 ${statusColor(mk.status)}`}>
                                {statusLabel(mk.status)}
                              </span>
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${isHidden ? 'bg-white/10 text-neutral-400' : 'bg-apple-green/15 text-apple-green'}`}>
                                {isHidden ? 'Hidden' : 'Live'}
                              </span>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-neutral-500 shrink-0">
                              {market.vaultBalance !== undefined && (
                                <span>${formatUsdc(market.vaultBalance)} USDC</span>
                              )}
                              <span>{mk.numWords} words</span>
                              <span className="text-neutral-600">{isExpanded ? '▲' : '▼'}</span>
                            </div>
                          </div>

                          {/* Expanded detail */}
                          {isExpanded && (
                            <div className="border-t border-white/5 px-4 py-5 space-y-6 bg-white/[0.01]">

                              {/* Market Info */}
                              <div>
                                <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">Market Info</h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                  <div>
                                    <p className="text-neutral-500 mb-0.5">Market ID</p>
                                    <p className="text-white font-mono">{mk.marketId.toString()}</p>
                                  </div>
                                  <div>
                                    <p className="text-neutral-500 mb-0.5">Vault Balance</p>
                                    <p className="text-white">${formatUsdc(market.vaultBalance ?? 0n)} USDC</p>
                                  </div>
                                  <div>
                                    <p className="text-neutral-500 mb-0.5">Accumulated Fees</p>
                                    <p className="text-white">${formatUsdc(mk.accumulatedFees)} USDC</p>
                                  </div>
                                  <div>
                                    <p className="text-neutral-500 mb-0.5">LP Shares (yours)</p>
                                    <p className="text-white">{market.lpPosition ? formatUsdc(market.lpPosition.shares) : '—'}</p>
                                  </div>
                                  <div>
                                    <p className="text-neutral-500 mb-0.5">Total LP Shares</p>
                                    <p className="text-white">{formatUsdc(mk.totalLpShares)}</p>
                                  </div>
                                  <div>
                                    <p className="text-neutral-500 mb-0.5">b Parameter</p>
                                    <p className="text-white">{(Number(mk.liquidityParamB) / 1_000_000).toFixed(2)}</p>
                                  </div>
                                  <div>
                                    <p className="text-neutral-500 mb-0.5">Trade Fee</p>
                                    <p className="text-white">{mk.tradeFeeBps / 100}%</p>
                                  </div>
                                  <div>
                                    <p className="text-neutral-500 mb-0.5">Trading Locks At</p>
                                    <p className="text-white">{new Date(Number(mk.locksAt) * 1000).toLocaleString()}</p>
                                  </div>
                                </div>
                              </div>

                              {/* Words */}
                              <div className="pt-1 border-t border-white/5">
                                <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">Words</h3>
                                <div className="flex flex-wrap gap-2">
                                  {mk.words.map(w => (
                                    <span
                                      key={w.wordIndex}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 text-sm"
                                    >
                                      {w.label}
                                      {w.outcome !== null && (
                                        <span className={`text-xs font-semibold ${w.outcome ? 'text-apple-green' : 'text-apple-red'}`}>
                                          {w.outcome ? 'YES' : 'NO'}
                                        </span>
                                      )}
                                    </span>
                                  ))}
                                </div>
                              </div>

                              {/* Liquidity Management */}
                              <div className="pt-1 border-t border-white/5">
                                <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">Liquidity</h3>
                                <div className="flex flex-col sm:flex-row gap-4">
                                  {mk.status !== MarketStatus.Resolved && (
                                    <div>
                                      <div className="flex gap-2 items-end">
                                        <div>
                                          <label className="block text-[10px] font-medium text-neutral-500 mb-1">Deposit (USDC)</label>
                                          <input
                                            type="number"
                                            placeholder="10.00"
                                            value={depositAmounts[market.pubkey] || ''}
                                            onChange={e => setDepositAmounts(prev => ({ ...prev, [market.pubkey]: e.target.value }))}
                                            className="w-28 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                                            min="0"
                                            step="0.01"
                                          />
                                        </div>
                                        <button
                                          onClick={() => handleDepositLiquidity(market)}
                                          disabled={txPending}
                                          className="px-4 py-2 bg-apple-green/20 text-apple-green text-xs font-semibold rounded-lg hover:bg-apple-green/30 transition-colors disabled:opacity-50"
                                        >
                                          Deposit
                                        </button>
                                      </div>
                                      {(() => {
                                        const dep = parseFloat(depositAmounts[market.pubkey] || '')
                                        if (!dep || dep <= 0) return null
                                        const loss = worstCaseLpLossUsdc(Number(mk.baseBPerUsdc), mk.numWords, dep)
                                        return (
                                          <p className="text-[10px] text-yellow-500/80 mt-2 max-w-xs leading-relaxed">
                                            Worst-case LP loss ≈ <span className="font-semibold">${loss.toFixed(2)}</span> of your ${dep.toFixed(2)} deposit ({mk.numWords} word{mk.numWords === 1 ? '' : 's'}). Only if every word&apos;s volume runs against you and the crowd is right; trade fees partially offset.
                                          </p>
                                        )
                                      })()}
                                    </div>
                                  )}

                                  {mk.status === MarketStatus.Resolved && market.lpPosition && market.lpPosition.shares > 0n && (
                                    <div className="flex gap-2 items-end">
                                      <div>
                                        <label className="block text-[10px] font-medium text-neutral-500 mb-1">Shares to burn</label>
                                        <input
                                          type="number"
                                          placeholder={formatUsdc(market.lpPosition.shares)}
                                          value={withdrawShares[market.pubkey] || ''}
                                          onChange={e => setWithdrawShares(prev => ({ ...prev, [market.pubkey]: e.target.value }))}
                                          className="w-28 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                                          min="0"
                                          step="0.01"
                                        />
                                      </div>
                                      <button
                                        onClick={() => handleWithdrawLiquidity(market)}
                                        disabled={txPending}
                                        className="px-4 py-2 bg-blue-500/20 text-blue-400 text-xs font-semibold rounded-lg hover:bg-blue-500/30 transition-colors disabled:opacity-50"
                                      >
                                        Withdraw LP
                                      </button>
                                    </div>
                                  )}

                                  {mk.status === MarketStatus.Resolved && mk.accumulatedFees > 0n && (
                                    <button
                                      onClick={() => handleWithdrawFees(market)}
                                      disabled={txPending}
                                      className="px-4 py-2 bg-yellow-500/20 text-yellow-400 text-xs font-semibold rounded-lg hover:bg-yellow-500/30 transition-colors self-end disabled:opacity-50"
                                    >
                                      Withdraw ${formatUsdc(mk.accumulatedFees)} Fees
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Resolution panel */}
                              {mk.status !== MarketStatus.Resolved && mk.words.some(w => w.outcome === null) && (
                                <div className="pt-1 border-t border-white/5">
                                  <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1">Lock for Resolution</h3>
                                  <p className="text-[10px] text-neutral-600 mb-3">
                                    Freeze trading on a word while you decide the outcome. Locked words cannot be bought or sold.
                                  </p>
                                  <div className="space-y-2 mb-2">
                                    {mk.words.filter(w => w.outcome === null).map(w => (
                                      <div key={w.wordIndex} className="flex items-center justify-between">
                                        <span className={`text-sm font-medium truncate max-w-[160px] ${w.locked ? 'text-yellow-400' : 'text-white'}`} title={w.label}>{w.label}</span>
                                        <div className="flex items-center gap-2">
                                          <span className="text-[10px] text-neutral-600">{w.locked ? 'Locked' : 'Trading active'}</span>
                                          <button
                                            onClick={() => handleLockWord(market, w.wordIndex, !w.locked)}
                                            disabled={txPending}
                                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${w.locked ? 'bg-yellow-500/40 border border-yellow-500/40' : 'bg-white/10 border border-white/10'}`}
                                          >
                                            <span className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${w.locked ? 'translate-x-[18px] bg-yellow-400' : 'translate-x-0.5 bg-neutral-500'}`} />
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {mk.status !== MarketStatus.Resolved && mk.words.some(w => w.outcome === null) && (
                                <div className="pt-1 border-t border-white/5">
                                  <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1">Resolve Words</h3>
                                  <p className="text-[10px] text-neutral-600 mb-2">
                                    When all words are resolved the market transitions to Resolved automatically.
                                  </p>
                                  <div className="space-y-2.5 mb-4">
                                    {mk.words.filter(w => w.outcome === null).map(w => (
                                      <div key={w.wordIndex} className="flex items-center gap-3">
                                        <span className="text-sm font-medium w-36 truncate" title={w.label}>{w.label}</span>
                                        <div className="flex gap-1.5">
                                          <button
                                            onClick={() => setResolutions(prev => ({
                                              ...prev,
                                              [market.pubkey]: { ...prev[market.pubkey], [w.wordIndex]: true }
                                            }))}
                                            className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                                              wordRes[w.wordIndex] === true
                                                ? 'bg-apple-green text-white'
                                                : 'bg-white/5 text-neutral-400 hover:bg-white/10'
                                            }`}
                                          >
                                            YES
                                          </button>
                                          <button
                                            onClick={() => setResolutions(prev => ({
                                              ...prev,
                                              [market.pubkey]: { ...prev[market.pubkey], [w.wordIndex]: false }
                                            }))}
                                            className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                                              wordRes[w.wordIndex] === false
                                                ? 'bg-apple-red text-white'
                                                : 'bg-white/5 text-neutral-400 hover:bg-white/10'
                                            }`}
                                          >
                                            NO
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => setAllWordResolutions(market, true)}
                                      className="px-3 py-1.5 text-xs bg-apple-green/20 text-apple-green rounded-lg hover:bg-apple-green/30 transition-colors"
                                    >
                                      All YES
                                    </button>
                                    <button
                                      onClick={() => setAllWordResolutions(market, false)}
                                      className="px-3 py-1.5 text-xs bg-apple-red/20 text-apple-red rounded-lg hover:bg-apple-red/30 transition-colors"
                                    >
                                      All NO
                                    </button>
                                    <button
                                      onClick={() => handleResolveWords(market)}
                                      disabled={txPending}
                                      className="px-4 py-1.5 text-xs bg-apple-blue text-white font-semibold rounded-lg hover:bg-apple-blue/80 transition-colors disabled:opacity-50"
                                    >
                                      {txPending ? 'Sending...' : 'Resolve Selected'}
                                    </button>
                                  </div>
                                  {message && (
                                    <div className={`mt-2 px-3 py-2 rounded-lg text-xs font-mono break-all ${message.type === 'success' ? 'bg-apple-green/10 text-apple-green' : 'bg-apple-red/10 text-apple-red'}`}>
                                      {message.text}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Edit Market Metadata */}
                              <div className="pt-1 border-t border-white/5">
                                <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">Edit Market</h3>
                                {editStates[market.pubkey] ? (
                                  <div className="space-y-3">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                      <div>
                                        <label className="block text-[10px] font-medium text-neutral-500 mb-1">Title <span className="text-apple-red">*</span></label>
                                        <input
                                          type="text"
                                          value={editStates[market.pubkey].title}
                                          onChange={e => updateEditState(market.pubkey, { title: e.target.value })}
                                          maxLength={64}
                                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[10px] font-medium text-neutral-500 mb-1">Event Start Time</label>
                                        <input
                                          type="datetime-local"
                                          value={editStates[market.pubkey].eventStartTime}
                                          onChange={e => updateEditState(market.pubkey, { eventStartTime: e.target.value })}
                                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[10px] font-medium text-neutral-500 mb-1">Cover Image URL</label>
                                        <input
                                          type="url"
                                          placeholder="https://..."
                                          value={editStates[market.pubkey].coverImageUrl}
                                          onChange={e => updateEditState(market.pubkey, { coverImageUrl: e.target.value })}
                                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[10px] font-medium text-neutral-500 mb-1">Stream URL</label>
                                        <input
                                          type="url"
                                          placeholder="YouTube or Twitch URL"
                                          value={editStates[market.pubkey].streamUrl}
                                          onChange={e => updateEditState(market.pubkey, { streamUrl: e.target.value })}
                                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[10px] font-medium text-neutral-500 mb-1">URL Slug</label>
                                        {editStates[market.pubkey].existingSlug ? (
                                          <div className="flex items-center gap-2">
                                            <span className="text-xs font-mono text-apple-green">/paid/{editStates[market.pubkey].existingSlug}</span>
                                          </div>
                                        ) : (
                                          <div>
                                            <input
                                              type="text"
                                              placeholder="e.g. COSTCO → /paid/COSTCO-a1b2c3"
                                              value={editStates[market.pubkey].urlPrefix}
                                              onChange={e => updateEditState(market.pubkey, { urlPrefix: e.target.value.replace(/[^a-zA-Z0-9-]/g, '') })}
                                              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                                            />
                                            <p className="text-[10px] text-neutral-600 mt-1">Set once — cannot be changed after saving</p>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-medium text-neutral-500 mb-1">Description</label>
                                      <textarea
                                        placeholder="Optional description shown to users"
                                        value={editStates[market.pubkey].description}
                                        onChange={e => updateEditState(market.pubkey, { description: e.target.value })}
                                        rows={2}
                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20 resize-none"
                                      />
                                    </div>
                                    <div className="flex items-center gap-3">
                                      <button
                                        onClick={() => handleSaveMetadata(market)}
                                        disabled={editStates[market.pubkey].saving}
                                        className="px-4 py-2 bg-apple-blue text-white text-xs font-semibold rounded-lg hover:bg-apple-blue/80 transition-colors disabled:opacity-50"
                                      >
                                        {editStates[market.pubkey].saving ? 'Saving...' : 'Save Changes'}
                                      </button>
                                      {editStates[market.pubkey].saveMsg && (
                                        <span className={`text-xs font-mono ${editStates[market.pubkey].saveMsg!.type === 'success' ? 'text-apple-green' : 'text-apple-red'}`}>
                                          {editStates[market.pubkey].saveMsg!.text}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <p className="text-xs text-neutral-600">Loading metadata...</p>
                                )}
                              </div>

                              {/* Actions */}
                              <div className="pt-1 border-t border-white/5">
                                <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">Actions</h3>
                                <div className="flex flex-wrap gap-2">
                                  {mk.status === MarketStatus.Open && (
                                    <button
                                      onClick={() => handlePause(market)}
                                      disabled={txPending}
                                      className="px-4 py-2 bg-yellow-500/20 text-yellow-400 text-xs font-semibold rounded-lg hover:bg-yellow-500/30 transition-colors disabled:opacity-50"
                                    >
                                      Pause Trading
                                    </button>
                                  )}
                                  {mk.status === MarketStatus.Paused && (
                                    <button
                                      onClick={() => handlePause(market)}
                                      disabled={txPending}
                                      className="px-4 py-2 bg-apple-green/20 text-apple-green text-xs font-semibold rounded-lg hover:bg-apple-green/30 transition-colors disabled:opacity-50"
                                    >
                                      Unpause Trading
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleToggleVisibility(market)}
                                    disabled={txPending}
                                    className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 ${
                                      isHidden
                                        ? 'bg-apple-green/20 text-apple-green hover:bg-apple-green/30'
                                        : 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
                                    }`}
                                  >
                                    {isHidden ? 'Make Live on Site' : 'Hide from Site'}
                                  </button>
                                  <a
                                    href={editStates[market.pubkey]?.existingSlug
                                      ? `/paid/${editStates[market.pubkey]?.existingSlug}`
                                      : `/market/${mk.marketId.toString()}`}
                                    target="_blank"
                                    className="px-4 py-2 bg-white/5 text-neutral-300 text-xs font-semibold rounded-lg hover:bg-white/10 transition-colors"
                                  >
                                    View Market Page →
                                  </a>
                                </div>
                              </div>

                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </main>
            <Footer />
          </div>
        </div>
      </div>
    </div>
  )
}
