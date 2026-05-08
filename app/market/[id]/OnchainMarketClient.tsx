'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import FlashValue from '@/components/FlashValue'
import EventPriceChart from '@/components/EventPriceChart'
import MentionedSpinner from '@/components/MentionedSpinner'
import { useWallet } from '@/contexts/WalletContext'
import {
  fetchMarket,
  fetchVaultBalance,
  fetchTokenBalance,
  fetchUsdcBalance,
  createAtaIx,
  createBuyIx,
  createSellIx,
  createRedeemIx,
  sendInstructions,
  impliedYesPrice,
  estimateBuyCost,
  estimateSellReturn,
  sharesForUsdc,
  formatUsdc,
  statusLabel,
  MarketStatus,
  USDC_PRECISION,
  type UsdcMarketAccount,
  type WordState,
} from '@/lib/mentionMarketUsdc'
import type { Address } from '@solana/kit'

// ── Props ────────────────────────────────────────────────

interface Props {
  marketId: string
}

// ── Types ────────────────────────────────────────────────

interface UserTokens {
  yes: bigint
  no: bigint
}

interface OnchainTrade {
  signature: string
  wordIndex: number
  direction: 'YES' | 'NO'
  isBuy: boolean
  quantity: number
  cost: number
  impliedPrice: number
  trader: string
  username: string | null
  blockTime: string
}

// ── Helpers ──────────────────────────────────────────────

function formatTokens(baseUnits: bigint): string {
  const whole = baseUnits / USDC_PRECISION
  const frac = baseUnits % USDC_PRECISION
  const fracStr = frac.toString().padStart(6, '0').slice(0, 2)
  if (frac === 0n) return whole.toString()
  return `${whole}.${fracStr}`
}

function timeUntil(ts: bigint): string {
  const diff = Number(ts) * 1000 - Date.now()
  if (diff <= 0) return 'Resolved'
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }
  return `${hours}h ${minutes}m`
}

function formatResolveTime(ts: bigint): string {
  const d = new Date(Number(ts) * 1000)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

function statusPillClasses(status: MarketStatus): string {
  switch (status) {
    case MarketStatus.Open:
      return 'bg-apple-green/15 text-apple-green border-apple-green/30'
    case MarketStatus.Paused:
      return 'bg-yellow-400/15 text-yellow-400 border-yellow-400/30'
    case MarketStatus.Resolved:
      return 'bg-neutral-700/40 text-neutral-400 border-neutral-600/30'
  }
}

const POLL_INTERVAL = 12_000

interface PaidMarketMetadata {
  market_id: string
  title: string
  description: string | null
  cover_image_url: string | null
  stream_url: string | null
}

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

function DescriptionBlock({ text, limit }: { text: string; limit: number }) {
  const [expanded, setExpanded] = useState(false)
  const needsTrunc = text.length > limit
  return (
    <div className="mb-5 text-sm text-neutral-400 leading-relaxed">
      {expanded || !needsTrunc ? text : `${text.slice(0, limit).trimEnd()}…`}
      {needsTrunc && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="ml-1 text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          {expanded ? 'less' : 'more'}
        </button>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────

export default function OnchainMarketClient({ marketId }: Props) {
  const id = useMemo(() => BigInt(marketId), [marketId])

  const { publicKey, connected, connect, signer, signOnly } = useWallet()

  // ── Data state ────────────────────────────────────────────
  const [market, setMarket] = useState<UsdcMarketAccount | null>(null)
  const [metadata, setMetadata] = useState<PaidMarketMetadata | null>(null)
  const [chartData, setChartData] = useState<{ wordIndex: number; history: { t: number; p: number }[] }[]>([])
  const [chartLoading, setChartLoading] = useState(true)
  const [vaultBalance, setVaultBalance] = useState<bigint>(0n)
  const [userUsdc, setUserUsdc] = useState<bigint>(0n)
  const [userTokens, setUserTokens] = useState<UserTokens[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [contentVisible, setContentVisible] = useState(false)

  // ── Trading state ─────────────────────────────────────────
  const [selectedWordIdx, setSelectedWordIdx] = useState(0)
  const [side, setSide] = useState<'YES' | 'NO'>('YES')
  const [tradeMode, setTradeMode] = useState<'buy' | 'sell'>('buy')
  const [amount, setAmount] = useState('')
  const [txPending, setTxPending] = useState(false)
  const [tradeStatus, setTradeStatus] = useState<{ msg: string; error: boolean } | null>(null)

  // ── Mobile sheet ──────────────────────────────────────────
  const [mobileTradeOpen, setMobileTradeOpen] = useState(false)

  // ── Stream ────────────────────────────────────────────────
  const [streamHidden, setStreamHidden] = useState(false)

  // ── Recent trades ─────────────────────────────────────────
  const [trades, setTrades] = useState<OnchainTrade[]>([])

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Data fetching ─────────────────────────────────────────

  const loadMarket = useCallback(async () => {
    try {
      const [mkt, vault, metaRes] = await Promise.all([
        fetchMarket(id),
        fetchVaultBalance(id),
        fetch(`/api/paid-markets/metadata?id=${marketId}`).then(r => r.ok ? r.json() : null),
      ])
      if (!mkt) { setError('Market not found'); setLoading(false); return }
      setMarket(mkt)
      setVaultBalance(vault)
      if (metaRes && !metaRes.error) setMetadata(metaRes)
      setError(null)
    } catch (e) {
      setError('Failed to load market')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [id, marketId])

  const loadUserData = useCallback(async (mkt: UsdcMarketAccount) => {
    if (!publicKey) return
    const wallet = publicKey as Address
    try {
      const [usdc, ...tokens] = await Promise.all([
        fetchUsdcBalance(wallet),
        ...mkt.words.flatMap((w: WordState) => [
          fetchTokenBalance(w.yesMint, wallet),
          fetchTokenBalance(w.noMint, wallet),
        ]),
      ])
      setUserUsdc(usdc)
      const parsed: UserTokens[] = []
      for (let i = 0; i < mkt.words.length; i++) {
        parsed.push({ yes: tokens[i * 2], no: tokens[i * 2 + 1] })
      }
      setUserTokens(parsed)
    } catch (e) {
      console.error('Failed to load user data', e)
    }
  }, [publicKey])

  const loadChart = useCallback(async () => {
    try {
      const res = await fetch(`/api/paid-markets/chart?id=${marketId}`)
      if (res.ok) {
        const data = await res.json()
        setChartData(data.words || [])
      }
    } catch { /* ignore */ } finally {
      setChartLoading(false)
    }
  }, [marketId])

  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch(`/api/paid-markets/trades?id=${marketId}`)
      if (res.ok) {
        const data = await res.json()
        setTrades(data.trades || [])
      }
    } catch { /* ignore */ }
  }, [marketId])

  useEffect(() => {
    loadMarket()
    pollRef.current = setInterval(loadMarket, POLL_INTERVAL)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [loadMarket])

  useEffect(() => { loadChart() }, [loadChart])
  useEffect(() => { fetchTrades() }, [fetchTrades])

  useEffect(() => {
    if (market) loadUserData(market)
  }, [market, loadUserData])

  // Fade-in after load
  useEffect(() => {
    if (!loading && market) {
      requestAnimationFrame(() => setContentVisible(true))
    }
  }, [loading, market])

  // ── Derived values ─────────────────────────────────────────

  const word = market?.words[selectedWordIdx]
  const amountNum = parseFloat(amount) || 0

  const estimatedShares = useMemo<bigint>(() => {
    if (!word || !market || amountNum <= 0 || tradeMode === 'sell') return 0n
    const usdcUnits = BigInt(Math.floor(amountNum * 1_000_000))
    return sharesForUsdc(word, market.liquidityParamB, side, usdcUnits)
  }, [word, market, amountNum, tradeMode, side])

  const estimatedCost = useMemo<bigint>(() => {
    if (!word || !market || amountNum <= 0 || tradeMode === 'sell' || estimatedShares <= 0n) return 0n
    return estimateBuyCost(word, market.liquidityParamB, side, estimatedShares)
  }, [word, market, amountNum, tradeMode, side, estimatedShares])

  const feeOnCost = useMemo<bigint>(() => {
    if (!market || estimatedCost <= 0n) return 0n
    return (estimatedCost * BigInt(market.tradeFeeBps)) / 10000n
  }, [market, estimatedCost])

  const sellShares = useMemo<bigint>(() => {
    if (!word || tradeMode !== 'sell') return 0n
    const raw = BigInt(Math.floor(amountNum * 1_000_000))
    const held = side === 'YES'
      ? (userTokens[selectedWordIdx]?.yes ?? 0n)
      : (userTokens[selectedWordIdx]?.no ?? 0n)
    return raw > held ? held : raw
  }, [word, tradeMode, amountNum, side, userTokens, selectedWordIdx])

  const estimatedReturn = useMemo<bigint>(() => {
    if (!word || !market || tradeMode !== 'sell' || sellShares <= 0n) return 0n
    return estimateSellReturn(word, market.liquidityParamB, side, sellShares)
  }, [word, market, tradeMode, side, sellShares])

  const heldForSide = side === 'YES'
    ? (userTokens[selectedWordIdx]?.yes ?? 0n)
    : (userTokens[selectedWordIdx]?.no ?? 0n)

  const streamEmbedUrl = metadata?.stream_url ? toEmbedUrl(metadata.stream_url) : null
  const DESC_LIMIT = 180

  const chartMarkets = useMemo(() => {
    if (!market) return []
    return market.words.map((w, i) => ({
      marketId: String(i),
      title: w.label,
      currentPrice: impliedYesPrice(w, market.liquidityParamB),
    }))
  }, [market])

  const chartSeries = useMemo(() => {
    if (!market) return []
    return market.words.map((w, i) => {
      const wordData = chartData.find(cd => cd.wordIndex === i)
      const currentPrice = impliedYesPrice(w, market.liquidityParamB)
      const data: { t: number; p: number }[] = wordData?.history.length
        ? [...wordData.history]
        : [{ t: Math.floor((Date.now() - 3600000) / 1000), p: 0.5 }]
      if (market.status !== MarketStatus.Resolved) {
        data.push({ t: Math.floor(Date.now() / 1000), p: currentPrice })
      }
      return { marketId: String(i), title: w.label, currentPrice, data }
    })
  }, [market, chartData])

  const sliderMax = tradeMode === 'buy' ? userUsdc : heldForSide
  const sliderValue = sliderMax > 0n ? Math.min(100, (amountNum * 1_000_000 / Number(sliderMax)) * 100) : 0

  const isOpen = market?.status === MarketStatus.Open
  const isResolved = market?.status === MarketStatus.Resolved
  const canTrade = isOpen && !!publicKey && !!signer && !!signOnly

  const showBuyPreview = tradeMode === 'buy' && amountNum > 0 && estimatedShares > 0n
  const showSellPreview = tradeMode === 'sell' && amountNum > 0 && estimatedReturn > 0n

  // ── Quick-amount preset handler ───────────────────────────

  const handlePreset = useCallback((pct: number) => {
    const max = tradeMode === 'buy' ? userUsdc : heldForSide
    if (max <= 0n) return
    const fraction = Number(max) * pct / 100
    if (tradeMode === 'buy') {
      // USDC: format to 2dp
      setAmount((Math.floor(fraction / 10_000) / 100).toString())
    } else {
      // Tokens: format to 2dp truncated
      const tokens = fraction / 1_000_000
      const truncated = Math.floor(tokens * 100) / 100
      setAmount(truncated.toFixed(2))
    }
  }, [tradeMode, userUsdc, heldForSide])

  // ── Word selection handler ────────────────────────────────

  const handleWordClick = useCallback((idx: number) => {
    if (!market) return
    const w = market.words[idx]
    if (w.outcome !== null) return // don't select resolved words for trading
    setSelectedWordIdx(idx)
    setAmount('')
  }, [market])

  // ── Transactions ──────────────────────────────────────────

  const handleBuy = useCallback(async () => {
    if (!market || !signer || !signOnly || !publicKey || !word || amountNum <= 0) return
    setTxPending(true)
    setTradeStatus(null)
    try {
      const wallet = publicKey as Address
      const usdcUnits = BigInt(Math.floor(amountNum * 1_000_000))
      const shares = sharesForUsdc(word, market.liquidityParamB, side, usdcUnits)
      if (shares <= 0n) throw new Error('Amount too small')
      const cost = estimateBuyCost(word, market.liquidityParamB, side, shares)
      const fee = (cost * BigInt(market.tradeFeeBps)) / 10000n
      const maxCost = cost + fee + (cost + fee) / 50n // 2% slippage

      const ataIx = await createAtaIx(wallet, wallet, side === 'YES' ? word.yesMint : word.noMint)
      const buyIx = await createBuyIx(wallet, id, selectedWordIdx, side, shares, maxCost)
      await sendInstructions(signer, signOnly, [ataIx, buyIx])

      setTradeStatus({ msg: `Bought ${formatTokens(shares)} ${side} tokens for "${word.label}"`, error: false })
      setAmount('')
      setTimeout(() => { loadMarket(); loadUserData(market); fetchTrades() }, 2000)
    } catch (e: unknown) {
      setTradeStatus({ msg: e instanceof Error ? e.message : String(e), error: true })
    } finally {
      setTxPending(false)
      setTimeout(() => setTradeStatus(null), 8000)
    }
  }, [market, signer, signOnly, publicKey, word, amountNum, side, id, selectedWordIdx, loadMarket, loadUserData, fetchTrades])

  const handleSell = useCallback(async () => {
    if (!market || !signer || !signOnly || !publicKey || !word || sellShares <= 0n) return
    setTxPending(true)
    setTradeStatus(null)
    try {
      const wallet = publicKey as Address
      const ret = estimateSellReturn(word, market.liquidityParamB, side, sellShares)
      const minReturn = ret - ret / 50n // 2% slippage
      const sellIx = await createSellIx(wallet, id, selectedWordIdx, side, sellShares, minReturn)
      await sendInstructions(signer, signOnly, [sellIx])

      setTradeStatus({ msg: `Sold ${formatTokens(sellShares)} ${side} tokens`, error: false })
      setAmount('')
      setTimeout(() => { loadMarket(); loadUserData(market); fetchTrades() }, 2000)
    } catch (e: unknown) {
      setTradeStatus({ msg: e instanceof Error ? e.message : String(e), error: true })
    } finally {
      setTxPending(false)
      setTimeout(() => setTradeStatus(null), 8000)
    }
  }, [market, signer, signOnly, publicKey, word, side, sellShares, id, selectedWordIdx, loadMarket, loadUserData, fetchTrades])

  const handleRedeem = useCallback(async (wordIndex: number, dir: 'YES' | 'NO') => {
    if (!market || !signer || !signOnly || !publicKey) return
    setTxPending(true)
    setTradeStatus(null)
    try {
      const wallet = publicKey as Address
      const redeemIx = await createRedeemIx(wallet, id, wordIndex, dir)
      await sendInstructions(signer, signOnly, [redeemIx])
      setTradeStatus({ msg: 'Redeemed successfully!', error: false })
      setTimeout(() => { loadMarket(); loadUserData(market) }, 2000)
    } catch (e: unknown) {
      setTradeStatus({ msg: e instanceof Error ? e.message : String(e), error: true })
    } finally {
      setTxPending(false)
      setTimeout(() => setTradeStatus(null), 8000)
    }
  }, [market, signer, signOnly, publicKey, id, loadMarket, loadUserData])

  // ── Trading Panel ─────────────────────────────────────────

  const tradingPanel = word ? (
    <>
      {/* Header: market icon + selected word */}
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-white/10">
        <div className="w-9 h-9 rounded-full overflow-hidden bg-neutral-800 flex-shrink-0">
          {metadata?.cover_image_url ? (
            <img src={metadata.cover_image_url} alt={word.label} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-base">🎯</div>
          )}
        </div>
        <span className="text-white font-semibold text-base truncate">{word.label}</span>
      </div>

      {/* Buy / Sell tabs */}
      <div className="flex items-center gap-5 mb-5">
        <button
          onClick={() => { setTradeMode('buy'); setAmount('') }}
          className={`text-base font-semibold pb-1 border-b-2 transition-all duration-200 ${
            tradeMode === 'buy' ? 'text-white border-white' : 'text-neutral-500 border-transparent hover:text-neutral-300'
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => { setTradeMode('sell'); setAmount('') }}
          className={`text-base font-semibold pb-1 border-b-2 transition-all duration-200 ${
            tradeMode === 'sell' ? 'text-white border-white' : 'text-neutral-500 border-transparent hover:text-neutral-300'
          }`}
        >
          Sell
        </button>
      </div>

      {/* YES / NO direction buttons */}
      {(() => {
        const yesPrice = impliedYesPrice(word, market!.liquidityParamB)
        const yesCents = Math.round(yesPrice * 100)
        const noCents = 100 - yesCents
        return (
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
        )
      })()}

      {/* Amount section */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-neutral-400 font-medium">
            {tradeMode === 'buy' ? 'USDC to spend' : 'Shares to sell'}
          </span>
          {connected && (
            <div className="text-right">
              {tradeMode === 'buy' ? (
                <>
                  <span className={`text-xs font-medium transition-colors ${showBuyPreview ? 'text-apple-red' : 'text-neutral-400'}`}>
                    {showBuyPreview
                      ? `$${formatUsdc(userUsdc - estimatedCost - feeOnCost)} USDC`
                      : `$${formatUsdc(userUsdc)} USDC`}
                  </span>
                  <span className="block text-[10px] text-neutral-600">
                    {showBuyPreview ? 'remaining after trade' : 'available'}
                  </span>
                </>
              ) : (
                <>
                  <span className={`text-xs font-medium transition-colors ${showSellPreview ? 'text-apple-green' : 'text-neutral-400'}`}>
                    {formatTokens(heldForSide)} {side} held
                  </span>
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

        {/* Preset quick buttons */}
        {(tradeMode === 'buy' || heldForSide > 0n) && (
          <div className="flex gap-2">
            {[25, 50, 75, 100].map(pct => (
              <button
                key={pct}
                onClick={() => handlePreset(pct)}
                className="flex-1 py-1.5 text-xs font-semibold rounded-full bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition-colors border border-white/10"
              >
                {pct === 100 ? 'Max' : `${pct}%`}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Buy preview — animated slide-down */}
      <div
        style={{
          maxHeight: showBuyPreview ? '140px' : '0px',
          opacity: showBuyPreview ? 1 : 0,
          transform: showBuyPreview ? 'translateY(0)' : 'translateY(-10px)',
          overflow: 'hidden',
          transition: 'max-height 0.3s ease-out, opacity 0.25s ease-out, transform 0.25s ease-out',
          marginBottom: showBuyPreview ? '16px' : '0px',
        }}
      >
        <div className="border-t border-white/10 pt-4">
          <div className="flex items-end justify-between mb-1.5">
            <span className="text-sm text-neutral-400">Est. shares</span>
            <span className="text-3xl font-bold text-white">
              {formatTokens(estimatedShares)}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span>
              Avg price{' '}
              {estimatedShares > 0n
                ? Math.round((Number(estimatedCost + feeOnCost) / Number(estimatedShares)) * 100)
                : 0}¢
            </span>
            <span className="text-neutral-400">
              fee ${formatUsdc(feeOnCost)} ({(market?.tradeFeeBps ?? 0) / 100}%)
            </span>
          </div>
        </div>
      </div>

      {/* Sell preview — animated slide-down */}
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
            <span className="text-sm text-neutral-400">USDC returned ~</span>
            <span className="text-2xl font-bold text-white">${formatUsdc(estimatedReturn)}</span>
          </div>
        </div>
      </div>

      {/* Trade status message */}
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
          {market?.status === MarketStatus.Paused ? 'Market Paused' : 'Market Resolved'}
        </button>
      ) : !connected ? (
        <button
          onClick={connect}
          className="w-full py-4 bg-white hover:bg-neutral-100 text-black font-bold text-base rounded-2xl transition-all duration-200"
        >
          Login to trade
        </button>
      ) : (
        <button
          onClick={tradeMode === 'buy' ? handleBuy : handleSell}
          disabled={txPending || !canTrade || amountNum <= 0}
          className={`w-full py-4 font-bold text-base rounded-2xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${
            side === 'YES'
              ? 'bg-apple-green hover:bg-apple-green/90 text-white'
              : 'bg-apple-red hover:bg-apple-red/90 text-white'
          }`}
        >
          {txPending ? (
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
      )}

      {/* User positions */}
      {connected && userTokens.some(t => t.yes > 0n || t.no > 0n) && market && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-2">
            Your Positions
          </div>
          <div className="space-y-2">
            {market.words.map((w, i) => {
              const tok = userTokens[i]
              if (!tok || (tok.yes <= 0n && tok.no <= 0n)) return null
              const winDir: 'YES' | 'NO' | null = w.outcome === true ? 'YES' : w.outcome === false ? 'NO' : null
              return (
                <div
                  key={i}
                  className="glass rounded-lg p-2.5"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-white font-medium text-xs truncate max-w-[140px]">{w.label}</span>
                    {winDir && (
                      <span className={`text-[10px] font-bold uppercase ${winDir === 'YES' ? 'text-apple-green' : 'text-apple-red'}`}>
                        {winDir === side ? 'Won' : 'Lost'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {tok.yes > 0n && (
                      <button
                        onClick={() => {
                          if (isResolved && w.outcome === true) {
                            handleRedeem(i, 'YES')
                          } else if (!w.outcome) {
                            setSelectedWordIdx(i)
                            setTradeMode('sell')
                            setSide('YES')
                            setAmount('')
                          }
                        }}
                        className={`text-[11px] px-2 py-1 rounded-md border transition-colors ${
                          isResolved && w.outcome !== null
                            ? w.outcome === true
                              ? 'border-apple-green/40 bg-apple-green/10 text-apple-green hover:bg-apple-green/20'
                              : 'border-white/10 bg-white/5 text-neutral-500 cursor-default'
                            : 'border-apple-green/30 text-apple-green hover:bg-apple-green/10'
                        }`}
                        disabled={isResolved && w.outcome !== true}
                      >
                        {formatTokens(tok.yes)} YES
                        {isResolved && w.outcome === true ? ' · Redeem' : !w.outcome ? ' · sell' : ''}
                      </button>
                    )}
                    {tok.no > 0n && (
                      <button
                        onClick={() => {
                          if (isResolved && w.outcome === false) {
                            handleRedeem(i, 'NO')
                          } else if (!w.outcome) {
                            setSelectedWordIdx(i)
                            setTradeMode('sell')
                            setSide('NO')
                            setAmount('')
                          }
                        }}
                        className={`text-[11px] px-2 py-1 rounded-md border transition-colors ${
                          isResolved && w.outcome !== null
                            ? w.outcome === false
                              ? 'border-apple-red/40 bg-apple-red/10 text-apple-red hover:bg-apple-red/20'
                              : 'border-white/10 bg-white/5 text-neutral-500 cursor-default'
                            : 'border-apple-red/30 text-apple-red hover:bg-apple-red/10'
                        }`}
                        disabled={isResolved && w.outcome !== false}
                      >
                        {formatTokens(tok.no)} NO
                        {isResolved && w.outcome === false ? ' · Redeem' : !w.outcome ? ' · sell' : ''}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  ) : null

  // ── Loading / Error ────────────────────────────────────────

  if (loading || !market) {
    if (error) { /* fall through */ } else return null
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

  // ── Full render ────────────────────────────────────────────

  const isResolvingSoon = market.status === MarketStatus.Open && (Number(market.resolvesAt) * 1000 - Date.now()) > 0

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
                <span className="text-neutral-400">Paid Market</span>
              </div>

              {/* Market header */}
              <div className="flex items-start gap-3 md:gap-4 mb-4 md:mb-5">
                <div className="w-12 h-12 md:w-14 md:h-14 rounded-xl overflow-hidden flex-shrink-0 bg-neutral-800">
                  {metadata?.cover_image_url ? (
                    <img src={metadata.cover_image_url} alt={market.label} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl">🎯</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="text-lg md:text-xl font-semibold text-white leading-tight">
                    {market.label}
                  </h1>
                </div>
              </div>

              {/* Meta bar */}
              <div className="flex items-center flex-wrap gap-3 mb-4 text-xs md:text-sm text-neutral-400">
                <span>${formatUsdc(market.tradeFeeBps > 0 ? market.accumulatedFees * 10000n / BigInt(market.tradeFeeBps) : 0n)} volume</span>
                <span className="text-neutral-700">·</span>
                <span>{market.words.length} word{market.words.length !== 1 ? 's' : ''}</span>
                <span className="text-neutral-700">·</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${statusPillClasses(market.status)}`}>
                  {statusLabel(market.status)}
                </span>
                <span className="text-neutral-700">·</span>
                <span>{(market.tradeFeeBps / 100).toFixed(1)}% fee</span>
                {isResolvingSoon && (
                  <>
                    <span className="text-neutral-700">·</span>
                    <span>Resolves {formatResolveTime(market.resolvesAt)}</span>
                    <span className="text-neutral-700">·</span>
                    <span>{timeUntil(market.resolvesAt)} left</span>
                  </>
                )}
              </div>

              {/* Stream label row */}
              {streamEmbedUrl && !streamHidden && (
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <div className="w-2 h-2 rounded-full bg-apple-red animate-pulse flex-shrink-0" />
                  <span className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">Live Stream</span>
                  <button onClick={() => setStreamHidden(true)} className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors">
                    Hide stream
                  </button>
                </div>
              )}
              {streamEmbedUrl && streamHidden && (
                <button
                  onClick={() => setStreamHidden(false)}
                  className="flex items-center gap-2 mb-4 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                >
                  <div className="w-2 h-2 rounded-full bg-apple-red animate-pulse" />
                  <span className="text-xs font-medium text-neutral-300">Show live stream</span>
                </button>
              )}

              {/* Two-column layout */}
              <div className="flex gap-6">
                {/* Left column */}
                <div className="flex-1 min-w-0">
                  {/* Stream embed */}
                  {streamEmbedUrl && !streamHidden && (
                    <div className="mb-5">
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

                  {/* Price chart */}
                  {chartLoading ? (
                    <div className="mb-5 w-full h-[280px] rounded-2xl bg-white/[0.02] border border-white/5 flex items-center justify-center">
                      <MentionedSpinner className="" />
                    </div>
                  ) : chartMarkets.length > 0 && (
                    <div className="mb-5">
                      <EventPriceChart
                        eventId={`paid_${marketId}`}
                        markets={chartMarkets}
                        selectedMarketId={String(selectedWordIdx)}
                        hoveredMarketId={null}
                        preloadedSeries={chartSeries.length > 0 ? chartSeries : undefined}
                      />
                    </div>
                  )}

                  {/* Words table */}
                  <div className="mb-6">
                    {/* Table header */}
                    <div className="flex items-center justify-between px-3 md:px-4 py-3 border-b border-white/10">
                      <span className="text-xs md:text-sm text-neutral-400 font-medium w-2/5">Word</span>
                      <span className="text-xs md:text-sm text-neutral-400 font-medium text-center flex-1">Chance</span>
                      <span className="text-xs md:text-sm text-neutral-400 font-medium text-center w-[148px] md:w-[232px]">Trade</span>
                    </div>

                    {market.words.map((w, i) => {
                      const isResolved = w.outcome !== null
                      const yesPrice = impliedYesPrice(w, market.liquidityParamB)
                      const pct = isResolved
                        ? (w.outcome ? 100 : 0)
                        : Math.round(yesPrice * 100)
                      const yesCents = isResolved
                        ? (w.outcome ? 100 : 0)
                        : Math.round(yesPrice * 100)
                      const noCents = 100 - yesCents
                      const isSelected = i === selectedWordIdx
                      const winDir: 'YES' | 'NO' | null = w.outcome === true ? 'YES' : w.outcome === false ? 'NO' : null
                      const userYes = userTokens[i]?.yes ?? 0n
                      const userNo = userTokens[i]?.no ?? 0n

                      return (
                        <div key={i}>
                          <button
                            onClick={() => {
                              handleWordClick(i)
                              if (window.innerWidth < 1024 && !isResolved) setMobileTradeOpen(true)
                            }}
                            className={`w-full flex items-center justify-between px-3 md:px-4 py-3 md:py-4 border-b border-white/5 transition-all duration-200 hover:bg-white/[0.03] ${
                              isSelected ? 'bg-white/[0.05]' : ''
                            }`}
                          >
                            <div className="flex items-center gap-2 md:gap-3 w-2/5">
                              <span className="text-white font-semibold text-sm md:text-[15px] text-left">{w.label}</span>
                              {isResolved && (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase flex-shrink-0 ${
                                  w.outcome
                                    ? 'bg-apple-green/15 text-apple-green'
                                    : 'bg-apple-red/15 text-apple-red'
                                }`}>
                                  {w.outcome ? 'YES' : 'NO'}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 md:gap-2 flex-1 justify-center">
                              <FlashValue value={`${pct}%`} className="text-white font-bold text-base md:text-lg" />
                            </div>

                            <div className="flex items-center gap-1.5 md:gap-2 w-[148px] md:w-[232px] justify-end">
                              {isResolved ? (
                                <span className={`px-3 md:px-5 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-semibold border ${
                                  w.outcome
                                    ? 'bg-apple-green/10 border-apple-green/30 text-apple-green'
                                    : 'bg-apple-red/10 border-apple-red/30 text-apple-red'
                                }`}>
                                  Resolved {w.outcome ? 'Yes' : 'No'}
                                </span>
                              ) : (
                                <>
                                  <span
                                    className={`w-[70px] md:w-[110px] py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-semibold border transition-all duration-200 flex items-center justify-center gap-1 tabular-nums ${
                                      isSelected && side === 'YES'
                                        ? 'bg-apple-green/15 border-apple-green text-apple-green'
                                        : 'border-white/10 text-apple-green hover:border-apple-green/30'
                                    }`}
                                    onClick={e => {
                                      e.stopPropagation()
                                      setSelectedWordIdx(i)
                                      setSide('YES')
                                      setAmount('')
                                      if (window.innerWidth < 1024) setMobileTradeOpen(true)
                                    }}
                                  >
                                    Yes <FlashValue value={`${yesCents}¢`} />
                                  </span>
                                  <span
                                    className={`w-[70px] md:w-[110px] py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-semibold border transition-all duration-200 flex items-center justify-center gap-1 tabular-nums ${
                                      isSelected && side === 'NO'
                                        ? 'bg-apple-red/15 border-apple-red text-apple-red'
                                        : 'border-white/10 text-apple-red hover:border-apple-red/30'
                                    }`}
                                    onClick={e => {
                                      e.stopPropagation()
                                      setSelectedWordIdx(i)
                                      setSide('NO')
                                      setAmount('')
                                      if (window.innerWidth < 1024) setMobileTradeOpen(true)
                                    }}
                                  >
                                    No <FlashValue value={`${noCents}¢`} />
                                  </span>
                                </>
                              )}
                            </div>
                          </button>

                          {/* Redeem row for resolved markets with winning positions */}
                          {isResolved && winDir && connected && (
                            (() => {
                              const winTokens = winDir === 'YES' ? userYes : userNo
                              if (winTokens <= 0n) return null
                              return (
                                <div className="px-3 md:px-4 py-2 border-b border-white/5 bg-apple-green/5">
                                  <button
                                    onClick={() => handleRedeem(i, winDir)}
                                    disabled={txPending}
                                    className="w-full py-2.5 rounded-xl text-sm font-semibold bg-apple-green hover:bg-apple-green/90 text-white disabled:opacity-50 transition-all"
                                  >
                                    {txPending
                                      ? 'Processing...'
                                      : `Redeem ${formatTokens(winTokens)} ${winDir} → $${formatUsdc(winTokens)} USDC`}
                                  </button>
                                </div>
                              )
                            })()
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Description */}
                  {metadata?.description && (
                    <div className="mb-5">
                      <DescriptionBlock text={metadata.description} limit={DESC_LIMIT} />
                    </div>
                  )}

                  {/* Recent trades */}
                  {trades.length > 0 && (
                    <div className="mb-6">
                      <h2 className="text-base font-semibold text-white mb-3">Recent Trades</h2>
                      <div className="glass rounded-2xl p-4">
                        <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                          {trades.map(t => {
                            const wordLabel = market?.words[t.wordIndex]?.label ?? `Word ${t.wordIndex}`
                            const displayName = t.username || `${t.trader.slice(0, 4)}...${t.trader.slice(-4)}`
                            return (
                              <div key={t.signature} className="flex items-center justify-between text-xs py-1">
                                <div className="flex items-center gap-1.5 text-neutral-400 min-w-0 flex-1">
                                  <Link
                                    href={`/profile/${t.username || t.trader}`}
                                    className="text-neutral-300 font-medium hover:text-apple-blue transition-colors flex-shrink-0"
                                  >
                                    {displayName}
                                  </Link>
                                  <span className="flex-shrink-0">{t.isBuy ? 'bought' : 'sold'}</span>
                                  <span className={`flex-shrink-0 font-medium ${t.direction === 'YES' ? 'text-apple-green' : 'text-apple-red'}`}>
                                    {t.quantity.toFixed(0)} {t.direction}
                                  </span>
                                  <span className="flex-shrink-0">for</span>
                                  <span className="flex-shrink-0 text-neutral-300">${formatUsdc(BigInt(Math.round(t.cost)))}</span>
                                  <span className="truncate">on {wordLabel}</span>
                                </div>
                                <span className="text-neutral-600 flex-shrink-0 ml-3 pr-1">{Math.round(t.impliedPrice * 100)}¢</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Spacer for mobile bottom bar */}
                  <div className="h-20 lg:hidden" />
                </div>

                {/* Right column — sticky trading panel (desktop only) */}
                <div className="w-[340px] flex-shrink-0 hidden lg:block">
                  <div className="sticky top-28">
                    <div className="glass rounded-2xl p-5">
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
          <div className="bg-neutral-900/95 backdrop-blur-md border-t border-white/10 px-4 pt-2 pb-3">
            <button
              onClick={() => setMobileTradeOpen(true)}
              className={`w-full py-3 font-semibold text-white rounded-xl transition-all ${
                side === 'YES' ? 'bg-apple-green' : 'bg-apple-red'
              }`}
            >
              {word ? `Trade ${word.label}` : 'Trade'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
