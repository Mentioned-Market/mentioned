'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import EventChat from '@/components/EventChat'
import MarketChart from '@/components/MarketChart'
import FlashValue from '@/components/FlashValue'
import { useWallet } from '@/contexts/WalletContext'
import { getStatusLabel } from '@/lib/customMarketUtils'
import { virtualBuyCost, virtualSellReturn, sharesForTokens } from '@/lib/virtualLmsr'
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

// ── Helpers ────────────────────────────────────────────

function toEmbedUrl(url: string): string {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  const twitchChannel = url.match(/twitch\.tv\/([^/?]+)/i)
  if (twitchChannel) return `https://player.twitch.tv/?channel=${twitchChannel[1]}&parent=${hostname}&muted=true`
  const twitchVod = url.match(/twitch\.tv\/videos\/(\d+)/i)
  if (twitchVod) return `https://player.twitch.tv/?video=v${twitchVod[1]}&parent=${hostname}&muted=true`
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?]+)/)
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&mute=1`
  const ytLive = url.match(/youtube\.com\/live\/([^?&]+)/)
  if (ytLive) return `https://www.youtube.com/embed/${ytLive[1]}?autoplay=1&mute=1`
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
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// ── Main Page ──────────────────────────────────────────

export default function CustomMarketPage() {
  const params = useParams()
  const id = params.id as string
  const marketId = parseInt(id, 10)
  const { connected, connect, publicKey } = useWallet()

  const [market, setMarket] = useState<CustomMarket | null>(null)
  const [words, setWords] = useState<MarketWord[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [balance, setBalance] = useState(1000)
  const [startingBalance, setStartingBalance] = useState(1000)
  const [traderCount, setTraderCount] = useState(0)
  const [trades, setTrades] = useState<Trade[]>([])
  const [chartData, setChartData] = useState<ChartWord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [streamHidden, setStreamHidden] = useState(false)

  // Trading state
  const [selectedWordId, setSelectedWordId] = useState<number | null>(null)
  const [side, setSide] = useState<'YES' | 'NO'>('YES')
  const [tradeMode, setTradeMode] = useState<'buy' | 'sell'>('buy')
  const [amount, setAmount] = useState('')
  const [trading, setTrading] = useState(false)
  const [tradeStatus, setTradeStatus] = useState<{ msg: string; error: boolean } | null>(null)

  // Mobile trade sheet
  const [mobileTradeOpen, setMobileTradeOpen] = useState(false)

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
        setSelectedWordId(data.words[0].id)
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
          return { ...w, yes_price: updated.yes_price, no_price: updated.no_price, yes_qty: updated.yes_qty, no_qty: updated.no_qty }
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
    } catch { /* ignore */ }
  }, [marketId])

  useEffect(() => { fetchMarket() }, [fetchMarket])
  useEffect(() => { fetchPositions() }, [fetchPositions])
  useEffect(() => { fetchTrades() }, [fetchTrades])
  useEffect(() => { fetchChart() }, [fetchChart])

  // Poll when market is open
  useEffect(() => {
    if (!market || market.status !== 'open') return
    const interval = setInterval(() => {
      fetchPrices()
      fetchTrades()
    }, 10000)
    return () => clearInterval(interval)
  }, [market?.status, fetchPrices, fetchTrades])

  // ── Derived data ────────────────────────────────────

  const isOpen = market?.status === 'open'
  const lockTimePassed = market?.lock_time ? new Date(market.lock_time) <= new Date() : false
  const b = market?.b_parameter ?? 500
  const selectedWord = words.find(w => w.id === selectedWordId) || words[0]
  const positionMap = new Map(positions.map(p => [p.word_id, p]))
  const selectedPosition = selectedWord ? positionMap.get(selectedWord.id) : undefined
  const streamEmbedUrl = market?.stream_url ? toEmbedUrl(market.stream_url) : null

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

  // Chart series from chart data
  const chartColors = ['#34C759', '#007AFF', '#FF9500', '#FF3B30', '#AF52DE', '#5AC8FA', '#FF9F0A']
  const chartSeries = useMemo(() => {
    return chartData.map((cw, i) => {
      const word = words.find(w => w.id === cw.word_id)
      const currentPrice = word?.yes_price ?? 0.5
      const data = cw.history.length > 0
        ? cw.history.map(h => ({ timestamp: new Date(h.t).getTime(), price: h.yes }))
        : [{ timestamp: Date.now() - 3600000, price: 0.5 }, { timestamp: Date.now(), price: currentPrice }]

      // Extend to now with current price if market is active
      if (data.length > 0 && market?.status !== 'resolved') {
        data.push({ timestamp: Date.now(), price: currentPrice })
      }

      return {
        label: cw.word,
        color: chartColors[i % chartColors.length],
        data,
        currentPrice,
      }
    })
  }, [chartData, words, market?.status])

  // Total profit for resolved markets
  const totalProfit = useMemo(() => {
    if (market?.status !== 'resolved' || positions.length === 0) return 0
    const totalSpent = positions.reduce((s, p) => s + p.tokens_spent, 0)
    const totalReceived = positions.reduce((s, p) => s + p.tokens_received, 0)
    return totalReceived - totalSpent
  }, [market?.status, positions])

  // ── Handlers ────────────────────────────────────────

  const handleWordClick = (wordId: number) => {
    setSelectedWordId(wordId)
  }

  const handleTrade = async () => {
    if (!publicKey || !market || !selectedWord) return
    if (amountNum <= 0) return

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

  const tradingPanel = selectedWord ? (
    <>
      {/* Balance bar */}
      {connected && (
        <div className="mb-4 pb-4 border-b border-white/10">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider">Play Tokens</span>
            <span className="text-sm font-semibold text-white">{Math.floor(balance)} / {startingBalance}</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden bg-white/5">
            <div
              className="h-full bg-apple-blue/60 transition-all duration-300 rounded-full"
              style={{ width: `${Math.max(0, Math.min(100, (balance / startingBalance) * 100))}%` }}
            />
          </div>
        </div>
      )}

      {/* Selected word label */}
      <div className="mb-4">
        <span className={`font-semibold text-sm ${side === 'YES' ? 'text-apple-green' : 'text-apple-red'}`}>
          {tradeMode === 'buy' ? 'Buy' : 'Sell'} {side}
        </span>
        <span className="text-neutral-400 text-sm"> · </span>
        <span className="text-white font-semibold text-sm">{selectedWord.word}</span>
      </div>

      {/* Buy / Sell toggle */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => { setTradeMode('buy'); setAmount('') }}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
            tradeMode === 'buy' ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-neutral-300'
          }`}
        >Buy</button>
        <button
          onClick={() => { setTradeMode('sell'); setAmount('') }}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
            tradeMode === 'sell' ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-neutral-300'
          }`}
        >Sell</button>
      </div>

      {/* Yes / No buttons */}
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => setSide('YES')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
            side === 'YES'
              ? 'bg-apple-green/15 text-apple-green border border-apple-green/40'
              : 'border border-white/10 text-neutral-400 hover:border-white/20'
          }`}
        >
          Yes <FlashValue value={`${yesCents}¢`} />
        </button>
        <button
          onClick={() => setSide('NO')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
            side === 'NO'
              ? 'bg-apple-red/15 text-apple-red border border-apple-red/40'
              : 'border border-white/10 text-neutral-400 hover:border-white/20'
          }`}
        >
          No <FlashValue value={`${noCents}¢`} />
        </button>
      </div>

      {/* Amount input */}
      <div className="mb-5">
        <div className="flex items-center justify-between py-3">
          <div>
            <div className="text-sm text-neutral-400 font-medium">
              {tradeMode === 'buy' ? 'Amount (Tokens)' : 'Shares to sell'}
            </div>
            {preview && (
              <div className="text-xs text-neutral-500 mt-0.5">
                {tradeMode === 'buy'
                  ? `~${preview.shares.toFixed(1)} shares`
                  : `~${preview.cost.toFixed(1)} tokens returned`}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
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
      {preview && amountNum > 0 && tradeMode === 'buy' && (
        <div className="mb-5 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-neutral-400">Avg Price</span>
            <span className="text-white font-medium">{preview.shares > 0 ? Math.round((preview.cost / preview.shares) * 100) : 0}¢</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">Shares</span>
            <span className="text-white font-medium">{preview.shares.toFixed(1)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">Payout if correct</span>
            <span className="text-white font-medium">{preview.payout.toFixed(1)} tokens</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">Profit</span>
            <span className="text-apple-green font-semibold">+{preview.profit.toFixed(1)} tokens</span>
          </div>
        </div>
      )}

      {/* Sell preview */}
      {preview && amountNum > 0 && tradeMode === 'sell' && (
        <div className="mb-5 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-neutral-400">Tokens returned</span>
            <span className="text-white font-medium">{preview.cost.toFixed(1)}</span>
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
      {!isOpen ? (
        <button disabled className="w-full py-3.5 bg-white/10 text-neutral-400 font-semibold text-base rounded-xl cursor-not-allowed">
          {market?.status === 'resolved' ? 'Market Resolved' : market?.status === 'locked' ? 'Market Locked' : 'Market Closed'}
        </button>
      ) : connected ? (
        <button
          onClick={handleTrade}
          disabled={!amount || amountNum <= 0 || trading}
          className={`w-full py-3.5 text-white font-semibold text-base rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${
            side === 'YES'
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
              Processing...
            </span>
          ) : (
            `${tradeMode === 'buy' ? 'Buy' : 'Sell'} ${side === 'YES' ? 'Yes' : 'No'}`
          )}
        </button>
      ) : (
        <button
          onClick={connect}
          className="w-full py-3.5 bg-apple-green hover:bg-apple-green/90 text-white font-semibold text-base rounded-xl transition-all duration-200"
        >
          Connect wallet to trade
        </button>
      )}

      {/* User positions for this market */}
      {connected && positions.length > 0 && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-2">
            Positions ({positions.length})
          </div>
          <div className="space-y-2">
            {positions.map(pos => {
              const pnl = pos.tokens_received - pos.tokens_spent
              const hasShares = pos.yes_shares > 0 || pos.no_shares > 0
              if (!hasShares && pnl === 0) return null
              return (
                <div key={pos.word_id} className="glass rounded-lg p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-white font-medium text-xs truncate max-w-[140px]">{pos.word}</span>
                    {market?.status === 'resolved' && (
                      <span className={`text-xs font-semibold ${pnl >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                        {pnl >= 0 ? '+' : ''}{pnl.toFixed(1)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-neutral-400">
                    <span>
                      {pos.yes_shares > 0 && <span className="text-apple-green">{pos.yes_shares.toFixed(1)} YES</span>}
                      {pos.yes_shares > 0 && pos.no_shares > 0 && ' · '}
                      {pos.no_shares > 0 && <span className="text-apple-red">{pos.no_shares.toFixed(1)} NO</span>}
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

  if (loading) {
    return (
      <div className="relative flex min-h-screen w-full flex-col bg-black">
        <div className="flex h-full grow flex-col">
          <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
            <div className="flex flex-col w-full max-w-7xl flex-1">
              <Header />
              <div className="flex items-center justify-center py-32">
                <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              </div>
            </div>
          </div>
        </div>
      </div>
    )
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
    <div className="relative flex min-h-screen w-full flex-col bg-black">
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
                  <div className="flex items-center gap-2 text-xs md:text-sm text-neutral-400 font-medium mb-0.5">
                    <span className="px-2 py-0.5 rounded-full bg-apple-green/90 text-white text-[10px] font-bold uppercase tracking-wide">
                      Free
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${
                      market.status === 'open' ? 'bg-apple-green/15 text-apple-green' :
                      market.status === 'locked' ? 'bg-orange-500/15 text-orange-400' :
                      market.status === 'resolved' ? 'bg-white/10 text-neutral-300' :
                      'bg-white/10 text-neutral-400'
                    }`}>
                      {getStatusLabel(market.status)}
                    </span>
                  </div>
                  <h1 className="text-lg md:text-xl font-semibold text-white leading-tight">
                    {market.title}
                  </h1>
                  {market.description && (
                    <p className="text-neutral-500 text-sm mt-1">{market.description}</p>
                  )}
                </div>
              </div>

              {/* Meta bar */}
              <div className="flex items-center gap-4 mb-5 text-xs md:text-sm text-neutral-400">
                <span>{traderCount} trader{traderCount !== 1 ? 's' : ''}</span>
                <span className="text-neutral-700">·</span>
                <span>{words.length} words</span>
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

              {/* Stream embed + event chat */}
              {streamEmbedUrl && !streamHidden && (
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-apple-red animate-pulse" />
                      <span className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">Live Stream</span>
                    </div>
                    <button onClick={() => setStreamHidden(true)} className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors">
                      Hide stream
                    </button>
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="relative w-full rounded-xl overflow-hidden border border-white/5 aspect-video">
                        <iframe src={streamEmbedUrl} className="absolute inset-0 w-full h-full" allowFullScreen allow="autoplay; encrypted-media" />
                      </div>
                    </div>
                    <div className="hidden lg:block w-[340px] flex-shrink-0 aspect-video">
                      <EventChat eventId={`custom_${marketId}`} marketIds={[]} />
                    </div>
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
              {chartSeries.length > 0 && (
                <div className="mb-5">
                  <div className="glass rounded-2xl overflow-hidden">
                    <div className="h-[240px] md:h-[320px] p-2">
                      <MarketChart series={chartSeries} />
                    </div>
                  </div>
                </div>
              )}

              {/* Two-column layout */}
              <div className="flex gap-6">
                {/* Left Column */}
                <div className="flex-1 min-w-0">
                  {/* Words table */}
                  <div className="mb-6">
                    <div className="flex items-center justify-between px-3 md:px-4 py-3 border-b border-white/10">
                      <span className="text-xs md:text-sm text-neutral-400 font-medium w-2/5">Word</span>
                      <span className="text-xs md:text-sm text-neutral-400 font-medium text-center flex-1">Chance</span>
                      <span className="text-xs md:text-sm text-neutral-400 font-medium text-right w-[180px] md:w-[240px]">Trade</span>
                    </div>

                    {words.map(word => {
                      const pct = Math.round(word.yes_price * 100)
                      const wordYesCents = Math.round(word.yes_price * 100)
                      const wordNoCents = 100 - wordYesCents
                      const isSelected = word.id === selectedWordId
                      const isResolved = word.resolved_outcome !== null

                      return (
                        <button
                          key={word.id}
                          onClick={() => handleWordClick(word.id)}
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

                          <div className="flex items-center gap-1.5 md:gap-2 w-[180px] md:w-[240px] justify-end">
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
                                  className={`px-3 md:px-5 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-semibold border transition-all duration-200 ${
                                    isSelected && side === 'YES'
                                      ? 'bg-apple-green/15 border-apple-green text-apple-green'
                                      : 'border-white/10 text-apple-green hover:border-apple-green/30'
                                  }`}
                                  onClick={e => { e.stopPropagation(); setSelectedWordId(word.id); setSide('YES') }}
                                >
                                  Yes <FlashValue value={`${wordYesCents}¢`} />
                                </span>
                                <span
                                  className={`px-3 md:px-5 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-semibold border transition-all duration-200 ${
                                    isSelected && side === 'NO'
                                      ? 'bg-apple-red/15 border-apple-red text-apple-red'
                                      : 'border-white/10 text-apple-red hover:border-apple-red/30'
                                  }`}
                                  onClick={e => { e.stopPropagation(); setSelectedWordId(word.id); setSide('NO') }}
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

                  {/* Recent trades */}
                  {trades.length > 0 && (
                    <div className="mb-6">
                      <h2 className="text-base font-semibold text-white mb-3">Recent Trades</h2>
                      <div className="glass rounded-2xl p-4">
                        <div className="space-y-1.5 max-h-60 overflow-y-auto">
                          {trades.map(t => (
                            <div key={t.id} className="flex items-center justify-between text-xs py-1">
                              <div className="flex items-center gap-2 text-neutral-400 truncate">
                                <span className="text-neutral-300 font-medium">{t.username || t.wallet.slice(0, 6)}</span>
                                <span>{t.action === 'buy' ? 'bought' : 'sold'}</span>
                                <span className={t.side === 'YES' ? 'text-apple-green font-medium' : 'text-apple-red font-medium'}>
                                  {t.shares.toFixed(1)} {t.side}
                                </span>
                                <span>on {t.word}</span>
                              </div>
                              <span className="text-neutral-600 flex-shrink-0 ml-2">{Math.round(t.yes_price * 100)}¢</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Event chat (when no stream, show inline) */}
                  {!streamEmbedUrl && (
                    <div className="mb-6">
                      <div className="h-[400px]">
                        <EventChat eventId={`custom_${marketId}`} marketIds={[]} />
                      </div>
                    </div>
                  )}

                  {/* Spacer for mobile bottom bar */}
                  <div className="h-20 lg:hidden" />
                </div>

                {/* Right Column — Trading Panel (desktop) */}
                <div className="w-[340px] flex-shrink-0 hidden lg:block">
                  <div className="sticky top-24">
                    <div className="glass rounded-2xl p-5">
                      {tradingPanel}
                    </div>

                    {/* Event chat below trading panel when stream is visible (already shown beside stream above) */}
                    {streamEmbedUrl && (
                      <div className="mt-4 h-[400px]">
                        <EventChat eventId={`custom_${marketId}`} marketIds={[]} />
                      </div>
                    )}
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
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={() => setMobileTradeOpen(false)} />
            <div className="relative z-50 bg-neutral-900 border-t border-white/10 rounded-t-2xl p-5 max-h-[80vh] overflow-y-auto animate-slide-up">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-white">Trade</span>
                <button onClick={() => setMobileTradeOpen(false)} className="text-neutral-400 hover:text-white">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {tradingPanel}
            </div>
          </>
        ) : (
          <div className="bg-neutral-900/95 backdrop-blur-md border-t border-white/10 px-4 py-3 safe-pb">
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
    </div>
  )
}
