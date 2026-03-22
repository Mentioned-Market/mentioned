'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { useWallet } from '@/contexts/WalletContext'

// ── Types ──────────────────────────────────────────────────

interface Position {
  pubkey: string
  marketId: string
  eventId: string
  isYes: boolean
  contracts: string
  avgPriceUsd: number
  markPriceUsd: number
  pnlUsd: number
  pnlUsdPercent: number
  totalCostUsd: string
  sizeUsd: string
  sellPriceUsd: number
  claimable?: boolean
  claimed?: boolean
  claimableAt?: number | null
  payoutUsd?: string
  marketMetadata?: { title: string }
  eventMetadata?: { title: string; imageUrl: string; closeTime: string }
}

interface Order {
  pubkey: string
  marketId: string
  eventId: string
  status: 'pending' | 'filled' | 'failed' | 'cancelled'
  isYes: boolean
  isBuy: boolean
  contracts: string
  filledContracts: string
  maxFillPriceUsd: string
  avgFillPriceUsd: string
  sizeUsd: string
  createdAt: number
  updatedAt: number
  marketMetadata?: { title: string }
  eventMetadata?: { title: string; imageUrl: string }
}

interface HistoryEvent {
  id: number
  eventType: string
  signature: string
  slot: number
  timestamp: number
  orderPubkey: string
  positionPubkey: string
  marketId: string
  eventId: string
  ownerPubkey: string
  isBuy: boolean
  isYes: boolean
  contracts: string
  filledContracts: string
  maxFillPriceUsd: number
  avgFillPriceUsd: number
  maxBuyPriceUsd: number
  minSellPriceUsd: number
  depositAmountUsd: number
  totalCostUsd: number
  feeUsd: number
  grossProceedsUsd: number
  netProceedsUsd: number
  contractsSettled: string
  transferAmountToken: string
  realizedPnl: number
  realizedPnlBeforeFees: number
  payoutAmountUsd: number
  marketMetadata?: { title: string }
  eventMetadata?: { title: string; imageUrl: string }
}

type Tab = 'positions' | 'orders' | 'history'
type PnlPeriod = '1D' | '1W' | '1M' | 'ALL'

// ── Helpers ────────────────────────────────────────────────

function microToUsd(micro: number | null | string | undefined): string {
  if (micro === null || micro === undefined) return '—'
  const n = typeof micro === 'string' ? Number(micro) : micro
  if (!Number.isFinite(n)) return '$0.00'
  if (n === 0) return '$0.00'
  return `$${(n / 1_000_000).toFixed(2)}`
}

function microToUsdSigned(micro: number | null | undefined): string {
  if (micro === null || micro === undefined) return '—'
  const n = Number(micro)
  if (!Number.isFinite(n) || n === 0) return '-'
  const usd = n / 1_000_000
  const sign = usd > 0 ? '+' : ''
  return `${sign}$${Math.abs(usd).toFixed(2)}`
}

function microToCents(micro: number | null): string {
  if (micro === null) return '—'
  return `${(micro / 10_000).toFixed(0)}¢`
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatDateFull(ts: number): string {
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

function formatCloseTime(isoTime: string): string {
  const d = new Date(isoTime)
  const diff = d.getTime() - Date.now()
  if (diff <= 0) return 'Settled'
  const hours = Math.floor(diff / (1000 * 60 * 60))
  if (hours > 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  return `${hours}h ${minutes}m`
}

function eventTypeToStatus(eventType: string): { label: string; color: string } {
  switch (eventType) {
    case 'order_filled':
      return { label: 'Filled', color: 'text-apple-green bg-apple-green/10' }
    case 'order_created':
      return { label: 'Created', color: 'text-apple-blue bg-apple-blue/10' }
    case 'order_closed':
      return { label: 'Closed', color: 'text-neutral-300 bg-white/5' }
    case 'order_failed':
      return { label: 'Failed', color: 'text-apple-red bg-apple-red/10' }
    case 'settle_position':
      return { label: 'Settled', color: 'text-apple-green bg-apple-green/10' }
    case 'payout_claimed':
      return { label: 'Claimed', color: 'text-apple-green bg-apple-green/10' }
    default:
      return { label: eventType.replace(/_/g, ' '), color: 'text-neutral-400 bg-white/5' }
  }
}

function periodCutoff(period: PnlPeriod): number {
  const now = Date.now()
  if (period === '1D') return (now - 86_400_000) / 1000
  if (period === '1W') return (now - 7 * 86_400_000) / 1000
  if (period === '1M') return (now - 30 * 86_400_000) / 1000
  return 0
}

function periodLabel(period: PnlPeriod): string {
  if (period === '1D') return 'Past Day'
  if (period === '1W') return 'Past Week'
  if (period === '1M') return 'Past Month'
  return 'All Time'
}

// ── Sparkline ──────────────────────────────────────────────

const SETTLEMENT_TYPES = new Set(['settle_position', 'payout_claimed'])

function eventPnl(h: HistoryEvent): number {
  if (h.realizedPnl !== 0) return h.realizedPnl
  if (SETTLEMENT_TYPES.has(h.eventType) && h.payoutAmountUsd > 0) return h.payoutAmountUsd
  return 0
}

function Sparkline({ history, period, pnlValue }: {
  history: HistoryEvent[]
  period: PnlPeriod
  pnlValue: number
}) {
  const cutoff = periodCutoff(period)
  const points = useMemo(() => {
    const filtered = history
      .filter(h => h.timestamp >= cutoff && h.realizedPnl !== 0)
      .sort((a, b) => a.timestamp - b.timestamp)
    if (filtered.length === 0) return []
    let cum = 0
    const result = [0]
    for (const h of filtered) {
      cum += h.realizedPnl
      result.push(cum)
    }
    return result
  }, [history, cutoff])

  if (points.length < 2) {
    return <div className="h-16 flex items-end"><div className="w-full h-0.5 bg-white/5 rounded-full" /></div>
  }

  const min = Math.min(...points, 0)
  const max = Math.max(...points, 0)
  const range = max - min || 1
  const W = 400
  const H = 64
  const xs = points.map((_, i) => (i / (points.length - 1)) * W)
  const ys = points.map(v => H - ((v - min) / range) * H)
  const pathD = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x},${ys[i]}`).join(' ')
  const fillD = `${pathD} L${W},${H} L0,${H} Z`
  const lastY = ys[ys.length - 1]
  const positive = pnlValue >= 0
  const color = positive ? '#34d399' : '#f87171'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {min < 0 && max > 0 && (
        <line
          x1="0" y1={H - ((-min) / range) * H}
          x2={W} y2={H - ((-min) / range) * H}
          stroke="rgba(255,255,255,0.08)" strokeWidth="1"
        />
      )}
      <path d={fillD} fill="url(#sparkFill)" />
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xs[xs.length - 1]} cy={lastY} r="3" fill={color} />
    </svg>
  )
}

// ── Wallet signing helper ──────────────────────────────────

async function signAndSendTx(transaction: string, ownerPubkey: string): Promise<string> {
  const { getWallets } = await import('@wallet-standard/app')
  const wallets = getWallets().get()
  const wallet = wallets.find(w => w.name === 'Phantom')
  if (!wallet) throw new Error('Phantom wallet not found')

  const account = wallet.accounts.find(a => a.address === ownerPubkey)
  if (!account) throw new Error('Wallet account not found')

  const signAndSend = wallet.features['solana:signAndSendTransaction'] as {
    signAndSendTransaction(
      ...inputs: Array<{ transaction: Uint8Array; account: any; chain?: string }>
    ): Promise<Array<{ signature: Uint8Array }>>
  }

  const txBytes = Uint8Array.from(atob(transaction), c => c.charCodeAt(0))
  const chain = account.chains.find(c => c.startsWith('solana:')) || 'solana:mainnet-beta'

  const [result] = await signAndSend.signAndSendTransaction({ transaction: txBytes, account, chain })
  return Array.from(result.signature).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Page ───────────────────────────────────────────────────

export default function ProfilePage() {
  const { connected, publicKey, connect } = useWallet()

  // Username state
  const [username, setUsername] = useState<string | null>(null)
  const [editingUsername, setEditingUsername] = useState(false)
  const [usernameInput, setUsernameInput] = useState('')
  const [usernameSaving, setUsernameSaving] = useState(false)
  const [usernameError, setUsernameError] = useState<string | null>(null)

  // Positions state
  const [tab, setTab] = useState<Tab>('positions')
  const [pnlPeriod, setPnlPeriod] = useState<PnlPeriod>('ALL')
  const [positions, setPositions] = useState<Position[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [history, setHistory] = useState<HistoryEvent[]>([])
  const [loadingPositions, setLoadingPositions] = useState(true)
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [closingPubkey, setClosingPubkey] = useState<string | null>(null)
  const [closeStatus, setCloseStatus] = useState<{ msg: string; error: boolean } | null>(null)

  // ── Load username ───────────────────────────────────────

  useEffect(() => {
    if (!publicKey) { setUsername(null); return }
    fetch(`/api/profile?wallet=${publicKey}`)
      .then(r => r.json())
      .then(d => setUsername(d.username))
      .catch(() => setUsername(null))
  }, [publicKey])

  // ── Fetch positions ───────────────────────────────────────

  const fetchPositions = useCallback(async () => {
    if (!publicKey) { setPositions([]); setLoadingPositions(false); return }
    try {
      const res = await fetch(`/api/polymarket/positions?ownerPubkey=${publicKey}`)
      if (res.ok) {
        const json = await res.json()
        setPositions(json.data || [])
      }
    } catch { /* ignore */ }
    setLoadingPositions(false)
  }, [publicKey])

  const fetchOrders = useCallback(async () => {
    if (!publicKey) { setOrders([]); setLoadingOrders(false); return }
    try {
      const res = await fetch(`/api/polymarket/orders/list?ownerPubkey=${publicKey}`)
      if (res.ok) {
        const json = await res.json()
        setOrders((json.data || []).sort((a: Order, b: Order) => b.createdAt - a.createdAt))
      }
    } catch { /* ignore */ }
    setLoadingOrders(false)
  }, [publicKey])

  const fetchHistory = useCallback(async () => {
    if (!publicKey) { setHistory([]); setLoadingHistory(false); return }
    try {
      const res = await fetch(`/api/polymarket/history?ownerPubkey=${publicKey}`)
      if (res.ok) {
        const json = await res.json()
        setHistory((json.data || []).sort((a: HistoryEvent, b: HistoryEvent) => b.timestamp - a.timestamp))
      }
    } catch { /* ignore */ }
    setLoadingHistory(false)
  }, [publicKey])

  useEffect(() => {
    setLoadingPositions(true)
    setLoadingOrders(true)
    setLoadingHistory(true)
    fetchPositions()
    fetchOrders()
    fetchHistory()

    const posInterval = setInterval(fetchPositions, 30_000)
    const ordInterval = setInterval(fetchOrders, 15_000)
    const histInterval = setInterval(fetchHistory, 30_000)
    return () => {
      clearInterval(posInterval)
      clearInterval(ordInterval)
      clearInterval(histInterval)
    }
  }, [fetchPositions, fetchOrders, fetchHistory])

  // ── Close position ─────────────────────────────────────────

  const handleClosePosition = useCallback(async (pos: Position) => {
    if (!publicKey) return
    setClosingPubkey(pos.pubkey)
    setCloseStatus(null)

    try {
      const res = await fetch('/api/polymarket/positions/close', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionPubkey: pos.pubkey, ownerPubkey: publicKey, marketId: pos.marketId }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || 'Failed to close position')
      }

      const data = await res.json()
      if (!data.transaction) throw new Error('No transaction returned')

      const sig = await signAndSendTx(data.transaction, publicKey)
      setCloseStatus({ msg: `Close order submitted! Tx: ${sig.slice(0, 8)}...${sig.slice(-8)}`, error: false })

      // Record sell trade for leaderboard (fire-and-forget)
      fetch('/api/polymarket/trades/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: publicKey,
          marketId: pos.marketId,
          eventId: pos.eventId,
          isYes: pos.isYes,
          isBuy: false,
          side: pos.isYes ? 'yes' : 'no',
          amountUsd: pos.sizeUsd,
          txSignature: sig,
          marketTitle: pos.marketMetadata?.title ?? null,
        }),
      }).catch(() => {})

      setTimeout(() => { fetchPositions(); fetchOrders(); fetchHistory() }, 3000)
    } catch (e: unknown) {
      setCloseStatus({ msg: e instanceof Error ? e.message : 'Failed to close position', error: true })
    } finally {
      setClosingPubkey(null)
      setTimeout(() => setCloseStatus(null), 10000)
    }
  }, [publicKey, fetchPositions, fetchOrders, fetchHistory])

  // ── Claim position ────────────────────────────────────────

  const handleClaimPosition = useCallback(async (pos: Position) => {
    if (!publicKey) return
    setClosingPubkey(pos.pubkey)
    setCloseStatus(null)

    try {
      const res = await fetch('/api/polymarket/positions/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionPubkey: pos.pubkey, ownerPubkey: publicKey, marketId: pos.marketId }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || 'Failed to claim position')
      }

      const data = await res.json()
      if (!data.transaction) throw new Error('No transaction returned')

      const sig = await signAndSendTx(data.transaction, publicKey)
      setCloseStatus({ msg: `Claim submitted! Tx: ${sig.slice(0, 8)}...${sig.slice(-8)}`, error: false })

      // Record claim trade for leaderboard (fire-and-forget)
      fetch('/api/polymarket/trades/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: publicKey,
          marketId: pos.marketId,
          eventId: pos.eventId,
          isYes: pos.isYes,
          isBuy: false,
          side: pos.isYes ? 'yes' : 'no',
          amountUsd: pos.payoutUsd ?? pos.sizeUsd,
          txSignature: sig,
          marketTitle: pos.marketMetadata?.title ?? null,
        }),
      }).catch(() => {})

      setTimeout(() => { fetchPositions(); fetchOrders(); fetchHistory() }, 3000)
    } catch (e: unknown) {
      setCloseStatus({ msg: e instanceof Error ? e.message : 'Failed to claim position', error: true })
    } finally {
      setClosingPubkey(null)
      setTimeout(() => setCloseStatus(null), 10000)
    }
  }, [publicKey, fetchPositions, fetchOrders, fetchHistory])

  // ── Username save ───────────────────────────────────────

  const handleSaveUsername = async () => {
    if (!publicKey) return
    const trimmed = usernameInput.trim()
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(trimmed)) {
      setUsernameError('3-20 characters, letters/numbers/underscores only')
      return
    }
    setUsernameSaving(true)
    setUsernameError(null)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: publicKey, username: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) {
        setUsernameError(data.error || 'Failed to save')
      } else {
        setUsername(trimmed)
        setEditingUsername(false)
      }
    } catch {
      setUsernameError('Failed to save username')
    } finally {
      setUsernameSaving(false)
    }
  }

  // ── Derived data ──────────────────────────────────────────

  const openOrders = orders.filter(o => o.status === 'pending')
  const unrealizedPnl = positions.reduce((sum, p) => sum + (Number(p.pnlUsd) || 0), 0)
  const realizedPnl = history.reduce((sum, h) => sum + (Number(h.realizedPnl) || 0), 0)
  const totalPnl = unrealizedPnl + realizedPnl
  const totalValue = positions.reduce((sum, p) => sum + (Number(p.sizeUsd) || 0), 0)

  const biggestWin = useMemo(() =>
    history.reduce((max, h) => { const pnl = eventPnl(h); return pnl > max ? pnl : max }, 0),
  [history])

  const periodPnl = useMemo(() => {
    const cutoff = periodCutoff(pnlPeriod)
    const filtered = history.filter(h => h.timestamp >= cutoff)
    const realized = filtered.reduce((s, h) => s + (h.realizedPnl || 0), 0)
    const unrealized = pnlPeriod === 'ALL' ? unrealizedPnl : 0
    return realized + unrealized
  }, [history, pnlPeriod, unrealizedPnl])

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'positions', label: 'Positions', count: positions.length },
    { key: 'orders', label: 'Open Orders', count: openOrders.length },
    { key: 'history', label: 'History', count: history.length },
  ]

  // ── Not connected ───────────────────────────────────────

  if (!connected) {
    return (
      <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
        <div className="layout-container flex h-full grow flex-col">
          <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
            <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
              <Header />
              <main className="flex-1 flex flex-col items-center justify-center py-32 gap-4">
                <div className="w-16 h-16 rounded-2xl glass flex items-center justify-center mb-2">
                  <svg className="w-8 h-8 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
                  </svg>
                </div>
                <span className="text-neutral-400 text-base font-medium">Connect your wallet to view your profile</span>
                <button
                  onClick={connect}
                  className="mt-2 px-6 py-3 bg-white text-black text-sm font-semibold rounded-xl hover:bg-neutral-100 transition-all duration-200"
                >
                  Connect Wallet
                </button>
              </main>
              <Footer />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Connected ──────────────────────────────────────────

  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
            <Header />

            <main className="py-4 md:py-6 flex-1">
              {/* Username section */}
              <div className="mb-6">
                {editingUsername ? (
                  <div className="flex items-center gap-2 mb-1">
                    <input
                      type="text"
                      value={usernameInput}
                      onChange={(e) => { setUsernameInput(e.target.value); setUsernameError(null) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveUsername(); if (e.key === 'Escape') { setEditingUsername(false); setUsernameError(null) } }}
                      placeholder="username"
                      autoFocus
                      maxLength={20}
                      className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xl md:text-2xl font-bold text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/30 w-56"
                    />
                    <button
                      onClick={handleSaveUsername}
                      disabled={usernameSaving}
                      className="px-3 py-1.5 bg-white text-black text-sm font-semibold rounded-lg hover:bg-neutral-200 transition-colors disabled:opacity-50"
                    >
                      {usernameSaving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={() => { setEditingUsername(false); setUsernameError(null) }}
                      className="px-3 py-1.5 text-neutral-400 text-sm font-medium hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 mb-1">
                    <h1 className="text-2xl md:text-3xl font-bold text-white">
                      {username || 'Set Username'}
                    </h1>
                    <button
                      onClick={() => { setUsernameInput(username || ''); setEditingUsername(true); setUsernameError(null) }}
                      className="text-neutral-500 hover:text-white transition-colors"
                      title="Edit username"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                        <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                      </svg>
                    </button>
                  </div>
                )}
                {usernameError && (
                  <p className="text-apple-red text-xs mt-1 mb-1">{usernameError}</p>
                )}
                <p className="text-neutral-500 text-sm font-mono">
                  {publicKey?.slice(0, 8)}...{publicKey?.slice(-8)}
                </p>
              </div>

              {/* Summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="glass rounded-xl p-4">
                  <div className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-1">Positions</div>
                  <div className="text-white text-xl font-bold">{positions.length}</div>
                </div>
                <div className="glass rounded-xl p-4">
                  <div className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-1">Total Value</div>
                  <div className="text-white text-xl font-bold">{microToUsd(totalValue)}</div>
                </div>
                <div className="glass rounded-xl p-4">
                  <div className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-1">All-time P&L</div>
                  <div className={`text-xl font-bold ${totalPnl >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                    {totalPnl >= 0 ? '+' : ''}{microToUsd(totalPnl)}
                  </div>
                </div>
                <div className="glass rounded-xl p-4">
                  <div className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-1">Open Orders</div>
                  <div className="text-white text-xl font-bold">{openOrders.length}</div>
                </div>
              </div>

              {/* P&L chart */}
              <div className="glass rounded-xl p-4 mb-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${periodPnl >= 0 ? 'bg-apple-green' : 'bg-apple-red'}`} />
                    <span className="text-neutral-400 text-sm font-medium">Profit / Loss</span>
                    <span className={`text-sm font-bold ${periodPnl >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                      {periodPnl >= 0 ? '+' : ''}{microToUsd(periodPnl)}
                    </span>
                    <span className="text-neutral-600 text-xs">{periodLabel(pnlPeriod)}</span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    {(['1D', '1W', '1M', 'ALL'] as PnlPeriod[]).map(p => (
                      <button
                        key={p}
                        onClick={() => setPnlPeriod(p)}
                        className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all duration-150 ${
                          pnlPeriod === p ? 'bg-white/15 text-white' : 'text-neutral-500 hover:text-neutral-300'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <Sparkline history={history} period={pnlPeriod} pnlValue={periodPnl} />
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1 mb-4 border-b border-white/10">
                {tabs.map(t => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-all duration-200 border-b-2 -mb-px ${
                      tab === t.key
                        ? 'text-white border-white'
                        : 'text-neutral-500 border-transparent hover:text-neutral-300'
                    }`}
                  >
                    {t.label}
                    {t.count > 0 && (
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                        tab === t.key ? 'bg-white/15 text-white' : 'bg-white/5 text-neutral-500'
                      }`}>
                        {t.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* ── Positions Tab ──────────────────────────────── */}
              {tab === 'positions' && (
                <div>
                  {loadingPositions ? (
                    <div className="flex items-center justify-center py-16">
                      <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    </div>
                  ) : positions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-2">
                      <span className="text-neutral-500 text-sm">No open positions</span>
                      <Link href="/" className="text-apple-blue text-sm font-medium hover:underline">
                        Browse markets
                      </Link>
                    </div>
                  ) : (
                    <>
                      {closeStatus && (
                        <div className={`mb-3 p-3 rounded-lg text-xs ${
                          closeStatus.error
                            ? 'bg-red-500/10 border border-red-500/30 text-red-300'
                            : 'bg-green-500/10 border border-green-500/30 text-green-300'
                        }`}>
                          {closeStatus.msg}
                        </div>
                      )}

                      <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_80px] gap-3 px-4 py-2.5 text-[10px] text-neutral-500 font-medium uppercase tracking-wider border-b border-white/5">
                        <span>Event</span>
                        <span className="text-right">Total Size</span>
                        <span className="text-right">Value</span>
                        <span className="text-right">Avg. Price</span>
                        <span className="text-right">Mark Price</span>
                        <span className="text-right">PNL</span>
                        <span className="text-right">Payout if right</span>
                        <span className="text-right">Est. Settlement</span>
                        <span></span>
                      </div>

                      {positions.map(pos => {
                        const contracts = Number(pos.contracts || 0)
                        const payoutIfRight = contracts * 1_000_000
                        const isClosing = closingPubkey === pos.pubkey

                        return (
                          <div
                            key={pos.pubkey}
                            className="group grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_80px] gap-1 md:gap-3 px-4 py-3 md:py-4 border-b border-white/5 hover:bg-white/[0.03] transition-colors"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                pos.isYes ? 'bg-apple-green/15 text-apple-green' : 'bg-apple-red/15 text-apple-red'
                              }`}>
                                {pos.isYes ? 'YES' : 'NO'}
                              </span>
                              <Link
                                href={pos.eventId ? `/polymarkets/event/${pos.eventId}` : '#'}
                                className="text-white text-sm font-medium truncate hover:underline"
                              >
                                {pos.marketMetadata?.title || pos.marketId.slice(0, 12) + '...'}
                              </Link>
                            </div>

                            <div className="flex md:block justify-between md:text-right">
                              <span className="text-neutral-500 text-xs md:hidden">Total Size</span>
                              <span className="text-white text-sm font-medium">{pos.contracts}</span>
                            </div>

                            <div className="flex md:block justify-between md:text-right">
                              <span className="text-neutral-500 text-xs md:hidden">Value</span>
                              <span className="text-white text-sm font-medium">{microToUsd(pos.sizeUsd)}</span>
                            </div>

                            <div className="flex md:block justify-between md:text-right">
                              <span className="text-neutral-500 text-xs md:hidden">Avg. Price</span>
                              <span className="text-neutral-300 text-sm">{microToCents(pos.avgPriceUsd)}</span>
                            </div>

                            <div className="flex md:block justify-between md:text-right">
                              <span className="text-neutral-500 text-xs md:hidden">Mark Price</span>
                              <span className="text-neutral-300 text-sm">{microToCents(pos.markPriceUsd)}</span>
                            </div>

                            <div className="flex md:block justify-between md:text-right">
                              <span className="text-neutral-500 text-xs md:hidden">PNL</span>
                              <div>
                                <span className={`text-sm font-semibold ${Number(pos.pnlUsd) >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                                  {Number(pos.pnlUsd) >= 0 ? '+' : ''}{microToUsd(pos.pnlUsd)}
                                </span>
                                <span className={`block text-[10px] ${Number(pos.pnlUsdPercent) >= 0 ? 'text-apple-green/70' : 'text-apple-red/70'}`}>
                                  {Number(pos.pnlUsdPercent) >= 0 ? '+' : ''}{((Number(pos.pnlUsdPercent) || 0) / 100).toFixed(1)}%
                                </span>
                              </div>
                            </div>

                            <div className="flex md:block justify-between md:text-right">
                              <span className="text-neutral-500 text-xs md:hidden">Payout</span>
                              <span className="text-white text-sm font-medium">{microToUsd(payoutIfRight)}</span>
                            </div>

                            <div className="flex md:block justify-between md:text-right">
                              <span className="text-neutral-500 text-xs md:hidden">Settlement</span>
                              <span className="text-neutral-400 text-sm">
                                {pos.eventMetadata?.closeTime ? formatCloseTime(pos.eventMetadata.closeTime) : '—'}
                              </span>
                            </div>

                            <div className="flex items-center justify-end">
                              {pos.claimable && !pos.claimed ? (
                                <button
                                  onClick={() => handleClaimPosition(pos)}
                                  disabled={isClosing || !!closingPubkey}
                                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-apple-green/30 text-apple-green hover:bg-apple-green/10 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  {isClosing ? (
                                    <span className="flex items-center gap-1.5">
                                      <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                      </svg>
                                      Claiming
                                    </span>
                                  ) : 'Claim'}
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleClosePosition(pos)}
                                  disabled={isClosing || !!closingPubkey}
                                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-apple-red/30 text-apple-red hover:bg-apple-red/10 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  {isClosing ? (
                                    <span className="flex items-center gap-1.5">
                                      <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                      </svg>
                                      Closing
                                    </span>
                                  ) : 'Close'}
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </>
                  )}
                </div>
              )}

              {/* ── Open Orders Tab ────────────────────────────── */}
              {tab === 'orders' && (
                <div>
                  {loadingOrders ? (
                    <div className="flex items-center justify-center py-16">
                      <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    </div>
                  ) : openOrders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-2">
                      <span className="text-neutral-500 text-sm">No open orders</span>
                      <Link href="/" className="text-apple-blue text-sm font-medium hover:underline">
                        Browse markets
                      </Link>
                    </div>
                  ) : (
                    <>
                      <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2.5 text-[10px] text-neutral-500 font-medium uppercase tracking-wider border-b border-white/5">
                        <span>Market</span>
                        <span className="text-center">Side</span>
                        <span className="text-right">Contracts</span>
                        <span className="text-right">Max Price</span>
                        <span className="text-right">Size</span>
                        <span className="text-right">Created</span>
                      </div>

                      {openOrders.map(order => (
                        <div
                          key={order.pubkey}
                          className="group grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-1 md:gap-3 px-4 py-3 md:py-4 border-b border-white/5 hover:bg-white/[0.03] transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              order.isYes ? 'bg-apple-green/15 text-apple-green' : 'bg-apple-red/15 text-apple-red'
                            }`}>
                              {order.isYes ? 'YES' : 'NO'}
                            </span>
                            <Link
                              href={order.eventId ? `/polymarkets/event/${order.eventId}` : '#'}
                              className="text-white text-sm font-medium truncate hover:underline"
                            >
                              {order.marketMetadata?.title || order.marketId.slice(0, 12) + '...'}
                            </Link>
                          </div>

                          <div className="flex md:block justify-between md:text-center">
                            <span className="text-neutral-500 text-xs md:hidden">Side</span>
                            <span className={`text-sm font-semibold ${order.isBuy ? 'text-apple-green' : 'text-apple-red'}`}>
                              {order.isBuy ? 'Buy' : 'Sell'}
                            </span>
                          </div>

                          <div className="flex md:block justify-between md:text-right">
                            <span className="text-neutral-500 text-xs md:hidden">Contracts</span>
                            <span className="text-white text-sm">{order.contracts}</span>
                          </div>

                          <div className="flex md:block justify-between md:text-right">
                            <span className="text-neutral-500 text-xs md:hidden">Max Price</span>
                            <span className="text-neutral-300 text-sm">{microToUsd(order.maxFillPriceUsd)}</span>
                          </div>

                          <div className="flex md:block justify-between md:text-right">
                            <span className="text-neutral-500 text-xs md:hidden">Size</span>
                            <span className="text-white text-sm font-medium">{microToUsd(order.sizeUsd)}</span>
                          </div>

                          <div className="flex md:block justify-between md:text-right">
                            <span className="text-neutral-500 text-xs md:hidden">Created</span>
                            <span className="text-neutral-400 text-xs">{formatDate(order.createdAt)}</span>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}

              {/* ── History Tab ─────────────────────────────────── */}
              {tab === 'history' && (
                <div>
                  {loadingHistory ? (
                    <div className="flex items-center justify-center py-16">
                      <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    </div>
                  ) : history.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-2">
                      <span className="text-neutral-500 text-sm">No trade history yet</span>
                      <Link href="/" className="text-apple-blue text-sm font-medium hover:underline">
                        Browse markets
                      </Link>
                    </div>
                  ) : (
                    <>
                      <div className="hidden md:grid grid-cols-[2.5fr_0.8fr_0.8fr_0.8fr_1fr_1fr_0.8fr] gap-3 px-4 py-2.5 text-[10px] text-neutral-500 font-medium uppercase tracking-wider border-b border-white/5">
                        <span>Event</span>
                        <span className="text-center">Action</span>
                        <span className="text-center">Status</span>
                        <span className="text-right">Price</span>
                        <span className="text-right">Deposit / Withdraw</span>
                        <span className="text-right">PNL</span>
                        <span className="text-right">Fee</span>
                      </div>

                      {history.map(h => {
                        const { label: statusLabel, color: statusColor } = eventTypeToStatus(h.eventType)

                        let depositWithdraw: string = '-'
                        if (h.depositAmountUsd && h.depositAmountUsd > 0) {
                          depositWithdraw = `-${microToUsd(h.depositAmountUsd)}`
                        } else if (h.netProceedsUsd && h.netProceedsUsd > 0) {
                          depositWithdraw = `+${microToUsd(h.netProceedsUsd)}`
                        } else if (h.grossProceedsUsd && h.grossProceedsUsd > 0) {
                          depositWithdraw = `+${microToUsd(h.grossProceedsUsd)}`
                        } else if (h.payoutAmountUsd && h.payoutAmountUsd > 0) {
                          depositWithdraw = `+${microToUsd(h.payoutAmountUsd)}`
                        }

                        const depositIsPositive = depositWithdraw.startsWith('+')

                        const price = h.avgFillPriceUsd
                          ? microToCents(h.avgFillPriceUsd)
                          : h.maxBuyPriceUsd
                          ? microToCents(h.maxBuyPriceUsd)
                          : h.minSellPriceUsd
                          ? microToCents(h.minSellPriceUsd)
                          : '-'

                        const pnl = h.realizedPnl ? microToUsdSigned(h.realizedPnl) : '-'
                        const pnlPositive = h.realizedPnl ? h.realizedPnl > 0 : false

                        const fee = h.feeUsd && h.feeUsd > 0 ? microToUsd(h.feeUsd) : '-'

                        return (
                          <div
                            key={h.id}
                            className="group grid grid-cols-1 md:grid-cols-[2.5fr_0.8fr_0.8fr_0.8fr_1fr_1fr_0.8fr] gap-1 md:gap-3 px-4 py-3 md:py-4 border-b border-white/5 hover:bg-white/[0.03] transition-colors"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                                  h.isYes ? 'bg-apple-green/15 text-apple-green' : 'bg-apple-red/15 text-apple-red'
                                }`}>
                                  {h.isYes ? 'Yes' : 'No'}
                                </span>
                                <span className="text-neutral-500 text-[10px]">·</span>
                                <Link
                                  href={h.eventId ? `/polymarkets/event/${h.eventId}` : '#'}
                                  className="text-white text-sm font-medium truncate hover:underline"
                                >
                                  {h.marketMetadata?.title || h.marketId?.slice(0, 12) + '...'}
                                </Link>
                              </div>
                              <div className="text-neutral-500 text-[11px]">
                                {formatDateFull(h.timestamp)}
                              </div>
                            </div>

                            <div className="flex md:block justify-between md:text-center">
                              <span className="text-neutral-500 text-xs md:hidden">Action</span>
                              <span className="text-white text-sm font-medium">
                                {h.isBuy ? 'Buy' : 'Sell'}
                              </span>
                            </div>

                            <div className="flex md:block justify-between md:text-center">
                              <span className="text-neutral-500 text-xs md:hidden">Status</span>
                              <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${statusColor}`}>
                                {statusLabel}
                              </span>
                            </div>

                            <div className="flex md:block justify-between md:text-right">
                              <span className="text-neutral-500 text-xs md:hidden">Price</span>
                              <span className="text-white text-sm">{price}</span>
                            </div>

                            <div className="flex md:block justify-between md:text-right">
                              <span className="text-neutral-500 text-xs md:hidden">Deposit / Withdraw</span>
                              <span className={`text-sm font-medium ${
                                depositIsPositive ? 'text-apple-green' : depositWithdraw === '-' ? 'text-neutral-500' : 'text-white'
                              }`}>
                                {depositWithdraw}
                              </span>
                            </div>

                            <div className="flex md:block justify-between md:text-right">
                              <span className="text-neutral-500 text-xs md:hidden">PNL</span>
                              <span className={`text-sm font-semibold ${
                                pnl === '-' ? 'text-neutral-500' : pnlPositive ? 'text-apple-green' : 'text-apple-red'
                              }`}>
                                {pnl}
                              </span>
                            </div>

                            <div className="flex md:block justify-between md:text-right">
                              <span className="text-neutral-500 text-xs md:hidden">Fee</span>
                              <span className="text-neutral-400 text-sm">{fee}</span>
                            </div>
                          </div>
                        )
                      })}
                    </>
                  )}
                </div>
              )}

            </main>

            <Footer />
          </div>
        </div>
      </div>
    </div>
  )
}
