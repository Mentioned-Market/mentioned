'use client'

import { useState, useMemo, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Header from '@/components/Header'
import CountdownTimer from '@/components/CountdownTimer'
import MarketChart from '@/components/MarketChart'
import { useWallet } from '@/contexts/WalletContext'
import {
  fetchAllWordMarkets,
  fetchUserPositions,
  type WordMarket,
  type UserPosition,
  MarketStatus,
  marketStatusStr,
  outcomeStr,
} from '@/lib/mentionMarket'
import { address as toAddress } from '@solana/kit'

interface Word {
  word: string
  yesPrice: string
  noPrice: string
  volume: number
  change: number
}

const SOL_USD_RATE = 175 // mock rate

export default function MarketPage() {
  const params = useParams()
  const marketId = params.id as string
  const { connected, connect, publicKey } = useWallet()

  const [selectedWord, setSelectedWord] = useState<string | null>(null)
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [selectedSide, setSelectedSide] = useState<'YES' | 'NO'>('YES')
  const [amount, setAmount] = useState('')
  const [chartPeriod, setChartPeriod] = useState<'1D' | '1W' | '1M' | 'ALL'>('ALL')
  const [showAllWords, setShowAllWords] = useState(false)
  const [denomination, setDenomination] = useState<'SOL' | 'USD'>('SOL')
  const [denomDropdownOpen, setDenomDropdownOpen] = useState(false)
  const [rulesExpanded, setRulesExpanded] = useState(false)
  const [mobileTradeOpen, setMobileTradeOpen] = useState(false)

  // Chart legend — track up to 3 words
  const chartColors = ['#34C759', '#007AFF', '#FF9500']
  const [trackedWords, setTrackedWords] = useState<string[]>([])

  // On-chain data state
  const isNumericMarket = /^\d+$/.test(marketId)
  const [onChainWords, setOnChainWords] = useState<WordMarket[] | null>(null)
  const [onChainStatus, setOnChainStatus] = useState<MarketStatus | null>(null)
  const [loading, setLoading] = useState(isNumericMarket)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [userPositions, setUserPositions] = useState<UserPosition[]>([])

  useEffect(() => {
    if (!isNumericMarket) return

    let cancelled = false
    setLoading(true)
    setFetchError(null)

    fetchAllWordMarkets()
      .then((all) => {
        if (cancelled) return
        const targetId = BigInt(marketId)
        const matches = all
          .filter((m) => m.account.marketId === targetId)
          .sort((a, b) => a.account.wordIndex - b.account.wordIndex)

        if (matches.length === 0) {
          setFetchError('Market not found')
          setOnChainWords(null)
        } else {
          setOnChainWords(matches.map((m) => m.account))
          setOnChainStatus(matches[0].account.status)
        }
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Failed to fetch markets:', err)
        setFetchError('Failed to load market data')
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [isNumericMarket, marketId])

  // Fetch user positions for this market
  useEffect(() => {
    if (!publicKey || !isNumericMarket) {
      setUserPositions([])
      return
    }
    let cancelled = false

    fetchUserPositions(toAddress(publicKey))
      .then((positions) => {
        if (cancelled) return
        const marketPositions = positions.filter(
          (p) => p.market.marketId === BigInt(marketId)
        )
        setUserPositions(marketPositions)
      })
      .catch(console.error)

    return () => { cancelled = true }
  }, [publicKey, isNumericMarket, marketId])

  interface MarketData {
    id: string
    title: string
    category: string
    eventTime: Date
    eventDateLabel: string
    imageUrl: string
    words: Word[]
    totalVolume: number
    rules: {
      summary: string
      details: string
      marketOpen: string
      marketCloses: string
      projectedPayout: string
      expiryNote: string
      series: string
      event: string
      marketCode: string
    }
  }

  const market = useMemo((): MarketData => {
    const now = Date.now()

    // On-chain market data
    if (isNumericMarket && onChainWords && onChainWords.length > 0) {
      const totalCol = onChainWords.reduce(
        (sum, w) => sum + Number(w.totalCollateral),
        0
      )
      return {
        id: marketId,
        title: `Market #${marketId}`,
        category: 'Mentions · On-Chain',
        eventTime: new Date(now + 2 * 60 * 60 * 1000),
        eventDateLabel: 'TBD',
        imageUrl: '/src/logo.png',
        words: onChainWords.map((w) => ({
          word: w.label,
          yesPrice: '0.50',
          noPrice: '0.50',
          volume: Number(w.totalCollateral),
          change: 0,
        })),
        totalVolume: totalCol,
        rules: {
          summary: `If the speaker says this word during the event, then the market resolves to Yes. Outcome verified from the official broadcast.`,
          details: 'The exact phrase/word, or a plural or possessive form of the phrase/word, must be used. Grammatical/tense inflections are otherwise not included. Commentary will count once the speech has started and end once the speech has concluded.',
          marketOpen: 'When market is created',
          marketCloses: 'After the outcome occurs',
          projectedPayout: '30 minutes after closing',
          expiryNote: 'This market will close when paused and resolved by the authority.',
          series: `MNTD-MARKET-${marketId}`,
          event: `MNTD-MARKET-${marketId}`,
          marketCode: `MNTD-MARKET-${marketId}`,
        },
      }
    }

    // Hardcoded demo data
    const marketData: Record<string, MarketData> = {
      'trump-speech': {
        id: 'trump-speech',
        title: "Trump Iowa Rally",
        category: "Mentions · Politics",
        eventTime: new Date(now + 2 * 60 * 60 * 1000),
        eventDateLabel: 'Feb 14, 12:00pm EST',
        imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCPwsL0smxRVROhCkwShqqarIa-4xnAdVdAomChQJ_T5mRI0s77w-xoaIXYP2m8tRl-uEGpY2db-WBf6yZIfORA6Azp8_G7mOSTRPFRKHgyuo-4Ltlj_aMHH0t0PkSvdDO95rJOZpBgoS7jAKqkQ_7C86iSDgLJC9vDfV4YSshAaEhuIv2qI0WDcGs0VSLKNYTrz72KduCuH-fH8XBkROiM1zDK2dJlV6R0sCiMjP_Y3Ml19Uglhnihkb8ZD1prCuWa0i_wip0TXSI',
        words: [
          { word: 'Immigration', yesPrice: '0.72', noPrice: '0.28', volume: 125000, change: -6 },
          { word: 'Economy', yesPrice: '0.65', noPrice: '0.35', volume: 98000, change: -5 },
          { word: 'China', yesPrice: '0.58', noPrice: '0.42', volume: 87000, change: 3 },
          { word: 'Border', yesPrice: '0.81', noPrice: '0.19', volume: 156000, change: 8 },
          { word: 'Taxes', yesPrice: '0.45', noPrice: '0.55', volume: 67000, change: -11 },
          { word: 'Jobs', yesPrice: '0.67', noPrice: '0.33', volume: 89000, change: 2 },
          { word: 'Trade', yesPrice: '0.52', noPrice: '0.48', volume: 72000, change: -3 },
          { word: 'America', yesPrice: '0.89', noPrice: '0.11', volume: 234000, change: 12 },
          { word: 'Freedom', yesPrice: '0.76', noPrice: '0.24', volume: 145000, change: 5 },
          { word: 'Victory', yesPrice: '0.83', noPrice: '0.17', volume: 178000, change: -2 },
        ],
        totalVolume: 1251000,
        rules: {
          summary: 'If the speaker says this word during the Trump Iowa Rally originally scheduled for Feb 14, 2026, then the market resolves to Yes. Outcome verified from the official broadcast.',
          details: 'Video of the Trump Iowa Rally originally scheduled for Feb 14, 2026 will be primarily used to resolve the market; if a consensus cannot be reached using video, transcripts will be used according to the news publications listed in the contract. The exact phrase/word, or a plural or possessive form of the phrase/word, must be used. Grammatical/tense inflections are otherwise not included. Please see full rules for more details. Commentary will count once the speech has started and end once the speech has concluded. For the purpose of this market, previous recordings aired during this event will count. Promotional content aired during the event will count, but advertisements will not. For the purpose of this market, this market will resolve based on the national broadcast.',
          marketOpen: 'Feb 12, 2026 · 8:00pm EST',
          marketCloses: 'After the outcome occurs',
          projectedPayout: '30 minutes after closing',
          expiryNote: 'This market will close and expire early if the event occurs. Otherwise, it closes by Feb 14, 2026 at 5:00pm EST.',
          series: 'MNTD-RALLY-MENTION',
          event: 'MNTD-RALLY-MENTION-26FEB14IOWA',
          marketCode: 'MNTD-RALLY-MENTION-26FEB14IOWA',
        },
      },
    }
    return marketData[marketId] || marketData['trump-speech']
  }, [marketId, isNumericMarket, onChainWords])

  // Initialize tracked words and selected word
  useMemo(() => {
    if (market.words.length > 0) {
      if (trackedWords.length === 0 || !trackedWords.some(tw => market.words.some(w => w.word === tw))) {
        setTrackedWords(market.words.slice(0, 3).map(w => w.word))
      }
      if (selectedWord === null || !market.words.some(w => w.word === selectedWord)) {
        setSelectedWord(market.words[0].word)
      }
    }
  }, [market.words, trackedWords.length, selectedWord])

  const selectedWordData = market.words.find(w => w.word === selectedWord) || market.words[0]

  // Generate chart data for tracked words
  const chartSeries = useMemo(() => {
    return trackedWords.map((wordName, i) => {
      const word = market.words.find(w => w.word === wordName)
      if (!word) return null

      const data: { timestamp: number; price: number }[] = []
      const now = Date.now()
      const endPrice = parseFloat(word.yesPrice)
      const startPrice = endPrice - 0.1 + Math.random() * 0.05

      for (let j = 0; j < 60; j++) {
        const progress = j / 59
        const timestamp = now - (24 * 60 * 60 * 1000) * (1 - progress)
        const volatility = (Math.random() - 0.5) * 0.04
        const trend = startPrice + (endPrice - startPrice) * progress
        const price = Math.max(0.01, Math.min(0.99, trend + volatility))
        data.push({ timestamp, price })
      }

      return {
        label: word.word,
        color: chartColors[i % chartColors.length],
        data,
        currentPrice: endPrice,
      }
    }).filter(Boolean) as { label: string; color: string; data: { timestamp: number; price: number }[]; currentPrice: number }[]
  }, [trackedWords, market.words])

  const yesCents = Math.round(parseFloat(selectedWordData.yesPrice) * 100)
  const noCents = Math.round(parseFloat(selectedWordData.noPrice) * 100)

  const handleWordClick = (word: string) => {
    setSelectedWord(word)
    if (!trackedWords.includes(word)) {
      setTrackedWords(prev => {
        const next = [...prev, word]
        if (next.length > 3) next.shift()
        return next
      })
    }
  }

  const formatVolume = (vol: number) => {
    if (vol >= 1000000) return `$${(vol / 1000000).toFixed(1)}M`
    if (vol >= 1000) return `$${(vol / 1000).toFixed(0)}K`
    return `$${vol}`
  }

  // Amount conversion helpers
  const amountNum = parseFloat(amount) || 0
  const convertedAmount = denomination === 'SOL'
    ? (amountNum * SOL_USD_RATE).toFixed(2)
    : (amountNum / SOL_USD_RATE).toFixed(4)
  const convertedLabel = denomination === 'SOL' ? 'USD' : 'SOL'

  const visibleWords = showAllWords ? market.words : market.words.slice(0, 3)

  // Color for the side label
  const sideColor = selectedSide === 'YES' ? 'text-apple-green' : 'text-apple-red'

  // Potential winnings: amount buys (amount / price) shares, each pays 1 unit if correct
  const activePrice = selectedSide === 'YES'
    ? parseFloat(selectedWordData.yesPrice)
    : parseFloat(selectedWordData.noPrice)
  const amountInSol = denomination === 'SOL' ? amountNum : amountNum / SOL_USD_RATE
  const potentialPayout = activePrice > 0 ? amountInSol / activePrice : 0
  const potentialProfit = potentialPayout - amountInSol

  // User's position for the currently selected word
  const selectedWordPosition = useMemo(() => {
    if (!selectedWord) return null
    return userPositions.find((p) => p.market.label === selectedWord) ?? null
  }, [selectedWord, userPositions])

  // Trading panel content (shared between desktop sidebar and mobile sheet)
  const tradingPanel = (
    <>
      {/* Event info */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 bg-neutral-800">
          <img
            src={market.imageUrl}
            alt={market.title}
            className="w-full h-full object-cover"
          />
        </div>
        <span className="text-sm text-neutral-300 font-medium">
          {market.title}
        </span>
      </div>

      {/* Selected word — color based on YES/NO */}
      <div className="mb-5">
        <span className={`font-semibold text-sm ${sideColor}`}>
          {side === 'buy' ? 'Buy' : 'Sell'} {selectedSide}
        </span>
        <span className="text-neutral-400 text-sm"> · </span>
        <span className="text-white font-semibold text-sm">
          {selectedWordData.word}
        </span>
      </div>

      {/* Buy / Sell Toggle */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setSide('buy')}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
            side === 'buy'
              ? 'bg-white/10 text-white'
              : 'text-neutral-500 hover:text-neutral-300'
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setSide('sell')}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
            side === 'sell'
              ? 'bg-white/10 text-white'
              : 'text-neutral-500 hover:text-neutral-300'
          }`}
        >
          Sell
        </button>
      </div>

      {/* Yes / No Price Buttons */}
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => setSelectedSide('YES')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
            selectedSide === 'YES'
              ? 'bg-apple-green/15 text-apple-green border border-apple-green/40'
              : 'border border-white/10 text-neutral-400 hover:border-white/20'
          }`}
        >
          Yes {yesCents}¢
        </button>
        <button
          onClick={() => setSelectedSide('NO')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
            selectedSide === 'NO'
              ? 'bg-apple-red/15 text-apple-red border border-apple-red/40'
              : 'border border-white/10 text-neutral-400 hover:border-white/20'
          }`}
        >
          No {noCents}¢
        </button>
      </div>

      {/* Amount Input */}
      <div className="mb-5">
        <div className="flex items-center justify-between py-3">
          <div className="flex-shrink-0">
            <div className="text-sm text-neutral-400 font-medium">Amount</div>
            {amountNum > 0 && (
              <div className="text-xs text-neutral-500 mt-0.5">
                ({denomination === 'SOL' ? '$' : ''}{convertedAmount} {convertedLabel})
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 min-w-0 justify-end">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9.]/g, '')
                setAmount(val)
              }}
              placeholder="0"
              className="bg-transparent border-0 text-right text-2xl font-semibold text-white min-w-0 flex-1 focus:outline-none focus:ring-0 placeholder:text-neutral-600 p-0"
            />
            <div className="relative flex-shrink-0">
              <button
                onClick={() => setDenomDropdownOpen(!denomDropdownOpen)}
                className="flex items-center gap-1 text-sm text-neutral-400 hover:text-white transition-colors"
              >
                <span className="font-medium">{denomination}</span>
                <svg
                  className={`w-3 h-3 transition-transform duration-200 ${denomDropdownOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {denomDropdownOpen && (
                <div className="absolute right-0 top-full mt-1 w-20 bg-neutral-900 rounded-lg overflow-hidden z-50 border border-white/10 animate-scale-in">
                  <button
                    onClick={() => { setDenomination('SOL'); setDenomDropdownOpen(false); setAmount('') }}
                    className={`block w-full text-left px-3 py-2 text-sm font-medium transition-colors ${
                      denomination === 'SOL' ? 'text-white bg-white/10' : 'text-neutral-400 hover:bg-white/5'
                    }`}
                  >
                    SOL
                  </button>
                  <button
                    onClick={() => { setDenomination('USD'); setDenomDropdownOpen(false); setAmount('') }}
                    className={`block w-full text-left px-3 py-2 text-sm font-medium transition-colors ${
                      denomination === 'USD' ? 'text-white bg-white/10' : 'text-neutral-400 hover:bg-white/5'
                    }`}
                  >
                    USD
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Potential Winnings */}
      {amountNum > 0 && (
        <div className="mb-5 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-neutral-400">Shares</span>
            <span className="text-white font-medium">
              {(amountInSol / activePrice).toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">Payout if correct</span>
            <span className="text-white font-medium">
              {potentialPayout.toFixed(4)} SOL
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">Profit</span>
            <span className="text-apple-green font-semibold">
              +{potentialProfit.toFixed(4)} SOL
            </span>
          </div>
        </div>
      )}

      {/* Action Button */}
      {isNumericMarket && onChainStatus === MarketStatus.Resolved ? (
        <button
          disabled
          className="w-full py-3.5 bg-white/10 text-neutral-400 font-semibold text-base rounded-xl cursor-not-allowed"
        >
          Market Resolved
        </button>
      ) : connected ? (
        <button
          disabled={!amount || parseFloat(amount) <= 0}
          className={`w-full py-3.5 text-white font-semibold text-base rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${
            selectedSide === 'YES'
              ? 'bg-apple-green hover:bg-apple-green/90'
              : 'bg-apple-red hover:bg-apple-red/90'
          }`}
        >
          {side === 'buy' ? 'Buy' : 'Sell'} {selectedSide === 'YES' ? 'Yes' : 'No'}
        </button>
      ) : (
        <button
          onClick={connect}
          className="w-full py-3.5 bg-apple-green hover:bg-apple-green/90 text-white font-semibold text-base rounded-xl transition-all duration-200"
        >
          Connect wallet to trade
        </button>
      )}

      {/* Your Position */}
      {connected && selectedWordPosition && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="text-xs text-neutral-400 font-medium uppercase tracking-wider mb-2">
            Your Position
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-neutral-400">Side</span>
              <span className={`font-semibold ${
                selectedWordPosition.side === 'YES' ? 'text-apple-green' : 'text-apple-red'
              }`}>
                {selectedWordPosition.side}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">Shares</span>
              <span className="text-white font-medium">
                {selectedWordPosition.shares.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">Est. Value</span>
              <span className="text-white font-medium">
                {selectedWordPosition.estimatedValueSol.toFixed(4)} SOL
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  )

  return (
    <div className="relative flex min-h-screen w-full flex-col bg-black">
      <div className="flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="flex flex-col w-full max-w-7xl flex-1">
            <Header />

            <main className="py-4 md:py-6 flex-1">
              {/* Loading state */}
              {loading && (
                <div className="flex items-center justify-center py-32">
                  <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                </div>
              )}

              {/* Error state */}
              {fetchError && !loading && (
                <div className="flex flex-col items-center justify-center py-32 gap-3">
                  <span className="text-neutral-400 text-lg font-medium">{fetchError}</span>
                  <span className="text-neutral-500 text-sm">Check the market ID and try again</span>
                </div>
              )}

              {!loading && !fetchError && (<>
              {/* Event Header — full width above both columns */}
              <div className="flex items-start gap-3 md:gap-4 mb-4 md:mb-5">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl overflow-hidden flex-shrink-0 bg-neutral-800">
                  <img
                    src={market.imageUrl}
                    alt={market.title}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs md:text-sm text-neutral-400 font-medium mb-0.5">
                    <span>{market.category}</span>
                    {isNumericMarket && onChainStatus !== null && (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${
                        onChainStatus === MarketStatus.Active
                          ? 'bg-apple-green/15 text-apple-green'
                          : onChainStatus === MarketStatus.Paused
                          ? 'bg-yellow-500/15 text-yellow-400'
                          : 'bg-white/10 text-neutral-300'
                      }`}>
                        {marketStatusStr(onChainStatus)}
                        {onChainStatus === MarketStatus.Resolved && onChainWords?.[0]?.outcome !== null && (
                          <> · {outcomeStr(onChainWords![0].outcome)}</>
                        )}
                      </span>
                    )}
                  </div>
                  <h1 className="text-lg md:text-xl font-semibold text-white leading-tight">
                    {market.title}
                  </h1>
                </div>
              </div>

              {/* Countdown + Date — full width */}
              <div className="flex items-center justify-between mb-4 md:mb-5">
                <div className="flex items-center gap-2 text-xs md:text-sm text-neutral-400">
                  <span>Begins in</span>
                  <CountdownTimer targetTime={market.eventTime} />
                  <span className="text-neutral-600">·</span>
                  <span className="hidden sm:inline">{market.eventDateLabel}</span>
                </div>
                <span className="text-base md:text-lg font-semibold text-white tracking-tight">
                  Mentioned
                </span>
              </div>

              {/* Chart Legend — full width */}
              <div className="flex items-center gap-3 md:gap-5 mb-3 md:mb-4 overflow-x-auto">
                {trackedWords.map((wordName, i) => {
                  const word = market.words.find(w => w.word === wordName)
                  if (!word) return null
                  const pct = Math.round(parseFloat(word.yesPrice) * 100)
                  return (
                    <button
                      key={wordName}
                      onClick={() => setSelectedWord(wordName)}
                      className="flex items-center gap-1.5 md:gap-2 text-xs md:text-sm hover:opacity-80 transition-opacity flex-shrink-0"
                    >
                      <span
                        className="w-2 h-2 md:w-2.5 md:h-2.5 rounded-full"
                        style={{ backgroundColor: chartColors[i % chartColors.length] }}
                      />
                      <span className="text-neutral-300 font-medium">{wordName}</span>
                      <span className="text-white font-semibold">{pct}%</span>
                    </button>
                  )
                })}
              </div>

              {/* Two-column layout starts here — chart aligned with trading panel */}
              <div className="flex gap-6">
                {/* Left Column — Chart + Word Table + Rules */}
                <div className="flex-1 min-w-0">
                  {/* Chart */}
                  <div className="glass rounded-2xl overflow-hidden mb-3">
                    <div className="h-[240px] md:h-[320px] p-2">
                      <MarketChart series={chartSeries} />
                    </div>
                  </div>

                  {/* Volume + Period Selectors */}
                  <div className="flex items-center justify-between mb-6">
                    <span className="text-xs md:text-sm text-neutral-400 font-medium">
                      {formatVolume(market.totalVolume)} vol
                    </span>
                    <div className="flex items-center gap-1">
                      {(['1D', '1W', '1M', 'ALL'] as const).map(period => (
                        <button
                          key={period}
                          onClick={() => setChartPeriod(period)}
                          className={`px-2.5 md:px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                            chartPeriod === period
                              ? 'bg-white/10 text-white'
                              : 'text-neutral-500 hover:text-neutral-300'
                          }`}
                        >
                          {period}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Word Table */}
                  <div>
                    {/* Table Header */}
                    <div className="flex items-center justify-between px-3 md:px-4 py-3 border-b border-white/10">
                      <span className="text-xs md:text-sm text-neutral-400 font-medium w-1/3">Market</span>
                      <span className="text-xs md:text-sm text-neutral-400 font-medium text-center flex-1">Chance</span>
                      <div className="w-[160px] md:w-[240px]" />
                    </div>

                    {/* Word Rows — show 3 by default */}
                    {visibleWords.map((word) => {
                      const wordYesCents = Math.round(parseFloat(word.yesPrice) * 100)
                      const wordNoCents = Math.round(parseFloat(word.noPrice) * 100)
                      const wordChance = Math.round(parseFloat(word.yesPrice) * 100)
                      const isSelected = selectedWord === word.word
                      const isTracked = trackedWords.includes(word.word)

                      return (
                        <button
                          key={word.word}
                          onClick={() => handleWordClick(word.word)}
                          className={`w-full flex items-center justify-between px-3 md:px-4 py-3 md:py-4 border-b border-white/5 transition-all duration-200 hover:bg-white/[0.03] ${
                            isSelected ? 'bg-white/[0.05]' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2 md:gap-3 w-1/3">
                            {isTracked && (
                              <span
                                className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{ backgroundColor: chartColors[trackedWords.indexOf(word.word) % chartColors.length] }}
                              />
                            )}
                            <span className="text-white font-semibold text-sm md:text-[15px]">
                              {word.word}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 md:gap-2 flex-1 justify-center">
                            <span className="text-white font-bold text-base md:text-lg">{wordChance}%</span>
                            <span className={`text-[10px] md:text-xs font-semibold ${
                              word.change >= 0 ? 'text-apple-green' : 'text-apple-red'
                            }`}>
                              {word.change >= 0 ? '▲' : '▼'} {Math.abs(word.change)}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 md:gap-2 w-[160px] md:w-[240px] justify-end">
                            <span
                              className={`px-3 md:px-5 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-semibold border transition-all duration-200 ${
                                isSelected && selectedSide === 'YES'
                                  ? 'bg-apple-green/15 border-apple-green text-apple-green'
                                  : 'border-white/10 text-apple-green hover:border-apple-green/30'
                              }`}
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedWord(word.word)
                                setSelectedSide('YES')
                              }}
                            >
                              Yes {wordYesCents}¢
                            </span>
                            <span
                              className={`px-3 md:px-5 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-semibold border transition-all duration-200 ${
                                isSelected && selectedSide === 'NO'
                                  ? 'bg-apple-red/15 border-apple-red text-apple-red'
                                  : 'border-white/10 text-apple-red hover:border-apple-red/30'
                              }`}
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedWord(word.word)
                                setSelectedSide('NO')
                              }}
                            >
                              No {wordNoCents}¢
                            </span>
                          </div>
                        </button>
                      )
                    })}

                    {/* Show More / Show Less */}
                    {market.words.length > 3 && (
                      <button
                        onClick={() => setShowAllWords(!showAllWords)}
                        className="w-full py-3 text-sm font-semibold text-neutral-400 hover:text-white transition-colors duration-200 border-b border-white/5"
                      >
                        {showAllWords ? 'Show less' : `Show ${market.words.length - 3} more`}
                      </button>
                    )}
                  </div>

                  {/* Rules Section */}
                  <div className="mt-8">
                    <h2 className="text-lg font-semibold text-white mb-4">Rules</h2>

                    {/* Rules Summary */}
                    <div className="glass rounded-2xl p-4 md:p-5 mb-4">
                      <h3 className="text-white font-semibold text-[15px] mb-3">
                        {selectedWordData.word}
                      </h3>
                      <p className="text-sm text-neutral-300 leading-relaxed mb-3">
                        {market.rules.summary}
                      </p>
                      {rulesExpanded && (
                        <p className="text-sm text-neutral-400 leading-relaxed mb-3">
                          {market.rules.details}
                        </p>
                      )}
                      <button
                        onClick={() => setRulesExpanded(!rulesExpanded)}
                        className="text-sm text-apple-blue font-semibold hover:opacity-80 transition-opacity"
                      >
                        {rulesExpanded ? 'Hide full rules' : 'View full rules'}
                      </button>
                    </div>

                    {/* Timeline and Payout */}
                    <div className="glass rounded-2xl p-4 md:p-5">
                      <h3 className="text-white font-semibold text-[15px] mb-4">
                        Timeline and payout
                      </h3>
                      <div className="space-y-3">
                        <div className="flex justify-between text-sm">
                          <span className="text-neutral-400">Market open</span>
                          <span className="text-white font-medium">{market.rules.marketOpen}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-neutral-400">Market closes</span>
                          <span className="text-white font-medium">{market.rules.marketCloses}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-neutral-400">Projected payout</span>
                          <span className="text-white font-medium">{market.rules.projectedPayout}</span>
                        </div>
                      </div>
                      <p className="text-xs text-neutral-500 mt-4 leading-relaxed">
                        {market.rules.expiryNote}
                      </p>

                      <div className="border-t border-white/10 mt-4 pt-4 space-y-2">
                        <div className="flex justify-between text-xs">
                          <span className="text-neutral-500">Series</span>
                          <span className="text-neutral-300 font-mono">{market.rules.series}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-neutral-500">Event</span>
                          <span className="text-neutral-300 font-mono">{market.rules.event}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-neutral-500">Market</span>
                          <span className="text-neutral-300 font-mono">{market.rules.marketCode}-{selectedWordData.word.toUpperCase()}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Spacer for mobile bottom bar */}
                  <div className="h-20 lg:hidden" />
                </div>

                {/* Right Column — Trading Panel (desktop only) */}
                <div className="w-[340px] flex-shrink-0 hidden lg:block">
                  <div className="sticky top-24">
                    <div className="glass rounded-2xl p-5">
                      {tradingPanel}
                    </div>
                  </div>
                </div>
              </div>
              </>)}
            </main>
          </div>
        </div>
      </div>

      {/* Mobile Trade Bar — sticky bottom (hidden on desktop, hidden during loading/error) */}
      {loading || fetchError ? null : (
      <div className="fixed bottom-0 left-0 right-0 lg:hidden z-40">
        {mobileTradeOpen ? (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setMobileTradeOpen(false)}
            />
            {/* Bottom Sheet */}
            <div className="relative bg-neutral-950 border-t border-white/10 rounded-t-2xl p-5 max-h-[80vh] overflow-y-auto animate-fade-in">
              <div className="flex justify-between items-center mb-4">
                <span className="text-white font-semibold">Trade</span>
                <button
                  onClick={() => setMobileTradeOpen(false)}
                  className="text-neutral-400 hover:text-white p-1"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {tradingPanel}
            </div>
          </>
        ) : (
          <div className="bg-neutral-950 border-t border-white/10 px-4 py-3 flex items-center justify-between">
            <div>
              <span className={`font-semibold text-sm ${sideColor}`}>
                {selectedSide}
              </span>
              <span className="text-neutral-400 text-sm"> · </span>
              <span className="text-white font-semibold text-sm">
                {selectedWordData.word}
              </span>
              <span className="text-neutral-500 text-sm ml-2">
                {selectedSide === 'YES' ? yesCents : noCents}¢
              </span>
            </div>
            <button
              onClick={() => setMobileTradeOpen(true)}
              className={`px-6 py-2.5 text-white font-semibold text-sm rounded-xl transition-all duration-200 ${
                selectedSide === 'YES'
                  ? 'bg-apple-green hover:bg-apple-green/90'
                  : 'bg-apple-red hover:bg-apple-red/90'
              }`}
            >
              Trade
            </button>
          </div>
        )}
      </div>
      )}
    </div>
  )
}
