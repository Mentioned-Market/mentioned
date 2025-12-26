'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { PublicKey } from '@solana/web3.js'
import Header from '@/components/Header'
import CountdownTimer from '@/components/CountdownTimer'
import TradingChart from '@/components/TradingChart'
import OrderBook from '@/components/OrderBook'
import WordList from '@/components/WordList'
import TradingInterface from '@/components/TradingInterface'
import ResolveRules from '@/components/ResolveRules'
import QuickBuy from '@/components/QuickBuy'
import { useWallet } from '@/contexts/WalletContext'

interface Word {
  word: string
  yesPrice: string
  noPrice: string
  volume: number
}

interface ChatMessage {
  id: string
  username: string
  message: string
  timestamp: Date
}

interface DataPoint {
  timestamp: number
  price: number
}

export default function MarketPage() {
  const params = useParams()
  const marketId = params.id as string
  
  const market = useMemo(() => {
    const now = Date.now()
    const marketData: Record<string, {
      id: string
      category: string
      title: string
      eventTime: Date
      imageUrl: string
      words: Word[]
      streamUrl?: string
      resolveRules: Array<{ outcome: 'YES' | 'NO', description: string }>
    }> = {
      'trump-speech': {
        id: 'trump-speech',
        category: 'POLITICS',
        title: "TRUMP'S SPEECH",
        eventTime: new Date(now + 2 * 60 * 60 * 1000), // 2 hours from now
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
        streamUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', // Dummy stream
        resolveRules: [
          {
            outcome: 'YES',
            description: 'The word must be spoken clearly and audibly by Trump during the main speech. Variations (e.g., "immigrant" for "immigration") will be evaluated case-by-case. Introduction and closing remarks are included.'
          },
          {
            outcome: 'NO',
            description: 'The word is NOT spoken during the main speech period, OR is only mentioned by other speakers, OR is only present in background materials/slides but not verbally stated by Trump.'
          }
        ]
      },
    }
    return marketData[marketId] || marketData['trump-speech']
  }, [marketId])
  
  const [activeTab, setActiveTab] = useState<'trading' | 'stream'>('trading')
  const [selectedWord, setSelectedWord] = useState(market.words[0].word)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)
  const { publicKey, connected } = useWallet()

  // Generate simulated historical data for the selected word
  const generateHistoricalData = (word: Word): DataPoint[] => {
    const data: DataPoint[] = []
    const now = Date.now()
    const startPrice = parseFloat(word.yesPrice) - 0.15 // Start lower
    const endPrice = parseFloat(word.yesPrice)
    
    // Generate 50 data points over 24 hours
    for (let i = 0; i < 50; i++) {
      const timestamp = now - (24 * 60 * 60 * 1000) * (1 - i / 49)
      const progress = i / 49
      // Add some randomness to make it look realistic
      const volatility = (Math.random() - 0.5) * 0.05
      const price = startPrice + (endPrice - startPrice) * progress + volatility
      data.push({ timestamp, price: Math.max(0, Math.min(1, price)) })
    }
    
    return data
  }

  // Generate simulated order book
  const generateOrderBook = (word: Word) => {
    const yesPrice = parseFloat(word.yesPrice)
    const noPrice = parseFloat(word.noPrice)
    
    const buyOrders = []
    const sellOrders = []
    
    // Generate 5 buy orders
    for (let i = 0; i < 5; i++) {
      const price = yesPrice - (i + 1) * 0.02
      const amount = Math.floor(Math.random() * 500) + 100
      buyOrders.push({
        price,
        amount,
        total: price * amount
      })
    }
    
    // Generate 5 sell orders
    for (let i = 0; i < 5; i++) {
      const price = yesPrice + (i + 1) * 0.02
      const amount = Math.floor(Math.random() * 500) + 100
      sellOrders.push({
        price,
        amount,
        total: price * amount
      })
    }
    
    return { buyOrders, sellOrders }
  }

  const selectedWordData = market.words.find(w => w.word === selectedWord) || market.words[0]
  const historicalData = generateHistoricalData(selectedWordData)
  const orderBook = generateOrderBook(selectedWordData)

  // Create mock marketData for TradingInterface component
  const mockMarketData = {
    marketPda: new PublicKey('11111111111111111111111111111111'), // Mock public key
    marketData: {},
    word: selectedWord,
    yesPrice: parseFloat(selectedWordData.yesPrice),
    noPrice: parseFloat(selectedWordData.noPrice),
    totalLiquidity: 0,
    yesBalance: 0,
    noBalance: 0,
  }

  const getUsername = () => {
    if (!connected || !publicKey) return 'Anonymous'
    const address = publicKey.toString()
    return `${address.slice(0, 4)}...${address.slice(-4)}`
  }

  useEffect(() => {
    // Add some initial mock messages
    const initialMessages: ChatMessage[] = [
      { id: '1', username: 'CryptoTrader', message: 'IMMIGRATION is going to hit 0.80!', timestamp: new Date(Date.now() - 120000) },
      { id: '2', username: 'SolanaMaxi', message: 'AMERICA is a lock at 0.89', timestamp: new Date(Date.now() - 90000) },
      { id: '3', username: 'DeFiDegen', message: 'BORDER looking strong', timestamp: new Date(Date.now() - 60000) },
      { id: '4', username: 'MoonBoy', message: 'VICTORY to the moon!', timestamp: new Date(Date.now() - 30000) },
    ]
    setChatMessages(initialMessages)

    // Simulate new messages every 10-20 seconds
    const interval = setInterval(() => {
      const mockUsers = ['CryptoTrader', 'SolanaMaxi', 'DeFiDegen', 'MoonBoy', 'WhaleAlert', 'DiamondHands']
      const mockMessages = [
        'This is going to be huge!',
        'I just bought IMMIGRATION',
        'AMERICA is the play',
        'BORDER looking good',
        'VICTORY to 0.90!',
        'CHINA might surprise',
        'ECONOMY is undervalued',
      ]
      const randomUser = mockUsers[Math.floor(Math.random() * mockUsers.length)]
      const randomMessage = mockMessages[Math.floor(Math.random() * mockMessages.length)]
      
      setChatMessages(prev => [...prev, {
        id: Date.now().toString(),
        username: randomUser,
        message: randomMessage,
        timestamp: new Date(),
      }])
    }, 15000)

    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (!chatInput.trim()) return

    setChatMessages(prev => [...prev, {
      id: Date.now().toString(),
      username: getUsername(),
      message: chatInput,
      timestamp: new Date(),
    }])
    setChatInput('')
  }

  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="layout-content-container flex flex-col w-full max-w-[1800px] flex-1">
            <Header />
            
            <main className="flex-1 py-5">
              {/* Market Header with Tabs */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex-1">
                    <h1 className="text-4xl md:text-6xl font-bold uppercase text-white">{market.title}</h1>
                  </div>
                  
                  {/* Tabs - Top Right */}
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
                <div className="flex items-center gap-6 text-xl">
                  <span className="text-white/70">ENDS IN:</span>
                  <CountdownTimer targetTime={market.eventTime} />
                </div>
              </div>

              {/* Trading Tab */}
              {activeTab === 'trading' && (
                <div className="space-y-6">
                  {/* Top Section - Chart and Trading Interface */}
                  <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                    {/* Left side - Price Chart */}
                    <div className="lg:col-span-3">
                      <div className="bg-black h-full">
                        <div className="border-b border-white/30 p-3">
                          <div className="flex items-center justify-between">
                            <h3 className="text-white font-bold text-lg uppercase">
                              {selectedWord} - PRICE HISTORY
                            </h3>
                            <div className="text-white font-bold text-xl">
                              ${parseFloat(selectedWordData.yesPrice).toFixed(2)}
                            </div>
                          </div>
                        </div>
                        <div className="h-[450px] p-4">
                          <TradingChart
                            word={selectedWord}
                            data={historicalData}
                            currentPrice={parseFloat(selectedWordData.yesPrice)}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Right side - Compact Trading Interface */}
                    <div className="lg:col-span-1">
                      <TradingInterface
                        marketData={mockMarketData}
                        eventId={marketId}
                      />
                    </div>
                  </div>

                  {/* Word List - Horizontal Scroll */}
                  <WordList
                    words={market.words}
                    selectedWord={selectedWord}
                    onSelectWord={setSelectedWord}
                  />

                  {/* Resolve Rules */}
                  <ResolveRules
                    title={market.title}
                    rules={market.resolveRules}
                  />
                </div>
              )}

              {/* Stream Tab */}
              {activeTab === 'stream' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Stream Embed */}
                    <div className="lg:col-span-2 bg-[#1a1a1a] rounded-lg overflow-hidden">
                      <div className="aspect-video bg-black relative">
                        <iframe
                          src={market.streamUrl}
                          className="w-full h-full"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                    </div>

                    {/* Chat */}
                    <div className="lg:col-span-1 bg-[#1a1a1a] rounded-lg flex flex-col h-[600px]">
                      <div className="border-b border-white/20 p-4">
                        <h3 className="text-white font-bold text-xl uppercase">CHAT</h3>
                      </div>
                      
                      <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {chatMessages.map((msg) => (
                          <div key={msg.id} className="text-sm">
                            <span className="text-white/70">{msg.username}:</span>
                            <span className="text-white ml-2">{msg.message}</span>
                          </div>
                        ))}
                        <div ref={chatEndRef} />
                      </div>

                      <form onSubmit={handleSendMessage} className="border-t border-white/20 p-4">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            placeholder={connected ? "Type a message..." : "Connect wallet to chat"}
                            disabled={!connected}
                            className="flex-1 bg-black border-2 border-white/30 rounded text-white text-sm px-4 py-2 focus:outline-none focus:border-white disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                          <button
                            type="submit"
                            disabled={!connected || !chatInput.trim()}
                            className="px-6 py-2 bg-white text-black font-bold uppercase rounded hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            SEND
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>

                  {/* Quick Buy Section */}
                  <QuickBuy words={market.words} />
                </div>
              )}
            </main>
          </div>
        </div>
      </div>
    </div>
  )
}

