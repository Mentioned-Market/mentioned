'use client'

import { useState, useMemo } from 'react'
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

export default function TrumpSpeechPro() {
  const { connected } = useWallet()
  const [selectedWord, setSelectedWord] = useState('IMMIGRATION')
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET')
  const [side, setSide] = useState<'YES' | 'NO'>('YES')
  const [amount, setAmount] = useState('')
  const [limitPrice, setLimitPrice] = useState('')
  const [activeTab, setActiveTab] = useState<'trading' | 'stream'>('trading')
  
  const market = useMemo(() => {
    const now = Date.now()
    return {
      title: "TRUMP'S SPEECH",
      eventTime: new Date(now + 2 * 60 * 60 * 1000),
      streamUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
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
      ]
    }
  }, [])

  const selectedWordData = market.words.find(w => w.word === selectedWord) || market.words[0]
  
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
  
  const currentPrice = side === 'YES' ? parseFloat(selectedWordData.yesPrice) : parseFloat(selectedWordData.noPrice)
  const estimatedCost = amount ? (parseFloat(amount) * (orderType === 'MARKET' ? currentPrice : parseFloat(limitPrice || '0'))).toFixed(2) : '0.00'

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="px-4 md:px-10 lg:px-20">
        <Header />
        
        <main className="py-4">
          {/* Top Bar */}
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/10">
            <div>
              <h1 className="text-2xl font-bold text-white/90">{market.title}</h1>
              <div className="flex items-center gap-4 text-sm text-white/50 mt-1">
                <span>ENDS: <CountdownTimer targetTime={market.eventTime} /></span>
                <span>MODE: PRO</span>
              </div>
            </div>
            
            {/* Tabs */}
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab('trading')}
                className={`px-4 py-2 text-xs font-bold rounded ${
                  activeTab === 'trading'
                    ? 'bg-white text-black'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                TRADING
              </button>
              <button
                onClick={() => setActiveTab('stream')}
                className={`px-4 py-2 text-xs font-bold rounded ${
                  activeTab === 'stream'
                    ? 'bg-white text-black'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                STREAM
              </button>
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
            <div className="col-span-7">
              <div className="bg-[#111111] rounded border border-white/10">
                <div className="border-b border-white/10 p-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-white/70">{selectedWordData.word} / YES</span>
                  <span className="text-sm font-bold">${parseFloat(selectedWordData.yesPrice).toFixed(2)}</span>
                </div>
                <div className="h-[350px] p-2">
                  <TradingChart
                    word={selectedWord}
                    data={historicalData}
                    currentPrice={parseFloat(selectedWordData.yesPrice)}
                  />
                </div>
              </div>

              {/* Order Book */}
              <div className="mt-3 bg-[#111111] rounded border border-white/10">
                <div className="border-b border-white/10 p-2">
                  <span className="text-xs font-bold text-white/70">ORDER BOOK</span>
                </div>
                <div className="grid grid-cols-2 divide-x divide-white/10">
                  <div className="p-2">
                    <div className="text-xs text-green-400 font-bold mb-2">BIDS</div>
                    <div className="space-y-1 font-mono text-xs">
                      {orderBook.buyOrders.slice(0, 5).map((order, i) => (
                        <div key={i} className="grid grid-cols-3 gap-2 text-white/70">
                          <span className="text-green-400">{order.price.toFixed(2)}</span>
                          <span className="text-right">{order.amount}</span>
                          <span className="text-right">${order.total.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="p-2">
                    <div className="text-xs text-red-400 font-bold mb-2">ASKS</div>
                    <div className="space-y-1 font-mono text-xs">
                      {orderBook.sellOrders.slice(0, 5).map((order, i) => (
                        <div key={i} className="grid grid-cols-3 gap-2 text-white/70">
                          <span className="text-red-400">{order.price.toFixed(2)}</span>
                          <span className="text-right">{order.amount}</span>
                          <span className="text-right">${order.total.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right - Trading Terminal */}
            <div className="col-span-3">
              <div className="bg-[#111111] rounded border border-white/10 p-3">
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

              {/* Market Stats */}
              <div className="mt-3 bg-[#111111] rounded border border-white/10 p-3">
                <div className="text-xs font-bold text-white/70 mb-3">MARKET DATA</div>
                <div className="space-y-2 text-xs font-mono">
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
  )
}

