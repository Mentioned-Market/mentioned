'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { useVisibleInterval } from '@/hooks/useVisibleInterval'
import Image from 'next/image'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import EventChat from '@/components/EventChat'
import EventPriceChart from '@/components/EventPriceChart'
import { useWallet } from '@/contexts/WalletContext'
import { useAchievements } from '@/contexts/AchievementContext'
import { signAndSendTx } from '@/lib/walletUtils'
import MentionedSpinner from '@/components/MentionedSpinner'

// ── Types ──────────────────────────────────────────────────

interface Pricing {
  buyYesPriceUsd: number | null
  buyNoPriceUsd: number | null
  sellYesPriceUsd: number | null
  sellNoPriceUsd: number | null
  volume: number
}

interface MarketMeta {
  title: string
  isTeamMarket: boolean
  rulesPrimary: string
  rulesSecondary: string
  status: string
}

interface Market {
  marketId: string
  status: string
  result: string | null
  openTime: number
  closeTime: number
  metadata: MarketMeta
  pricing: Pricing
}

interface EventMeta {
  title: string
  imageUrl: string
  closeTime: string
  slug: string
}

interface PolyEvent {
  eventId: string
  isActive: boolean
  isLive: boolean
  beginAt: string
  category: string
  subcategory: string
  metadata: EventMeta
  markets: Market[]
  volumeUsd: string
  closeCondition: string
}

interface OrderbookData {
  yes: [number, number][]
  no: [number, number][]
}

interface Position {
  pubkey: string
  marketId: string
  isYes: boolean
  contracts: string
  avgPriceUsd: number
  markPriceUsd: number
  pnlUsd: number
  pnlUsdPercent: number
  totalCostUsd: string
  sizeUsd: string
  sellPriceUsd: number
  marketMetadata?: { title: string }
}

interface Order {
  pubkey: string
  marketId: string
  eventId: string
  status: 'pending' | 'filled' | 'failed'
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
}

// ── Helpers ────────────────────────────────────────────────

const SUBCATEGORY_LABELS: Record<string, string> = {
  lol: 'League of Legends',
  val: 'Valorant',
  cs: 'Counter-Strike',
  dota: 'Dota 2',
  rl: 'Rocket League',
  cod: 'Call of Duty',
}

function microToUsd(micro: number | null): string {
  if (micro === null) return '—'
  return (micro / 1_000_000).toFixed(2)
}

function toEmbedUrl(url: string): string {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost'

  // Twitch channel: https://www.twitch.tv/esl_csgo → embed
  const twitchChannel = url.match(/twitch\.tv\/([^/?]+)/i)
  if (twitchChannel) {
    const channel = twitchChannel[1]
    return `https://player.twitch.tv/?channel=${channel}&parent=${hostname}&muted=true`
  }
  // Twitch VOD: https://www.twitch.tv/videos/123456
  const twitchVod = url.match(/twitch\.tv\/videos\/(\d+)/i)
  if (twitchVod) {
    return `https://player.twitch.tv/?video=v${twitchVod[1]}&parent=${hostname}&muted=true`
  }
  // YouTube: https://www.youtube.com/watch?v=xxx or https://youtu.be/xxx
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?]+)/)
  if (ytMatch) {
    return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&mute=1`
  }
  // YouTube live: https://www.youtube.com/live/xxx
  const ytLive = url.match(/youtube\.com\/live\/([^?&]+)/)
  if (ytLive) {
    return `https://www.youtube.com/embed/${ytLive[1]}?autoplay=1&mute=1`
  }
  // Fallback: use as-is (already an embed URL)
  return url
}

function microToCents(micro: number | null): number {
  if (micro === null) return 0
  return Math.round(micro / 10_000)
}

function formatVolume(volumeUsd: string): string {
  const usd = Number(volumeUsd) / 1_000_000
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`
  return `$${usd.toFixed(0)}`
}

function formatCloseTime(isoTime: string): string {
  const d = new Date(isoTime)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function timeUntil(isoTime: string): string {
  const diff = new Date(isoTime).getTime() - Date.now()
  if (diff <= 0) return 'Closed'
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }
  return `${hours}h ${minutes}m`
}

// ── Orderbook Component ────────────────────────────────────

function OrderbookPanel({ orderbook }: { orderbook: OrderbookData | null }) {
  if (!orderbook) {
    return <MentionedSpinner className="py-8" />
  }

  const yesOrders = orderbook.yes.slice(0, 8)
  const noOrders = orderbook.no.slice(0, 8)
  const maxSize = Math.max(
    ...yesOrders.map(o => o[1]),
    ...noOrders.map(o => o[1]),
    1
  )

  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Yes side */}
      <div>
        <div className="flex items-center justify-between text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-2 px-1">
          <span>Price</span>
          <span>Size</span>
        </div>
        {yesOrders.length === 0 ? (
          <div className="text-neutral-600 text-xs text-center py-4">No orders</div>
        ) : (
          yesOrders.map(([price, size], i) => (
            <div key={i} className="relative flex items-center justify-between py-1 px-1 text-xs">
              <div
                className="absolute inset-0 bg-apple-green/10 rounded-sm"
                style={{ width: `${(size / maxSize) * 100}%` }}
              />
              <span className="relative text-apple-green font-medium">{price}¢</span>
              <span className="relative text-neutral-400">{size}</span>
            </div>
          ))
        )}
      </div>
      {/* No side */}
      <div>
        <div className="flex items-center justify-between text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-2 px-1">
          <span>Price</span>
          <span>Size</span>
        </div>
        {noOrders.length === 0 ? (
          <div className="text-neutral-600 text-xs text-center py-4">No orders</div>
        ) : (
          noOrders.map(([price, size], i) => (
            <div key={i} className="relative flex items-center justify-between py-1 px-1 text-xs">
              <div
                className="absolute inset-0 right-0 bg-apple-red/10 rounded-sm"
                style={{ width: `${(size / maxSize) * 100}%` }}
              />
              <span className="relative text-apple-red font-medium">{price}¢</span>
              <span className="relative text-neutral-400">{size}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────

export default function PolymarketEventPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const eventId = params.eventId as string
  const { connected, connect, publicKey, walletType } = useWallet()
  const { showAchievementToast } = useAchievements()

  // Data state
  const [event, setEvent] = useState<PolyEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Selected market (prefer query param, then first market)
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(
    searchParams.get('market')
  )

  // Trading state
  const [side, setSide] = useState<'yes' | 'no'>('yes')
  const [amount, setAmount] = useState('')
  const [trading, setTrading] = useState(false)
  const [tradingPhase, setTradingPhase] = useState<'creating' | 'signing' | 'confirming' | null>(null)
  const [tradeStatus, setTradeStatus] = useState<{ msg: string; error: boolean } | null>(null)

  // Orderbook
  const [orderbook, setOrderbook] = useState<OrderbookData | null>(null)

  // Positions
  const [positions, setPositions] = useState<Position[]>([])

  // Orders
  const [orders, setOrders] = useState<Order[]>([])

  // Rules expand
  const [rulesExpanded, setRulesExpanded] = useState(false)

  // Mobile trade sheet
  const [mobileTradeOpen, setMobileTradeOpen] = useState(false)

  // Close position
  const [closingPubkey, setClosingPubkey] = useState<string | null>(null)
  const [closeStatus, setCloseStatus] = useState<{ msg: string; error: boolean } | null>(null)

  // Stream embed
  const [streamUrl, setStreamUrl] = useState<string | null>(null)
  const [streamEmbedUrl, setStreamEmbedUrl] = useState<string | null>(null)
  const [streamHidden, setStreamHidden] = useState(false)

  // ── Fetch event ───────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/polymarket/event?eventId=${encodeURIComponent(eventId)}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch event')
        return res.json()
      })
      .then(data => {
        if (cancelled) return
        setEvent(data)
        if (data.markets?.length > 0 && !selectedMarketId) {
          setSelectedMarketId(data.markets[0].marketId)
        }
      })
      .catch(err => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [eventId])

  // ── Fetch stream URL ────────────────────────────────────────

  useEffect(() => {
    fetch(`/api/streams?eventId=${encodeURIComponent(eventId)}`)
      .then(res => res.json())
      .then(data => {
        if (data.streamUrl) {
          setStreamUrl(data.streamUrl)
          setStreamEmbedUrl(toEmbedUrl(data.streamUrl))
        }
      })
      .catch(() => {})
  }, [eventId])

  // ── Fetch orderbook for selected market ───────────────────

  const fetchOrderbook = useCallback(async () => {
    if (!selectedMarketId) return
    try {
      const res = await fetch(`/api/polymarket/orderbook?marketId=${encodeURIComponent(selectedMarketId)}`)
      if (res.ok) {
        const data = await res.json()
        setOrderbook(data)
      }
    } catch { /* ignore */ }
  }, [selectedMarketId])

  useEffect(() => {
    setOrderbook(null)
    fetchOrderbook()
  }, [fetchOrderbook])

  // ── Fetch user positions ──────────────────────────────────

  const fetchPositions = useCallback(async () => {
    if (!publicKey || !event) {
      setPositions([])
      return
    }
    try {
      const res = await fetch(`/api/polymarket/positions?ownerPubkey=${publicKey}`)
      if (res.ok) {
        const json = await res.json()
        const eventMarketIds = new Set((event.markets || []).map(m => m.marketId))
        setPositions(
          (json.data || []).filter((p: Position) => eventMarketIds.has(p.marketId))
        )
      }
    } catch { /* ignore */ }
  }, [publicKey, event])

  // ── Fetch user orders ───────────────────────────────────────

  const fetchOrders = useCallback(async () => {
    if (!publicKey || !event) {
      setOrders([])
      return
    }
    try {
      const res = await fetch(`/api/polymarket/orders/list?ownerPubkey=${publicKey}`)
      if (res.ok) {
        const json = await res.json()
        const eventMarketIds = new Set((event.markets || []).map(m => m.marketId))
        setOrders(
          (json.data || [])
            .filter((o: Order) => eventMarketIds.has(o.marketId))
            .sort((a: Order, b: Order) => b.createdAt - a.createdAt)
        )
      }
    } catch { /* ignore */ }
  }, [publicKey, event])

  // Combined polling — one interval, pauses when tab hidden
  const pollTick = useRef(0)
  useVisibleInterval(() => {
    const tick = pollTick.current++
    // Orderbook: every tick (10s), positions: every 3rd tick (30s), orders: every tick (10s)
    fetchOrderbook()
    fetchOrders()
    if (tick % 3 === 0) fetchPositions()
  }, 10_000)

  // ── Close position ─────────────────────────────────────────

  const handleClosePosition = useCallback(async (pos: Position) => {
    if (!publicKey) return
    setClosingPubkey(pos.pubkey)
    setCloseStatus(null)

    try {
      const res = await fetch('/api/polymarket/positions/close', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionPubkey: pos.pubkey, ownerPubkey: publicKey }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || 'Failed to close position')
      }

      const data = await res.json()
      if (!data.transaction) throw new Error('No transaction returned')

      // Sign & send
      const sig = await signAndSendTx(data.transaction, publicKey, walletType!)

      setCloseStatus({ msg: `Close order submitted! Tx: ${sig.slice(0, 8)}...${sig.slice(-8)}`, error: false })

      // Show achievement toast from close response
      if (data.newAchievements?.length) {
        for (const ach of data.newAchievements) showAchievementToast(ach)
      }

      // Record sell trade for leaderboard (fire-and-forget, but check for achievements)
      fetch('/api/polymarket/trades/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: publicKey,
          marketId: pos.marketId,
          eventId,
          isYes: pos.isYes,
          isBuy: false,
          side: pos.isYes ? 'yes' : 'no',
          amountUsd: pos.sizeUsd,
          txSignature: sig,
          marketTitle: pos.marketMetadata?.title ?? null,
        }),
      }).then(r => r.ok ? r.json() : null).then(data => {
        if (data?.newAchievements?.length) {
          for (const ach of data.newAchievements) showAchievementToast(ach)
        }
      }).catch(() => {})

      setTimeout(() => {
        fetchPositions()
        fetchOrders()
        fetchOrderbook()
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
  }, [publicKey, eventId, fetchPositions, fetchOrders, fetchOrderbook])

  // ── Derived data ──────────────────────────────────────────

  const selectedMarket = useMemo(() => {
    if (!event || !selectedMarketId) return null
    return event.markets.find(m => m.marketId === selectedMarketId) || null
  }, [event, selectedMarketId])

  const yesCents = microToCents(selectedMarket?.pricing.buyYesPriceUsd ?? null)
  const noCents = selectedMarket ? 100 - yesCents : 0

  const amountNum = parseFloat(amount) || 0
  const activePrice = side === 'yes' ? yesCents / 100 : noCents / 100
  const contracts = activePrice > 0 ? amountNum / activePrice : 0
  const potentialPayout = contracts * 1.0
  const potentialProfit = potentialPayout - amountNum

  // ── Trading ───────────────────────────────────────────────

  const handleTrade = async () => {
    if (!publicKey || !selectedMarketId || amountNum <= 0) return

    setTrading(true)
    setTradingPhase('creating')
    setTradeStatus(null)

    try {
      // 1. Request unsigned transaction from Jupiter
      //    depositAmount = USDC to spend (required for buys)
      //    maxBuyPriceUsd = price ceiling in micro USD (set to 99¢ for market buy behavior)
      //    The keeper will fill immediately at best available price up to the ceiling
      const depositMicro = String(Math.round(amountNum * 1_000_000))

      const orderRes = await fetch('/api/polymarket/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isBuy: true,
          ownerPubkey: publicKey,
          marketId: selectedMarketId,
          isYes: side === 'yes',
          depositAmount: depositMicro,
          maxBuyPriceUsd: 990000, // 99¢ ceiling — ensures immediate fill at market
          depositMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        }),
      })

      if (!orderRes.ok) {
        const errData = await orderRes.json().catch(() => ({}))
        throw new Error(errData.error || 'Failed to create order')
      }

      const orderData = await orderRes.json()

      if (!orderData.transaction) {
        throw new Error('No transaction returned from order creation')
      }

      // 2. Sign & send
      setTradingPhase('signing')

      const sig = await signAndSendTx(orderData.transaction, publicKey, walletType!)

      setTradingPhase('confirming')

      setTradeStatus({
        msg: `Order submitted! Tx: ${sig.slice(0, 8)}...${sig.slice(-8)}`,
        error: false,
      })
      setAmount('')

      // Record trade for leaderboard (after tx confirmed, check for achievements)
      fetch('/api/polymarket/trades/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: publicKey,
          marketId: selectedMarketId,
          eventId,
          isYes: side === 'yes',
          isBuy: true,
          side,
          amountUsd: depositMicro,
          txSignature: sig,
          marketTitle: selectedMarket?.metadata.title ?? null,
        }),
      }).then(r => r.ok ? r.json() : null).then(data => {
        if (data?.newAchievements?.length) {
          for (const ach of data.newAchievements) showAchievementToast(ach)
        }
      }).catch(() => {})

      fetchOrderbook()
      // Refresh orders after a short delay so the new order shows up
      setTimeout(fetchOrders, 3000)
    } catch (e: unknown) {
      console.error('Trade failed:', e)
      setTradeStatus({
        msg: e instanceof Error ? e.message : 'Trade failed',
        error: true,
      })
    } finally {
      setTrading(false)
      setTradingPhase(null)
      setTimeout(() => setTradeStatus(null), 10000)
    }
  }

  // ── Trading Panel (shared between desktop & mobile) ───────

  const tradingPanel = (
    <>
      {selectedMarket && (
        <>
          {/* Selected outcome label */}
          <div className="mb-4">
            <span className={`font-semibold text-sm ${side === 'yes' ? 'text-apple-green' : 'text-apple-red'}`}>
              Buy {side === 'yes' ? 'Yes' : 'No'}
            </span>
            <span className="text-neutral-400 text-sm"> · </span>
            <span className="text-white font-semibold text-sm">
              {selectedMarket.metadata.title}
            </span>
          </div>

          {/* Yes / No buttons */}
          <div className="flex gap-2 mb-5">
            <button
              onClick={() => setSide('yes')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                side === 'yes'
                  ? 'bg-apple-green/15 text-apple-green border border-apple-green/40'
                  : 'border border-white/10 text-neutral-400 hover:border-white/20'
              }`}
            >
              Yes {yesCents}¢
            </button>
            <button
              onClick={() => setSide('no')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                side === 'no'
                  ? 'bg-apple-red/15 text-apple-red border border-apple-red/40'
                  : 'border border-white/10 text-neutral-400 hover:border-white/20'
              }`}
            >
              No {noCents}¢
            </button>
          </div>

          {/* Amount input */}
          <div className="mb-5">
            <div className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm text-neutral-400 font-medium">Amount (USDC)</div>
                {amountNum > 0 && (
                  <div className="text-xs text-neutral-500 mt-0.5">
                    ~{contracts.toFixed(1)} contracts
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-neutral-500 text-lg">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="0"
                  className="bg-transparent border-0 text-right text-2xl font-semibold text-white w-24 focus:outline-none focus:ring-0 placeholder:text-neutral-600 p-0"
                />
              </div>
            </div>
          </div>

          {/* Cost breakdown */}
          {amountNum > 0 && (
            <div className="mb-5 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-neutral-400">Avg Price</span>
                <span className="text-white font-medium">{(activePrice * 100).toFixed(0)}¢</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Contracts</span>
                <span className="text-white font-medium">{contracts.toFixed(1)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Payout if correct</span>
                <span className="text-white font-medium">${potentialPayout.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Profit</span>
                <span className="text-apple-green font-semibold">+${potentialProfit.toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* Trade status */}
          {tradeStatus && (
            <div className={`mb-3 p-3 rounded-lg text-xs ${
              tradeStatus.error
                ? 'bg-red-500/10 border border-red-500/30 text-red-300'
                : 'bg-green-500/10 border border-green-500/30 text-green-300'
            }`}>
              {tradeStatus.msg}
            </div>
          )}

          {/* Action button */}
          {connected ? (
            <button
              onClick={handleTrade}
              disabled={!amount || amountNum <= 0 || trading}
              className={`w-full py-3.5 text-white font-semibold text-base rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${
                side === 'yes'
                  ? 'bg-apple-green hover:bg-apple-green/90'
                  : 'bg-apple-red hover:bg-apple-red/90'
              }`}
            >
              {trading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {tradingPhase === 'creating' && 'Creating order...'}
                  {tradingPhase === 'signing' && 'Sign in wallet...'}
                  {tradingPhase === 'confirming' && 'Confirming...'}
                </span>
              ) : (
                `Buy ${side === 'yes' ? 'Yes' : 'No'}`
              )}
            </button>
          ) : (
            <button
              onClick={connect}
              className="w-full py-3.5 bg-white hover:bg-neutral-100 text-black font-semibold text-base rounded-xl transition-all duration-200"
            >
              Login to trade
            </button>
          )}

          {/* Open orders for this event */}
          {connected && orders.length > 0 && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-2">
                Orders ({orders.length})
              </div>
              <div className="space-y-2">
                {orders.map(order => {
                  const statusColor = order.status === 'filled'
                    ? 'text-apple-green'
                    : order.status === 'failed'
                    ? 'text-apple-red'
                    : 'text-yellow-400'
                  const statusIcon = order.status === 'filled'
                    ? '●'
                    : order.status === 'failed'
                    ? '✕'
                    : '◌'
                  return (
                    <div key={order.pubkey} className="glass rounded-lg p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs font-bold ${order.isYes ? 'text-apple-green' : 'text-apple-red'}`}>
                            {order.isYes ? 'YES' : 'NO'}
                          </span>
                          <span className="text-white font-medium text-xs truncate max-w-[120px]">
                            {order.marketMetadata?.title || order.marketId}
                          </span>
                        </div>
                        <span className={`text-[10px] font-semibold ${statusColor} flex items-center gap-1`}>
                          {statusIcon} {order.status}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-neutral-400">
                        <span>{order.contracts} contracts · ${microToUsd(Number(order.sizeUsd))}</span>
                        {order.status === 'filled' && (
                          <span>filled {order.filledContracts} @ {microToUsd(Number(order.avgFillPriceUsd))}¢</span>
                        )}
                        {order.status === 'pending' && (
                          <span className="animate-pulse">matching...</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* User positions for this event */}
          {connected && positions.length > 0 && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-2">
                Positions ({positions.length})
              </div>

              {closeStatus && (
                <div className={`mb-2 p-2.5 rounded-lg text-xs ${
                  closeStatus.error
                    ? 'bg-red-500/10 border border-red-500/30 text-red-300'
                    : 'bg-green-500/10 border border-green-500/30 text-green-300'
                }`}>
                  {closeStatus.msg}
                </div>
              )}

              <div className="space-y-2">
                {positions.map(pos => {
                  const isClosing = closingPubkey === pos.pubkey
                  return (
                    <div key={pos.pubkey} className="glass rounded-lg p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold ${pos.isYes ? 'text-apple-green' : 'text-apple-red'}`}>
                            {pos.isYes ? 'YES' : 'NO'}
                          </span>
                          <span className="text-white font-medium text-xs truncate max-w-[100px]">
                            {pos.marketMetadata?.title || pos.marketId}
                          </span>
                        </div>
                        <span className={`text-xs font-semibold ${pos.pnlUsd >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                          {pos.pnlUsd >= 0 ? '+' : ''}{microToUsd(pos.pnlUsd)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-neutral-400 text-[11px]">{pos.contracts} contracts · {microToUsd(Number(pos.sizeUsd))}</span>
                        <button
                          onClick={() => handleClosePosition(pos)}
                          disabled={isClosing || !!closingPubkey}
                          className="px-2.5 py-1 text-[10px] font-semibold rounded-md border border-apple-red/30 text-apple-red hover:bg-apple-red/10 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {isClosing ? (
                            <span className="flex items-center gap-1">
                              <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Closing
                            </span>
                          ) : 'Close'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </>
  )

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="relative flex min-h-screen w-full flex-col bg-black">
      <div className="flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="flex flex-col w-full max-w-7xl flex-1">
            <Header />

            <main className="py-4 md:py-6 flex-1">
              {/* Loading */}
              {loading && (
                <MentionedSpinner className="py-32" />
              )}

              {/* Error */}
              {error && !loading && (
                <div className="flex flex-col items-center justify-center py-32 gap-3">
                  <span className="text-neutral-400 text-lg font-medium">Failed to load event</span>
                  <span className="text-neutral-500 text-sm">{error}</span>
                  <Link
                    href="/polymarkets"
                    className="mt-4 px-4 py-2 glass rounded-lg text-white text-sm font-medium hover:bg-white/10 transition-colors"
                  >
                    Back to Polymarkets
                  </Link>
                </div>
              )}

              {!loading && !error && event && (
                <>
                  {/* Breadcrumb */}
                  <div className="flex items-center gap-2 text-xs text-neutral-500 mb-4">
                    <Link href="/polymarkets" className="hover:text-white transition-colors">
                      Polymarkets
                    </Link>
                    <span>/</span>
                    <span className="text-neutral-400">{SUBCATEGORY_LABELS[event.subcategory] || event.subcategory}</span>
                  </div>

                  {/* Event Header */}
                  <div className="flex items-start gap-3 md:gap-4 mb-4 md:mb-5">
                    <div className="w-12 h-12 md:w-14 md:h-14 rounded-xl overflow-hidden flex-shrink-0 bg-neutral-800">
                      <Image
                        src={event.metadata.imageUrl}
                        alt={event.metadata.title}
                        width={56}
                        height={56}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs md:text-sm text-neutral-400 font-medium mb-0.5">
                        <span>{SUBCATEGORY_LABELS[event.subcategory] || event.subcategory}</span>
                        {event.isLive && (
                          <span className="px-2 py-0.5 rounded-full bg-apple-red/90 text-white text-[10px] font-bold uppercase tracking-wide">
                            Live
                          </span>
                        )}
                        {event.isActive && !event.isLive && (
                          <span className="px-2 py-0.5 rounded-full bg-apple-green/15 text-apple-green text-[10px] font-semibold uppercase tracking-wide">
                            Open
                          </span>
                        )}
                      </div>
                      <h1 className="text-lg md:text-xl font-semibold text-white leading-tight">
                        {event.metadata.title}
                      </h1>
                    </div>
                  </div>

                  {/* Event meta bar */}
                  <div className="flex items-center gap-4 mb-5 text-xs md:text-sm text-neutral-400">
                    <span>Vol {formatVolume(event.volumeUsd)}</span>
                    <span className="text-neutral-700">·</span>
                    <span>Closes {formatCloseTime(event.metadata.closeTime)}</span>
                    <span className="text-neutral-700">·</span>
                    <span>{timeUntil(event.metadata.closeTime)} left</span>
                  </div>

                  {/* Live Stream */}
                  {streamEmbedUrl && !streamHidden && (
                    <div className="mb-5">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-apple-red animate-pulse" />
                          <span className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">Live Stream</span>
                        </div>
                        <button
                          onClick={() => setStreamHidden(true)}
                          className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
                        >
                          Hide stream
                        </button>
                      </div>
                      <div className="relative w-full rounded-xl overflow-hidden border border-white/5 aspect-video">
                        <iframe
                          src={streamEmbedUrl}
                          className="absolute inset-0 w-full h-full"
                          allowFullScreen
                          allow="autoplay; encrypted-media"
                        />
                      </div>
                    </div>
                  )}

                  {streamEmbedUrl && streamHidden && (
                    <button
                      onClick={() => setStreamHidden(false)}
                      className="flex items-center gap-2 mb-5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                    >
                      <div className="w-2 h-2 rounded-full bg-apple-red animate-pulse" />
                      <span className="text-xs font-medium text-neutral-300">Show live stream</span>
                    </button>
                  )}

                  {/* Price chart */}
                  {loading ? (
                    <div className="mb-5 w-full h-[280px] rounded-2xl bg-white/[0.02] border border-white/5 flex items-center justify-center">
                      <MentionedSpinner className="" />
                    </div>
                  ) : (event.markets?.length ?? 0) > 0 && (
                    <div className="mb-5">
                      <EventPriceChart
                        eventId={eventId}
                        markets={(event.markets || []).map((m: any) => ({
                          marketId: m.marketId,
                          title: m.metadata?.title,
                          currentPrice: (m.pricing?.buyYesPriceUsd ?? 0) / 1_000_000,
                        }))}
                        selectedMarketId={selectedMarketId}
                      />
                    </div>
                  )}

                  {/* Two-column layout */}
                  <div className="flex gap-6">
                    {/* Left Column */}
                    <div className="flex-1 min-w-0">
                      {/* Markets table */}
                      <div className="mb-6">
                        <div className="flex items-center justify-between px-3 md:px-4 py-3 border-b border-white/10">
                          <span className="text-xs md:text-sm text-neutral-400 font-medium w-2/5">Outcome</span>
                          <span className="text-xs md:text-sm text-neutral-400 font-medium text-center flex-1">Chance</span>
                          <span className="text-xs md:text-sm text-neutral-400 font-medium text-right w-[148px] md:w-[240px]">Buy</span>
                        </div>

                        {(event.markets || []).map(m => {
                          const pct = microToCents(m.pricing?.buyYesPriceUsd ?? null)
                          const yesBuy = microToCents(m.pricing?.buyYesPriceUsd ?? null)
                          const noBuy = 100 - yesBuy
                          const isSelected = m.marketId === selectedMarketId

                          return (
                            <button
                              key={m.marketId}
                              onClick={() => setSelectedMarketId(m.marketId)}
                              className={`w-full flex items-center justify-between px-3 md:px-4 py-3 md:py-4 border-b border-white/5 transition-all duration-200 hover:bg-white/[0.03] ${
                                isSelected ? 'bg-white/[0.05]' : ''
                              }`}
                            >
                              <div className="flex items-center gap-2 md:gap-3 w-2/5">
                                <span className="text-white font-semibold text-sm md:text-[15px] truncate">
                                  {m.metadata?.title}
                                </span>
                                {m.result && (
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                    m.result === 'yes' ? 'bg-apple-green/15 text-apple-green' : 'bg-apple-red/15 text-apple-red'
                                  }`}>
                                    {m.result}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5 md:gap-2 flex-1 justify-center">
                                <span className="text-white font-bold text-base md:text-lg">{pct}%</span>
                              </div>

                              <div className="flex items-center gap-1.5 md:gap-2 w-[148px] md:w-[240px] justify-end">
                                {m.status === 'open' ? (
                                  <>
                                    <span
                                      className={`px-3 md:px-5 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-semibold border transition-all duration-200 ${
                                        isSelected && side === 'yes'
                                          ? 'bg-apple-green/15 border-apple-green text-apple-green'
                                          : 'border-white/10 text-apple-green hover:border-apple-green/30'
                                      }`}
                                      onClick={e => {
                                        e.stopPropagation()
                                        setSelectedMarketId(m.marketId)
                                        setSide('yes')
                                      }}
                                    >
                                      Yes {yesBuy}¢
                                    </span>
                                    <span
                                      className={`px-3 md:px-5 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-semibold border transition-all duration-200 ${
                                        isSelected && side === 'no'
                                          ? 'bg-apple-red/15 border-apple-red text-apple-red'
                                          : 'border-white/10 text-apple-red hover:border-apple-red/30'
                                      }`}
                                      onClick={e => {
                                        e.stopPropagation()
                                        setSelectedMarketId(m.marketId)
                                        setSide('no')
                                      }}
                                    >
                                      No {noBuy}¢
                                    </span>
                                  </>
                                ) : (
                                  <span className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/5 text-neutral-500">
                                    {m.status}
                                  </span>
                                )}
                              </div>
                            </button>
                          )
                        })}
                      </div>

                      {/* Orderbook */}
                      {selectedMarket && (
                        <div className="mb-6">
                          <h2 className="text-base font-semibold text-white mb-3">
                            Orderbook — {selectedMarket.metadata.title}
                          </h2>
                          <div className="glass rounded-2xl p-4">
                            <div className="flex items-center gap-4 mb-3">
                              <div className="flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-full bg-apple-green" />
                                <span className="text-xs text-neutral-400 font-medium">Yes</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-full bg-apple-red" />
                                <span className="text-xs text-neutral-400 font-medium">No</span>
                              </div>
                            </div>
                            <OrderbookPanel orderbook={orderbook} />
                          </div>
                        </div>
                      )}

                      {/* Rules */}
                      {selectedMarket && (
                        <div className="mb-8">
                          <h2 className="text-base font-semibold text-white mb-3">Rules</h2>
                          <div className="glass rounded-2xl p-4 md:p-5">
                            <h3 className="text-white font-semibold text-[15px] mb-3">
                              {selectedMarket.metadata.title}
                            </h3>
                            <p className="text-sm text-neutral-300 leading-relaxed mb-3 whitespace-pre-line">
                              {rulesExpanded
                                ? selectedMarket.metadata.rulesPrimary
                                : selectedMarket.metadata.rulesPrimary.split('\n').slice(0, 3).join('\n')
                              }
                            </p>
                            {selectedMarket.metadata.rulesPrimary.split('\n').length > 3 && (
                              <button
                                onClick={() => setRulesExpanded(!rulesExpanded)}
                                className="text-sm text-apple-blue font-semibold hover:opacity-80 transition-opacity"
                              >
                                {rulesExpanded ? 'Hide full rules' : 'View full rules'}
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Close condition */}
                      {event.closeCondition && (
                        <div className="mb-8">
                          <div className="glass rounded-2xl p-4">
                            <div className="text-xs text-neutral-500 font-medium uppercase tracking-wider mb-1">Resolution</div>
                            <p className="text-sm text-neutral-300">{event.closeCondition}</p>
                          </div>
                        </div>
                      )}

                      {/* Spacer for mobile bottom bar */}
                      <div className="h-20 lg:hidden" />
                    </div>

                    {/* Right Column — Chat + Trading Panel (desktop) */}
                    <div className="w-[340px] flex-shrink-0 hidden lg:block">
                      {streamEmbedUrl && !streamHidden && (
                        <div className="h-[320px] mb-4">
                          <EventChat eventId={eventId} marketIds={(event.markets || []).map((m: any) => m.marketId)} />
                        </div>
                      )}
                      <div className="sticky top-24">
                        <div className="glass rounded-2xl p-5">
                          {tradingPanel}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </main>

            {!loading && !error && <Footer />}
          </div>
        </div>
      </div>

      {/* Mobile Trade Bar */}
      {!loading && !error && event && (
        <div className="fixed bottom-0 left-0 right-0 lg:hidden z-40">
          {mobileTradeOpen ? (
            <>
              <div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
                onClick={() => setMobileTradeOpen(false)}
              />
              <div className="relative z-50 bg-neutral-900 border-t border-white/10 rounded-t-2xl p-5 max-h-[80vh] overflow-y-auto animate-slide-up">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-white font-semibold text-base">Trade</span>
                  <button
                    onClick={() => setMobileTradeOpen(false)}
                    className="text-neutral-400 hover:text-white transition-colors p-1"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {tradingPanel}
              </div>
            </>
          ) : (
            <div className="bg-neutral-900/95 backdrop-blur-xl border-t border-white/10 px-4 py-3 flex items-center gap-3">
              {selectedMarket && (
                <>
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-semibold truncate">{selectedMarket.metadata.title}</div>
                    <div className="text-neutral-400 text-xs">
                      Yes {yesCents}¢ · No {noCents}¢
                    </div>
                  </div>
                  <button
                    onClick={() => { setSide('yes'); setMobileTradeOpen(true) }}
                    className="px-4 py-2 bg-apple-green/20 text-apple-green text-sm font-semibold rounded-lg"
                  >
                    Yes {yesCents}¢
                  </button>
                  <button
                    onClick={() => { setSide('no'); setMobileTradeOpen(true) }}
                    className="px-4 py-2 bg-apple-red/20 text-apple-red text-sm font-semibold rounded-lg"
                  >
                    No {noCents}¢
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
