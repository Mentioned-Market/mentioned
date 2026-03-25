'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import EventChat from '@/components/EventChat'
import { useWallet } from '@/contexts/WalletContext'
import { getStatusLabel } from '@/lib/customMarketUtils'
import { virtualImpliedPrice, virtualBuyCost, virtualSellReturn, sharesForTokens } from '@/lib/virtualLmsr'

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

function formatPrice(p: number): string {
  return `${Math.round(p * 100)}c`
}

function formatShares(s: number): string {
  if (s >= 1000) return `${(s / 1000).toFixed(1)}k`
  if (s >= 100) return s.toFixed(0)
  if (s >= 1) return s.toFixed(1)
  return s.toFixed(2)
}

// ── Word Card Component ────────────────────────────────

function WordCard({
  word,
  position,
  isOpen,
  connected,
  b,
  balance,
  onTrade,
  submitting,
}: {
  word: MarketWord
  position: Position | undefined
  isOpen: boolean
  connected: boolean
  b: number
  balance: number
  onTrade: (wordId: number, action: 'buy' | 'sell', side: 'YES' | 'NO', amount: number, amountType: 'tokens' | 'shares') => void
  submitting: boolean
}) {
  const [activeTab, setActiveTab] = useState<'buy' | 'sell'>('buy')
  const [side, setSide] = useState<'YES' | 'NO'>('YES')
  const [amount, setAmount] = useState('')

  const isResolved = word.resolved_outcome !== null
  const yesPct = Math.round(word.yes_price * 100)
  const noPct = 100 - yesPct

  const hasPosition = position && (position.yes_shares > 0 || position.no_shares > 0)

  // Compute preview
  const numAmount = parseFloat(amount) || 0
  let previewShares = 0
  let previewCost = 0

  if (activeTab === 'buy' && numAmount > 0) {
    previewShares = sharesForTokens(word.yes_qty, word.no_qty, side, numAmount, b)
    previewCost = virtualBuyCost(word.yes_qty, word.no_qty, side, previewShares, b)
  } else if (activeTab === 'sell' && numAmount > 0) {
    previewCost = virtualSellReturn(word.yes_qty, word.no_qty, side, numAmount, b)
  }

  function handleSubmit() {
    if (numAmount <= 0 || submitting) return
    if (activeTab === 'buy') {
      onTrade(word.id, 'buy', side, numAmount, 'tokens')
    } else {
      onTrade(word.id, 'sell', side, numAmount, 'shares')
    }
    setAmount('')
  }

  return (
    <div className={`rounded-xl border transition-colors ${
      isResolved
        ? word.resolved_outcome
          ? 'border-apple-green/20 bg-apple-green/5'
          : 'border-apple-red/20 bg-apple-red/5'
        : 'border-white/5 bg-white/[0.02]'
    }`}>
      <div className="p-4">
        {/* Word title + prices */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold">{word.word}</span>
          <div className="flex items-center gap-2">
            {isResolved && (
              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                word.resolved_outcome ? 'bg-apple-green/20 text-apple-green' : 'bg-apple-red/20 text-apple-red'
              }`}>
                {word.resolved_outcome ? 'YES' : 'NO'}
              </span>
            )}
            <span className="text-xs text-neutral-400">
              <span className="text-apple-green">{formatPrice(word.yes_price)}</span>
              {' / '}
              <span className="text-apple-red">{formatPrice(word.no_price)}</span>
            </span>
          </div>
        </div>

        {/* Price bar */}
        <div className="mb-3">
          <div className="h-2 rounded-full overflow-hidden bg-white/5 flex">
            <div className="bg-apple-green/60 transition-all duration-300" style={{ width: `${yesPct}%` }} />
            <div className="bg-apple-red/60 transition-all duration-300" style={{ width: `${noPct}%` }} />
          </div>
        </div>

        {/* Position display (if held) */}
        {hasPosition && (
          <div className="flex items-center gap-3 text-[11px] text-neutral-400 mb-3 px-1">
            {position!.yes_shares > 0 && (
              <span className="text-apple-green">{formatShares(position!.yes_shares)} YES</span>
            )}
            {position!.no_shares > 0 && (
              <span className="text-apple-red">{formatShares(position!.no_shares)} NO</span>
            )}
          </div>
        )}

        {/* Buy/Sell panel */}
        {isOpen && connected && !isResolved && (
          <div>
            {/* Tab selector */}
            <div className="flex gap-1 mb-2">
              <button
                onClick={() => { setActiveTab('buy'); setAmount('') }}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  activeTab === 'buy' ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >Buy</button>
              {hasPosition && (
                <button
                  onClick={() => { setActiveTab('sell'); setAmount('') }}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    activeTab === 'sell' ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >Sell</button>
              )}
            </div>

            {/* Side selector */}
            <div className="grid grid-cols-2 gap-1 mb-2">
              <button
                onClick={() => setSide('YES')}
                className={`py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  side === 'YES' ? 'bg-apple-green/20 text-apple-green' : 'bg-white/5 text-neutral-400'
                }`}
              >YES {formatPrice(word.yes_price)}</button>
              <button
                onClick={() => setSide('NO')}
                className={`py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  side === 'NO' ? 'bg-apple-red/20 text-apple-red' : 'bg-white/5 text-neutral-400'
                }`}
              >NO {formatPrice(word.no_price)}</button>
            </div>

            {/* Amount input */}
            <div className="relative mb-2">
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder={activeTab === 'buy' ? 'Tokens to spend' : 'Shares to sell'}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-600 focus:border-white/20 focus:outline-none"
                min="0"
                step="any"
              />
              {activeTab === 'buy' && balance > 0 && (
                <button
                  onClick={() => setAmount(String(Math.floor(balance)))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-apple-blue hover:text-apple-blue/80"
                >MAX</button>
              )}
            </div>

            {/* Preview */}
            {numAmount > 0 && (
              <div className="text-[11px] text-neutral-400 mb-2 px-1 space-y-0.5">
                {activeTab === 'buy' ? (
                  <>
                    <div>Shares: ~{formatShares(previewShares)} {side}</div>
                    <div>Payout if correct: {formatShares(previewShares)} tokens</div>
                  </>
                ) : (
                  <div>Return: ~{previewCost.toFixed(1)} tokens</div>
                )}
              </div>
            )}

            {/* Submit button */}
            <button
              onClick={handleSubmit}
              disabled={submitting || numAmount <= 0}
              className={`w-full py-2 text-xs font-semibold rounded-lg transition-colors disabled:opacity-40 ${
                side === 'YES'
                  ? 'bg-apple-green/20 text-apple-green hover:bg-apple-green/30'
                  : 'bg-apple-red/20 text-apple-red hover:bg-apple-red/30'
              }`}
            >
              {submitting ? '...' : `${activeTab === 'buy' ? 'Buy' : 'Sell'} ${side}`}
            </button>
          </div>
        )}

        {/* Resolved result with payout */}
        {isResolved && hasPosition && (
          <div className="text-xs mt-2 space-y-1">
            {position!.yes_shares > 0 && (
              <div className={word.resolved_outcome ? 'text-apple-green' : 'text-apple-red'}>
                {formatShares(position!.yes_shares)} YES {word.resolved_outcome ? `= ${formatShares(position!.yes_shares)} tokens` : '= 0 tokens'}
              </div>
            )}
            {position!.no_shares > 0 && (
              <div className={!word.resolved_outcome ? 'text-apple-green' : 'text-apple-red'}>
                {formatShares(position!.no_shares)} NO {!word.resolved_outcome ? `= ${formatShares(position!.no_shares)} tokens` : '= 0 tokens'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Balance Bar Component ─────────────────────────────

function BalanceBar({ balance, startingBalance }: { balance: number; startingBalance: number }) {
  const pct = Math.max(0, Math.min(100, (balance / startingBalance) * 100))
  return (
    <div className="glass rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Play Tokens</span>
        <span className="text-sm font-bold text-white">{Math.floor(balance)} / {startingBalance}</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden bg-white/5">
        <div
          className="h-full bg-apple-blue/60 transition-all duration-300 rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ── Trade Feed Component ──────────────────────────────

function TradeFeed({ trades }: { trades: Trade[] }) {
  if (trades.length === 0) return null
  return (
    <div className="glass rounded-xl p-4">
      <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">Recent Trades</h3>
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {trades.map(t => (
          <div key={t.id} className="flex items-center justify-between text-[11px]">
            <span className="text-neutral-400 truncate mr-2">
              <span className="text-neutral-300">{t.username || t.wallet.slice(0, 6)}</span>
              {' '}{t.action === 'buy' ? 'bought' : 'sold'}{' '}
              <span className={t.side === 'YES' ? 'text-apple-green' : 'text-apple-red'}>
                {formatShares(t.shares)} {t.side}
              </span>
              {' on '}{t.word}
            </span>
            <span className="text-neutral-600 shrink-0">{formatPrice(t.yes_price)}</span>
          </div>
        ))}
      </div>
    </div>
  )
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [streamHidden, setStreamHidden] = useState(false)

  // Fetch market data
  const fetchMarket = useCallback(async () => {
    try {
      const res = await fetch(`/api/custom/${marketId}`)
      if (!res.ok) throw new Error('Market not found')
      const data = await res.json()
      setMarket(data.market)
      setWords(data.words)
      setTraderCount(data.traderCount)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [marketId])

  // Fetch user positions + balance
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

  // Fetch prices (sentiment endpoint) for polling
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

  // Fetch recent trades
  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch(`/api/custom/${marketId}/trades?limit=20`)
      const data = await res.json()
      setTrades(data.trades || [])
    } catch { /* ignore */ }
  }, [marketId])

  useEffect(() => { fetchMarket() }, [fetchMarket])
  useEffect(() => { fetchPositions() }, [fetchPositions])
  useEffect(() => { fetchTrades() }, [fetchTrades])

  // Poll prices when market is open
  useEffect(() => {
    if (!market || market.status !== 'open') return
    const interval = setInterval(() => { fetchPrices(); fetchTrades() }, 10000)
    return () => clearInterval(interval)
  }, [market?.status, fetchPrices, fetchTrades])

  async function handleTrade(wordId: number, action: 'buy' | 'sell', side: 'YES' | 'NO', amount: number, amountType: 'tokens' | 'shares') {
    if (!publicKey || !market) return
    setSubmitting(true)

    try {
      const res = await fetch(`/api/custom/${marketId}/trade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: publicKey, word_id: wordId, action, side, amount, amount_type: amountType }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error)
      }
      const result = await res.json()

      // Update balance immediately from trade result for responsive UI
      setBalance(result.new_balance)

      // Refresh all server state to stay in sync
      fetchPrices()
      fetchPositions()
      fetchTrades()
    } catch (err: any) {
      console.error('Trade error:', err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const isOpen = market?.status === 'open' && (!market.lock_time || new Date(market.lock_time) > new Date())
  const b = market?.b_parameter ?? 500
  const streamEmbedUrl = market?.stream_url ? toEmbedUrl(market.stream_url) : null
  const positionMap = new Map(positions.map(p => [p.word_id, p]))

  // Compute total profit for resolved markets
  let totalProfit = 0
  if (market?.status === 'resolved' && positions.length > 0) {
    const totalSpent = positions.reduce((s, p) => s + p.tokens_spent, 0)
    const totalReceived = positions.reduce((s, p) => s + p.tokens_received, 0)
    totalProfit = totalReceived - totalSpent
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="max-w-7xl mx-auto px-4 md:px-10 lg:px-20">
          <Header />
          <div className="flex items-center justify-center py-24">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        </div>
      </div>
    )
  }

  if (error || !market) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="max-w-7xl mx-auto px-4 md:px-10 lg:px-20">
          <Header />
          <div className="flex flex-col items-center justify-center py-24">
            <p className="text-neutral-400 mb-4">{error || 'Market not found'}</p>
            <a href="/markets" className="text-apple-blue hover:underline text-sm">Back to markets</a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-7xl mx-auto px-4 md:px-10 lg:px-20">
        <Header />

        <main className="py-4 md:py-6 animate-fade-in">
          {/* Header */}
          <div className="flex items-start gap-4 mb-6">
            {market.cover_image_url && (
              <img
                src={market.cover_image_url}
                alt={market.title}
                className="w-16 h-16 md:w-20 md:h-20 rounded-xl object-cover"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-apple-green/20 text-apple-green">
                  FREE
                </span>
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                  market.status === 'open' ? 'bg-green-500/20 text-green-400' :
                  market.status === 'locked' ? 'bg-orange-500/20 text-orange-400' :
                  market.status === 'resolved' ? 'bg-blue-500/20 text-blue-400' :
                  'bg-white/10 text-neutral-400'
                }`}>
                  {getStatusLabel(market.status)}
                </span>
              </div>
              <h1 className="text-xl md:text-2xl font-bold">{market.title}</h1>
              {market.description && (
                <p className="text-neutral-400 text-sm mt-1">{market.description}</p>
              )}
              <div className="flex items-center gap-4 mt-2 text-xs text-neutral-500">
                <span>{words.length} words</span>
                <span>{traderCount} trader{traderCount !== 1 ? 's' : ''}</span>
                {market.lock_time && isOpen && (
                  <span>Locks in {timeUntil(market.lock_time)}</span>
                )}
              </div>
            </div>
          </div>

          {/* Resolved summary */}
          {market.status === 'resolved' && positions.length > 0 && (
            <div className={`glass rounded-xl p-4 mb-4 border ${totalProfit > 0 ? 'border-apple-green/20' : 'border-white/5'}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-400">Your Result</span>
                <div className="text-right">
                  <div className={`text-lg font-bold ${totalProfit > 0 ? 'text-apple-green' : totalProfit < 0 ? 'text-apple-red' : 'text-neutral-400'}`}>
                    {totalProfit > 0 ? '+' : ''}{totalProfit.toFixed(1)} tokens
                  </div>
                  {totalProfit > 0 && (
                    <div className="text-xs text-neutral-500">
                      = {Math.floor(totalProfit * 0.5)} platform points
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Stream embed */}
          {streamEmbedUrl && !streamHidden && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-neutral-500 font-medium uppercase tracking-wider">Live Stream</span>
                <button
                  onClick={() => setStreamHidden(true)}
                  className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
                >Hide</button>
              </div>
              <div className="relative w-full rounded-xl overflow-hidden border border-white/5" style={{ paddingBottom: '56.25%' }}>
                <iframe
                  src={streamEmbedUrl}
                  className="absolute inset-0 w-full h-full"
                  allowFullScreen
                  allow="autoplay; encrypted-media"
                />
              </div>
            </div>
          )}

          {/* Main content: two-column layout */}
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Left column: Balance + Words */}
            <div className="flex-1 min-w-0 space-y-6">
              {/* Balance bar */}
              {connected && (
                <BalanceBar balance={balance} startingBalance={startingBalance} />
              )}

              {/* Connect wallet prompt */}
              {!connected && isOpen && (
                <div className="glass rounded-xl p-4 text-center">
                  <p className="text-neutral-400 text-sm mb-3">Connect your wallet to start trading</p>
                  <button
                    onClick={connect}
                    className="px-5 py-2.5 bg-apple-blue text-white text-sm font-semibold rounded-lg hover:bg-apple-blue/80 transition-colors"
                  >Connect Wallet</button>
                </div>
              )}

              {/* Word grid */}
              <div>
                <h2 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
                  Markets {isOpen ? '' : market.status === 'locked' ? '(Locked)' : market.status === 'resolved' ? '(Resolved)' : ''}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {words.map(word => (
                    <WordCard
                      key={word.id}
                      word={word}
                      position={positionMap.get(word.id)}
                      isOpen={isOpen && connected}
                      connected={connected}
                      b={b}
                      balance={balance}
                      onTrade={handleTrade}
                      submitting={submitting}
                    />
                  ))}
                </div>
              </div>

              {/* Trade feed */}
              <TradeFeed trades={trades} />
            </div>

            {/* Right column: Chat */}
            <div className="w-full lg:w-80 xl:w-96 space-y-4 flex-shrink-0">
              <div className="h-[500px]">
                <EventChat
                  eventId={`custom_${marketId}`}
                  marketIds={[]}
                />
              </div>
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </div>
  )
}
