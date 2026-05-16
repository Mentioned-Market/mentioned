'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { useWallet } from '@/contexts/WalletContext'
import { useAchievements } from '@/contexts/AchievementContext'
import { signAndSendTx } from '@/lib/walletUtils'
import MentionedSpinner from '@/components/MentionedSpinner'
import Pagination, { usePagination } from '@/components/Pagination'

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
type MarketMode = 'paid' | 'free'

interface FreePosition {
  id: number
  market_id: number
  word_id: number
  wallet: string
  yes_shares: string
  no_shares: string
  tokens_spent: string
  tokens_received: string
  updated_at: string
  word: string
  market_title: string
  market_status: string
  market_slug: string
}

interface FreeTrade {
  id: number
  market_id: number
  word_id: number
  wallet: string
  action: string
  side: string
  shares: string
  cost: string
  yes_price: string
  no_price: string
  created_at: string
  word: string
  market_title: string
  market_slug: string
}

interface FreeMarketGroup {
  market_id: number
  market_title: string
  market_status: string
  market_slug: string
  positions: FreePosition[]
  totalSpent: number
  totalReceived: number
  pnl: number
}

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

// Map Jupiter eventType to display label
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

// signAndSendTx imported from @/lib/walletUtils

// ── Page ───────────────────────────────────────────────────

export default function PositionsPage() {
  const { connected, connect, publicKey, walletType } = useWallet()
  const { showAchievementToast } = useAchievements()

  const [tab, setTab] = useState<Tab>('positions')
  const [marketMode, setMarketMode] = useState<MarketMode>('free')
  const [positions, setPositions] = useState<Position[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [history, setHistory] = useState<HistoryEvent[]>([])
  const [loadingPositions, setLoadingPositions] = useState(true)
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [closingPubkey, setClosingPubkey] = useState<string | null>(null)
  const [closeStatus, setCloseStatus] = useState<{ msg: string; error: boolean } | null>(null)

  // Free market data
  const [freePositions, setFreePositions] = useState<FreePosition[]>([])
  const [freeTrades, setFreeTrades] = useState<FreeTrade[]>([])
  const [freePointsEarned, setFreePointsEarned] = useState<number>(0)
  const [loadingFree, setLoadingFree] = useState(false)
  const [expandedMarkets, setExpandedMarkets] = useState<Set<number>>(new Set())

  // ── Fetch positions ───────────────────────────────────────

  const fetchPositions = useCallback(async () => {
    if (!publicKey) {
      setPositions([])
      setLoadingPositions(false)
      return
    }
    try {
      const res = await fetch(`/api/polymarket/positions?ownerPubkey=${publicKey}`)
      if (res.ok) {
        const json = await res.json()
        setPositions(json.data || [])
      }
    } catch { /* ignore */ }
    setLoadingPositions(false)
  }, [publicKey])

  // ── Fetch orders ──────────────────────────────────────────

  const fetchOrders = useCallback(async () => {
    if (!publicKey) {
      setOrders([])
      setLoadingOrders(false)
      return
    }
    try {
      const res = await fetch(`/api/polymarket/orders/list?ownerPubkey=${publicKey}`)
      if (res.ok) {
        const json = await res.json()
        setOrders(
          (json.data || []).sort((a: Order, b: Order) => b.createdAt - a.createdAt)
        )
      }
    } catch { /* ignore */ }
    setLoadingOrders(false)
  }, [publicKey])

  // ── Fetch history ─────────────────────────────────────────

  const fetchHistory = useCallback(async () => {
    if (!publicKey) {
      setHistory([])
      setLoadingHistory(false)
      return
    }
    try {
      const res = await fetch(`/api/polymarket/history?ownerPubkey=${publicKey}`)
      if (res.ok) {
        const json = await res.json()
        setHistory(
          (json.data || []).sort((a: HistoryEvent, b: HistoryEvent) => b.timestamp - a.timestamp)
        )
      }
    } catch { /* ignore */ }
    setLoadingHistory(false)
  }, [publicKey])

  const fetchFreeActivity = useCallback(async () => {
    if (!publicKey) {
      setFreePositions([])
      setFreeTrades([])
      setLoadingFree(false)
      return
    }
    setLoadingFree(true)
    try {
      const res = await fetch(`/api/custom/user-activity?wallet=${publicKey}`)
      if (res.ok) {
        const json = await res.json()
        setFreePositions(json.positions || [])
        setFreeTrades(json.trades || [])
        setFreePointsEarned(json.pointsEarned ?? 0)
      }
    } catch { /* ignore */ }
    setLoadingFree(false)
  }, [publicKey])

  // Always fetch positions (default tab), lazy-fetch orders/history only when tab is active
  useEffect(() => {
    setLoadingPositions(true)
    fetchPositions()
    const posInterval = setInterval(fetchPositions, 30_000)
    return () => clearInterval(posInterval)
  }, [fetchPositions])

  useEffect(() => {
    if (tab !== 'orders') return
    setLoadingOrders(true)
    fetchOrders()
    const ordInterval = setInterval(fetchOrders, 15_000)
    return () => clearInterval(ordInterval)
  }, [tab, fetchOrders])

  useEffect(() => {
    if (tab !== 'history') return
    setLoadingHistory(true)
    fetchHistory()
    const histInterval = setInterval(fetchHistory, 30_000)
    return () => clearInterval(histInterval)
  }, [tab, fetchHistory])

  useEffect(() => {
    if (marketMode !== 'free') return
    fetchFreeActivity()
  }, [marketMode, fetchFreeActivity])

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

      const sig = await signAndSendTx(data.transaction, publicKey, walletType!)
      setCloseStatus({ msg: `Close order submitted! Tx: ${sig.slice(0, 8)}...${sig.slice(-8)}`, error: false })

      // Show achievement toast from close response
      if (data.newAchievements?.length) {
        for (const ach of data.newAchievements) showAchievementToast(ach)
      }

      // Record sell trade for leaderboard
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
      }).then(r => r.ok ? r.json() : null).then(d => {
        if (d?.newAchievements?.length) {
          for (const ach of d.newAchievements) showAchievementToast(ach)
        }
      }).catch(() => {})

      // Refresh data after a delay
      setTimeout(() => {
        fetchPositions()
        fetchOrders()
        fetchHistory()
      }, 3000)
    } catch (e: unknown) {
      setCloseStatus({
        msg: e instanceof Error ? e.message : 'Failed to close position',
        error: true,
      })
    } finally {
      setClosingPubkey(null)
      setTimeout(() => setCloseStatus(null), 10000)
    }
  }, [publicKey, fetchPositions, fetchOrders, fetchHistory, showAchievementToast])

  // ── Claim position ──────────────────────────────────────────

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

      const sig = await signAndSendTx(data.transaction, publicKey, walletType!)
      setCloseStatus({ msg: `Claim submitted! Tx: ${sig.slice(0, 8)}...${sig.slice(-8)}`, error: false })

      // Show achievement toast from claim response
      if (data.newAchievements?.length) {
        for (const ach of data.newAchievements) showAchievementToast(ach)
      }

      // Record claim trade for leaderboard
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
      }).then(r => r.ok ? r.json() : null).then(d => {
        if (d?.newAchievements?.length) {
          for (const ach of d.newAchievements) showAchievementToast(ach)
        }
      }).catch(() => {})

      setTimeout(() => {
        fetchPositions()
        fetchOrders()
        fetchHistory()
      }, 3000)
    } catch (e: unknown) {
      setCloseStatus({
        msg: e instanceof Error ? e.message : 'Failed to claim position',
        error: true,
      })
    } finally {
      setClosingPubkey(null)
      setTimeout(() => setCloseStatus(null), 10000)
    }
  }, [publicKey, fetchPositions, fetchOrders, fetchHistory, showAchievementToast])

  // ── Derived data ──────────────────────────────────────────

  const openOrders = orders.filter(o => o.status === 'pending')

  const unrealizedPnl = positions.reduce((sum, p) => sum + (Number(p.pnlUsd) || 0), 0)
  const realizedPnl = history.reduce((sum, h) => sum + (Number(h.realizedPnl) || 0), 0)
  const totalFees = history.reduce((sum, h) => sum + (Number(h.feeUsd) || 0), 0)
  const totalPnl = unrealizedPnl + realizedPnl
  const totalValue = positions.reduce((sum, p) => sum + (Number(p.sizeUsd) || 0), 0)

  const toggleExpand = useCallback((marketId: number) => {
    setExpandedMarkets(prev => {
      const next = new Set(prev)
      if (next.has(marketId)) next.delete(marketId)
      else next.add(marketId)
      return next
    })
  }, [])

  // Free market derived
  const freeTotalSpent = freePositions.reduce((sum, p) => sum + parseFloat(p.tokens_spent), 0)

  const SHARE_THRESHOLD = 0.01

  const freeMarketGroups = useMemo<FreeMarketGroup[]>(() => {
    const map = new Map<number, FreeMarketGroup>()
    for (const pos of freePositions) {
      const yes = parseFloat(pos.yes_shares)
      const no = parseFloat(pos.no_shares)
      // Skip near-zero positions in open/locked markets (float remainders from selling)
      if (pos.market_status !== 'resolved' && yes < SHARE_THRESHOLD && no < SHARE_THRESHOLD) {
        continue
      }
      if (!map.has(pos.market_id)) {
        map.set(pos.market_id, {
          market_id: pos.market_id,
          market_title: pos.market_title,
          market_status: pos.market_status,
          market_slug: pos.market_slug || String(pos.market_id),
          positions: [],
          totalSpent: 0,
          totalReceived: 0,
          pnl: 0,
        })
      }
      const group = map.get(pos.market_id)!
      group.positions.push(pos)
      group.totalSpent += parseFloat(pos.tokens_spent)
      group.totalReceived += parseFloat(pos.tokens_received)
      group.pnl = group.totalReceived - group.totalSpent
    }
    return Array.from(map.values())
  }, [freePositions])

  const freeOpenMarkets = useMemo(
    () => freeMarketGroups.filter(g => g.market_status !== 'resolved'),
    [freeMarketGroups],
  )
  const freeHistoryMarkets = useMemo(
    () => freeMarketGroups.filter(g => g.market_status === 'resolved'),
    [freeMarketGroups],
  )

  // ── Pagination ────────────────────────────────────────────

  const posPg = usePagination(positions)
  const ordersPg = usePagination(openOrders)
  const historyPg = usePagination(history)
  const freeOpenPg = usePagination(freeOpenMarkets)
  const freeHistoryPg = usePagination(freeHistoryMarkets)

  // Reset to page 1 on tab or market mode change
  useEffect(() => {
    posPg.setPage(1); ordersPg.setPage(1); historyPg.setPage(1)
    freeOpenPg.setPage(1); freeHistoryPg.setPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, marketMode])

  // ── Tab counts ────────────────────────────────────────────

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'positions', label: marketMode === 'free' ? 'Open Positions' : 'Positions', count: marketMode === 'paid' ? positions.length : freeOpenMarkets.length },
    { key: 'orders', label: 'Open Orders', count: openOrders.length },
    { key: 'history', label: 'History', count: marketMode === 'paid' ? history.length : freeHistoryMarkets.length },
  ]

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden bg-black">
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex justify-center">
          <div className="w-full max-w-7xl"><Header /></div>
        </div>

        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="flex flex-col w-full max-w-6xl flex-1">
            <main className="py-10 space-y-0 flex-1">
              {/* Page header */}
              <div
                className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-2 animate-fade-in"
                style={{ animationDelay: '0ms', animationFillMode: 'both' }}
              >
                <h1 className="text-4xl md:text-5xl font-black tracking-tight" style={{ color: '#F2B71F' }}>
                  Positions
                </h1>
                <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-white/[0.05]">
                  <button
                    onClick={() => setMarketMode('paid')}
                    className="px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-150"
                    style={marketMode === 'paid'
                      ? { background: 'rgba(242,183,31,0.15)', color: '#F2B71F' }
                      : { color: '#6b7280' }
                    }
                  >
                    Paid Markets
                  </button>
                  <button
                    onClick={() => setMarketMode('free')}
                    className="px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-150"
                    style={marketMode === 'free'
                      ? { background: 'rgba(242,183,31,0.15)', color: '#F2B71F' }
                      : { color: '#6b7280' }
                    }
                  >
                    Free Markets
                  </button>
                </div>
              </div>

              <p
                className="text-neutral-700 text-xs pb-2 animate-fade-in"
                style={{ animationDelay: '60ms', animationFillMode: 'both' }}
              >
                {marketMode === 'paid'
                  ? 'Your Polymarket positions, open orders, and trade history'
                  : 'Your free market positions and trade history'}
              </p>

              {!connected ? (
                <div className="flex flex-col items-center py-20 gap-3 animate-fade-in" style={{ animationDelay: '120ms', animationFillMode: 'both' }}>
                  <p className="text-neutral-500 text-sm">Connect your wallet to view positions</p>
                  <button
                    onClick={connect}
                    className="text-sm font-medium hover:underline"
                    style={{ color: '#F2B71F' }}
                  >
                    Connect Wallet
                  </button>
                </div>
              ) : (
                <>
                  {/* Summary cards */}
                  <div
                    className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 animate-fade-in"
                    style={{ animationDelay: '120ms', animationFillMode: 'both' }}
                  >
                    {marketMode === 'paid' ? (
                      <>
                        <div className="rounded-xl p-4" style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.012)' }}>
                          <div className="text-[10px] text-neutral-600 font-medium uppercase tracking-widest mb-1">Positions</div>
                          <div className="text-white text-xl font-bold tabular-nums">{positions.length}</div>
                        </div>
                        <div className="rounded-xl p-4" style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.012)' }}>
                          <div className="text-[10px] text-neutral-600 font-medium uppercase tracking-widest mb-1">Total Value</div>
                          <div className="text-white text-xl font-bold tabular-nums">{microToUsd(totalValue)}</div>
                        </div>
                        <div className="rounded-xl p-4" style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.012)' }}>
                          <div className="text-[10px] text-neutral-600 font-medium uppercase tracking-widest mb-1">P&L</div>
                          <div className={`text-xl font-bold tabular-nums ${totalPnl >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                            {totalPnl >= 0 ? '+' : ''}{microToUsd(totalPnl)}
                          </div>
                        </div>
                        <div className="rounded-xl p-4" style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.012)' }}>
                          <div className="text-[10px] text-neutral-600 font-medium uppercase tracking-widest mb-1">Open Orders</div>
                          <div className="text-white text-xl font-bold tabular-nums">{openOrders.length}</div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="rounded-xl p-4" style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.012)' }}>
                          <div className="text-[10px] text-neutral-600 font-medium uppercase tracking-widest mb-1">Markets</div>
                          <div className="text-white text-xl font-bold tabular-nums">{freeMarketGroups.length}</div>
                        </div>
                        <div className="rounded-xl p-4" style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.012)' }}>
                          <div className="text-[10px] text-neutral-600 font-medium uppercase tracking-widest mb-1">Tokens Spent</div>
                          <div className="text-white text-xl font-bold tabular-nums">{freeTotalSpent.toFixed(0)}</div>
                        </div>
                        <div className="rounded-xl p-4" style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.012)' }}>
                          <div className="text-[10px] text-neutral-600 font-medium uppercase tracking-widest mb-1">Points Earned</div>
                          <div className="text-apple-green text-xl font-bold tabular-nums">+{freePointsEarned.toLocaleString()}</div>
                        </div>
                        <div className="rounded-xl p-4" style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.012)' }}>
                          <div className="text-[10px] text-neutral-600 font-medium uppercase tracking-widest mb-1">Trades</div>
                          <div className="text-white text-xl font-bold tabular-nums">{freeTrades.length}</div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Tabs */}
                  <div
                    className="animate-fade-in pt-5 pb-4"
                    style={{ animationDelay: '180ms', animationFillMode: 'both' }}
                  >
                    <div className="flex items-center justify-between mb-1 pb-3">
                      <span className="text-xs font-medium text-neutral-600 uppercase tracking-widest">
                        {tab === 'positions' ? 'Open positions' : tab === 'orders' ? 'Open orders' : 'Trade history'}
                      </span>
                      <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-white/[0.05]">
                        {tabs.filter(t => marketMode === 'free' ? t.key !== 'orders' : true).map(t => (
                          <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-150"
                            style={tab === t.key
                              ? { background: 'rgba(242,183,31,0.15)', color: '#F2B71F' }
                              : { color: '#6b7280' }
                            }
                          >
                            {t.label}
                            {t.count > 0 && (
                              <span className="text-[10px] opacity-70">
                                {t.count}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* ── Free Market Open Positions Tab ────────────── */}
                  <div style={{ display: marketMode === 'free' && tab === 'positions' ? undefined : 'none' }}>
                    {loadingFree ? (
                      <MentionedSpinner className="py-20" />
                    ) : freeOpenMarkets.length === 0 ? (
                      <div className="flex flex-col items-center py-20 gap-3">
                        <p className="text-neutral-500 text-sm">No open free market positions</p>
                        <Link href="/markets?type=free" className="text-sm font-medium hover:underline" style={{ color: '#F2B71F' }}>
                          Browse free markets
                        </Link>
                      </div>
                    ) : (
                      <div className="mt-1 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.012)' }}>
                        {freeOpenPg.paged.map(group => {
                          const isExpanded = expandedMarkets.has(group.market_id)
                          const statusClass = group.market_status === 'locked'
                            ? 'bg-yellow-500/10 text-yellow-400'
                            : 'bg-white/5 text-neutral-400'
                          const statusLabel = group.market_status.charAt(0).toUpperCase() + group.market_status.slice(1)
                          return (
                            <div key={group.market_id} className="border-b border-white/[0.04] last:border-b-0">
                              <button
                                onClick={() => toggleExpand(group.market_id)}
                                className="w-full px-4 py-4 flex items-center gap-3 hover:bg-white/[0.04] transition-colors duration-100 text-left"
                              >
                                <svg
                                  className={`w-3.5 h-3.5 text-neutral-500 shrink-0 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                </svg>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Link
                                      href={`/free/${group.market_slug}`}
                                      className="text-white text-sm font-semibold hover:underline truncate leading-snug"
                                      target="_blank" rel="noopener noreferrer"
                                      onClick={e => e.stopPropagation()}
                                    >
                                      {group.market_title}
                                    </Link>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${statusClass}`}>
                                      {statusLabel}
                                    </span>
                                  </div>
                                  <div className="text-neutral-600 text-xs mt-0.5">
                                    {group.positions.length} word{group.positions.length !== 1 ? 's' : ''}
                                  </div>
                                </div>
                                <div className="flex items-center gap-4 md:gap-6 shrink-0">
                                  <div className="text-right hidden sm:block">
                                    <div className="text-[10px] text-neutral-600 uppercase tracking-widest">Spent</div>
                                    <div className="text-neutral-400 text-sm tabular-nums">{group.totalSpent.toFixed(0)}</div>
                                  </div>
                                  <div className="text-right hidden sm:block">
                                    <div className="text-[10px] text-neutral-600 uppercase tracking-widest">Received</div>
                                    <div className="text-neutral-400 text-sm tabular-nums">{group.totalReceived.toFixed(0)}</div>
                                  </div>
                                  <div className="text-right">
                                    <div className="text-[10px] text-neutral-600 uppercase tracking-widest">P&L</div>
                                    <div className={`text-sm font-bold tabular-nums ${group.pnl >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                                      {group.pnl >= 0 ? '+' : ''}{group.pnl.toFixed(0)}
                                    </div>
                                  </div>
                                </div>
                              </button>
                              {isExpanded && (
                                <div className="border-t border-white/[0.04]">
                                  <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 px-4 pl-11 py-2 text-[10px] text-neutral-700 uppercase tracking-widest font-medium" style={{ background: 'rgba(255,255,255,0.015)' }}>
                                    <div>Word</div>
                                    <div className="text-right">Spent</div>
                                    <div className="text-right">Received</div>
                                    <div className="text-right">P&L</div>
                                  </div>
                                  {group.positions.map(pos => {
                                    const wordPnl = parseFloat(pos.tokens_received) - parseFloat(pos.tokens_spent)
                                    const yes = parseFloat(pos.yes_shares)
                                    const no = parseFloat(pos.no_shares)
                                    const hasYes = yes >= SHARE_THRESHOLD
                                    const hasNo = no >= SHARE_THRESHOLD
                                    return (
                                      <div
                                        key={pos.id}
                                        className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr] gap-1 md:gap-3 px-4 pl-4 md:pl-11 py-3 border-b border-white/[0.03] last:border-b-0"
                                        style={{ background: 'rgba(255,255,255,0.015)' }}
                                      >
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          {hasYes && (
                                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 bg-apple-green/15 text-apple-green">
                                              YES {yes.toFixed(2)}
                                            </span>
                                          )}
                                          {hasNo && (
                                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 bg-apple-red/15 text-apple-red">
                                              NO {no.toFixed(2)}
                                            </span>
                                          )}
                                          <span className="text-neutral-300 text-sm">{pos.word}</span>
                                        </div>
                                        <div className="flex md:block justify-between md:text-right items-center">
                                          <span className="text-neutral-600 text-xs md:hidden">Spent</span>
                                          <span className="text-neutral-400 text-sm tabular-nums">{parseFloat(pos.tokens_spent).toFixed(2)}</span>
                                        </div>
                                        <div className="flex md:block justify-between md:text-right items-center">
                                          <span className="text-neutral-600 text-xs md:hidden">Received</span>
                                          <span className="text-neutral-400 text-sm tabular-nums">{parseFloat(pos.tokens_received).toFixed(2)}</span>
                                        </div>
                                        <div className="flex md:block justify-between md:text-right items-center">
                                          <span className="text-neutral-600 text-xs md:hidden">P&L</span>
                                          <span className={`text-sm font-bold tabular-nums ${wordPnl >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                                            {wordPnl >= 0 ? '+' : ''}{wordPnl.toFixed(2)}
                                          </span>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}
                        <Pagination page={freeOpenPg.page} totalPages={freeOpenPg.totalPages} totalItems={freeOpenPg.totalItems} onPageChange={freeOpenPg.setPage} />
                      </div>
                    )}
                  </div>

                  {/* ── Free Market History Tab (resolved markets) ── */}
                  <div style={{ display: marketMode === 'free' && tab === 'history' ? undefined : 'none' }}>
                    {loadingFree ? (
                      <MentionedSpinner className="py-20" />
                    ) : freeHistoryMarkets.length === 0 ? (
                      <div className="flex flex-col items-center py-20 gap-3">
                        <p className="text-neutral-500 text-sm">No resolved free market positions yet</p>
                        <Link href="/markets?type=free" className="text-sm font-medium hover:underline" style={{ color: '#F2B71F' }}>
                          Browse free markets
                        </Link>
                      </div>
                    ) : (
                      <div className="mt-1 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.012)' }}>
                        {freeHistoryPg.paged.map(group => {
                          const isExpanded = expandedMarkets.has(group.market_id)
                          return (
                            <div key={group.market_id} className="border-b border-white/[0.04] last:border-b-0">
                              <button
                                onClick={() => toggleExpand(group.market_id)}
                                className="w-full px-4 py-4 flex items-center gap-3 hover:bg-white/[0.04] transition-colors duration-100 text-left"
                              >
                                <svg
                                  className={`w-3.5 h-3.5 text-neutral-500 shrink-0 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                </svg>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Link
                                      href={`/free/${group.market_slug}`}
                                      className="text-white text-sm font-semibold hover:underline truncate leading-snug"
                                      target="_blank" rel="noopener noreferrer"
                                      onClick={e => e.stopPropagation()}
                                    >
                                      {group.market_title}
                                    </Link>
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 bg-apple-green/10 text-apple-green">
                                      Resolved
                                    </span>
                                  </div>
                                  <div className="text-neutral-600 text-xs mt-0.5">
                                    {group.positions.length} word{group.positions.length !== 1 ? 's' : ''}
                                  </div>
                                </div>
                                <div className="flex items-center gap-4 md:gap-6 shrink-0">
                                  <div className="text-right hidden sm:block">
                                    <div className="text-[10px] text-neutral-600 uppercase tracking-widest">Spent</div>
                                    <div className="text-neutral-400 text-sm tabular-nums">{group.totalSpent.toFixed(0)}</div>
                                  </div>
                                  <div className="text-right hidden sm:block">
                                    <div className="text-[10px] text-neutral-600 uppercase tracking-widest">Received</div>
                                    <div className="text-neutral-400 text-sm tabular-nums">{group.totalReceived.toFixed(0)}</div>
                                  </div>
                                  <div className="text-right">
                                    <div className="text-[10px] text-neutral-600 uppercase tracking-widest">P&L</div>
                                    <div className={`text-sm font-bold tabular-nums ${group.pnl >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                                      {group.pnl >= 0 ? '+' : ''}{group.pnl.toFixed(0)}
                                    </div>
                                  </div>
                                </div>
                              </button>
                              {isExpanded && (
                                <div className="border-t border-white/[0.04]">
                                  <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 px-4 pl-11 py-2 text-[10px] text-neutral-700 uppercase tracking-widest font-medium" style={{ background: 'rgba(255,255,255,0.015)' }}>
                                    <div>Word</div>
                                    <div className="text-right">Spent</div>
                                    <div className="text-right">Received</div>
                                    <div className="text-right">P&L</div>
                                  </div>
                                  {group.positions.map(pos => {
                                    const wordPnl = parseFloat(pos.tokens_received) - parseFloat(pos.tokens_spent)
                                    const yes = parseFloat(pos.yes_shares)
                                    const no = parseFloat(pos.no_shares)
                                    const hasYes = yes >= SHARE_THRESHOLD
                                    const hasNo = no >= SHARE_THRESHOLD
                                    return (
                                      <div
                                        key={pos.id}
                                        className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr] gap-1 md:gap-3 px-4 pl-4 md:pl-11 py-3 border-b border-white/[0.03] last:border-b-0"
                                        style={{ background: 'rgba(255,255,255,0.015)' }}
                                      >
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          {hasYes && (
                                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 bg-apple-green/15 text-apple-green">
                                              YES {yes.toFixed(2)}
                                            </span>
                                          )}
                                          {hasNo && (
                                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 bg-apple-red/15 text-apple-red">
                                              NO {no.toFixed(2)}
                                            </span>
                                          )}
                                          <span className="text-neutral-300 text-sm">{pos.word}</span>
                                        </div>
                                        <div className="flex md:block justify-between md:text-right items-center">
                                          <span className="text-neutral-600 text-xs md:hidden">Spent</span>
                                          <span className="text-neutral-400 text-sm tabular-nums">{parseFloat(pos.tokens_spent).toFixed(2)}</span>
                                        </div>
                                        <div className="flex md:block justify-between md:text-right items-center">
                                          <span className="text-neutral-600 text-xs md:hidden">Received</span>
                                          <span className="text-neutral-400 text-sm tabular-nums">{parseFloat(pos.tokens_received).toFixed(2)}</span>
                                        </div>
                                        <div className="flex md:block justify-between md:text-right items-center">
                                          <span className="text-neutral-600 text-xs md:hidden">P&L</span>
                                          <span className={`text-sm font-bold tabular-nums ${wordPnl >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                                            {wordPnl >= 0 ? '+' : ''}{wordPnl.toFixed(2)}
                                          </span>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}
                        <Pagination page={freeHistoryPg.page} totalPages={freeHistoryPg.totalPages} totalItems={freeHistoryPg.totalItems} onPageChange={freeHistoryPg.setPage} />
                      </div>
                    )}
                  </div>

                  {/* ── Positions Tab ──────────────────────────────── */}
                  <div style={{ display: marketMode === 'paid' && tab === 'positions' ? undefined : 'none' }}>
                      {loadingPositions ? (
                        <MentionedSpinner className="py-20" />
                      ) : positions.length === 0 ? (
                        <div className="flex flex-col items-center py-20 gap-3">
                          <p className="text-neutral-500 text-sm">No open positions</p>
                          <Link href="/polymarkets" className="text-sm font-medium hover:underline" style={{ color: '#F2B71F' }}>
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

                          <div className="mt-1 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.012)' }}>
                            <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_80px] gap-3 px-4 py-2.5 text-[10px] text-neutral-600 uppercase tracking-widest font-medium border-b border-white/[0.06]">
                              <div>Event</div>
                              <div className="text-right">Total Size</div>
                              <div className="text-right">Value</div>
                              <div className="text-right">Avg. Price</div>
                              <div className="text-right">Mark Price</div>
                              <div className="text-right">PNL</div>
                              <div className="text-right">Payout if right</div>
                              <div className="text-right">Est. Settlement</div>
                              <div></div>
                            </div>

                            {posPg.paged.map((pos, i) => {
                              const contracts = Number(pos.contracts || 0)
                              const payoutIfRight = contracts * 1_000_000
                              const isClosing = closingPubkey === pos.pubkey

                              return (
                                <div
                                  key={pos.pubkey}
                                  className="group grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_80px] gap-1 md:gap-3 px-4 py-4 border-b border-white/[0.04] last:border-b-0 transition-colors duration-100 hover:bg-white/[0.05]"
                                  style={{ background: i % 2 === 0 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.01)' }}
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                      pos.isYes ? 'bg-apple-green/15 text-apple-green' : 'bg-apple-red/15 text-apple-red'
                                    }`}>
                                      {pos.isYes ? 'YES' : 'NO'}
                                    </span>
                                    <Link
                                      href={pos.eventId ? `/polymarkets/event/${pos.eventId}` : '#'}
                                      className="text-white text-sm font-semibold truncate hover:underline leading-snug"
                                    >
                                      {pos.marketMetadata?.title || pos.marketId.slice(0, 12) + '...'}
                                    </Link>
                                  </div>

                                  <div className="flex md:block justify-between md:text-right items-center">
                                    <span className="text-neutral-600 text-xs md:hidden">Total Size</span>
                                    <span className="text-neutral-300 text-sm font-medium tabular-nums">{pos.contracts}</span>
                                  </div>

                                  <div className="flex md:block justify-between md:text-right items-center">
                                    <span className="text-neutral-600 text-xs md:hidden">Value</span>
                                    <span className="text-white text-sm font-medium tabular-nums">{microToUsd(pos.sizeUsd)}</span>
                                  </div>

                                  <div className="flex md:block justify-between md:text-right items-center">
                                    <span className="text-neutral-600 text-xs md:hidden">Avg. Price</span>
                                    <span className="text-neutral-400 text-sm tabular-nums">{microToCents(pos.avgPriceUsd)}</span>
                                  </div>

                                  <div className="flex md:block justify-between md:text-right items-center">
                                    <span className="text-neutral-600 text-xs md:hidden">Mark Price</span>
                                    <span className="text-neutral-400 text-sm tabular-nums">{microToCents(pos.markPriceUsd)}</span>
                                  </div>

                                  <div className="flex md:block justify-between md:text-right items-center">
                                    <span className="text-neutral-600 text-xs md:hidden">PNL</span>
                                    <div>
                                      <span className={`text-sm font-bold tabular-nums ${Number(pos.pnlUsd) >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                                        {Number(pos.pnlUsd) >= 0 ? '+' : ''}{microToUsd(pos.pnlUsd)}
                                      </span>
                                      <span className={`block text-[10px] tabular-nums ${Number(pos.pnlUsdPercent) >= 0 ? 'text-apple-green/70' : 'text-apple-red/70'}`}>
                                        {Number(pos.pnlUsdPercent) >= 0 ? '+' : ''}{((Number(pos.pnlUsdPercent) || 0) / 100).toFixed(1)}%
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex md:block justify-between md:text-right items-center">
                                    <span className="text-neutral-600 text-xs md:hidden">Payout</span>
                                    <span className="text-white text-sm font-medium tabular-nums">{microToUsd(payoutIfRight)}</span>
                                  </div>

                                  <div className="flex md:block justify-between md:text-right items-center">
                                    <span className="text-neutral-600 text-xs md:hidden">Settlement</span>
                                    <span className="text-neutral-500 text-sm">
                                      {pos.eventMetadata?.closeTime
                                        ? formatCloseTime(pos.eventMetadata.closeTime)
                                        : '—'}
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
                                        ) : (
                                          'Claim'
                                        )}
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
                                        ) : (
                                          'Close'
                                        )}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                            <Pagination page={posPg.page} totalPages={posPg.totalPages} totalItems={posPg.totalItems} onPageChange={posPg.setPage} />
                          </div>
                        </>
                      )}
                    </div>

                  {/* ── Open Orders Tab ────────────────────────────── */}
                  <div style={{ display: marketMode === 'paid' && tab === 'orders' ? undefined : 'none' }}>
                      {loadingOrders ? (
                        <MentionedSpinner className="py-20" />
                      ) : openOrders.length === 0 ? (
                        <div className="flex flex-col items-center py-20 gap-3">
                          <p className="text-neutral-500 text-sm">No open orders</p>
                          <Link href="/polymarkets" className="text-sm font-medium hover:underline" style={{ color: '#F2B71F' }}>
                            Browse markets
                          </Link>
                        </div>
                      ) : (
                        <div className="mt-1 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.012)' }}>
                          <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2.5 text-[10px] text-neutral-600 uppercase tracking-widest font-medium border-b border-white/[0.06]">
                            <div>Market</div>
                            <div className="text-center">Side</div>
                            <div className="text-right">Contracts</div>
                            <div className="text-right">Max Price</div>
                            <div className="text-right">Size</div>
                            <div className="text-right">Created</div>
                          </div>

                          {ordersPg.paged.map((order, i) => (
                            <div
                              key={order.pubkey}
                              className="group grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-1 md:gap-3 px-4 py-4 border-b border-white/[0.04] last:border-b-0 transition-colors duration-100 hover:bg-white/[0.05]"
                              style={{ background: i % 2 === 0 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.01)' }}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  order.isYes ? 'bg-apple-green/15 text-apple-green' : 'bg-apple-red/15 text-apple-red'
                                }`}>
                                  {order.isYes ? 'YES' : 'NO'}
                                </span>
                                <Link
                                  href={order.eventId ? `/polymarkets/event/${order.eventId}` : '#'}
                                  className="text-white text-sm font-semibold truncate hover:underline leading-snug"
                                >
                                  {order.marketMetadata?.title || order.marketId.slice(0, 12) + '...'}
                                </Link>
                              </div>

                              <div className="flex md:block justify-between md:text-center items-center">
                                <span className="text-neutral-600 text-xs md:hidden">Side</span>
                                <span className={`text-sm font-bold ${order.isBuy ? 'text-apple-green' : 'text-apple-red'}`}>
                                  {order.isBuy ? 'Buy' : 'Sell'}
                                </span>
                              </div>

                              <div className="flex md:block justify-between md:text-right items-center">
                                <span className="text-neutral-600 text-xs md:hidden">Contracts</span>
                                <span className="text-neutral-300 text-sm tabular-nums">{order.contracts}</span>
                              </div>

                              <div className="flex md:block justify-between md:text-right items-center">
                                <span className="text-neutral-600 text-xs md:hidden">Max Price</span>
                                <span className="text-neutral-400 text-sm tabular-nums">{microToUsd(order.maxFillPriceUsd)}</span>
                              </div>

                              <div className="flex md:block justify-between md:text-right items-center">
                                <span className="text-neutral-600 text-xs md:hidden">Size</span>
                                <span className="text-white text-sm font-medium tabular-nums">{microToUsd(order.sizeUsd)}</span>
                              </div>

                              <div className="flex md:block justify-between md:text-right items-center">
                                <span className="text-neutral-600 text-xs md:hidden">Created</span>
                                <span className="text-neutral-500 text-xs">{formatDate(order.createdAt)}</span>
                              </div>
                            </div>
                          ))}
                          <Pagination page={ordersPg.page} totalPages={ordersPg.totalPages} totalItems={ordersPg.totalItems} onPageChange={ordersPg.setPage} />
                        </div>
                      )}
                    </div>

                  {/* ── History Tab ─────────────────────────────────── */}
                  <div style={{ display: marketMode === 'paid' && tab === 'history' ? undefined : 'none' }}>
                      {loadingHistory ? (
                        <MentionedSpinner className="py-20" />
                      ) : history.length === 0 ? (
                        <div className="flex flex-col items-center py-20 gap-3">
                          <p className="text-neutral-500 text-sm">No trade history yet</p>
                          <Link href="/polymarkets" className="text-sm font-medium hover:underline" style={{ color: '#F2B71F' }}>
                            Browse markets
                          </Link>
                        </div>
                      ) : (
                        <div className="mt-1 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.012)' }}>
                          <div className="hidden md:grid grid-cols-[2.5fr_0.8fr_0.8fr_0.8fr_1fr_1fr_0.8fr] gap-3 px-4 py-2.5 text-[10px] text-neutral-600 uppercase tracking-widest font-medium border-b border-white/[0.06]">
                            <div>Event</div>
                            <div className="text-center">Action</div>
                            <div className="text-center">Status</div>
                            <div className="text-right">Price</div>
                            <div className="text-right">Deposit / Withdraw</div>
                            <div className="text-right">PNL</div>
                            <div className="text-right">Fee</div>
                          </div>

                          {historyPg.paged.map((h, i) => {
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

                            const pnl = h.realizedPnl
                              ? microToUsdSigned(h.realizedPnl)
                              : '-'
                            const pnlPositive = h.realizedPnl ? h.realizedPnl > 0 : false

                            const fee = h.feeUsd && h.feeUsd > 0
                              ? microToUsd(h.feeUsd)
                              : '-'

                            return (
                              <div
                                key={h.id}
                                className="group grid grid-cols-1 md:grid-cols-[2.5fr_0.8fr_0.8fr_0.8fr_1fr_1fr_0.8fr] gap-1 md:gap-3 px-4 py-4 border-b border-white/[0.04] last:border-b-0 transition-colors duration-100 hover:bg-white/[0.05]"
                                style={{ background: i % 2 === 0 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.01)' }}
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                                      h.isYes ? 'bg-apple-green/15 text-apple-green' : 'bg-apple-red/15 text-apple-red'
                                    }`}>
                                      {h.isYes ? 'Yes' : 'No'}
                                    </span>
                                    <span className="text-neutral-700 text-[10px]">·</span>
                                    <Link
                                      href={h.eventId ? `/polymarkets/event/${h.eventId}` : '#'}
                                      className="text-white text-sm font-semibold truncate hover:underline leading-snug"
                                    >
                                      {h.marketMetadata?.title || h.marketId?.slice(0, 12) + '...'}
                                    </Link>
                                  </div>
                                  <div className="text-neutral-600 text-[11px]">
                                    {formatDateFull(h.timestamp)}
                                  </div>
                                </div>

                                <div className="flex md:block justify-between md:text-center items-center">
                                  <span className="text-neutral-600 text-xs md:hidden">Action</span>
                                  <span className="text-neutral-300 text-sm font-medium">
                                    {h.isBuy ? 'Buy' : 'Sell'}
                                  </span>
                                </div>

                                <div className="flex md:block justify-between md:text-center items-center">
                                  <span className="text-neutral-600 text-xs md:hidden">Status</span>
                                  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${statusColor}`}>
                                    {statusLabel}
                                  </span>
                                </div>

                                <div className="flex md:block justify-between md:text-right items-center">
                                  <span className="text-neutral-600 text-xs md:hidden">Price</span>
                                  <span className="text-neutral-300 text-sm tabular-nums">{price}</span>
                                </div>

                                <div className="flex md:block justify-between md:text-right items-center">
                                  <span className="text-neutral-600 text-xs md:hidden">Deposit / Withdraw</span>
                                  <span className={`text-sm font-medium tabular-nums ${
                                    depositIsPositive ? 'text-apple-green' : depositWithdraw === '-' ? 'text-neutral-600' : 'text-white'
                                  }`}>
                                    {depositWithdraw}
                                  </span>
                                </div>

                                <div className="flex md:block justify-between md:text-right items-center">
                                  <span className="text-neutral-600 text-xs md:hidden">PNL</span>
                                  <span className={`text-sm font-bold tabular-nums ${
                                    pnl === '-' ? 'text-neutral-600' : pnlPositive ? 'text-apple-green' : 'text-apple-red'
                                  }`}>
                                    {pnl}
                                  </span>
                                </div>

                                <div className="flex md:block justify-between md:text-right items-center">
                                  <span className="text-neutral-600 text-xs md:hidden">Fee</span>
                                  <span className="text-neutral-500 text-sm tabular-nums">{fee}</span>
                                </div>
                              </div>
                            )
                          })}
                          <Pagination page={historyPg.page} totalPages={historyPg.totalPages} totalItems={historyPg.totalItems} onPageChange={historyPg.setPage} />
                        </div>
                      )}
                    </div>
                </>
              )}
            </main>
            <Footer />
          </div>
        </div>
      </div>
    </div>
  )
}
