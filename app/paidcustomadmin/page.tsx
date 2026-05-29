'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import MentionedSpinner from '@/components/MentionedSpinner'
import {
  fetchAllMarkets,
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
import type { Address } from '@solana/kit'

interface MarketWithMeta {
  pubkey: Address
  account: UsdcMarketAccount
  vaultBalance?: bigint
  lpPosition?: LpPosition | null
}

export default function PaidCustomAdminPage() {
  const { publicKey, signer, signOnly } = useWallet()

  const [isAdmin, setIsAdmin] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [markets, setMarkets] = useState<MarketWithMeta[]>([])
  const [loading, setLoading] = useState(true)
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
  const [tradeFeeBps, setTradeFeeBps] = useState('50')
  const [initialB, setInitialB] = useState('100000000')
  const [baseBPerUsdc, setBaseBPerUsdc] = useState('500000')
  const [creating, setCreating] = useState(false)

  const parsedWords = useMemo(
    () => wordsInput.split(/[,\n]+/).map(w => w.trim()).filter(Boolean),
    [wordsInput]
  )

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
    try {
      const all = await fetchAllMarkets()
      const enriched = await Promise.all(
        all.map(async ({ pubkey, account }) => {
          const [vaultBalance, lpPosition] = await Promise.all([
            fetchVaultBalance(account.marketId),
            fetchLpPosition(account.marketId, publicKey as Address),
          ])
          return { pubkey, account, vaultBalance, lpPosition }
        })
      )
      setMarkets(enriched)
    } catch (err) {
      console.error('Failed to fetch on-chain markets', err)
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
      const feeBps = parseInt(tradeFeeBps) || 50
      const initB = BigInt(initialB || '1000000')
      const bPerUsdc = BigInt(baseBPerUsdc || '100')

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
      setTradeFeeBps('50')
      setInitialB('1000000')
      setBaseBPerUsdc('100')
      await fetchMarkets()
    } catch (err: any) {
      show(err?.message || 'Failed to create market', 'error')
    } finally {
      setCreating(false)
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
              <p className="text-neutral-400 text-sm mb-6">Create and manage USDC prediction markets on Solana devnet</p>

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
                    <p className="text-[10px] text-neutral-600 mt-1 px-1">50 = 0.5%</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-400 mb-1.5">Initial b (USDC base units)</label>
                    <input
                      type="number"
                      placeholder="100000000"
                      value={initialB}
                      onChange={e => setInitialB(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                      min="100000"
                    />
                    <p className="text-[10px] text-neutral-600 mt-1 px-1">1_000_000 = 1 USDC. Higher = less volatile</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-400 mb-1.5">b per USDC (scaled 1e6)</label>
                    <input
                      type="number"
                      placeholder="500000"
                      value={baseBPerUsdc}
                      onChange={e => setBaseBPerUsdc(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                      min="1"
                    />
                    <p className="text-[10px] text-neutral-600 mt-1 px-1">How much b grows per USDC deposited</p>
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

                {!loading && markets.length === 0 && (
                  <p className="text-neutral-500 text-sm py-8 text-center">No on-chain markets found</p>
                )}

                {!loading && markets.length > 0 && (
                  <div className="space-y-3">
                    {markets.map(market => {
                      const mk = market.account
                      const isExpanded = expandedId === market.pubkey
                      const wordRes = resolutions[market.pubkey] || {}

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
                                  <a
                                    href={`/market/${mk.marketId.toString()}`}
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
