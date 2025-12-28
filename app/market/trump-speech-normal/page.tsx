'use client'

import { useState, useMemo } from 'react'
import Header from '@/components/Header'
import CountdownTimer from '@/components/CountdownTimer'
import { useWallet } from '@/contexts/WalletContext'

interface Word {
  word: string
  yesPrice: string
  noPrice: string
  volume: number
}

export default function TrumpSpeechNormal() {
  const { connected } = useWallet()
  const [selectedWord, setSelectedWord] = useState('IMMIGRATION')
  const [amount, setAmount] = useState('')
  const [activeTab, setActiveTab] = useState<'trading' | 'stream'>('trading')
  
  const market = useMemo(() => {
    const now = Date.now()
    return {
      title: "TRUMP'S SPEECH",
      eventTime: new Date(now + 2 * 60 * 60 * 1000),
      streamUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
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
      ]
    }
  }, [])

  const selectedWordData = market.words.find(w => w.word === selectedWord) || market.words[0]
  const estimatedYesCost = amount ? (parseFloat(amount) * parseFloat(selectedWordData.yesPrice)).toFixed(2) : '0.00'
  const estimatedNoCost = amount ? (parseFloat(amount) * parseFloat(selectedWordData.noPrice)).toFixed(2) : '0.00'
  const yesShares = amount ? parseFloat(amount).toFixed(0) : '0'
  const noShares = amount ? parseFloat(amount).toFixed(0) : '0'

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
                      disabled={!amount || parseFloat(amount) <= 0 || !connected}
                      className="h-32 bg-green-600 hover:bg-green-700 text-white font-bold text-2xl uppercase rounded-2xl transition-all transform hover:scale-105 shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                    >
                      <div>BUY YES</div>
                      <div className="text-3xl mt-2">${selectedWordData.yesPrice}</div>
                      {amount && parseFloat(amount) > 0 && (
                        <div className="text-base mt-2">
                          <div>Cost: ${estimatedYesCost}</div>
                          <div className="text-sm opacity-80">Payout: ${yesShares} if YES</div>
                        </div>
                      )}
                    </button>
                    <button
                      disabled={!amount || parseFloat(amount) <= 0 || !connected}
                      className="h-32 bg-red-600 hover:bg-red-700 text-white font-bold text-2xl uppercase rounded-2xl transition-all transform hover:scale-105 shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                    >
                      <div>BUY NO</div>
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
  )
}

