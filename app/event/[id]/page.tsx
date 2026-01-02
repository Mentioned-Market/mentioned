'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token'
import BN from 'bn.js'
import Header from '@/components/Header'
import CountdownTimer from '@/components/CountdownTimer'
import { useWallet } from '@/contexts/WalletContext'
import { 
  fetchEventMarkets, 
  DEVNET_RPC, 
  createMintSetInstruction,
  getYesMintPDA,
  getNoMintPDA,
  getEventPDA
} from '@/lib/program'

interface Word {
  word: string
  yesPrice: string
  noPrice: string
  volume: number
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

export default function TrumpSpeechNormal() {
  const params = useParams()
  const eventId = params.id as string
  
  const { connected, publicKey } = useWallet()
  const [selectedWord, setSelectedWord] = useState('')
  const [amount, setAmount] = useState('')
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
      imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCPwsL0smxRVROhCkwShqqarIa-4xnAdVdAomChQJ_T5mRI0s77w-xoaIXYP2m8tRl-uEGpY2db-WBf6yZIfORA6Azp8_G7mOSTRPFRKHgyuo-4Ltlj_aMHH0t0PkSvdDO95rJOZpBgoS7jAKqkQ_7C86iSDgLJC9vDfV4YSshAaEhuIv2qI0WDcGs0VSLKNYTrz72KduCuH-fH8XBkROiM1zDK2dJlV6R0sCiMjP_Y3Ml19Uglhnihkb8ZD1prCuWa0i_wip0TXSI',
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

  const estimatedYesCost = amount ? (parseFloat(amount) * parseFloat(selectedWordData.yesPrice)).toFixed(2) : '0.00'
  const estimatedNoCost = amount ? (parseFloat(amount) * parseFloat(selectedWordData.noPrice)).toFixed(2) : '0.00'
  const yesShares = amount ? parseFloat(amount).toFixed(0) : '0'
  const noShares = amount ? parseFloat(amount).toFixed(0) : '0'

  const handleBuy = async (side: 'YES' | 'NO') => {
    if (!connected || !publicKey || !window.solana || !selectedMarket) {
      setErrorMessage("Please connect your wallet first")
      return
    }

    if (!amount || parseFloat(amount) <= 0) {
      setErrorMessage("Please enter a valid amount")
      return
    }

    setTradeLoading(true)
    setSuccessMessage("")
    setErrorMessage("")

    try {
      const amountNum = parseFloat(amount)
      const size = new BN(Math.floor(amountNum * 1_000_000_000)) // Convert to lamports

      // Get event PDA (need to derive this from localStorage)
      const registryStr = localStorage.getItem("marketRegistry")
      if (!registryStr) throw new Error("Registry not found")
      
      const registry = JSON.parse(registryStr)
      const eventData = registry[eventId]
      let adminPubkey: PublicKey
      
      if (Array.isArray(eventData)) {
        adminPubkey = new PublicKey("AmMusRD99A7CnHNhNziN4f2Fm6V9D4NW1soH4rUn8t7S")
      } else if (eventData && eventData.admin) {
        adminPubkey = new PublicKey(eventData.admin)
      } else {
        throw new Error("Admin not found")
      }
      
      const [eventPda] = getEventPDA(adminPubkey, new BN(eventId))

      // Derive mint PDAs
      const [yesMintPda] = getYesMintPDA(selectedMarket.marketPda)
      const [noMintPda] = getNoMintPDA(selectedMarket.marketPda)

      // Get user ATAs
      const userYesAta = await getAssociatedTokenAddress(
        yesMintPda,
        publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      const userNoAta = await getAssociatedTokenAddress(
        noMintPda,
        publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )

      // Mint a set of YES+NO tokens
      const mintSetIx = createMintSetInstruction(
        publicKey,
        eventPda,
        selectedMarket.marketPda,
        yesMintPda,
        noMintPda,
        userYesAta,
        userNoAta,
        size
      )

      const transaction = new Transaction().add(mintSetIx)
      transaction.feePayer = publicKey
      const { blockhash } = await connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash

      const signed = await window.solana.signTransaction(transaction)
      const txid = await connection.sendRawTransaction(signed.serialize())
      await connection.confirmTransaction(txid, 'confirmed')

      setSuccessMessage(`✅ Successfully bought ${amountNum} ${side} tokens!`)
      setAmount('')
    } catch (err: any) {
      console.error("Trade error:", err)
      setErrorMessage(`❌ Error: ${err.message || err.toString()}`)
    } finally {
      setTradeLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="mb-4 text-6xl">⏳</div>
          <h2 className="text-2xl font-bold">Loading Markets...</h2>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
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
    <div className="min-h-screen bg-black text-white">
      <div className="px-4 md:px-10 lg:px-20">
        <Header />
        
        <main className="py-8 max-w-7xl mx-auto">
          {/* Header with Tabs */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-6xl md:text-8xl font-bold uppercase mb-4">
                  {market.title}
                </h1>
                <div className="flex items-center gap-6 text-2xl">
                  <span className="text-white/70">LIVE IN:</span>
                  <div className="bg-red-600/80 px-6 py-2 rounded-lg">
                    <CountdownTimer targetTime={market.eventTime} />
                  </div>
                </div>
              </div>
              
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

          {/* Trading Tab */}
          {activeTab === 'trading' && (
            <>
              {/* Trading Section */}
              <div className="bg-[#161616] rounded-3xl p-8 border border-[#2a2a2a] mb-8">
                <h2 className="text-4xl font-bold mb-6 text-center">
                  TRADE "{selectedWordData.word}"
                </h2>
                
                <div className="max-w-2xl mx-auto space-y-6">
                  {/* Amount Input */}
                  <div>
                    <label className="text-white/70 text-lg block mb-3">HOW MANY SHARES?</label>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="Enter amount..."
                      className="w-full h-16 bg-black/50 border-2 border-white/30 rounded-xl text-white text-2xl px-6 focus:outline-none focus:border-white"
                      min="0"
                      step="1"
                    />
                  </div>

                  {/* Buy Buttons */}
                  <div className="grid grid-cols-2 gap-6">
                    <button
                      onClick={() => handleBuy('YES')}
                      disabled={!amount || parseFloat(amount) <= 0 || !connected || tradeLoading}
                      className="h-32 bg-green-600 hover:bg-green-700 text-white font-bold text-2xl uppercase rounded-2xl transition-all transform hover:scale-105 shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                    >
                      <div>{tradeLoading ? 'PROCESSING...' : 'BUY YES'}</div>
                      <div className="text-3xl mt-2">${selectedWordData.yesPrice}</div>
                      {amount && parseFloat(amount) > 0 && (
                        <div className="text-base mt-2">
                          <div>Cost: ${estimatedYesCost}</div>
                          <div className="text-sm opacity-80">Payout: ${yesShares} if YES</div>
                        </div>
                      )}
                    </button>
                    <button
                      onClick={() => handleBuy('NO')}
                      disabled={!amount || parseFloat(amount) <= 0 || !connected || tradeLoading}
                      className="h-32 bg-red-600 hover:bg-red-700 text-white font-bold text-2xl uppercase rounded-2xl transition-all transform hover:scale-105 shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                    >
                      <div>{tradeLoading ? 'PROCESSING...' : 'BUY NO'}</div>
                      <div className="text-3xl mt-2">${selectedWordData.noPrice}</div>
                      {amount && parseFloat(amount) > 0 && (
                        <div className="text-base mt-2">
                          <div>Cost: ${estimatedNoCost}</div>
                          <div className="text-sm opacity-80">Payout: ${noShares} if NO</div>
                        </div>
                      )}
                    </button>
                  </div>

                  {!connected && (
                    <div className="text-center text-yellow-400 text-lg font-bold">
                      ⚠️ Connect your wallet to trade!
                    </div>
                  )}

                  {successMessage && (
                    <div className="text-center text-green-400 text-lg font-bold">
                      {successMessage}
                    </div>
                  )}

                  {errorMessage && (
                    <div className="text-center text-red-400 text-lg font-bold">
                      {errorMessage}
                    </div>
                  )}

                  {/* Quick Stats */}
                  <div className="grid grid-cols-3 gap-4 pt-6">
                    <div className="bg-black/30 rounded-xl p-4 text-center">
                      <div className="text-white/50 text-sm">VOLUME</div>
                      <div className="text-2xl font-bold">${(selectedWordData.volume / 1000).toFixed(0)}K</div>
                    </div>
                    <div className="bg-black/30 rounded-xl p-4 text-center">
                      <div className="text-white/50 text-sm">YES PRICE</div>
                      <div className="text-2xl font-bold text-green-400">${selectedWordData.yesPrice}</div>
                    </div>
                    <div className="bg-black/30 rounded-xl p-4 text-center">
                      <div className="text-white/50 text-sm">NO PRICE</div>
                      <div className="text-2xl font-bold text-red-400">${selectedWordData.noPrice}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Words Grid */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {words.map((word) => (
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
  )
}

