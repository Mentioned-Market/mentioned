'use client'

import { useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Header from '@/components/Header'
import CountdownTimer from '@/components/CountdownTimer'
import TradingChart from '@/components/TradingChart'
import { useWallet } from '@/contexts/WalletContext'

interface Word {
  word: string
  yesPrice: string
  noPrice: string
  volume: number
}

interface DataPoint {
  timestamp: number
  price: number
}

interface Order {
  price: number
  amount: number
  total: number
}

export default function MarketPage() {
  const params = useParams()
  const marketId = params.id as string
  const { connected, mode, setMode } = useWallet()
  
  const [selectedWord, setSelectedWord] = useState('IMMIGRATION')
  const [amount, setAmount] = useState('')
  const [activeTab, setActiveTab] = useState<'trading' | 'stream'>('trading')
  
  // Pro mode specific state
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET')
  const [side, setSide] = useState<'YES' | 'NO'>('YES')
  const [limitPrice, setLimitPrice] = useState('')
  
  const market = useMemo(() => {
    const now = Date.now()
    const marketData: Record<string, {
      id: string
      title: string
      eventTime: Date
      imageUrl: string
      words: Word[]
      streamUrl?: string
    }> = {
      'trump-speech': {
        id: 'trump-speech',
        title: "TRUMP'S SPEECH",
        eventTime: new Date(now + 2 * 60 * 60 * 1000),
        imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCPwsL0smxRVROhCkwShqqarIa-4xnAdVdAomChQJ_T5mRI0s77w-xoaIXYP2m8tRl-uEGpY2db-WBf6yZIfORA6Azp8_G7mOSTRPFRKHgyuo-4Ltlj_aMHH0t0PkSvdDO95rJOZpBgoS7jAKqkQ_7C86iSDgLJC9vDfV4YSshAaEhuIv2qI0WDcGs0VSLKNYTrz72KduCuH-fH8XBkROiM1zDK2dJlV6R0sCiMjP_Y3Ml19Uglhnihkb8ZD1prCuWa0i_wip0TXSI',
        words: [
          { word: 'IMMIGRATION', yesPrice: '0.72', noPrice: '0.28', volume: 125000 },
          { word: 'ECONOMY', yesPrice: '0.65', noPrice: '0.35', volume: 98000 },
          { word: 'CHINA', yesPrice: '0.58', noPrice: '0.42', volume: 87000 },
          { word: 'BORDER', yesPrice: '0.81', noPrice: '0.19', volume: 156000 },
          { word: 'TAXES', yesPrice: '0.45', noPrice: '0.55', volume: 67000 },
          { word: 'JOBS', yesPrice: '0.67', noPrice: '0.33', volume: 89000 },
          { word: 'TRADE', yesPrice: '0.52', noPrice: '0.48', volume: 72000 },
          { word: 'AMERICA', yesPrice: '0.89', noPrice: '0.11', volume: 234000 },
          { word: 'FREEDOM', yesPrice: '0.76', noPrice: '0.24', volume: 145000 },
          { word: 'VICTORY', yesPrice: '0.83', noPrice: '0.17', volume: 178000 },
        ],
        streamUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      },
    }
    return marketData[marketId] || marketData['trump-speech']
  }, [marketId])

  const selectedWordData = market.words.find(w => w.word === selectedWord) || market.words[0]
  
  // Normal mode calculations
  const estimatedYesCost = amount ? (parseFloat(amount) * parseFloat(selectedWordData.yesPrice)).toFixed(2) : '0.00'
  const estimatedNoCost = amount ? (parseFloat(amount) * parseFloat(selectedWordData.noPrice)).toFixed(2) : '0.00'
  const yesShares = amount ? parseFloat(amount).toFixed(0) : '0'
  const noShares = amount ? parseFloat(amount).toFixed(0) : '0'
  
  // Pro mode calculations
  const currentPrice = side === 'YES' ? parseFloat(selectedWordData.yesPrice) : parseFloat(selectedWordData.noPrice)
  const estimatedCost = amount ? (parseFloat(amount) * (orderType === 'MARKET' ? currentPrice : parseFloat(limitPrice || '0'))).toFixed(2) : '0.00'
  
  // Generate historical data
  const generateHistoricalData = (word: Word): DataPoint[] => {
    const data: DataPoint[] = []
    const now = Date.now()
    const startPrice = parseFloat(word.yesPrice) - 0.15
    const endPrice = parseFloat(word.yesPrice)
    
    for (let i = 0; i < 50; i++) {
      const timestamp = now - (24 * 60 * 60 * 1000) * (1 - i / 49)
      const progress = i / 49
      const volatility = (Math.random() - 0.5) * 0.05
      const price = startPrice + (endPrice - startPrice) * progress + volatility
      data.push({ timestamp, price: Math.max(0, Math.min(1, price)) })
    }
    return data
  }

  // Generate order book
  const generateOrderBook = (word: Word): { buyOrders: Order[], sellOrders: Order[] } => {
    const yesPrice = parseFloat(word.yesPrice)
    const buyOrders = []
    const sellOrders = []
    
    for (let i = 0; i < 8; i++) {
      const price = yesPrice - (i + 1) * 0.02
      const amount = Math.floor(Math.random() * 500) + 100
      buyOrders.push({ price, amount, total: price * amount })
    }
    
    for (let i = 0; i < 8; i++) {
      const price = yesPrice + (i + 1) * 0.02
      const amount = Math.floor(Math.random() * 500) + 100
      sellOrders.push({ price, amount, total: price * amount })
    }
    
    return { buyOrders, sellOrders }
  }

  const historicalData = generateHistoricalData(selectedWordData)
  const orderBook = generateOrderBook(selectedWordData)

  // Normal Mode Render
  if (mode === 'normal') {
  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden">
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
            <Header />
          
          <main className="py-4">
            {/* Header with Tabs */}
            <div className="mb-4 pb-3 border-b border-white/10">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h1 className="text-2xl font-bold text-white/90">{market.title}</h1>
                  <div className="flex items-center gap-4 text-sm text-white/50 mt-1">
                    <span>ENDS: <CountdownTimer targetTime={market.eventTime} /></span>
                  </div>
                </div>
                
                {/* Tabs and Mode Toggle */}
                <div className="flex flex-col items-end gap-3">
                  {/* Mode Toggle */}
                  <button
                    onClick={() => setMode('pro')}
                    className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] rounded-lg hover:bg-[#252525] transition-colors"
                  >
                    <span className="text-xs text-white/50 uppercase font-bold">Normal</span>
                    <div className="relative w-11 h-6 bg-black rounded-full">
                      <div className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200 translate-x-0"></div>
                    </div>
                    <span className="text-xs text-white/50 uppercase font-bold">Pro</span>
                  </button>
                  
                  {/* Tabs */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setActiveTab('trading')}
                      className={`px-6 py-3 font-bold text-sm uppercase transition-all rounded ${
                        activeTab === 'trading'
                          ? 'bg-white text-black'
                          : 'bg-[#1a1a1a] text-white hover:bg-[#252525]'
                      }`}
                    >
                      TRADING
                    </button>
                    <button
                      onClick={() => setActiveTab('stream')}
                      className={`px-6 py-3 font-bold text-sm uppercase transition-all rounded ${
                        activeTab === 'stream'
                          ? 'bg-white text-black'
                          : 'bg-[#1a1a1a] text-white hover:bg-[#252525]'
                      }`}
                    >
                      STREAM
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Trading Tab */}
            {activeTab === 'trading' && (
              <>
                {/* Trading Section */}
                <div className="bg-[#161616] rounded-2xl p-6 border border-[#2a2a2a] mb-6">
                  <h2 className="text-2xl font-bold mb-4 text-center">
                    TRADE "{selectedWordData.word}"
                  </h2>
                  
                  <div className="max-w-2xl mx-auto space-y-4">
                    {/* Amount Input */}
                    <div>
                      <label className="text-white/70 text-base block mb-2">HOW MANY SHARES?</label>
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="Enter amount..."
                        className="w-full h-12 bg-black/50 border-2 border-white/30 rounded-xl text-white text-xl px-4 focus:outline-none focus:border-white"
                        min="0"
                        step="1"
                      />
                    </div>

                    {/* Buy Buttons with Info Below */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <button
                          disabled={!amount || parseFloat(amount) <= 0 || !connected}
                          className="w-full h-20 bg-green-600 hover:bg-green-700 text-white font-bold text-xl uppercase rounded-xl transition-all transform hover:scale-105 shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                        >
                          <div>BUY YES</div>
                          <div className="text-2xl mt-1">${selectedWordData.yesPrice}</div>
                        </button>
                        <div className="mt-2 text-sm text-center space-y-1">
                          <div className="text-white/70">Cost: <span className="text-white font-bold">${estimatedYesCost}</span></div>
                          <div className="text-green-400">Win: ${yesShares}</div>
                        </div>
                      </div>
                      <div>
                        <button
                          disabled={!amount || parseFloat(amount) <= 0 || !connected}
                          className="w-full h-20 bg-red-600 hover:bg-red-700 text-white font-bold text-xl uppercase rounded-xl transition-all transform hover:scale-105 shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                        >
                          <div>BUY NO</div>
                          <div className="text-2xl mt-1">${selectedWordData.noPrice}</div>
                        </button>
                        <div className="mt-2 text-sm text-center space-y-1">
                          <div className="text-white/70">Cost: <span className="text-white font-bold">${estimatedNoCost}</span></div>
                          <div className="text-red-400">Win: ${noShares}</div>
                        </div>
                      </div>
                    </div>

                    {!connected && (
                      <div className="text-center text-yellow-400 text-base font-bold">
                        ⚠️ Connect your wallet to trade!
                      </div>
                    )}

                    {/* Quick Stats */}
                    <div className="grid grid-cols-3 gap-3 pt-4">
                      <div className="bg-black/30 rounded-xl p-3 text-center">
                        <div className="text-white/50 text-xs">VOLUME</div>
                        <div className="text-xl font-bold">${(selectedWordData.volume / 1000).toFixed(0)}K</div>
                      </div>
                      <div className="bg-black/30 rounded-xl p-3 text-center">
                        <div className="text-white/50 text-xs">YES PRICE</div>
                        <div className="text-xl font-bold text-green-400">${selectedWordData.yesPrice}</div>
                      </div>
                      <div className="bg-black/30 rounded-xl p-3 text-center">
                        <div className="text-white/50 text-xs">NO PRICE</div>
                        <div className="text-xl font-bold text-red-400">${selectedWordData.noPrice}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Words Grid */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {market.words.map((word) => (
                    <button
                      key={word.word}
                      onClick={() => setSelectedWord(word.word)}
                      className={`p-6 rounded-2xl transition-all transform hover:scale-105 ${
                        selectedWord === word.word
                          ? 'bg-white text-black shadow-2xl scale-105'
                          : 'bg-[#1a1a1a] border-2 border-white/20 hover:border-white/50'
                      }`}
                    >
                      <div className="text-center">
                        <div className="text-2xl font-bold mb-3">{word.word}</div>
                        <div className="flex justify-center gap-2 text-sm">
                          <span className={`font-bold ${selectedWord === word.word ? 'text-green-600' : 'text-green-400'}`}>
                            ${word.yesPrice}
                          </span>
                          <span className={`font-bold ${selectedWord === word.word ? 'text-red-600' : 'text-red-400'}`}>
                            ${word.noPrice}
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Stream Tab */}
            {activeTab === 'stream' && (
              <div className="bg-[#1a1a1a] rounded-3xl overflow-hidden">
                <div className="aspect-video bg-black">
                  <iframe
                    src={market.streamUrl}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              </div>
            )}
          </main>
          </div>
        </div>
      </div>
    </div>
  )
}

  // Pro Mode Render
  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden">
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
            <Header />
        
        <main className="py-4">
          {/* Top Bar */}
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/10">
            <div>
              <h1 className="text-2xl font-bold text-white/90">{market.title}</h1>
              <div className="flex items-center gap-4 text-sm text-white/50 mt-1">
                <span>ENDS: <CountdownTimer targetTime={market.eventTime} /></span>
              </div>
            </div>
            
            {/* Tabs and Mode Toggle */}
            <div className="flex flex-col items-end gap-3">
              {/* Mode Toggle */}
              <button
                onClick={() => setMode('normal')}
                className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] rounded-lg hover:bg-[#252525] transition-colors"
              >
                <span className="text-xs text-white/50 uppercase font-bold">Normal</span>
                <div className="relative w-11 h-6 bg-black rounded-full">
                  <div className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200 translate-x-5"></div>
                </div>
                <span className="text-xs text-white/50 uppercase font-bold">Pro</span>
              </button>
              
              {/* Tabs */}
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveTab('trading')}
                  className={`px-6 py-3 font-bold text-sm uppercase transition-all rounded ${
                    activeTab === 'trading'
                      ? 'bg-white text-black'
                      : 'bg-[#1a1a1a] text-white hover:bg-[#252525]'
                  }`}
                >
                  TRADING
                </button>
                <button
                  onClick={() => setActiveTab('stream')}
                  className={`px-6 py-3 font-bold text-sm uppercase transition-all rounded ${
                    activeTab === 'stream'
                      ? 'bg-white text-black'
                      : 'bg-[#1a1a1a] text-white hover:bg-[#252525]'
                  }`}
                >
                  STREAM
                </button>
              </div>
            </div>
          </div>

          {/* Main Grid - Trading Tab */}
          {activeTab === 'trading' && (
            <div className="grid grid-cols-12 gap-3">
              {/* Left - Words List */}
              <div className="col-span-2 space-y-1">
                <div className="text-xs text-white/50 font-bold mb-2 px-2">MARKETS</div>
                {market.words.map((word) => (
                  <button
                    key={word.word}
                    onClick={() => setSelectedWord(word.word)}
                    className={`w-full text-left px-2 py-2 text-xs font-mono transition-colors ${
                      selectedWord === word.word
                        ? 'bg-white/10 text-white'
                        : 'text-white/50 hover:bg-white/5 hover:text-white/70'
                    }`}
                  >
                    <div className="font-bold">{word.word}</div>
                    <div className="flex gap-2 mt-1">
                      <span className="text-green-400">{word.yesPrice}</span>
                      <span className="text-red-400">{word.noPrice}</span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Center - Chart */}
              <div className="col-span-7 space-y-3">
                <div className="bg-[#111111] rounded border border-white/10 h-[400px] flex flex-col overflow-hidden">
                  <div className="border-b border-white/10 p-2 flex items-center justify-between flex-shrink-0">
                    <span className="text-xs font-bold text-white/70">{selectedWordData.word} / YES</span>
                    <span className="text-sm font-bold">${parseFloat(selectedWordData.yesPrice).toFixed(2)}</span>
                  </div>
                  <div className="flex-1 p-2 min-h-0">
                    <TradingChart
                      word={selectedWord}
                      data={historicalData}
                      currentPrice={parseFloat(selectedWordData.yesPrice)}
                    />
                  </div>
                </div>

                {/* Order Book */}
                <div className="bg-[#111111] rounded border border-white/10 h-[223px] flex flex-col">
                  <div className="border-b border-white/10 p-2 flex-shrink-0">
                    <span className="text-xs font-bold text-white/70">ORDER BOOK</span>
                  </div>
                  <div className="grid grid-cols-2 divide-x divide-white/10 flex-1 overflow-hidden">
                    <div className="p-2 flex flex-col">
                      <div className="text-xs text-green-400 font-bold mb-2">BIDS</div>
                      <div className="space-y-1 font-mono text-xs flex-1">
                        {orderBook.buyOrders.slice(0, 7).map((order, i) => (
                          <div key={i} className="grid grid-cols-3 gap-2 text-white/70">
                            <span className="text-green-400">{order.price.toFixed(2)}</span>
                            <span className="text-right">{order.amount}</span>
                            <span className="text-right">${order.total.toFixed(0)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="p-2 flex flex-col">
                      <div className="text-xs text-red-400 font-bold mb-2">ASKS</div>
                      <div className="space-y-1 font-mono text-xs flex-1">
                        {orderBook.sellOrders.slice(0, 7).map((order, i) => (
                          <div key={i} className="grid grid-cols-3 gap-2 text-white/70">
                            <span className="text-red-400">{order.price.toFixed(2)}</span>
                            <span className="text-right">{order.amount}</span>
                            <span className="text-right">${order.total.toFixed(0)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right - Trading Terminal */}
              <div className="col-span-3 space-y-3">
                <div className="bg-[#111111] rounded border border-white/10 p-3 h-[400px] flex flex-col">
                  <div className="text-xs font-bold text-white/70 mb-3">PLACE ORDER</div>
                  
                  {/* Order Type */}
                  <div className="mb-3">
                    <div className="text-xs text-white/50 mb-2">TYPE</div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setOrderType('MARKET')}
                        className={`px-3 py-2 text-xs font-bold rounded ${
                          orderType === 'MARKET'
                            ? 'bg-white text-black'
                            : 'bg-white/10 text-white hover:bg-white/20'
                        }`}
                      >
                        MARKET
                      </button>
                      <button
                        onClick={() => setOrderType('LIMIT')}
                        className={`px-3 py-2 text-xs font-bold rounded ${
                          orderType === 'LIMIT'
                            ? 'bg-white text-black'
                            : 'bg-white/10 text-white hover:bg-white/20'
                        }`}
                      >
                        LIMIT
                      </button>
                    </div>
                  </div>

                  {/* Side */}
                  <div className="mb-3">
                    <div className="text-xs text-white/50 mb-2">SIDE</div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setSide('YES')}
                        className={`px-3 py-2 text-xs font-bold rounded ${
                          side === 'YES'
                            ? 'bg-green-600 text-white'
                            : 'bg-white/10 text-white hover:bg-white/20'
                        }`}
                      >
                        YES
                      </button>
                      <button
                        onClick={() => setSide('NO')}
                        className={`px-3 py-2 text-xs font-bold rounded ${
                          side === 'NO'
                            ? 'bg-red-600 text-white'
                            : 'bg-white/10 text-white hover:bg-white/20'
                        }`}
                      >
                        NO
                      </button>
                    </div>
                  </div>

                  {/* Limit Price (if limit order) */}
                  {orderType === 'LIMIT' && (
                    <div className="mb-3">
                      <div className="text-xs text-white/50 mb-2">PRICE</div>
                      <input
                        type="number"
                        value={limitPrice}
                        onChange={(e) => setLimitPrice(e.target.value)}
                        placeholder="0.00"
                        className="w-full bg-black/50 border border-white/20 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-white/40"
                        step="0.01"
                      />
                    </div>
                  )}

                  {/* Amount */}
                  <div className="mb-3">
                    <div className="text-xs text-white/50 mb-2">SHARES</div>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0"
                      className="w-full bg-black/50 border border-white/20 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-white/40"
                      step="1"
                    />
                  </div>

                  {/* Summary */}
                  <div className="bg-black/30 rounded p-2 mb-3 space-y-1 text-xs font-mono">
                    <div className="flex justify-between text-white/50">
                      <span>Price:</span>
                      <span>${orderType === 'MARKET' ? currentPrice.toFixed(2) : (limitPrice || '0.00')}</span>
                    </div>
                    <div className="flex justify-between text-white/50">
                      <span>Shares:</span>
                      <span>{amount || 0}</span>
                    </div>
                    <div className="flex justify-between text-white font-bold border-t border-white/20 pt-1">
                      <span>Total:</span>
                      <span>${estimatedCost}</span>
                    </div>
                  </div>

                  {/* Submit */}
                  <div className="mt-auto">
                    <button
                      disabled={!amount || parseFloat(amount) <= 0 || !connected || (orderType === 'LIMIT' && !limitPrice)}
                      className="w-full bg-white text-black font-bold text-sm py-3 rounded hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {orderType} {side === 'YES' ? 'BUY' : 'SELL'}
                    </button>

                    {!connected && (
                      <div className="text-xs text-center text-yellow-400 mt-2">Connect wallet</div>
                    )}
                  </div>
                </div>

                {/* Market Stats */}
                <div className="bg-[#111111] rounded border border-white/10 p-3 h-[223px] flex flex-col">
                  <div className="text-xs font-bold text-white/70 mb-3">MARKET DATA</div>
                  <div className="space-y-2 text-xs font-mono flex-1">
                    <div className="flex justify-between">
                      <span className="text-white/50">Volume:</span>
                      <span className="text-white">${(selectedWordData.volume / 1000).toFixed(0)}K</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/50">YES Price:</span>
                      <span className="text-green-400">${selectedWordData.yesPrice}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/50">NO Price:</span>
                      <span className="text-red-400">${selectedWordData.noPrice}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/50">24h Change:</span>
                      <span className="text-green-400">+12.5%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/50">24h High:</span>
                      <span className="text-white">${(parseFloat(selectedWordData.yesPrice) * 1.08).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/50">24h Low:</span>
                      <span className="text-white">${(parseFloat(selectedWordData.yesPrice) * 0.92).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Stream Tab */}
          {activeTab === 'stream' && (
            <div className="grid grid-cols-12 gap-3">
              {/* Left - Words List */}
              <div className="col-span-2 space-y-1">
                <div className="text-xs text-white/50 font-bold mb-2 px-2">QUICK BUY</div>
                {market.words.map((word) => {
                  const isExpanded = selectedWord === word.word
                  
                  return (
                    <div key={word.word} className="bg-[#111111] rounded border border-white/10">
                      <button
                        onClick={() => setSelectedWord(word.word)}
                        className="w-full text-left px-2 py-2 text-xs hover:bg-white/5 transition-colors"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-white">{word.word}</span>
                          <span className="text-white/50 text-xs">{isExpanded ? '▲' : '▼'}</span>
                        </div>
                        <div className="flex gap-2 text-xs">
                          <span className="text-green-400">{word.yesPrice}</span>
                          <span className="text-red-400">{word.noPrice}</span>
                        </div>
                      </button>
                      
                      {isExpanded && (
                        <div className="border-t border-white/10 p-2 space-y-2">
                          <input
                            type="number"
                            placeholder="Shares"
                            className="w-full bg-black/50 border border-white/20 rounded px-2 py-1 text-xs text-white focus:outline-none"
                            min="0"
                            step="1"
                          />
                          <div className="grid grid-cols-2 gap-1">
                            <button className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold py-1 rounded">
                              YES
                            </button>
                            <button className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-1 rounded">
                              NO
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Center/Right - Stream */}
              <div className="col-span-10">
                <div className="bg-[#111111] rounded border border-white/10 overflow-hidden">
                  <div className="aspect-video bg-black">
                    <iframe
                      src={market.streamUrl}
                      className="w-full h-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
          </div>
        </div>
      </div>
    </div>
  )
}
