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
  
  const [selectedWord, setSelectedWord] = useState('Immigration')
  const [amount, setAmount] = useState('')
  const [activeTab, setActiveTab] = useState<'trading' | 'stream'>('trading')
  const [chatMessage, setChatMessage] = useState('')
  
  // Pro mode specific state
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET')
  const [side, setSide] = useState<'YES' | 'NO'>('YES')
  const [limitPrice, setLimitPrice] = useState('')
  
  // Mock chat messages
  const [chatMessages, setChatMessages] = useState([
    { id: 1, user: 'trader123', message: 'This is going to moon! 🚀', timestamp: '2m ago' },
    { id: 2, user: 'cryptoking', message: 'Already bought 1000 YES shares', timestamp: '5m ago' },
    { id: 3, user: 'betmaster', message: 'Stream starting soon!', timestamp: '8m ago' },
  ])
  
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
        title: "Trump Iowa Rally",
        eventTime: new Date(now + 2 * 60 * 60 * 1000),
        imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCPwsL0smxRVROhCkwShqqarIa-4xnAdVdAomChQJ_T5mRI0s77w-xoaIXYP2m8tRl-uEGpY2db-WBf6yZIfORA6Azp8_G7mOSTRPFRKHgyuo-4Ltlj_aMHH0t0PkSvdDO95rJOZpBgoS7jAKqkQ_7C86iSDgLJC9vDfV4YSshAaEhuIv2qI0WDcGs0VSLKNYTrz72KduCuH-fH8XBkROiM1zDK2dJlV6R0sCiMjP_Y3Ml19Uglhnihkb8ZD1prCuWa0i_wip0TXSI',
        words: [
          { word: 'Immigration', yesPrice: '0.72', noPrice: '0.28', volume: 125000 },
          { word: 'Economy', yesPrice: '0.65', noPrice: '0.35', volume: 98000 },
          { word: 'China', yesPrice: '0.58', noPrice: '0.42', volume: 87000 },
          { word: 'Border', yesPrice: '0.81', noPrice: '0.19', volume: 156000 },
          { word: 'Taxes', yesPrice: '0.45', noPrice: '0.55', volume: 67000 },
          { word: 'Jobs', yesPrice: '0.67', noPrice: '0.33', volume: 89000 },
          { word: 'Trade', yesPrice: '0.52', noPrice: '0.48', volume: 72000 },
          { word: 'America', yesPrice: '0.89', noPrice: '0.11', volume: 234000 },
          { word: 'Freedom', yesPrice: '0.76', noPrice: '0.24', volume: 145000 },
          { word: 'Victory', yesPrice: '0.83', noPrice: '0.17', volume: 178000 },
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
      <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
        <div className="layout-container flex h-full grow flex-col">
          <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
            <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
              <Header />
            
            <main className="py-6">
              {/* Header with Tabs */}
              <div className="flex items-center justify-between mb-6 pb-5 border-b border-white/10">
                <div>
                  <h1 className="text-2xl font-semibold text-white mb-1">{market.title}</h1>
                  <div className="flex items-center gap-3 text-sm text-neutral-400">
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium">Ends in</span>
                      <CountdownTimer targetTime={market.eventTime} />
                    </span>
                  </div>
                </div>
                
                {/* Tabs and Mode Toggle */}
                <div className="flex flex-col items-end gap-3">
                  {/* Mode Toggle */}
                  <button
                    onClick={() => setMode('pro')}
                    className="flex items-center gap-2 px-4 py-2 glass rounded-lg hover:bg-white/10 transition-all duration-200"
                  >
                    <span className="text-xs text-neutral-400 font-medium">Normal</span>
                    <div className="relative w-11 h-6 bg-white/10 rounded-full">
                      <div className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200 translate-x-0"></div>
                    </div>
                    <span className="text-xs text-neutral-400 font-medium">Pro</span>
                  </button>
                  
                  {/* Tabs */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setActiveTab('trading')}
                      className={`px-6 py-2.5 font-semibold text-sm transition-all duration-200 rounded-lg ${
                        activeTab === 'trading'
                          ? 'bg-white text-black shadow-button'
                          : 'glass text-neutral-300 hover:bg-white/10'
                      }`}
                    >
                      Trading
                    </button>
                    <button
                      onClick={() => setActiveTab('stream')}
                      className={`px-6 py-2.5 font-semibold text-sm transition-all duration-200 rounded-lg ${
                        activeTab === 'stream'
                          ? 'bg-white text-black shadow-button'
                          : 'glass text-neutral-300 hover:bg-white/10'
                      }`}
                    >
                      Stream
                    </button>
                  </div>
                </div>
              </div>

              {/* Trading Tab */}
              <div className={activeTab === 'trading' ? 'block' : 'hidden'}>
                <div className="grid grid-cols-12 gap-5 h-[calc(100vh-280px)]">
                {/* Left - Words List */}
                <div className="col-span-7 glass rounded-2xl p-4 overflow-y-auto">
                  <div className="space-y-2">
                    {market.words.map((word) => (
                      <button
                        key={word.word}
                        onClick={() => setSelectedWord(word.word)}
                        className={`w-full p-4 rounded-xl transition-all duration-200 ${
                          selectedWord === word.word
                            ? 'bg-white text-black shadow-card'
                            : 'glass hover:bg-white/10'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-lg font-semibold">{word.word}</div>
                          <div className="flex gap-4 text-sm font-semibold">
                            <span className={selectedWord === word.word ? 'text-green-600' : 'text-apple-green'}>
                              YES ${word.yesPrice}
                            </span>
                            <span className={selectedWord === word.word ? 'text-red-600' : 'text-apple-red'}>
                              NO ${word.noPrice}
                            </span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Right - Trading Interface */}
                <div className="col-span-5">
                  <div className="glass rounded-2xl p-6 h-full flex flex-col">
                    <h2 className="text-2xl font-semibold mb-6 text-center">
                      {selectedWordData.word}
                    </h2>
                    
                    <div className="space-y-4">
                      {/* Quick Stats */}
                      <div className="grid grid-cols-3 gap-2 mb-4">
                        <div className="bg-black/30 rounded-xl p-3 text-center">
                          <div className="text-neutral-500 text-xs font-medium">Volume</div>
                          <div className="text-lg font-semibold">${(selectedWordData.volume / 1000).toFixed(0)}K</div>
                        </div>
                        <div className="bg-black/30 rounded-xl p-3 text-center">
                          <div className="text-neutral-500 text-xs font-medium">Yes</div>
                          <div className="text-lg font-semibold text-apple-green">${selectedWordData.yesPrice}</div>
                        </div>
                        <div className="bg-black/30 rounded-xl p-3 text-center">
                          <div className="text-neutral-500 text-xs font-medium">No</div>
                          <div className="text-lg font-semibold text-apple-red">${selectedWordData.noPrice}</div>
                        </div>
                      </div>

                      {/* Amount Input */}
                      <div>
                        <label className="text-neutral-400 text-sm font-medium block mb-2">Shares</label>
                        <input
                          type="number"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder="0"
                          className="w-full h-14 bg-black/50 border border-white/20 rounded-xl text-white text-2xl px-4 focus:outline-none focus:border-white/50 text-center font-semibold transition-all duration-200"
                          min="0"
                          step="1"
                        />
                      </div>

                      {/* Buy Buttons */}
                      <div className="space-y-3">
                        <div>
                          <button
                            disabled={!amount || parseFloat(amount) <= 0 || !connected}
                            className="w-full h-20 bg-apple-green hover:bg-apple-green/90 text-white font-semibold text-xl rounded-xl transition-all duration-200 transform hover:scale-[1.02] shadow-button disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                          >
                            <div>Buy Yes</div>
                            <div className="text-2xl font-bold mt-1">${selectedWordData.yesPrice}</div>
                          </button>
                          <div className="mt-2 text-sm text-center space-y-1">
                            <div className="text-neutral-400">Cost: <span className="text-white font-semibold">${estimatedYesCost}</span></div>
                            <div className="text-apple-green font-semibold">Win: ${yesShares}</div>
                          </div>
                        </div>
                        
                        <div>
                          <button
                            disabled={!amount || parseFloat(amount) <= 0 || !connected}
                            className="w-full h-20 bg-apple-red hover:bg-apple-red/90 text-white font-semibold text-xl rounded-xl transition-all duration-200 transform hover:scale-[1.02] shadow-button disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                          >
                            <div>Buy No</div>
                            <div className="text-2xl font-bold mt-1">${selectedWordData.noPrice}</div>
                          </button>
                          <div className="mt-2 text-sm text-center space-y-1">
                            <div className="text-neutral-400">Cost: <span className="text-white font-semibold">${estimatedNoCost}</span></div>
                            <div className="text-apple-red font-semibold">Win: ${noShares}</div>
                          </div>
                        </div>
                      </div>

                      {!connected && (
                        <div className="text-center text-apple-orange text-sm font-semibold mt-4 bg-apple-orange/10 rounded-lg py-3">
                          Connect wallet to trade
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Stream Tab */}
            <div className={activeTab === 'stream' ? 'block' : 'hidden'}>
              <div className="grid grid-cols-12 gap-4 h-[calc(100vh-280px)]">
                {/* Left/Center - Stream */}
                <div className="col-span-8 glass rounded-2xl overflow-hidden">
                  <div className="w-full h-full bg-black">
                    <iframe
                      src={market.streamUrl}
                      className="w-full h-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                </div>

                {/* Right - Chat */}
                <div className="col-span-4 glass rounded-2xl flex flex-col">
                  <div className="p-4 border-b border-white/10">
                    <h3 className="text-sm font-semibold text-neutral-300">Live Chat</h3>
                  </div>
                  
                  {/* Chat Messages */}
                  <div className="flex-1 p-4 overflow-y-auto space-y-3">
                    {chatMessages.map((msg) => (
                      <div key={msg.id} className="glass rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-white">{msg.user}</span>
                          <span className="text-xs text-neutral-500">{msg.timestamp}</span>
                        </div>
                        <p className="text-xs text-neutral-300">{msg.message}</p>
                      </div>
                    ))}
                  </div>
                  
                  {/* Chat Input */}
                  <div className="p-4 border-t border-white/10">
                    {connected ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={chatMessage}
                          onChange={(e) => setChatMessage(e.target.value)}
                          placeholder="Message..."
                          className="flex-1 glass rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:bg-white/10 transition-all duration-200"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && chatMessage.trim()) {
                              setChatMessages([...chatMessages, {
                                id: Date.now(),
                                user: 'You',
                                message: chatMessage,
                                timestamp: 'now'
                              }])
                              setChatMessage('')
                            }
                          }}
                        />
                        <button
                          onClick={() => {
                            if (chatMessage.trim()) {
                              setChatMessages([...chatMessages, {
                                id: Date.now(),
                                user: 'You',
                                message: chatMessage,
                                timestamp: 'now'
                              }])
                              setChatMessage('')
                            }
                          }}
                          className="px-4 py-2 bg-white text-black font-semibold text-xs rounded-lg hover:bg-neutral-100 transition-colors duration-200"
                        >
                          Send
                        </button>
                      </div>
                    ) : (
                      <div className="text-center text-neutral-500 text-xs">
                        Connect wallet to chat
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </main>
          </div>
        </div>
      </div>
    </div>
  )
}

  // Pro Mode Render
  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
            <Header />
        
        <main className="py-6">
          {/* Top Bar */}
          <div className="flex items-center justify-between mb-6 pb-5 border-b border-white/10">
            <div>
              <h1 className="text-2xl font-semibold text-white mb-1">{market.title}</h1>
              <div className="flex items-center gap-3 text-sm text-neutral-400">
                <span className="flex items-center gap-1.5">
                  <span className="font-medium">Ends in</span>
                  <CountdownTimer targetTime={market.eventTime} />
                </span>
              </div>
            </div>
            
            {/* Tabs and Mode Toggle */}
            <div className="flex flex-col items-end gap-3">
              {/* Mode Toggle */}
              <button
                onClick={() => setMode('normal')}
                className="flex items-center gap-2 px-4 py-2 glass rounded-lg hover:bg-white/10 transition-all duration-200"
              >
                <span className="text-xs text-neutral-400 font-medium">Normal</span>
                <div className="relative w-11 h-6 bg-white/10 rounded-full">
                  <div className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200 translate-x-5"></div>
                </div>
                <span className="text-xs text-neutral-400 font-medium">Pro</span>
              </button>
              
              {/* Tabs */}
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveTab('trading')}
                  className={`px-6 py-2.5 font-semibold text-sm transition-all duration-200 rounded-lg ${
                    activeTab === 'trading'
                      ? 'bg-white text-black shadow-button'
                      : 'glass text-neutral-300 hover:bg-white/10'
                  }`}
                >
                  Trading
                </button>
                <button
                  onClick={() => setActiveTab('stream')}
                  className={`px-6 py-2.5 font-semibold text-sm transition-all duration-200 rounded-lg ${
                    activeTab === 'stream'
                      ? 'bg-white text-black shadow-button'
                      : 'glass text-neutral-300 hover:bg-white/10'
                  }`}
                >
                  Stream
                </button>
              </div>
            </div>
          </div>

          {/* Main Grid - Trading Tab */}
          <div className={activeTab === 'trading' ? 'block' : 'hidden'}>
            <div className="grid grid-cols-12 gap-4">
              {/* Left - Words List */}
              <div className="col-span-2 space-y-1">
                <div className="text-xs text-neutral-500 font-semibold mb-2 px-2">Markets</div>
                {market.words.map((word) => (
                  <button
                    key={word.word}
                    onClick={() => setSelectedWord(word.word)}
                    className={`w-full text-left px-3 py-2.5 text-xs font-mono transition-all duration-200 rounded-lg ${
                      selectedWord === word.word
                        ? 'glass bg-white/10 text-white'
                        : 'text-neutral-400 hover:glass hover:text-white'
                    }`}
                  >
                    <div className="font-semibold mb-1">{word.word}</div>
                    <div className="flex gap-2">
                      <span className="text-apple-green">{word.yesPrice}</span>
                      <span className="text-apple-red">{word.noPrice}</span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Center - Chart */}
              <div className="col-span-7 space-y-4">
                <div className="glass rounded-2xl h-[400px] flex flex-col overflow-hidden">
                  <div className="border-b border-white/10 p-3 flex items-center justify-between flex-shrink-0">
                    <span className="text-xs font-semibold text-neutral-400">{selectedWordData.word} / YES</span>
                    <span className="text-sm font-bold">${parseFloat(selectedWordData.yesPrice).toFixed(2)}</span>
                  </div>
                  <div className="flex-1 p-3 min-h-0">
                    <TradingChart
                      word={selectedWord}
                      data={historicalData}
                      currentPrice={parseFloat(selectedWordData.yesPrice)}
                    />
                  </div>
                </div>

                {/* Order Book */}
                <div className="glass rounded-2xl h-[223px] flex flex-col">
                  <div className="border-b border-white/10 p-3 flex-shrink-0">
                    <span className="text-xs font-semibold text-neutral-400">Order Book</span>
                  </div>
                  <div className="grid grid-cols-2 divide-x divide-white/10 flex-1 overflow-hidden">
                    <div className="p-3 flex flex-col">
                      <div className="text-xs text-apple-green font-semibold mb-2">Bids</div>
                      <div className="space-y-1 font-mono text-xs flex-1">
                        {orderBook.buyOrders.slice(0, 7).map((order, i) => (
                          <div key={i} className="grid grid-cols-3 gap-2 text-neutral-400">
                            <span className="text-apple-green font-semibold">{order.price.toFixed(2)}</span>
                            <span className="text-right">{order.amount}</span>
                            <span className="text-right">${order.total.toFixed(0)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="p-3 flex flex-col">
                      <div className="text-xs text-apple-red font-semibold mb-2">Asks</div>
                      <div className="space-y-1 font-mono text-xs flex-1">
                        {orderBook.sellOrders.slice(0, 7).map((order, i) => (
                          <div key={i} className="grid grid-cols-3 gap-2 text-neutral-400">
                            <span className="text-apple-red font-semibold">{order.price.toFixed(2)}</span>
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
              <div className="col-span-3 space-y-4">
                <div className="glass rounded-2xl p-4 h-[400px] flex flex-col">
                  <div className="text-xs font-semibold text-neutral-400 mb-3">Place Order</div>
                  
                  {/* Order Type */}
                  <div className="mb-2.5">
                    <div className="text-xs text-neutral-500 font-medium mb-1.5">Type</div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setOrderType('MARKET')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                          orderType === 'MARKET'
                            ? 'bg-white text-black shadow-button'
                            : 'glass hover:bg-white/10'
                        }`}
                      >
                        Market
                      </button>
                      <button
                        onClick={() => setOrderType('LIMIT')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                          orderType === 'LIMIT'
                            ? 'bg-white text-black shadow-button'
                            : 'glass hover:bg-white/10'
                        }`}
                      >
                        Limit
                      </button>
                    </div>
                  </div>

                  {/* Side */}
                  <div className="mb-2.5">
                    <div className="text-xs text-neutral-500 font-medium mb-1.5">Side</div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setSide('YES')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                          side === 'YES'
                            ? 'bg-apple-green text-white'
                            : 'glass hover:bg-white/10'
                        }`}
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setSide('NO')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                          side === 'NO'
                            ? 'bg-apple-red text-white'
                            : 'glass hover:bg-white/10'
                        }`}
                      >
                        No
                      </button>
                    </div>
                  </div>

                  {/* Price and Shares on same line for limit orders */}
                  {orderType === 'LIMIT' ? (
                    <div className="mb-2.5">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-xs text-neutral-500 font-medium mb-1.5">Price</div>
                          <input
                            type="number"
                            value={limitPrice}
                            onChange={(e) => setLimitPrice(e.target.value)}
                            placeholder="0.00"
                            className="w-full glass rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:bg-white/10 transition-all duration-200"
                            step="0.01"
                          />
                        </div>
                        <div>
                          <div className="text-xs text-neutral-500 font-medium mb-1.5">Shares</div>
                          <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0"
                            className="w-full glass rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:bg-white/10 transition-all duration-200"
                            step="1"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mb-2.5">
                      <div className="text-xs text-neutral-500 font-medium mb-1.5">Shares</div>
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0"
                        className="w-full glass rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:bg-white/10 transition-all duration-200"
                        step="1"
                      />
                    </div>
                  )}

                  {/* Summary */}
                  <div className="bg-black/30 rounded-lg p-2.5 mb-2.5 space-y-1 text-xs font-mono">
                    <div className="flex justify-between text-neutral-400">
                      <span>Price:</span>
                      <span>${orderType === 'MARKET' ? currentPrice.toFixed(2) : (limitPrice || '0.00')}</span>
                    </div>
                    <div className="flex justify-between text-neutral-400">
                      <span>Shares:</span>
                      <span>{amount || 0}</span>
                    </div>
                    <div className="flex justify-between text-white font-semibold border-t border-white/20 pt-1">
                      <span>Total:</span>
                      <span>${estimatedCost}</span>
                    </div>
                  </div>

                  {/* Submit */}
                  <div className="mt-auto">
                    <button
                      disabled={!amount || parseFloat(amount) <= 0 || !connected || (orderType === 'LIMIT' && !limitPrice)}
                      className="w-full bg-white text-black font-semibold text-sm py-2.5 rounded-lg hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-button"
                    >
                      {orderType} {side === 'YES' ? 'Buy' : 'Sell'}
                    </button>

                    {!connected && (
                      <div className="text-xs text-center text-apple-orange mt-2">Connect wallet</div>
                    )}
                  </div>
                </div>

                {/* Market Stats */}
                <div className="glass rounded-2xl p-4 h-[223px] flex flex-col">
                  <div className="text-xs font-semibold text-neutral-400 mb-3">Market Data</div>
                  <div className="space-y-2 text-xs font-mono flex-1">
                    <div className="flex justify-between">
                      <span className="text-neutral-500">Volume:</span>
                      <span className="text-white font-semibold">${(selectedWordData.volume / 1000).toFixed(0)}K</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500">Yes Price:</span>
                      <span className="text-apple-green font-semibold">${selectedWordData.yesPrice}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500">No Price:</span>
                      <span className="text-apple-red font-semibold">${selectedWordData.noPrice}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500">24h Change:</span>
                      <span className="text-apple-green font-semibold">+12.5%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500">24h High:</span>
                      <span className="text-white font-semibold">${(parseFloat(selectedWordData.yesPrice) * 1.08).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500">24h Low:</span>
                      <span className="text-white font-semibold">${(parseFloat(selectedWordData.yesPrice) * 0.92).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Stream Tab */}
          <div className={activeTab === 'stream' ? 'block' : 'hidden'}>
            <div className="grid grid-cols-12 gap-4 h-[calc(100vh-280px)]">
              {/* Left/Center - Stream */}
              <div className="col-span-8 glass rounded-2xl overflow-hidden">
                <div className="w-full h-full bg-black">
                  <iframe
                    src={market.streamUrl}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              </div>

              {/* Right - Chat */}
              <div className="col-span-4 glass rounded-2xl flex flex-col">
                <div className="p-4 border-b border-white/10">
                  <h3 className="text-sm font-semibold text-neutral-300">Live Chat</h3>
                </div>
                
                {/* Chat Messages */}
                <div className="flex-1 p-4 overflow-y-auto space-y-3">
                  {chatMessages.map((msg) => (
                    <div key={msg.id} className="glass rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-white">{msg.user}</span>
                        <span className="text-xs text-neutral-500">{msg.timestamp}</span>
                      </div>
                      <p className="text-xs text-neutral-300">{msg.message}</p>
                    </div>
                  ))}
                </div>
                
                {/* Chat Input */}
                <div className="p-4 border-t border-white/10">
                  {connected ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={chatMessage}
                        onChange={(e) => setChatMessage(e.target.value)}
                        placeholder="Message..."
                        className="flex-1 glass rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:bg-white/10 transition-all duration-200"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && chatMessage.trim()) {
                            setChatMessages([...chatMessages, {
                              id: Date.now(),
                              user: 'You',
                              message: chatMessage,
                              timestamp: 'now'
                            }])
                            setChatMessage('')
                          }
                        }}
                      />
                      <button
                        onClick={() => {
                          if (chatMessage.trim()) {
                            setChatMessages([...chatMessages, {
                              id: Date.now(),
                              user: 'You',
                              message: chatMessage,
                              timestamp: 'now'
                            }])
                            setChatMessage('')
                          }
                        }}
                        className="px-4 py-2 bg-white text-black font-semibold text-xs rounded-lg hover:bg-neutral-100 transition-colors duration-200"
                      >
                        Send
                      </button>
                    </div>
                  ) : (
                    <div className="text-center text-neutral-500 text-xs">
                      Connect wallet to chat
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </main>
          </div>
        </div>
      </div>
    </div>
  )
}
