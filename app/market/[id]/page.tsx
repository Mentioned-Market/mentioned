'use client'

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import Header from '@/components/Header'
import CountdownTimer from '@/components/CountdownTimer'
import MarketChart from '@/components/MarketChart'
import FlashValue from '@/components/FlashValue'
import { useWallet } from '@/contexts/WalletContext'
import {
  fetchMarket,
  fetchUserPositions,
  fetchTradeHistory,
  createBuyIx,
  createSellIx,
  createAtaIx,
  createRedeemIx,
  sendIxs,
  solToLamports,
  getAssociatedTokenAddress,
  lmsrImpliedPrice,
  lmsrBuyCost,
  lmsrSellReturn,
  createRpc,
  type MarketAccount,
  type UserPosition,
  type TradeHistoryPoint,
  MarketStatus,
  marketStatusStr,
} from '@/lib/mentionMarket'
import { address as toAddress } from '@solana/kit'

interface Word {
  word: string
  yesPrice: string
  noPrice: string
  volume: number
  change: number
  outcome: boolean | null
}

const SOL_USD_RATE = 175 // mock rate

export default function MarketPage() {
  const params = useParams()
  const marketId = params.id as string
  const { connected, connect, publicKey, signer } = useWallet()

  const [selectedWord, setSelectedWord] = useState<string | null>(null)
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [selectedSide, setSelectedSide] = useState<'YES' | 'NO'>('YES')
  const [amount, setAmount] = useState('')
  const [chartPeriod, setChartPeriod] = useState<'1D' | '1W' | '1M' | 'ALL'>('ALL')
  const [showAllWords, setShowAllWords] = useState(false)
  const [denomination, setDenomination] = useState<'Shares' | 'USD'>('Shares')
  const [denomDropdownOpen, setDenomDropdownOpen] = useState(false)
  const [rulesExpanded, setRulesExpanded] = useState(false)
  const [mobileTradeOpen, setMobileTradeOpen] = useState(false)

  const [trading, setTrading] = useState(false)
  const [tradingPhase, setTradingPhase] = useState<'signing' | 'confirming' | 'refreshing' | null>(null)
  const [tradeStatus, setTradeStatus] = useState<{ msg: string; error: boolean } | null>(null)

  // Chart legend — track up to 3 words
  const chartColors = ['#34C759', '#007AFF', '#FF9500']
  const [trackedWords, setTrackedWords] = useState<string[]>([])

  // On-chain data state
  const isNumericMarket = /^\d+$/.test(marketId)
  const [onChainMarket, setOnChainMarket] = useState<MarketAccount | null>(null)
  const [onChainStatus, setOnChainStatus] = useState<MarketStatus | null>(null)
  const [loading, setLoading] = useState(isNumericMarket)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [userPositions, setUserPositions] = useState<UserPosition[]>([])
  const [tradeHistory, setTradeHistory] = useState<TradeHistoryPoint[]>([])

  useEffect(() => {
    if (!isNumericMarket) return

    let cancelled = false
    setLoading(true)
    setFetchError(null)

    fetchMarket(BigInt(marketId))
      .then((market) => {
        if (cancelled) return
        if (!market) {
          setFetchError('Market not found')
          setOnChainMarket(null)
        } else {
          setOnChainMarket(market)
          setOnChainStatus(market.status)
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
          (p) => p.marketId === BigInt(marketId)
        )
        setUserPositions(marketPositions)
      })
      .catch(console.error)

    return () => { cancelled = true }
  }, [publicKey, isNumericMarket, marketId])

  // Fetch trade history for charts
  useEffect(() => {
    if (!isNumericMarket) return
    let cancelled = false

    fetchTradeHistory(BigInt(marketId))
      .then((history) => {
        if (!cancelled) setTradeHistory(history)
      })
      .catch(console.error)

    return () => { cancelled = true }
  }, [isNumericMarket, marketId])

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
    if (isNumericMarket && onChainMarket && onChainMarket.words.length > 0) {
      return {
        id: marketId,
        title: onChainMarket.label || `Market #${marketId}`,
        category: 'Mentions · On-Chain',
        eventTime: new Date(Number(onChainMarket.resolvesAt) * 1000),
        eventDateLabel: new Date(Number(onChainMarket.resolvesAt) * 1000).toLocaleDateString(),
        imageUrl: '/src/img/White Icon.svg',
        words: onChainMarket.words.map((w) => {
          const price = lmsrImpliedPrice(
            w.yesQuantity,
            w.noQuantity,
            onChainMarket.liquidityParamB
          )
          return {
            word: w.label,
            yesPrice: price.yes.toFixed(2),
            noPrice: price.no.toFixed(2),
            volume: 0,
            change: 0,
            outcome: w.outcome,
          }
        }),
        totalVolume: 0,
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
          { word: 'Immigration', yesPrice: '0.72', noPrice: '0.28', volume: 125000, change: -6, outcome: null },
          { word: 'Economy', yesPrice: '0.65', noPrice: '0.35', volume: 98000, change: -5, outcome: null },
          { word: 'China', yesPrice: '0.58', noPrice: '0.42', volume: 87000, change: 3, outcome: null },
          { word: 'Border', yesPrice: '0.81', noPrice: '0.19', volume: 156000, change: 8, outcome: null },
          { word: 'Taxes', yesPrice: '0.45', noPrice: '0.55', volume: 67000, change: -11, outcome: null },
          { word: 'Jobs', yesPrice: '0.67', noPrice: '0.33', volume: 89000, change: 2, outcome: null },
          { word: 'Trade', yesPrice: '0.52', noPrice: '0.48', volume: 72000, change: -3, outcome: null },
          { word: 'America', yesPrice: '0.89', noPrice: '0.11', volume: 234000, change: 12, outcome: null },
          { word: 'Freedom', yesPrice: '0.76', noPrice: '0.24', volume: 145000, change: 5, outcome: null },
          { word: 'Victory', yesPrice: '0.83', noPrice: '0.17', volume: 178000, change: -2, outcome: null },
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
  }, [marketId, isNumericMarket, onChainMarket])

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

      if (isNumericMarket && onChainMarket) {
        // Find this word's index in the on-chain data
        const onChainWord = onChainMarket.words.find((w) => w.label === wordName)
        const wordIdx = onChainWord?.wordIndex

        // Filter trade history for this word
        const wordHistory = wordIdx !== undefined
          ? tradeHistory.filter((t) => t.wordIndex === wordIdx)
          : []

        const isResolved = onChainStatus === MarketStatus.Resolved

        if (wordHistory.length > 0) {
          // Start at 0.50 (initial LMSR price), then add each trade's resulting price
          data.push({
            timestamp: wordHistory[0].timestamp * 1000 - 60000,
            price: 0.50,
          })
          for (const point of wordHistory) {
            data.push({
              timestamp: point.timestamp * 1000,
              price: point.impliedYesPrice,
            })
          }
          // Only extend to "now" if the market is still active
          if (!isResolved) {
            data.push({ timestamp: now, price: endPrice })
          }
        } else {
          // No trades yet: flat line at current price
          data.push({ timestamp: now - 24 * 60 * 60 * 1000, price: 0.50 })
          if (!isResolved) {
            data.push({ timestamp: now, price: endPrice })
          } else {
            data.push({ timestamp: now - 24 * 60 * 60 * 1000 + 1, price: 0.50 })
          }
        }
      } else {
        // Demo market: generate mock chart data
        const startPrice = endPrice - 0.1 + Math.random() * 0.05
        for (let j = 0; j < 60; j++) {
          const progress = j / 59
          const timestamp = now - (24 * 60 * 60 * 1000) * (1 - progress)
          const volatility = (Math.random() - 0.5) * 0.04
          const trend = startPrice + (endPrice - startPrice) * progress
          const price = Math.max(0.01, Math.min(0.99, trend + volatility))
          data.push({ timestamp, price })
        }
      }

      return {
        label: word.word,
        color: chartColors[i % chartColors.length],
        data,
        currentPrice: endPrice,
      }
    }).filter(Boolean) as { label: string; color: string; data: { timestamp: number; price: number }[]; currentPrice: number }[]
  }, [trackedWords, market.words, isNumericMarket, onChainMarket, onChainStatus, tradeHistory])

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
  const activePrice = selectedSide === 'YES'
    ? parseFloat(selectedWordData.yesPrice)
    : parseFloat(selectedWordData.noPrice)

  // Shares mode: user enters shares, we compute SOL cost
  // USD mode: user enters USD, we compute shares
  const shares = denomination === 'Shares'
    ? amountNum
    : activePrice > 0 ? (amountNum / SOL_USD_RATE) / activePrice : 0

  // Use accurate LMSR cost/return instead of simple shares * price
  const wordForCost = onChainMarket?.words.find((w) => w.label === selectedWord)
  const costInSol = useMemo(() => {
    if (!wordForCost || !onChainMarket || shares <= 0) return shares * activePrice
    if (side === 'buy') {
      return lmsrBuyCost(
        wordForCost.yesQuantity, wordForCost.noQuantity,
        selectedSide, shares, onChainMarket.liquidityParamB
      )
    } else {
      return lmsrSellReturn(
        wordForCost.yesQuantity, wordForCost.noQuantity,
        selectedSide, shares, onChainMarket.liquidityParamB
      )
    }
  }, [wordForCost, onChainMarket, shares, selectedSide, side, activePrice])
  const costInUsd = costInSol * SOL_USD_RATE

  const visibleWords = showAllWords ? market.words : market.words.slice(0, 3)

  // Color for the side label
  const sideColor = selectedSide === 'YES' ? 'text-apple-green' : 'text-apple-red'

  // Potential winnings: each share pays 1 SOL if correct
  const potentialPayout = shares * 1.0
  const potentialProfit = potentialPayout - costInSol

  // User's position for the currently selected word
  const selectedWordPosition = useMemo(() => {
    if (!selectedWord) return null
    return userPositions.find((p) => p.wordLabel === selectedWord) ?? null
  }, [selectedWord, userPositions])

  // Refresh market + positions + history
  const refreshData = useCallback(async () => {
    if (!isNumericMarket) return
    try {
      const m = await fetchMarket(BigInt(marketId))
      if (m) {
        setOnChainMarket(m)
        setOnChainStatus(m.status)
      }
    } catch {}
    try {
      const history = await fetchTradeHistory(BigInt(marketId))
      setTradeHistory(history)
    } catch {}
    if (publicKey) {
      try {
        const positions = await fetchUserPositions(toAddress(publicKey))
        setUserPositions(positions.filter((p) => p.marketId === BigInt(marketId)))
      } catch {}
    }
  }, [isNumericMarket, marketId, publicKey])

  // Auto-poll every 15s so other users' trades appear (stop when resolved)
  useEffect(() => {
    if (!isNumericMarket || loading || onChainStatus === MarketStatus.Resolved) return
    const interval = setInterval(refreshData, 15_000)
    return () => clearInterval(interval)
  }, [isNumericMarket, loading, onChainStatus, refreshData])

  const handleTrade = async () => {
    if (!signer || !publicKey || !onChainMarket || !selectedWord) return
    if (shares <= 0) return

    const wordData = onChainMarket.words.find((w) => w.label === selectedWord)
    if (!wordData) return
    const wordIndex = wordData.wordIndex

    setTrading(true)
    setTradingPhase('signing')
    setTradeStatus(null)
    try {
      const addr = toAddress(publicKey)

      if (side === 'buy') {
        // Determine the token mint for ATA creation
        const mint = selectedSide === 'YES' ? wordData.yesMint : wordData.noMint
        const ata = await getAssociatedTokenAddress(mint, addr)

        // Check if ATA exists - if not, create it first
        const ixs = []
        try {
          const rpc = createRpc()
          const ataInfo = await rpc.getAccountInfo(ata, { encoding: 'base64' }).send()
          if (!ataInfo.value) {
            ixs.push(await createAtaIx(addr, addr, mint))
          }
        } catch {
          // If we can't check, try to create it (idempotent with ATA program)
          ixs.push(await createAtaIx(addr, addr, mint))
        }

        // quantity in token base units (9 decimals = 1 share)
        const quantityTokens = solToLamports(shares)
        // Compute accurate LMSR cost + trade fee + 10% slippage buffer
        const accurateCost = lmsrBuyCost(
          wordData.yesQuantity, wordData.noQuantity,
          selectedSide, shares, onChainMarket.liquidityParamB
        )
        const feeBps = onChainMarket.tradeFeeBps || 0
        const costWithFee = accurateCost * (1 + feeBps / 10000)
        const maxCostLamports = solToLamports(costWithFee * 1.10)

        ixs.push(
          await createBuyIx(
            addr,
            BigInt(marketId),
            wordIndex,
            selectedSide,
            quantityTokens,
            maxCostLamports,
            onChainMarket
          )
        )

        await sendIxs(signer, ixs)
      } else {
        // Sell: shares to sell in token units
        const quantityTokens = solToLamports(shares)
        // Compute accurate LMSR return - fee - 10% slippage buffer
        const accurateReturn = lmsrSellReturn(
          wordData.yesQuantity, wordData.noQuantity,
          selectedSide, shares, onChainMarket.liquidityParamB
        )
        const feeBps = onChainMarket.tradeFeeBps || 0
        const returnAfterFee = accurateReturn * (1 - feeBps / 10000)
        const minReturnLamports = solToLamports(returnAfterFee * 0.90)

        const ix = await createSellIx(
          addr,
          BigInt(marketId),
          wordIndex,
          selectedSide,
          quantityTokens,
          minReturnLamports,
          onChainMarket
        )

        await sendIxs(signer, [ix])
      }

      // Wait for transaction to confirm on-chain
      setTradingPhase('confirming')
      await new Promise((r) => setTimeout(r, 2000))

      // Refresh market data + positions
      setTradingPhase('refreshing')
      await refreshData()

      const action = side === 'buy' ? 'Bought' : 'Sold'
      setTradeStatus({
        msg: `${action} ${shares.toFixed(2)} ${selectedSide} shares of "${selectedWord}" for ${costInSol.toFixed(4)} SOL`,
        error: false,
      })
      setAmount('')
    } catch (e: unknown) {
      console.error('Trade failed:', e)
      setTradeStatus({ msg: (e as Error).message, error: true })
    } finally {
      setTrading(false)
      setTradingPhase(null)
      setTimeout(() => setTradeStatus(null), 8000)
    }
  }

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
          Yes <FlashValue value={`${yesCents}¢`} />
        </button>
        <button
          onClick={() => setSelectedSide('NO')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
            selectedSide === 'NO'
              ? 'bg-apple-red/15 text-apple-red border border-apple-red/40'
              : 'border border-white/10 text-neutral-400 hover:border-white/20'
          }`}
        >
          No <FlashValue value={`${noCents}¢`} />
        </button>
      </div>

      {/* Amount Input */}
      <div className="mb-5">
        <div className="flex items-center justify-between py-3">
          <div className="flex-shrink-0">
            <div className="text-sm text-neutral-400 font-medium">Amount</div>
            {amountNum > 0 && (
              <div className="text-xs text-neutral-500 mt-0.5">
                {denomination === 'Shares'
                  ? `${costInSol.toFixed(4)} SOL ($${costInUsd.toFixed(2)})`
                  : `${shares.toFixed(2)} shares (${costInSol.toFixed(4)} SOL)`}
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
                <div className="absolute right-0 top-full mt-1 w-24 bg-neutral-900 rounded-lg overflow-hidden z-50 border border-white/10 animate-scale-in">
                  <button
                    onClick={() => { setDenomination('Shares'); setDenomDropdownOpen(false); setAmount('') }}
                    className={`block w-full text-left px-3 py-2 text-sm font-medium transition-colors ${
                      denomination === 'Shares' ? 'text-white bg-white/10' : 'text-neutral-400 hover:bg-white/5'
                    }`}
                  >
                    Shares
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
              {shares.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">{side === 'buy' ? 'Cost' : 'Return'}</span>
            <span className="text-white font-medium">
              {costInSol.toFixed(4)} SOL
            </span>
          </div>
          {side === 'buy' && (
            <>
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
            </>
          )}
        </div>
      )}

      {/* Trade Status */}
      {tradeStatus && (
        <div
          className={`mb-3 p-3 rounded-lg text-xs ${
            tradeStatus.error
              ? 'bg-red-500/10 border border-red-500/30 text-red-300'
              : 'bg-green-500/10 border border-green-500/30 text-green-300'
          }`}
        >
          {tradeStatus.msg}
        </div>
      )}

      {/* Action Button */}
      {isNumericMarket && onChainStatus === MarketStatus.Resolved ? (
        (() => {
          const marketClaimable = userPositions.filter((p) => p.claimable)
          const totalClaimSol = marketClaimable.reduce((s, p) => s + p.estimatedValueSol, 0)
          return marketClaimable.length > 0 ? (
            <button
              onClick={async () => {
                if (!signer || !publicKey || !onChainMarket) return
                setTrading(true)
                setTradingPhase('signing')
                setTradeStatus(null)
                try {
                  const addr = toAddress(publicKey)
                  const ixs = await Promise.all(
                    marketClaimable.map((pos) =>
                      createRedeemIx(addr, pos.marketId, pos.wordIndex, pos.side, onChainMarket!)
                    )
                  )
                  await sendIxs(signer, ixs)
                  setTradingPhase('confirming')
                  await new Promise((r) => setTimeout(r, 2000))
                  setTradingPhase('refreshing')
                  await refreshData()
                  setTradeStatus({
                    msg: `Claimed ${marketClaimable.length} position${marketClaimable.length > 1 ? 's' : ''} for ${totalClaimSol.toFixed(4)} SOL`,
                    error: false,
                  })
                } catch (e: unknown) {
                  console.error('Claim failed:', e)
                  setTradeStatus({ msg: (e as Error).message, error: true })
                } finally {
                  setTrading(false)
                  setTradingPhase(null)
                  setTimeout(() => setTradeStatus(null), 8000)
                }
              }}
              disabled={trading}
              className="w-full py-3.5 bg-apple-green hover:bg-apple-green/90 text-white font-semibold text-base rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {trading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {tradingPhase === 'signing' && 'Sign in wallet...'}
                  {tradingPhase === 'confirming' && 'Confirming...'}
                  {tradingPhase === 'refreshing' && 'Updating...'}
                </span>
              ) : (
                `Claim ${marketClaimable.length} Position${marketClaimable.length > 1 ? 's' : ''} (${totalClaimSol.toFixed(4)} SOL)`
              )}
            </button>
          ) : (
            <button
              disabled
              className="w-full py-3.5 bg-white/10 text-neutral-400 font-semibold text-base rounded-xl cursor-not-allowed"
            >
              Market Resolved
            </button>
          )
        })()
      ) : connected ? (
        <button
          onClick={handleTrade}
          disabled={!amount || parseFloat(amount) <= 0 || trading || !isNumericMarket}
          className={`w-full py-3.5 text-white font-semibold text-base rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${
            selectedSide === 'YES'
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
              {tradingPhase === 'signing' && 'Sign in wallet...'}
              {tradingPhase === 'confirming' && 'Confirming...'}
              {tradingPhase === 'refreshing' && 'Updating...'}
            </span>
          ) : (
            `${side === 'buy' ? 'Buy' : 'Sell'} ${selectedSide === 'YES' ? 'Yes' : 'No'}`
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
              <FlashValue value={selectedWordPosition.shares.toFixed(2)} className="text-white font-medium" />
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">Est. Value</span>
              <FlashValue value={`${selectedWordPosition.estimatedValueSol.toFixed(4)} SOL`} className="text-white font-medium" />
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
                        onChainStatus === MarketStatus.Open
                          ? 'bg-apple-green/15 text-apple-green'
                          : onChainStatus === MarketStatus.Paused
                          ? 'bg-yellow-500/15 text-yellow-400'
                          : 'bg-white/10 text-neutral-300'
                      }`}>
                        {marketStatusStr(onChainStatus)}
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
                      <FlashValue value={`${pct}%`} className="text-white font-semibold" />
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
                      const isResolved = word.outcome !== null

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
                            {isResolved && (
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                word.outcome ? 'bg-apple-green/15 text-apple-green' : 'bg-apple-red/15 text-apple-red'
                              }`}>
                                {word.outcome ? 'YES' : 'NO'}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 md:gap-2 flex-1 justify-center">
                            <FlashValue value={`${wordChance}%`} className="text-white font-bold text-base md:text-lg" />
                            {word.change !== 0 && (
                              <span className={`text-[10px] md:text-xs font-semibold ${
                                word.change > 0 ? 'text-apple-green' : 'text-apple-red'
                              }`}>
                                {word.change > 0 ? '▲' : '▼'} {Math.abs(word.change)}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 md:gap-2 w-[160px] md:w-[240px] justify-end">
                            {isResolved ? (
                              <span className={`px-3 md:px-5 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-semibold border ${
                                word.outcome
                                  ? 'bg-apple-green/10 border-apple-green/30 text-apple-green'
                                  : 'bg-apple-red/10 border-apple-red/30 text-apple-red'
                              }`}>
                                Resolved {word.outcome ? 'Yes' : 'No'}
                              </span>
                            ) : (
                              <>
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
                                  Yes <FlashValue value={`${wordYesCents}¢`} />
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
                                  No <FlashValue value={`${wordNoCents}¢`} />
                                </span>
                              </>
                            )}
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
              <FlashValue value={`${selectedSide === 'YES' ? yesCents : noCents}¢`} className="text-neutral-500 text-sm ml-2" />
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
