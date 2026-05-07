'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import EventChat from '@/components/EventChat'
import EventPriceChart from '@/components/EventPriceChart'
import FlashValue from '@/components/FlashValue'
import MarketTutorial from '@/components/MarketTutorial'
import { useWallet } from '@/contexts/WalletContext'
import { useAchievements } from '@/contexts/AchievementContext'
import {
  getDisplayStatus,
  getDisplayStatusLabel,
  getDisplayStatusPillClasses,
} from '@/lib/customMarketUtils'
import { virtualBuyCost, virtualSellReturn, sharesForTokens } from '@/lib/virtualLmsr'
import MentionedSpinner from '@/components/MentionedSpinner'
import MarketResultsLeaderboard from '@/components/MarketResultsLeaderboard'
// Points multiplier — matches lib/customScoring.ts constant
const VIRTUAL_MARKET_POINTS_MULTIPLIER = 0.5

// ── Types ──────────────────────────────────────────────

interface CustomMarket {
  id: number
  title: string
  description: string | null
  cover_image_url: string | null
  stream_url: string | null
  status: string
  lock_time: string | null
  b_parameter: number
  play_tokens: number
  market_type: string
  event_start_time: string | null
  created_at: string
}

interface MarketWord {
  id: number
  market_id: number
  word: string
  resolved_outcome: boolean | null
  yes_price: number
  no_price: number
  yes_qty: number
  no_qty: number
}

interface Position {
  word_id: number
  word: string
  yes_shares: number
  no_shares: number
  tokens_spent: number
  tokens_received: number
}

interface Trade {
  id: number
  wallet: string
  username: string | null
  word: string
  action: string
  side: string
  shares: number
  cost: number
  yes_price: number
  created_at: string
}

interface ChartWord {
  word_id: number
  word: string
  history: { t: string; yes: number; no: number }[]
}

interface TraderResult {
  wallet: string
  username: string | null
  pfp_emoji: string | null
  total_spent: number
  total_received: number
  net_tokens: number
  pnl_pct: number | null
  points_earned: number
  words: {
    word_id: number
    word: string
    outcome: 'YES' | 'NO'
    yes_shares: number
    no_shares: number
    tokens_spent: number
    tokens_received: number
    net_tokens: number
  }[]
}

// ── Helpers ────────────────────────────────────────────

function toEmbedUrl(url: string): string {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  const twitchChannel = url.match(/twitch\.tv\/([^/?]+)/i)
  if (twitchChannel) return `https://player.twitch.tv/?channel=${twitchChannel[1]}&parent=${hostname}&muted=true`
  const twitchVod = url.match(/twitch\.tv\/videos\/(\d+)/i)
  if (twitchVod) return `https://player.twitch.tv/?video=v${twitchVod[1]}&parent=${hostname}&muted=true`
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?]+)/)
  if (ytMatch) return `https://www.youtube-nocookie.com/embed/${ytMatch[1]}?autoplay=1&mute=1`
  const ytLive = url.match(/youtube\.com\/live\/([^?&]+)/)
  if (ytLive) return `https://www.youtube-nocookie.com/embed/${ytLive[1]}?autoplay=1&mute=1`
  return url
}

function timeUntil(isoTime: string): string {
  const diff = new Date(isoTime).getTime() - Date.now()
  if (diff <= 0) return 'Locked'
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }
  return `${hours}h ${minutes}m`
}

function formatCloseTime(isoTime: string): string {
  const d = new Date(isoTime)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
}

function formatEventTime(isoTime: string): string {
  const d = new Date(isoTime)
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
}

// ── How It Works Tooltip ───────────────────────────────

function HowItWorks({ onRerunTutorial, upward, compact }: { onRerunTutorial?: () => void; upward?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({})

  useEffect(() => { setMounted(true) }, [])

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      if (upward) {
        const panel = btnRef.current.closest<HTMLElement>('[data-trading-panel]')
        if (panel) {
          const panelRect = panel.getBoundingClientRect()
          setPopupStyle({
            position: 'fixed',
            top: Math.max(8, rect.top + rect.height / 2 - 110),
            right: window.innerWidth - panelRect.left + 10,
            width: 300,
            zIndex: 99999,
          })
        } else {
          // Mobile bottom bar — center popup above the button
          const popupWidth = 300
          const left = Math.max(8, Math.min(rect.left + rect.width / 2 - popupWidth / 2, window.innerWidth - popupWidth - 8))
          setPopupStyle({
            position: 'fixed',
            bottom: window.innerHeight - rect.top + 8,
            left,
            width: popupWidth,
            zIndex: 99999,
          })
        }
      } else {
        setPopupStyle({
          position: 'fixed',
          top: rect.bottom + 8,
          left: rect.left,
          width: 300,
          zIndex: 99999,
        })
      }
    }
    setOpen(v => !v)
  }

  const popupContent = open ? (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 99998 }}
        onClick={() => setOpen(false)}
      />
      <div
        style={{ ...popupStyle, backgroundColor: '#141414' }}
        className="rounded-xl p-4 shadow-2xl border border-white/15 animate-scale-in"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-white">How it works</span>
          <button onClick={() => setOpen(false)} className="text-neutral-500 hover:text-white">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="space-y-3 text-xs text-neutral-400 leading-relaxed">
          <p>You get <span className="text-[#F2B71F] font-semibold">500 free play tokens</span> for each market. No real money involved.</p>
          <p>Pick <span className="text-apple-green font-semibold">YES</span> or <span className="text-apple-red font-semibold">NO</span> on whether a word will be said. Prices shift as more people trade.</p>
          <p>If you&apos;re right, each share pays out <span className="text-white font-semibold">1 token</span>. Wrong shares pay <span className="text-neutral-300 font-semibold">nothing</span>.</p>
          <p>Every token of profit earns <span className="text-apple-blue font-semibold">0.5 platform points</span> toward the weekly leaderboard.</p>
        </div>
        {onRerunTutorial && (
          <button
            onClick={() => { setOpen(false); onRerunTutorial() }}
            className="mt-3 w-full text-center text-[11px] text-[#F2B71F] transition-colors"
          >
            Rerun tutorial
          </button>
        )}
      </div>
    </>
  ) : null

  return (
    <div className={compact ? 'inline-block' : 'mb-3'}>
      <button
        ref={btnRef}
        onClick={handleOpen}
        className={compact
          ? "flex items-center gap-1 px-2 py-1 rounded-lg bg-[#F2B71F]/10 border border-[#F2B71F]/20 text-[11px] text-[#F2B71F] hover:bg-[#F2B71F]/15 transition-colors"
          : "flex items-center gap-1.5 w-full px-3 py-2 rounded-lg bg-[#F2B71F]/10 border border-[#F2B71F]/20 text-xs text-[#F2B71F] hover:bg-[#F2B71F]/15 transition-colors"
        }
      >
        <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-[13px] font-bold leading-none">?</span>
        {!compact && <span className="font-medium">How does this work?</span>}
      </button>
      {mounted && createPortal(popupContent, document.body)}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────

export default function CustomMarketPageContent({ marketId, onLoaded }: { marketId: number; onLoaded?: () => void }) {
  const { connected, connect, publicKey, discordLinked, discordTooNew, profileLoading, refreshProfile } = useWallet()
  const { showAchievementToast } = useAchievements()
  const [contentVisible, setContentVisible] = useState(false)

  const [market, setMarket] = useState<CustomMarket | null>(null)
  const [words, setWords] = useState<MarketWord[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [balance, setBalance] = useState(1000)
  const [startingBalance, setStartingBalance] = useState(1000)
  const [traderCount, setTraderCount] = useState(0)
  const [trades, setTrades] = useState<Trade[]>([])
  const [chartData, setChartData] = useState<ChartWord[]>([])
  const [loading, setLoading] = useState(true)
  const [chartLoading, setChartLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [streamHidden, setStreamHidden] = useState(false)
  const [streamHeight, setStreamHeight] = useState<number>(360)
  const streamPlayerRef = useRef<HTMLDivElement>(null)
  const [marketResults, setMarketResults] = useState<TraderResult[]>([])
  const wordsSectionRef = useRef<HTMLDivElement>(null)

  // Trading state
  const [selectedWordId, setSelectedWordId] = useState<number | null>(null)
  const [hoveredWordId, setHoveredWordId] = useState<number | null>(null)
  const [side, setSide] = useState<'YES' | 'NO'>('YES')
  const [tradeMode, setTradeMode] = useState<'buy' | 'sell'>('buy')
  const [amount, setAmount] = useState('')
  const [trading, setTrading] = useState(false)
  const [tradeStatus, setTradeStatus] = useState<{ msg: string; error: boolean } | null>(null)

  // Mobile trade sheet
  const [mobileTradeOpen, setMobileTradeOpen] = useState(false)
  const [descExpanded, setDescExpanded] = useState(false)

  const DESC_LIMIT = 160

  const [showTutorial, setShowTutorial] = useState(false)
  useEffect(() => {
    const seen = document.cookie.split(';').some(c => c.trim().startsWith('mentioned_free_tutorial_seen='))
    if (!seen) setShowTutorial(true)
  }, [])

  // Listen for discord_callback postMessage from popup
  useEffect(() => {
    if (!connected || !publicKey) return
    const handler = (e: MessageEvent) => {
      let status: string | null = null
      if (e.data?.type === 'discord_callback') {
        status = e.data.status ?? 'error'
      } else if (e.data?.type === 'discord_linked') {
        status = 'linked'
      }
      if (status === 'linked') {
        refreshProfile()
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [connected, publicKey, refreshProfile])

  // Hover card state for recent trades
  interface TradeHoverPosition {
    word_id: number
    word: string
    yes_shares: number
    no_shares: number
    tokens_spent: number
    tokens_received: number
  }
  const [tradeHoveredWallet, setTradeHoveredWallet] = useState<string | null>(null)
  const [tradeHoverPositions, setTradeHoverPositions] = useState<TradeHoverPosition[]>([])
  const [tradeHoverPos, setTradeHoverPos] = useState({ top: 0, left: 0 })
  const [tradeHoverLoading, setTradeHoverLoading] = useState(false)
  const tradeHoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tradePositionCache = useRef<Map<string, TradeHoverPosition[]>>(new Map())

  const fetchTradeHoverPositions = useCallback(async (wallet: string) => {
    setTradeHoverLoading(true)
    if (tradePositionCache.current.has(wallet)) {
      setTradeHoverPositions(tradePositionCache.current.get(wallet)!)
      setTradeHoverLoading(false)
      return
    }
    try {
      const res = await fetch(`/api/custom/${marketId}/positions?wallet=${wallet}`)
      if (!res.ok) { setTradeHoverPositions([]); return }
      const json = await res.json()
      const positions: TradeHoverPosition[] = (json.positions || []).filter(
        (p: TradeHoverPosition) => p.yes_shares >= 0.01 || p.no_shares >= 0.01
      )
      tradePositionCache.current.set(wallet, positions)
      if (tradePositionCache.current.size > 200) tradePositionCache.current.clear()
      setTradeHoverPositions(positions)
    } catch {
      setTradeHoverPositions([])
    } finally {
      setTradeHoverLoading(false)
    }
  }, [marketId])

  const handleTradeMouseEnter = useCallback((wallet: string, e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    setTradeHoverPos({ top: rect.bottom + 4, left: rect.left })
    if (tradeHoverTimeout.current) clearTimeout(tradeHoverTimeout.current)
    tradeHoverTimeout.current = setTimeout(() => {
      setTradeHoveredWallet(wallet)
      fetchTradeHoverPositions(wallet)
    }, 300)
  }, [fetchTradeHoverPositions])

  const handleTradeMouseLeave = useCallback(() => {
    if (tradeHoverTimeout.current) clearTimeout(tradeHoverTimeout.current)
    tradeHoverTimeout.current = setTimeout(() => {
      setTradeHoveredWallet(null)
      setTradeHoverPositions([])
    }, 200)
  }, [])

  // ── Fetch data ──────────────────────────────────────

  const fetchMarket = useCallback(async () => {
    try {
      const res = await fetch(`/api/custom/${marketId}`)
      if (!res.ok) throw new Error('Market not found')
      const data = await res.json()
      setMarket(data.market)
      setWords(data.words)
      setTraderCount(data.traderCount)
      if (data.words.length > 0 && selectedWordId === null) {
        const firstUnresolved = data.words.find((w: MarketWord) => w.resolved_outcome === null)
        setSelectedWordId(firstUnresolved ? firstUnresolved.id : data.words[0].id)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [marketId])

  const fetchPositions = useCallback(async () => {
    if (!publicKey) return
    try {
      const res = await fetch(`/api/custom/${marketId}/positions?wallet=${publicKey}`)
      const data = await res.json()
      setPositions(data.positions || [])
      setBalance(data.balance)
      setStartingBalance(data.starting_balance)
    } catch { /* ignore */ }
  }, [marketId, publicKey])

  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch(`/api/custom/${marketId}/sentiment`)
      const data = await res.json()
      if (data.words) {
        setWords(prev => prev.map(w => {
          const updated = data.words.find((d: any) => d.word_id === w.id)
          if (!updated) return w
          return {
            ...w,
            yes_price: updated.yes_price,
            no_price: updated.no_price,
            yes_qty: updated.yes_qty,
            no_qty: updated.no_qty,
            ...(updated.resolved_outcome !== undefined ? { resolved_outcome: updated.resolved_outcome } : {}),
          }
        }))
      }
    } catch { /* ignore */ }
  }, [marketId])

  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch(`/api/custom/${marketId}/trades?limit=20`)
      const data = await res.json()
      setTrades(data.trades || [])
    } catch { /* ignore */ }
  }, [marketId])

  const fetchChart = useCallback(async () => {
    try {
      const res = await fetch(`/api/custom/${marketId}/chart`)
      const data = await res.json()
      setChartData(data.words || [])
    } catch { /* ignore */ } finally {
      setChartLoading(false)
    }
  }, [marketId])

  useEffect(() => { fetchMarket() }, [fetchMarket])
  useEffect(() => { fetchPositions() }, [fetchPositions])
  useEffect(() => { fetchTrades() }, [fetchTrades])
  useEffect(() => { fetchChart() }, [fetchChart])

  // Fetch results leaderboard when market is resolved
  useEffect(() => {
    if (market?.status !== 'resolved') return
    fetch(`/api/custom/${marketId}/results`)
      .then(r => r.json())
      .then(data => { if (data.leaderboard) setMarketResults(data.leaderboard) })
      .catch(() => { /* ignore */ })
  }, [marketId, market?.status])

  // Poll when market is open
  useEffect(() => {
    if (!market || market.status !== 'open') return
    const interval = setInterval(() => {
      fetchPrices()
      fetchPositions()
      fetchTrades()
    }, 10000)
    return () => clearInterval(interval)
  }, [market?.status, fetchPrices, fetchPositions, fetchTrades])

  // If selected word gets resolved, auto-select first unresolved word
  useEffect(() => {
    const sel = words.find(w => w.id === selectedWordId)
    if (sel && sel.resolved_outcome !== null) {
      const firstUnresolved = words.find(w => w.resolved_outcome === null)
      if (firstUnresolved) setSelectedWordId(firstUnresolved.id)
    }
  }, [words, selectedWordId])

  // ── Derived data ────────────────────────────────────

  const isOpen = market?.status === 'open'
  const lockTimePassed = market?.lock_time ? new Date(market.lock_time) <= new Date() : false
  const b = market?.b_parameter ?? 500
  const selectedWord = words.find(w => w.id === selectedWordId) || words[0]
  const positionMap = new Map(positions.map(p => [p.word_id, p]))
  const selectedPosition = selectedWord ? positionMap.get(selectedWord.id) : undefined
  const streamEmbedUrl = market?.stream_url ? toEmbedUrl(market.stream_url) : null

  // Keep chat height in sync with stream player height
  useEffect(() => {
    const el = streamPlayerRef.current
    if (!el || !streamEmbedUrl || streamHidden) return
    const obs = new ResizeObserver(([entry]) => {
      setStreamHeight(entry.contentRect.height)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [streamEmbedUrl, streamHidden])

  const yesCents = selectedWord ? Math.round(selectedWord.yes_price * 100) : 50
  const noCents = selectedWord ? 100 - yesCents : 50

  const amountNum = parseFloat(amount) || 0

  // Compute trade preview
  const preview = useMemo(() => {
    if (!selectedWord || amountNum <= 0) return null
    if (tradeMode === 'buy') {
      const shares = sharesForTokens(selectedWord.yes_qty, selectedWord.no_qty, side, amountNum, b)
      const cost = virtualBuyCost(selectedWord.yes_qty, selectedWord.no_qty, side, shares, b)
      const payout = shares
      const profit = payout - cost
      return { shares, cost: Math.min(cost, amountNum), payout, profit }
    } else {
      const cost = virtualSellReturn(selectedWord.yes_qty, selectedWord.no_qty, side, amountNum, b)
      return { shares: amountNum, cost, payout: 0, profit: 0 }
    }
  }, [selectedWord, amountNum, tradeMode, side, b])

  // Chart series for EventPriceChart (uses { t: epoch_seconds, p: price } format)
  const chartSeriesForChart = useMemo(() => {
    return chartData.map((cw) => {
      const word = words.find(w => w.id === cw.word_id)
      const currentPrice = word?.yes_price ?? 0.5
      const data = cw.history.length > 0
        ? cw.history.map(h => ({ t: Math.floor(new Date(h.t).getTime() / 1000), p: h.yes }))
        : [{ t: Math.floor((Date.now() - 3600000) / 1000), p: 0.5 }]

      // Extend to now with current price if market is active
      if (market?.status !== 'resolved') {
        data.push({ t: Math.floor(Date.now() / 1000), p: currentPrice })
      }

      return {
        marketId: String(cw.word_id),
        title: cw.word,
        currentPrice,
        data,
      }
    })
  }, [chartData, words, market?.status])

  // Markets list for EventPriceChart props
  const chartMarkets = useMemo(() => {
    return words.map(w => ({
      marketId: String(w.id),
      title: w.word,
      currentPrice: w.yes_price,
    }))
  }, [words])

  // Total profit for resolved markets (final, based on actual payouts)
  const totalProfit = useMemo(() => {
    if (market?.status !== 'resolved' || positions.length === 0) return 0
    const totalSpent = positions.reduce((s, p) => s + p.tokens_spent, 0)
    const totalReceived = positions.reduce((s, p) => s + p.tokens_received, 0)
    return totalReceived - totalSpent
  }, [market?.status, positions])

  // Current unrealised profit (for active/locked markets — values shares at current price)
  const currentProfit = useMemo(() => {
    if (positions.length === 0) return { spent: 0, received: 0, unrealised: 0, total: 0 }
    const wordMap = new Map(words.map(w => [w.id, w]))
    let totalSpent = 0
    let totalReceived = 0
    let unrealisedValue = 0

    for (const pos of positions) {
      totalSpent += pos.tokens_spent
      totalReceived += pos.tokens_received
      const word = wordMap.get(pos.word_id)
      if (word) {
        // Value shares at current implied price (what they'd be worth if sold now via LMSR)
        if (pos.yes_shares > 0) {
          unrealisedValue += virtualSellReturn(word.yes_qty, word.no_qty, 'YES', pos.yes_shares, b)
        }
        if (pos.no_shares > 0) {
          unrealisedValue += virtualSellReturn(word.yes_qty, word.no_qty, 'NO', pos.no_shares, b)
        }
      }
    }

    const total = totalReceived + unrealisedValue - totalSpent
    return { spent: totalSpent, received: totalReceived, unrealised: unrealisedValue, total }
  }, [positions, words, b])

  // Shares held for the currently-selected side (used by slider in sell mode).
  // Treat anything below 0.01 as zero — dust left behind by 2dp truncation shouldn't
  // be presented as a tradeable position.
  const rawSharesForSide = selectedPosition
    ? (side === 'YES' ? selectedPosition.yes_shares : selectedPosition.no_shares)
    : 0
  const sharesForSelectedSide = rawSharesForSide >= 0.01 ? rawSharesForSide : 0
  const sliderMax = tradeMode === 'buy' ? balance : sharesForSelectedSide
  const sliderValue = sliderMax > 0 ? Math.min(100, (amountNum / sliderMax) * 100) : 0

  // ── Handlers ────────────────────────────────────────

  const handleWordClick = (wordId: number) => {
    // Don't select resolved words for trading
    const word = words.find(w => w.id === wordId)
    if (word?.resolved_outcome !== null) return
    setSelectedWordId(wordId)
    setAmount('')
  }

  const handleSliderChange = (pct: number) => {
    if (tradeMode === 'buy') {
      // Always floor — balance is displayed as Math.floor(balance) and sell returns are fractional,
      // so the raw balance can have decimals the user never sees. Floor keeps the input clean.
      setAmount(String(Math.floor((pct / 100) * sliderMax)))
    } else {
      // Truncate (floor) to 2dp — toFixed(2) rounds, which can produce a value higher than
      // shares actually held, causing the API to reject with "Insufficient shares".
      const raw = (pct / 100) * sliderMax
      const truncated = Math.floor(raw * 100) / 100
      setAmount(truncated.toFixed(2))
    }
  }

  const handlePositionClick = (pos: Position) => {
    setSelectedWordId(pos.word_id)
    setTradeMode('sell')
    setSide(pos.yes_shares > 0 ? 'YES' : 'NO')
    setAmount('')
  }

  const handleTrade = async () => {
    if (!publicKey || !market || !selectedWord) return
    if (selectedWord.resolved_outcome !== null) return
    if (amountNum <= 0) return
    if (tradeMode === 'buy' && amountNum < 1) return
    if (discordLinked !== true) return
    if (discordTooNew) return

    setTrading(true)
    setTradeStatus(null)

    try {
      const res = await fetch(`/api/custom/${marketId}/trade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: publicKey,
          word_id: selectedWord.id,
          action: tradeMode,
          side,
          amount: amountNum,
          amount_type: tradeMode === 'buy' ? 'tokens' : 'shares',
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error)
      }

      const result = await res.json()
      setBalance(result.new_balance)
      setAmount('')
      setTradeStatus({
        msg: `${tradeMode === 'buy' ? 'Bought' : 'Sold'} ${result.shares.toFixed(1)} ${side} shares of "${selectedWord.word}"`,
        error: false,
      })

      // Achievement toasts
      if (result.newAchievements?.length) {
        for (const ach of result.newAchievements) showAchievementToast(ach)
      }

      // Refresh everything
      fetchPrices()
      fetchPositions()
      fetchTrades()
      fetchChart()
    } catch (err: any) {
      setTradeStatus({ msg: err.message || 'Trade failed', error: true })
    } finally {
      setTrading(false)
      setTimeout(() => setTradeStatus(null), 8000)
    }
  }

  // ── Trading Panel (shared between desktop & mobile) ────

  const showBuyPreview = !!(preview && amountNum > 0 && tradeMode === 'buy')
  const showSellPreview = !!(preview && amountNum > 0 && tradeMode === 'sell')

  const tradingPanel = selectedWord ? (
    <>
      {/* Header: word image + name */}
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-white/10">
        <div className="w-9 h-9 rounded-full overflow-hidden bg-neutral-800 flex-shrink-0">
          {market?.cover_image_url ? (
            <img src={market.cover_image_url} alt={selectedWord.word} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-base">🎯</div>
          )}
        </div>
        <span className="text-white font-semibold text-base">{selectedWord.word}</span>
      </div>

      {/* Buy / Sell tabs */}
      <div className="flex items-center gap-5 mb-5">
        <button
          onClick={() => { setTradeMode('buy'); setAmount('') }}
          className={`text-base font-semibold pb-1 border-b-2 transition-all duration-200 ${
            tradeMode === 'buy' ? 'text-white border-white' : 'text-neutral-500 border-transparent hover:text-neutral-300'
          }`}
        >Buy</button>
        <button
          onClick={() => { setTradeMode('sell'); setAmount('') }}
          className={`text-base font-semibold pb-1 border-b-2 transition-all duration-200 ${
            tradeMode === 'sell' ? 'text-white border-white' : 'text-neutral-500 border-transparent hover:text-neutral-300'
          }`}
        >Sell</button>
      </div>

      {/* Yes / No buttons */}
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => { setSide('YES'); setAmount('') }}
          className={`flex-1 py-3.5 rounded-xl text-base font-bold transition-all duration-200 ${
            side === 'YES'
              ? 'bg-apple-green text-white'
              : 'bg-white/5 text-neutral-400 hover:bg-white/10'
          }`}
        >
          Yes <FlashValue value={`${yesCents}¢`} />
        </button>
        <button
          onClick={() => { setSide('NO'); setAmount('') }}
          className={`flex-1 py-3.5 rounded-xl text-base font-bold transition-all duration-200 ${
            side === 'NO'
              ? 'bg-apple-red text-white'
              : 'bg-white/5 text-neutral-400 hover:bg-white/10'
          }`}
        >
          No <FlashValue value={`${noCents}¢`} />
        </button>
      </div>

      {/* Amount section */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-neutral-400 font-medium">
              {tradeMode === 'buy' ? 'Tokens to spend' : 'Shares to sell'}
            </span>
            <HowItWorks compact upward onRerunTutorial={() => {
              document.cookie = 'mentioned_free_tutorial_seen=; Max-Age=0; path=/'
              setShowTutorial(true)
            }} />
          </div>
          {connected && (
            <div className="text-right">
              {tradeMode === 'buy' ? (
                <>
                  <span className={`text-xs font-medium transition-colors ${preview && amountNum > 0 ? 'text-apple-red' : 'text-neutral-400'}`}>
                    {preview && amountNum > 0
                      ? `${Math.floor(balance - preview.cost)} tokens`
                      : `${Math.floor(balance)} tokens`}
                  </span>
                  <span className="block text-[10px] text-neutral-600">
                    {preview && amountNum > 0 ? `spending ${Math.ceil(preview.cost)} on this market` : 'left to spend on this market'}
                  </span>
                </>
              ) : (
                <>
                  <span className={`text-xs font-medium transition-colors ${preview && amountNum > 0 ? 'text-apple-green' : 'text-neutral-400'}`}>
                    {preview && amountNum > 0
                      ? `+${preview.cost.toFixed(1)} tokens`
                      : 'sell to receive tokens'}
                  </span>
                  {preview && amountNum > 0 && (
                    <span className="block text-[10px] text-neutral-600">plus points on profit</span>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          placeholder="0"
          className="bg-transparent border-0 text-right text-4xl font-bold text-white w-full focus:outline-none focus:ring-0 placeholder:text-neutral-700 p-0 mb-4"
        />

        {/* Preset buttons */}
        {(tradeMode === 'buy' || sharesForSelectedSide > 0) && (
          <div className="flex gap-2">
            {[25, 50, 75, 100].map(pct => (
              <button
                key={pct}
                onClick={() => handleSliderChange(pct)}
                className="flex-1 py-1.5 text-xs font-semibold rounded-full bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition-colors border border-white/10"
              >
                {pct === 100 ? 'Max' : `${pct}%`}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Animated buy preview — slides down when active */}
      <div
        style={{
          maxHeight: showBuyPreview ? '160px' : '0px',
          opacity: showBuyPreview ? 1 : 0,
          transform: showBuyPreview ? 'translateY(0)' : 'translateY(-10px)',
          overflow: 'hidden',
          transition: 'max-height 0.3s ease-out, opacity 0.25s ease-out, transform 0.25s ease-out',
          marginBottom: showBuyPreview ? '16px' : '0px',
        }}
      >
        <div className="border-t border-white/10 pt-4">
          <div className="flex items-end justify-between mb-1.5">
            <span className="text-sm text-neutral-400">To win 🎯</span>
            <span className={`text-3xl font-bold ${preview && preview.profit > 0 ? 'text-apple-green' : 'text-neutral-400'}`}>
              +{preview?.profit.toFixed(1)}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span>Avg. Price {preview && preview.shares > 0 ? Math.round((preview.cost / preview.shares) * 100) : 0}¢</span>
            <span className="text-apple-blue">+{Math.floor((preview?.profit ?? 0) * VIRTUAL_MARKET_POINTS_MULTIPLIER)} pts</span>
          </div>
        </div>
      </div>

      {/* Animated sell preview */}
      <div
        style={{
          maxHeight: showSellPreview ? '80px' : '0px',
          opacity: showSellPreview ? 1 : 0,
          transform: showSellPreview ? 'translateY(0)' : 'translateY(-10px)',
          overflow: 'hidden',
          transition: 'max-height 0.3s ease-out, opacity 0.25s ease-out, transform 0.25s ease-out',
          marginBottom: showSellPreview ? '16px' : '0px',
        }}
      >
        <div className="border-t border-white/10 pt-4">
          <div className="flex items-end justify-between">
            <span className="text-sm text-neutral-400">Tokens returned</span>
            <span className="text-2xl font-bold text-white">{preview?.cost.toFixed(1)}</span>
          </div>
        </div>
      </div>

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
      {!isOpen ? (
        <button disabled className="w-full py-4 bg-white/10 text-neutral-400 font-bold text-base rounded-2xl cursor-not-allowed">
          {market ? (() => {
            const ds = getDisplayStatus(market)
            return ds === 'closed'             ? 'Market Closed'
              :    ds === 'resolved'           ? 'Market Resolved'
              :    ds === 'pending_resolution' ? 'Pending Resolution'
              :    ds === 'cancelled'          ? 'Market Cancelled'
              :                                  'Market Closed'
          })() : 'Market Closed'}
        </button>
      ) : connected && discordLinked === true && discordTooNew ? (
        <div className="p-3 rounded-lg bg-neutral-800/60 border border-neutral-700/50 text-neutral-300 text-xs">
          <p className="font-medium mb-1 text-neutral-200">Account currently under review</p>
          <p className="text-neutral-400">Trading capabilities paused. Contact the devs in Discord if you think this is a mistake.</p>
        </div>
      ) : connected && discordLinked === false ? (
        <div className="space-y-2">
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs">
            <p className="font-medium mb-1">Discord required to trade</p>
            <p className="text-amber-300/70">Link your Discord account to start trading on free markets. This helps us prevent abuse and reward real players.</p>
          </div>
          <button
            onClick={() => window.open(`/api/discord/link?wallet=${publicKey}`, '_blank', 'width=500,height=700')}
            className="flex items-center justify-center gap-2 w-full py-4 bg-[#5865F2] hover:bg-[#4752C4] text-white font-bold text-base rounded-2xl transition-all duration-200"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.030z"/></svg>
            Link Discord to trade
          </button>
        </div>
      ) : connected ? (
        <button
          onClick={handleTrade}
          disabled={!amount || amountNum <= 0 || (tradeMode === 'buy' && amountNum < 1) || trading}
          className={`w-full py-4 font-bold text-base rounded-2xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${
            side === 'YES'
              ? 'bg-apple-green hover:bg-apple-green/90 text-white'
              : 'bg-apple-red hover:bg-apple-red/90 text-white'
          }`}
        >
          {trading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Processing...
            </span>
          ) : (
            `${tradeMode === 'buy' ? 'Buy' : 'Sell'} ${side === 'YES' ? 'Yes' : 'No'}`
          )}
        </button>
      ) : (
        <button
          onClick={connect}
          className="w-full py-4 bg-white hover:bg-neutral-100 text-black font-bold text-base rounded-2xl transition-all duration-200"
        >
          Login to trade
        </button>
      )}

      {/* User positions for this market */}
      {connected && isOpen && !lockTimePassed && positions.filter(p => p.yes_shares >= 1 || p.no_shares >= 1).length > 0 && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-2 cursor-help" title="Your open positions in this market. Click a position to switch to sell mode and close it.">
            Positions ({positions.filter(p => p.yes_shares >= 1 || p.no_shares >= 1).length})
          </div>
          <div className="space-y-2">
            {positions.map(pos => {
              const pnl = pos.tokens_received - pos.tokens_spent
              // Require at least 1 share — anything less is unsellable dust from rounding
              const hasShares = pos.yes_shares >= 1 || pos.no_shares >= 1
              if (!hasShares) return null
              const posWord = words.find(w => w.id === pos.word_id)
              const wordResolved = posWord ? posWord.resolved_outcome !== null : false
              const isClickable = isOpen && hasShares && !wordResolved
              return (
                <div
                  key={pos.word_id}
                  onClick={isClickable ? () => handlePositionClick(pos) : undefined}
                  className={`glass rounded-lg p-2.5 transition-colors ${isClickable ? 'cursor-pointer hover:bg-white/5' : ''}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-white font-medium text-xs truncate max-w-[140px]">{pos.word}</span>
                    {market?.status === 'resolved' || wordResolved ? (
                      <span className={`text-xs font-semibold ${pnl >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                        {pnl >= 0 ? '+' : ''}{pnl.toFixed(1)}
                      </span>
                    ) : isClickable && (
                      <span className="text-[10px] text-neutral-600">sell →</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-neutral-400">
                    <span>
                      {pos.yes_shares >= 1 && <span className="text-apple-green">{pos.yes_shares.toFixed(1)} YES</span>}
                      {pos.yes_shares >= 1 && pos.no_shares >= 1 && ' · '}
                      {pos.no_shares >= 1 && <span className="text-apple-red">{pos.no_shares.toFixed(1)} NO</span>}
                    </span>
                    <span>spent {pos.tokens_spent.toFixed(1)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  ) : null

  // ── Render ──────────────────────────────────────────

  // Tell the parent overlay to fade out, then fade in our content
  useEffect(() => {
    if (!loading && market) {
      onLoaded?.()
      requestAnimationFrame(() => setContentVisible(true))
    }
  }, [loading, market, onLoaded])

  // Return nothing while loading — parent overlay covers the page
  if (loading || !market) {
    if (error) { /* fall through to error render below */ } else return null
  }

  if (error || !market) {
    return (
      <div className="relative flex min-h-screen w-full flex-col bg-black">
        <div className="flex h-full grow flex-col">
          <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
            <div className="flex flex-col w-full max-w-7xl flex-1">
              <Header />
              <div className="flex flex-col items-center justify-center py-32 gap-3">
                <span className="text-neutral-400 text-lg font-medium">{error || 'Market not found'}</span>
                <Link href="/markets" className="mt-4 px-4 py-2 glass rounded-lg text-white text-sm font-medium hover:bg-white/10 transition-colors">
                  Back to Markets
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="relative flex min-h-screen w-full flex-col bg-black"
      style={{ opacity: contentVisible ? 1 : 0, transition: 'opacity 0.45s ease' }}
    >
      <div className="flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="flex flex-col w-full max-w-7xl flex-1">
            <Header />

            <main className="py-4 md:py-6 flex-1">
              {/* Breadcrumb */}
              <div className="flex items-center gap-2 text-xs text-neutral-500 mb-4">
                <Link href="/markets" className="hover:text-white transition-colors">Markets</Link>
                <span>/</span>
                <span className="text-neutral-400">Free Market</span>
              </div>

              {/* Event Header */}
              <div className="flex items-start gap-3 md:gap-4 mb-4 md:mb-5">
                <div className="w-12 h-12 md:w-14 md:h-14 rounded-xl overflow-hidden flex-shrink-0 bg-neutral-800">
                  {market.cover_image_url ? (
                    <img src={market.cover_image_url} alt={market.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl">🎯</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <h1 className="text-lg md:text-xl font-semibold text-white leading-tight flex-1 min-w-0">
                      {market.title}
                    </h1>
                  </div>
                </div>
              </div>

              {/* Meta bar */}
              <div className="flex items-center gap-4 mb-5 text-xs md:text-sm text-neutral-400">
                <span>{traderCount} trader{traderCount !== 1 ? 's' : ''}</span>
                <span className="text-neutral-700">·</span>
                <span>{words.length} words</span>
                <span className="text-neutral-700">·</span>
                {(() => {
                  const ds = getDisplayStatus(market)
                  return (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase whitespace-nowrap ${getDisplayStatusPillClasses(ds)}`}>
                      {getDisplayStatusLabel(ds)}
                    </span>
                  )
                })()}
                {market.market_type === 'event' && market.event_start_time && (
                  <>
                    <span className="text-neutral-700">·</span>
                    <span>Event: {formatEventTime(market.event_start_time)}</span>
                  </>
                )}
                {market.lock_time && isOpen && !lockTimePassed && (
                  <>
                    <span className="text-neutral-700">·</span>
                    <span>Locks {formatCloseTime(market.lock_time)}</span>
                    <span className="text-neutral-700">·</span>
                    <span>{timeUntil(market.lock_time)} left</span>
                  </>
                )}
              </div>

              {/* Resolved summary */}
              {market.status === 'resolved' && positions.length > 0 && (
                <div className={`glass rounded-2xl p-4 mb-5 border ${totalProfit > 0 ? 'border-apple-green/20' : 'border-white/5'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-neutral-400">Your Result</span>
                    <div className="text-right">
                      <div className={`text-lg font-bold ${totalProfit > 0 ? 'text-apple-green' : totalProfit < 0 ? 'text-apple-red' : 'text-neutral-400'}`}>
                        {totalProfit > 0 ? '+' : ''}{totalProfit.toFixed(1)} tokens
                      </div>
                      {totalProfit > 0 && (
                        <div className="text-xs text-neutral-500">
                          = {Math.floor(totalProfit * VIRTUAL_MARKET_POINTS_MULTIPLIER)} platform points
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Stream label row — above both columns so stream + chat start at same point */}
              {streamEmbedUrl && !streamHidden && (
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <div className="w-2 h-2 rounded-full bg-apple-red animate-pulse flex-shrink-0" />
                  <span className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex-shrink-0">Live Stream</span>
                  <button onClick={() => setStreamHidden(true)} className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors flex-shrink-0">
                    Hide stream
                  </button>
                  {words.length > 0 && (
                    <>
                      <span className="text-neutral-700 text-xs flex-shrink-0">|</span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {words.map(word => (
                          <button
                            key={word.id}
                            onClick={() => {
                              setSelectedWordId(word.id)
                              wordsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                            }}
                            className={`px-2 py-0.5 rounded-md border text-xs transition-colors ${
                              word.resolved_outcome !== null
                                ? 'bg-white/[0.03] border-white/5 text-neutral-600 line-through hover:text-neutral-400'
                                : 'bg-white/5 hover:bg-white/10 border-white/10 text-neutral-300 hover:text-white'
                            }`}
                          >
                            {word.word}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
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

              {/* Two-column layout */}
              <div className="flex gap-6">
                {/* Left Column */}
                <div className="flex-1 min-w-0">

                  {/* Stream embed */}
                  {streamEmbedUrl && !streamHidden && (
                    <div className="mb-5">
                      <div ref={streamPlayerRef} className="relative w-full rounded-xl overflow-hidden border border-white/5 aspect-video">
                        <iframe src={streamEmbedUrl} className="absolute inset-0 w-full h-full" allowFullScreen allow="autoplay; encrypted-media" />
                      </div>
                    </div>
                  )}

                  {/* Price chart — matches polymarket event chart with legend + timeframes */}
                  {loading || chartLoading ? (
                    <div className="mb-5 w-full h-[280px] rounded-2xl bg-white/[0.02] border border-white/5 flex items-center justify-center">
                      <MentionedSpinner className="" />
                    </div>
                  ) : chartMarkets.length > 0 && (
                    <div className="mb-5">
                      <EventPriceChart
                        eventId={`custom_${marketId}`}
                        markets={chartMarkets}
                        selectedMarketId={selectedWordId ? String(selectedWordId) : null}
                        hoveredMarketId={hoveredWordId ? String(hoveredWordId) : null}
                        preloadedSeries={chartSeriesForChart.length > 0 ? chartSeriesForChart : undefined}
                      />
                    </div>
                  )}

                  {/* Words table */}
                  <div ref={wordsSectionRef} className="mb-6" data-tutorial="words-table">
                    <div className="flex items-center justify-between px-3 md:px-4 py-3 border-b border-white/10">
                      <span className="text-xs md:text-sm text-neutral-400 font-medium w-2/5">Word</span>
                      <span className="text-xs md:text-sm text-neutral-400 font-medium text-center flex-1" data-tutorial="chance-column">Chance</span>
                      <span className="text-xs md:text-sm text-neutral-400 font-medium text-center w-[148px] md:w-[232px]">Trade</span>
                    </div>

                    {words.map(word => {
                      const isResolved = word.resolved_outcome !== null
                      const pct = isResolved
                        ? (word.resolved_outcome ? 100 : 0)
                        : Math.round(word.yes_price * 100)
                      const wordYesCents = isResolved
                        ? (word.resolved_outcome ? 100 : 0)
                        : Math.round(word.yes_price * 100)
                      const wordNoCents = 100 - wordYesCents
                      const isSelected = word.id === selectedWordId

                      return (
                        <button
                          key={word.id}
                          onClick={() => handleWordClick(word.id)}
                          onMouseEnter={() => setHoveredWordId(word.id)}
                          onMouseLeave={() => setHoveredWordId(null)}
                          className={`w-full flex items-center justify-between px-3 md:px-4 py-3 md:py-4 border-b border-white/5 transition-all duration-200 hover:bg-white/[0.03] ${
                            isSelected ? 'bg-white/[0.05]' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2 md:gap-3 w-2/5">
                            <span className="text-white font-semibold text-sm md:text-[15px]">{word.word}</span>
                            {isResolved && (
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                word.resolved_outcome ? 'bg-apple-green/15 text-apple-green' : 'bg-apple-red/15 text-apple-red'
                              }`}>
                                {word.resolved_outcome ? 'YES' : 'NO'}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 md:gap-2 flex-1 justify-center">
                            <FlashValue value={`${pct}%`} className="text-white font-bold text-base md:text-lg" />
                          </div>

                          <div className="flex items-center gap-1.5 md:gap-2 w-[148px] md:w-[232px] justify-end">
                            {isResolved ? (
                              <span className={`px-3 md:px-5 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-semibold border ${
                                word.resolved_outcome
                                  ? 'bg-apple-green/10 border-apple-green/30 text-apple-green'
                                  : 'bg-apple-red/10 border-apple-red/30 text-apple-red'
                              }`}>
                                Resolved {word.resolved_outcome ? 'Yes' : 'No'}
                              </span>
                            ) : (
                              <>
                                <span
                                  className={`w-[70px] md:w-[110px] py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-semibold border transition-all duration-200 flex items-center justify-center gap-1 tabular-nums ${
                                    isSelected && side === 'YES'
                                      ? 'bg-apple-green/15 border-apple-green text-apple-green'
                                      : 'border-white/10 text-apple-green hover:border-apple-green/30'
                                  }`}
                                  onClick={e => { e.stopPropagation(); setSelectedWordId(word.id); setSide('YES'); if (window.innerWidth < 1024) setMobileTradeOpen(true) }}
                                >
                                  Yes <FlashValue value={`${wordYesCents}¢`} />
                                </span>
                                <span
                                  className={`w-[70px] md:w-[110px] py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-semibold border transition-all duration-200 flex items-center justify-center gap-1 tabular-nums ${
                                    isSelected && side === 'NO'
                                      ? 'bg-apple-red/15 border-apple-red text-apple-red'
                                      : 'border-white/10 text-apple-red hover:border-apple-red/30'
                                  }`}
                                  onClick={e => { e.stopPropagation(); setSelectedWordId(word.id); setSide('NO'); if (window.innerWidth < 1024) setMobileTradeOpen(true) }}
                                >
                                  No <FlashValue value={`${wordNoCents}¢`} />
                                </span>
                              </>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  {/* Description — show more/less */}
                  {market.description && (
                    <div className="mb-5">
                      <p className="text-neutral-500 text-sm leading-relaxed">
                        {descExpanded || market.description.length <= DESC_LIMIT
                          ? market.description
                          : `${market.description.slice(0, DESC_LIMIT).trimEnd()}…`}
                      </p>
                      {market.description.length > DESC_LIMIT && (
                        <button
                          onClick={() => setDescExpanded(v => !v)}
                          className="mt-1 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
                        >
                          {descExpanded ? 'Show less' : 'Show more'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Event chat + P&L stacked on mobile, side by side on desktop (when no stream) */}
                  {!streamEmbedUrl && (
                    <div className="flex flex-col lg:flex-row gap-4 mb-6">
                      <div className="flex-1 min-w-0 h-[400px]">
                        <EventChat eventId={`custom_${marketId}`} marketIds={[]} />
                      </div>
                      {connected && market?.status !== 'resolved' && (
                        <div className="flex-1 min-w-0 glass rounded-2xl p-4 flex flex-col">
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider">Current P&amp;L</span>
                            <span className={`text-sm font-bold ${currentProfit.total >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                              {currentProfit.total >= 0 ? '+' : ''}{currentProfit.total.toFixed(1)} tokens
                            </span>
                          </div>
                          {/* Balance bar */}
                          <div className="mb-4">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] text-neutral-600">Play tokens</span>
                              <span className="text-xs font-semibold text-white">{Math.floor(balance)} / {startingBalance}</span>
                            </div>
                            <div className="h-1.5 rounded-full overflow-hidden bg-white/5">
                              <div
                                className="h-full bg-[#F2B71F]/70 transition-all duration-300 rounded-full"
                                style={{ width: `${Math.max(0, Math.min(100, (balance / startingBalance) * 100))}%` }}
                              />
                            </div>
                          </div>
                          {positions.length > 0 ? (
                            <div className="space-y-2 text-xs flex-1">
                              <div className="flex justify-between text-neutral-500">
                                <span title="Total play tokens you've spent buying shares.">Spent</span>
                                <span>{currentProfit.spent.toFixed(1)}</span>
                              </div>
                              <div className="flex justify-between text-neutral-500">
                                <span title="Tokens received back from selling shares.">Realised (from sells)</span>
                                <span>{currentProfit.received.toFixed(1)}</span>
                              </div>
                              <div className="flex justify-between text-neutral-500">
                                <span title="Estimated value if you sold all shares now.">Unrealised (if sold now)</span>
                                <span>{currentProfit.unrealised.toFixed(1)}</span>
                              </div>
                              {currentProfit.total > 0 && (
                                <div className="pt-2 border-t border-white/10 text-[#F2B71F] font-medium">
                                  = {Math.floor(currentProfit.total * VIRTUAL_MARKET_POINTS_MULTIPLIER)} points if resolved now
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="flex-1 flex items-center justify-center">
                              <p className="text-neutral-600 text-xs text-center">No positions yet.<br />Place a trade to get started.</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Recent trades */}
                  {trades.length > 0 && (
                    <div className="mb-6">
                      <h2 className="text-base font-semibold text-white mb-3">Recent Trades</h2>
                      <div className="glass rounded-2xl p-4">
                        <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                          {trades.map(t => (
                            <div key={t.id} className="flex items-center justify-between text-xs py-1">
                              <div className="flex items-center gap-1.5 text-neutral-400 min-w-0 flex-1">
                                <Link
                                  href={`/profile/${t.username || t.wallet}`}
                                  className="text-neutral-300 font-medium hover:text-apple-blue transition-colors flex-shrink-0"
                                  onMouseEnter={(e) => handleTradeMouseEnter(t.wallet, e)}
                                  onMouseLeave={handleTradeMouseLeave}
                                >
                                  {t.username || t.wallet.slice(0, 6)}
                                </Link>
                                <span className="flex-shrink-0">{t.action === 'buy' ? 'bought' : 'sold'}</span>
                                <span className={`flex-shrink-0 font-medium ${t.side === 'YES' ? 'text-apple-green' : 'text-apple-red'}`}>
                                  {t.shares.toFixed(0)} {t.side}
                                </span>
                                <span className="flex-shrink-0">for</span>
                                <span className="flex-shrink-0 text-neutral-300">{Math.round(t.cost)} tokens</span>
                                <span className="truncate">on {t.word}</span>
                              </div>
                              <span className="text-neutral-600 flex-shrink-0 ml-3 pr-1">{Math.round(t.yes_price * 100)}¢</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Market results leaderboard — visible only after resolution */}
                  {market?.status === 'resolved' && marketResults.length > 0 && (
                    <MarketResultsLeaderboard
                      leaderboard={marketResults}
                      currentWallet={publicKey}
                    />
                  )}

                  {/* Trade hover card */}
                  {tradeHoveredWallet && (
                    <div
                      className="fixed z-[70] w-64 bg-neutral-900 border border-white/10 rounded-xl shadow-xl p-3"
                      style={{ top: tradeHoverPos.top, left: tradeHoverPos.left }}
                      onMouseEnter={() => { if (tradeHoverTimeout.current) clearTimeout(tradeHoverTimeout.current) }}
                      onMouseLeave={handleTradeMouseLeave}
                    >
                      <div className="text-xs text-neutral-400 mb-2">
                        {tradeHoveredWallet.slice(0, 4)}...{tradeHoveredWallet.slice(-4)} positions in this market
                      </div>
                      {tradeHoverLoading ? (
                        <div className="text-xs text-neutral-500">Loading...</div>
                      ) : tradeHoverPositions.length === 0 ? (
                        <div className="text-xs text-neutral-500">No open positions</div>
                      ) : (
                        <div className="space-y-2">
                          {tradeHoverPositions.flatMap((pos) => {
                            const rows: { word: string; side: string; shares: number }[] = []
                            if (pos.yes_shares >= 0.01) rows.push({ word: pos.word, side: 'YES', shares: pos.yes_shares })
                            if (pos.no_shares >= 0.01) rows.push({ word: pos.word, side: 'NO', shares: pos.no_shares })
                            return rows
                          }).slice(0, 6).map((row, i) => (
                            <div key={i} className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className={`font-semibold flex-shrink-0 ${row.side === 'YES' ? 'text-apple-green' : 'text-apple-red'}`}>
                                  {row.side}
                                </span>
                                <span className="text-neutral-300 truncate">{row.word}</span>
                              </div>
                              <span className="text-neutral-400 flex-shrink-0 ml-2">{row.shares.toFixed(1)} shares</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Spacer for mobile bottom bar */}
                  <div className="h-20 lg:hidden" />
                </div>

                {/* Right Column — Chat + Trading Panel (desktop) */}
                <div className="w-[340px] flex-shrink-0 hidden lg:block">
                  <div className="sticky top-28 flex flex-col gap-4">
                    {streamEmbedUrl && !streamHidden && (
                      <div style={{ height: streamHeight }}>
                        <EventChat eventId={`custom_${marketId}`} marketIds={[]} />
                      </div>
                    )}
                    <div className="glass rounded-2xl p-5" data-tutorial="trading-panel" data-trading-panel>
                      {tradingPanel}
                    </div>
                  </div>
                </div>
              </div>
            </main>

            <Footer />
          </div>
        </div>
      </div>

      {/* Mobile Trade Bar */}
      <div className="fixed bottom-0 left-0 right-0 lg:hidden z-40">
        {mobileTradeOpen ? (
          <>
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={() => { if (!showTutorial) setMobileTradeOpen(false) }} />
            <div className="relative z-50 bg-neutral-900 border-t border-white/10 rounded-t-2xl p-5 max-h-[80vh] overflow-y-auto animate-slide-up" data-tutorial="trading-panel-mobile">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-white">Trade</span>
                {!showTutorial && (
                  <button onClick={() => setMobileTradeOpen(false)} className="text-neutral-400 hover:text-white">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              {tradingPanel}
            </div>
          </>
        ) : (
          <div className="bg-neutral-900/95 backdrop-blur-md border-t border-white/10 px-4 pt-2 pb-3 safe-pb" data-tutorial="trading-panel-mobile">
            <HowItWorks upward onRerunTutorial={() => {
              document.cookie = 'mentioned_free_tutorial_seen=; Max-Age=0; path=/'
              setShowTutorial(true)
            }} />
            <button
              onClick={() => setMobileTradeOpen(true)}
              className={`w-full py-3 font-semibold text-white rounded-xl transition-all ${
                side === 'YES' ? 'bg-apple-green' : 'bg-apple-red'
              }`}
            >
              {selectedWord ? `Trade ${selectedWord.word}` : 'Trade'}
            </button>
          </div>
        )}
      </div>

      {/* Tutorial overlay — shown after initial data load */}
      {showTutorial && !loading && (
        <MarketTutorial
          onClose={() => {
            document.cookie = 'mentioned_free_tutorial_seen=1; Max-Age=31536000; path=/; SameSite=Lax'
            setShowTutorial(false)
            setMobileTradeOpen(false)
          }}
          onStepChange={(step) => {
            if (window.innerWidth >= 1024) return
            // Steps 2 and 3 (0-indexed) highlight the trading panel — open the sheet on mobile
            if (step === 2 || step === 3) {
              setMobileTradeOpen(true)
            } else {
              setMobileTradeOpen(false)
            }
          }}
        />
      )}
    </div>
  )
}
