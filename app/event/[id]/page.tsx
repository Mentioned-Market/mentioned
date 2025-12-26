'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Connection, PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import Header from '@/components/Header'
import CountdownTimer from '@/components/CountdownTimer'
import TradingChart from '@/components/TradingChart'
import WordList from '@/components/WordList'
import TradingInterface from '@/components/TradingInterface'
import ResolveRules from '@/components/ResolveRules'
import QuickBuy from '@/components/QuickBuy'
import { useWallet } from '@/contexts/WalletContext'
import { fetchEventMarkets, DEVNET_RPC, PROGRAM_ID } from '@/lib/program'

interface MarketData {
  marketPda: PublicKey
  marketData: any
  word: string
  yesPrice: number
  noPrice: number
  totalLiquidity: number
  yesBalance: number
  noBalance: number
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

export default function EventMarketPage() {
  const params = useParams()
  const eventId = params.id as string
  
  const [connection] = useState(() => new Connection(DEVNET_RPC, "confirmed"))
  const [markets, setMarkets] = useState<MarketData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  
  const [activeTab, setActiveTab] = useState<'trading' | 'stream'>('trading')
  const [selectedWord, setSelectedWord] = useState<string>("")
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)
  const { publicKey, connected } = useWallet()

  // Hardcoded admin public key for Event 1
  // TODO: Make this dynamic or fetch from somewhere
  const ADMIN_PUBKEY = new PublicKey("AmMusRD99A7CnHNhNziN4f2Fm6V9D4NW1soH4rUn8t7S")

  // Event metadata
  const eventTitle = "TRUMP'S SPEECH"
  const eventTime = new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours from now
  const streamUrl = 'https://www.youtube.com/embed/dQw4w9WgXcQ'
  const resolveRules = [
    {
      outcome: 'YES' as const,
      description: 'The word must be spoken clearly and audibly by Trump during the main speech. Variations (e.g., "immigrant" for "immigration") will be evaluated case-by-case. Introduction and closing remarks are included.'
    },
    {
      outcome: 'NO' as const,
      description: 'The word is NOT spoken during the main speech period, OR is only mentioned by other speakers, OR is only present in background materials/slides but not verbally stated by Trump.'
    }
  ]

  // Load markets from localStorage registry
  useEffect(() => {
    const loadMarkets = async () => {
      setLoading(true)
      setError("")
      
      try {
        // Get market registry from localStorage
        const registryStr = localStorage.getItem("marketRegistry")
        if (!registryStr) {
          setError("No markets found. Create markets in the admin panel first!")
          setLoading(false)
          return
        }

        const registry = JSON.parse(registryStr)
        console.log("Full registry:", registry)
        
        const eventData = registry[eventId]
        console.log(`Event data for event ${eventId}:`, eventData)
        
        // Support both old array format and new {admin, markets} format
        let adminPubkey: PublicKey
        let eventMarkets: any[]
        
        if (Array.isArray(eventData)) {
          // Old format: just array of markets
          console.warn("Using old localStorage format, defaulting to hardcoded admin pubkey")
          adminPubkey = new PublicKey("AmMusRD99A7CnHNhNziN4f2Fm6V9D4NW1soH4rUn8t7S")
          eventMarkets = eventData
        } else if (eventData && eventData.markets) {
          // New format: {admin, markets}
          adminPubkey = new PublicKey(eventData.admin)
          eventMarkets = eventData.markets
          console.log("Using admin pubkey from registry:", adminPubkey.toString())
        } else {
          setError(`No markets found for Event ${eventId}. Registry has events: ${Object.keys(registry).join(', ')}`)
          setLoading(false)
          return
        }
        
        if (!eventMarkets || eventMarkets.length === 0) {
          setError(`No markets found for Event ${eventId}. Registry has events: ${Object.keys(registry).join(', ')}`)
          setLoading(false)
          return
        }

        console.log("Loading markets:", eventMarkets)

        // Fetch market data from chain
        try {
          const fetchedMarkets = await fetchEventMarkets(
            connection,
            adminPubkey,
            new BN(eventId),
            eventMarkets
          )

          console.log("Fetched markets with prices:", fetchedMarkets)

          if (fetchedMarkets.length === 0) {
            setError("Markets exist but failed to load data from chain. Check console for details.")
            setLoading(false)
            return
          }

          setMarkets(fetchedMarkets)
          if (fetchedMarkets.length > 0) {
            setSelectedWord(fetchedMarkets[0].word)
          }
        } catch (fetchError: any) {
          console.error("Error fetching from chain:", fetchError)
          setError(`Chain fetch error: ${fetchError.message}`)
          setLoading(false)
          return
        }
      } catch (err: any) {
        console.error("Error loading markets:", err)
        setError(`Error: ${err.message}`)
      } finally {
        setLoading(false)
      }
    }

    if (eventId) {
      loadMarkets()
      
      // Refresh every 30 seconds
      const interval = setInterval(loadMarkets, 30000)
      return () => clearInterval(interval)
    }
  }, [eventId, connection])

  // Generate simulated historical data for the selected word
  const generateHistoricalData = (currentPrice: number): DataPoint[] => {
    const data: DataPoint[] = []
    const now = Date.now()
    const startPrice = Math.max(0.1, currentPrice - 0.15) // Start lower
    const endPrice = currentPrice
    
    // Generate 50 data points over 24 hours
    for (let i = 0; i < 50; i++) {
      const timestamp = now - (24 * 60 * 60 * 1000) * (1 - i / 49)
      const progress = i / 49
      // Add some randomness to make it look realistic
      const volatility = (Math.random() - 0.5) * 0.05
      const price = startPrice + (endPrice - startPrice) * progress + volatility
      data.push({ timestamp, price: Math.max(0.01, Math.min(0.99, price)) })
    }
    
    return data
  }

  const selectedMarket = markets.find(m => m.word === selectedWord)
  const historicalData = selectedMarket ? generateHistoricalData(selectedMarket.yesPrice) : []

  // Convert markets to Word format for WordList component
  const words = markets.map(m => ({
    word: m.word,
    yesPrice: m.yesPrice.toFixed(2),
    noPrice: m.noPrice.toFixed(2),
    volume: Math.floor(m.totalLiquidity / 1_000_000_000 * 100000), // Convert to display volume
  }))

  const getUsername = () => {
    if (!connected || !publicKey) return 'Anonymous'
    const address = publicKey.toString()
    return `${address.slice(0, 4)}...${address.slice(-4)}`
  }

  useEffect(() => {
    // Add some initial mock messages
    const initialMessages: ChatMessage[] = [
      { id: '1', username: 'CryptoTrader', message: 'These markets are live on-chain!', timestamp: new Date(Date.now() - 120000) },
      { id: '2', username: 'SolanaMaxi', message: 'Prices update based on real liquidity', timestamp: new Date(Date.now() - 90000) },
      { id: '3', username: 'DeFiDegen', message: 'Trading coming soon!', timestamp: new Date(Date.now() - 60000) },
    ]
    setChatMessages(initialMessages)

    // Simulate new messages every 20 seconds
    const interval = setInterval(() => {
      const mockUsers = ['CryptoTrader', 'SolanaMaxi', 'DeFiDegen', 'MoonBoy', 'WhaleAlert']
      const mockMessages = [
        'Looking good!',
        'Prices are moving',
        'More liquidity needed',
        'WAGMI',
        'To the moon!',
      ]
      const randomUser = mockUsers[Math.floor(Math.random() * mockUsers.length)]
      const randomMessage = mockMessages[Math.floor(Math.random() * mockMessages.length)]
      
      setChatMessages(prev => [...prev, {
        id: Date.now().toString(),
        username: randomUser,
        message: randomMessage,
        timestamp: new Date(),
      }])
    }, 20000)

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

  if (loading) {
    return (
      <div className="relative flex h-screen w-full items-center justify-center bg-black">
        <div className="text-center">
          <div className="mb-4 text-6xl">⏳</div>
          <h2 className="text-2xl font-bold text-white">Loading Markets...</h2>
          <p className="text-gray-400 mt-2">Fetching on-chain data</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="relative flex h-screen w-full items-center justify-center bg-black">
        <div className="text-center max-w-md">
          <div className="mb-4 text-6xl">❌</div>
          <h2 className="text-2xl font-bold text-white mb-4">Error Loading Markets</h2>
          <p className="text-gray-400 mb-6">{error}</p>
          <a
            href="/admin"
            className="inline-block px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold transition-all"
          >
            Go to Admin Panel
          </a>
        </div>
      </div>
    )
  }

  if (markets.length === 0) {
    return (
      <div className="relative flex h-screen w-full items-center justify-center bg-black">
        <div className="text-center max-w-md">
          <div className="mb-4 text-6xl">📊</div>
          <h2 className="text-2xl font-bold text-white mb-4">No Markets Yet</h2>
          <p className="text-gray-400 mb-6">Create markets for Event {eventId} in the admin panel</p>
          <a
            href="/admin"
            className="inline-block px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold transition-all"
          >
            Create Markets
          </a>
        </div>
      </div>
    )
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
                    <h1 className="text-4xl md:text-6xl font-bold uppercase text-white">{eventTitle}</h1>
                    <p className="text-sm text-gray-400 mt-2">
                      Event #{eventId} • {markets.length} Markets • Program: {PROGRAM_ID.toString().slice(0, 20)}...
                    </p>
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
                  <CountdownTimer targetTime={eventTime} />
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
                              ${selectedMarket ? selectedMarket.yesPrice.toFixed(2) : '0.00'}
                            </div>
                          </div>
                        </div>
                        <div className="h-[450px] p-4">
                          {selectedMarket && (
                            <TradingChart
                              word={selectedWord}
                              data={historicalData}
                              currentPrice={selectedMarket.yesPrice}
                            />
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right side - Trading Interface */}
                    <div className="lg:col-span-1">
                      {selectedMarket && (
                        <TradingInterface
                          marketData={selectedMarket}
                          eventId={eventId}
                        />
                      )}
                    </div>
                  </div>

                  {/* Word List - Horizontal Scroll */}
                  <WordList
                    words={words}
                    selectedWord={selectedWord}
                    onSelectWord={setSelectedWord}
                  />

                  {/* Liquidity Info */}
                  <div className="bg-[#1a1a1a] rounded-lg p-6 border border-white/10">
                    <h3 className="text-xl font-bold mb-4 text-white">💧 Market Liquidity</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {markets.map((market) => (
                        <div key={market.word} className="bg-black/50 rounded-lg p-4">
                          <h4 className="font-bold text-white mb-2">{market.word}</h4>
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-400">Liquidity:</span>
                              <span className="text-white">{(market.totalLiquidity / 1_000_000_000).toFixed(2)} SOL</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">YES Pool:</span>
                              <span className="text-green-400">{(market.yesBalance / 1_000_000_000).toFixed(4)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">NO Pool:</span>
                              <span className="text-red-400">{(market.noBalance / 1_000_000_000).toFixed(4)}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Resolve Rules */}
                  <ResolveRules
                    title={eventTitle}
                    rules={resolveRules}
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
                          src={streamUrl}
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
                  <QuickBuy words={words} />
                </div>
              )}
            </main>
          </div>
        </div>
      </div>
    </div>
  )
}

