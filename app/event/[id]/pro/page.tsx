'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import BN from 'bn.js'
import Header from '@/components/Header'
import CountdownTimer from '@/components/CountdownTimer'
import TradingChart from '@/components/TradingChart'
import { useWallet } from '@/contexts/WalletContext'
import { 
  fetchEventMarkets, 
  DEVNET_RPC, 
  createMintSetInstruction
} from '@/lib/program'

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

export default function TrumpSpeechPro() {
  const params = useParams()
  const eventId = params.id as string
  
  const { connected, publicKey } = useWallet()
  const [selectedWord, setSelectedWord] = useState('')
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET')
  const [side, setSide] = useState<'YES' | 'NO'>('YES')
  const [amount, setAmount] = useState('')
  const [limitPrice, setLimitPrice] = useState('')
  const [activeTab, setActiveTab] = useState<'trading' | 'stream'>('trading')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [markets, setMarkets] = useState<MarketData[]>([])
  const [connection] = useState(() => new Connection(DEVNET_RPC, "confirmed"))
  const [tradeLoading, setTradeLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  
  const market = useMemo(() => {
    const now = Date.now()
    return {
      title: "TRUMP'S SPEECH",
      eventTime: new Date(now + 2 * 60 * 60 * 1000),
      streamUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    }
  }, [])

  // Load markets from contract
  useEffect(() => {
    const loadMarkets = async () => {
      if (!eventId) return
      
      setLoading(true)
      setError("")
      
      try {
        const registryStr = localStorage.getItem("marketRegistry")
        if (!registryStr) {
          setError("No markets found. Create markets in the admin panel first!")
          setLoading(false)
          return
        }

        const registry = JSON.parse(registryStr)
        const eventData = registry[eventId]
        
        let adminPubkey: PublicKey
        let eventMarkets: any[]
        
        if (Array.isArray(eventData)) {
          adminPubkey = new PublicKey("AmMusRD99A7CnHNhNziN4f2Fm6V9D4NW1soH4rUn8t7S")
          eventMarkets = eventData
        } else if (eventData && eventData.markets) {
          adminPubkey = new PublicKey(eventData.admin)
          eventMarkets = eventData.markets
        } else {
          setError(`No markets found for Event ${eventId}`)
          setLoading(false)
          return
        }
        
        if (!eventMarkets || eventMarkets.length === 0) {
          setError(`No markets found for Event ${eventId}`)
          setLoading(false)
          return
        }

        const fetchedMarkets = await fetchEventMarkets(
          connection,
          adminPubkey,
          new BN(eventId),
          eventMarkets
        )

        if (fetchedMarkets.length === 0) {
          setError("Markets exist but failed to load data from chain.")
          setLoading(false)
          return
        }

        setMarkets(fetchedMarkets)
        if (fetchedMarkets.length > 0 && !selectedWord) {
          setSelectedWord(fetchedMarkets[0].word)
        }
      } catch (err: any) {
        console.error("Error loading markets:", err)
        setError(`Error: ${err.message}`)
      } finally {
        setLoading(false)
      }
    }

    loadMarkets()
  }, [eventId, connection, selectedWord])

  const selectedMarket = markets.find(m => m.word === selectedWord)
  const words: Word[] = markets.map(m => ({
    word: m.word,
    yesPrice: m.yesPrice.toFixed(2),
    noPrice: m.noPrice.toFixed(2),
    volume: Math.floor(m.totalLiquidity / 1_000_000_000 * 100000),
  }))

  const selectedWordData = words.find(w => w.word === selectedWord) || (words.length > 0 ? words[0] : {
    word: 'LOADING',
    yesPrice: '0.50',
    noPrice: '0.50',
    volume: 0
  })
  
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

  const handlePlaceOrder = async () => {
    if (!connected || !publicKey || !window.solana || !selectedMarket) {
      setErrorMessage("Please connect your wallet first")
      return
    }

    if (!amount || parseFloat(amount) <= 0) {
      setErrorMessage("Please enter a valid amount")
      return
    }

    if (orderType === 'LIMIT' && (!limitPrice || parseFloat(limitPrice) <= 0)) {
      setErrorMessage("Please enter a valid limit price")
      return
    }

    setTradeLoading(true)
    setSuccessMessage("")
    setErrorMessage("")

    try {
      const amountNum = parseFloat(amount)
      const size = Math.floor(amountNum * 1_000_000_000) // Convert to lamports

      // Mint a set of YES+NO tokens
      const mintSetIx = createMintSetInstruction(
        publicKey,
        selectedMarket.marketPda,
        size
      )

      const transaction = new Transaction().add(mintSetIx)
      transaction.feePayer = publicKey
      const { blockhash } = await connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash

      const signed = await window.solana.signTransaction(transaction)
      const txid = await connection.sendRawTransaction(signed.serialize())
      await connection.confirmTransaction(txid, 'confirmed')

      setSuccessMessage(`✅ ${orderType} order placed for ${amountNum} ${side}!`)
      setAmount('')
      setLimitPrice('')
    } catch (err: any) {
      console.error("Trade error:", err)
      setErrorMessage(`❌ Error: ${err.message || err.toString()}`)
    } finally {
      setTradeLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center">
        <div className="text-center">
          <div className="mb-4 text-6xl">⏳</div>
          <h2 className="text-2xl font-bold">Loading Markets...</h2>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="mb-4 text-6xl">❌</div>
          <h2 className="text-2xl font-bold mb-4">Error Loading Markets</h2>
          <p className="text-gray-400 mb-6">{error}</p>
          <a href="/admin" className="inline-block px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold">
            Go to Admin Panel
          </a>
        </div>
      </div>
    )
  }

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
              {words.map((word) => (
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
                  onClick={handlePlaceOrder}
                  disabled={!amount || parseFloat(amount) <= 0 || !connected || (orderType === 'LIMIT' && !limitPrice) || tradeLoading}
                  className="w-full bg-white text-black font-bold text-sm py-3 rounded hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {tradeLoading ? 'PROCESSING...' : `${orderType} ${side === 'YES' ? 'BUY' : 'SELL'}`}
                </button>

                {!connected && (
                  <div className="text-xs text-center text-yellow-400 mt-2">Connect wallet</div>
                )}

                {successMessage && (
                  <div className="text-xs text-center text-green-400 mt-2">{successMessage}</div>
                )}

                {errorMessage && (
                  <div className="text-xs text-center text-red-400 mt-2">{errorMessage}</div>
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
                {words.map((word) => {
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
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="w-full bg-black/50 border border-white/20 rounded px-2 py-1 text-xs text-white focus:outline-none"
                            min="0"
                            step="1"
                          />
                          <div className="grid grid-cols-2 gap-1">
                            <button
                              onClick={() => { setSide('YES'); handlePlaceOrder(); }}
                              disabled={!amount || parseFloat(amount) <= 0 || !connected || tradeLoading}
                              className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold py-1 rounded disabled:opacity-50"
                            >
                              YES
                            </button>
                            <button
                              onClick={() => { setSide('NO'); handlePlaceOrder(); }}
                              disabled={!amount || parseFloat(amount) <= 0 || !connected || tradeLoading}
                              className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-1 rounded disabled:opacity-50"
                            >
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

