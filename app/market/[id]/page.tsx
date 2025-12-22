'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Header from '@/components/Header'
import CountdownTimer from '@/components/CountdownTimer'
import { useWallet } from '@/contexts/WalletContext'

interface Word {
  word: string
  yesPrice: string
  noPrice: string
}

interface ChatMessage {
  id: string
  username: string
  message: string
  timestamp: Date
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
    }> = {
      'trump-speech': {
        id: 'trump-speech',
        category: 'POLITICS',
        title: "TRUMP'S SPEECH",
        eventTime: new Date(now + 2 * 60 * 60 * 1000), // 2 hours from now
        imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCPwsL0smxRVROhCkwShqqarIa-4xnAdVdAomChQJ_T5mRI0s77w-xoaIXYP2m8tRl-uEGpY2db-WBf6yZIfORA6Azp8_G7mOSTRPFRKHgyuo-4Ltlj_aMHH0t0PkSvdDO95rJOZpBgoS7jAKqkQ_7C86iSDgLJC9vDfV4YSshAaEhuIv2qI0WDcGs0VSLKNYTrz72KduCuH-fH8XBkROiM1zDK2dJlV6R0sCiMjP_Y3Ml19Uglhnihkb8ZD1prCuWa0i_wip0TXSI',
        words: [
          { word: 'IMMIGRATION', yesPrice: '0.72', noPrice: '0.28' },
          { word: 'ECONOMY', yesPrice: '0.65', noPrice: '0.35' },
          { word: 'CHINA', yesPrice: '0.58', noPrice: '0.42' },
          { word: 'BORDER', yesPrice: '0.81', noPrice: '0.19' },
          { word: 'TAXES', yesPrice: '0.45', noPrice: '0.55' },
          { word: 'JOBS', yesPrice: '0.67', noPrice: '0.33' },
          { word: 'TRADE', yesPrice: '0.52', noPrice: '0.48' },
          { word: 'AMERICA', yesPrice: '0.89', noPrice: '0.11' },
          { word: 'FREEDOM', yesPrice: '0.76', noPrice: '0.24' },
          { word: 'VICTORY', yesPrice: '0.83', noPrice: '0.17' },
        ],
        streamUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', // Dummy stream
      },
    }
    return marketData[marketId] || marketData['trump-speech']
  }, [marketId])
  const [activeTab, setActiveTab] = useState<'trading' | 'stream'>('trading')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)
  const { publicKey, connected } = useWallet()

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
          <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
            <Header />
            
            <main className="flex-1 py-5">
              {/* Market Header */}
              <div className="border-b border-white pb-4 mb-6">
                <p className="text-white font-mono text-sm mb-2">[{market.category}]</p>
                <h1 className="text-4xl md:text-6xl font-bold uppercase text-white mb-2">{market.title}</h1>
                <div className="flex items-center gap-6 font-mono text-xl">
                  <span className="text-white/70">ENDS IN:</span>
                  <CountdownTimer targetTime={market.eventTime} />
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-2 mb-6 border-b border-white">
                <button
                  onClick={() => setActiveTab('trading')}
                  className={`px-6 py-3 font-bold text-lg uppercase border-b-4 transition-all ${
                    activeTab === 'trading'
                      ? 'bg-white text-black border-white'
                      : 'text-white border-transparent hover:bg-white/10'
                  }`}
                >
                  TRADING
                </button>
                <button
                  onClick={() => setActiveTab('stream')}
                  className={`px-6 py-3 font-bold text-lg uppercase border-b-4 transition-all ${
                    activeTab === 'stream'
                      ? 'bg-white text-black border-white'
                      : 'text-white border-transparent hover:bg-white/10'
                  }`}
                >
                  STREAM
                </button>
              </div>

              {/* Trading Tab */}
              {activeTab === 'trading' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {market.words.map((word, index) => (
                    <div key={index} className="border-4 border-white p-4 bg-black">
                      <h3 className="text-white font-mono text-2xl uppercase mb-4">{word.word}</h3>
                      <div className="flex items-center justify-between mb-4 font-mono text-xl">
                        <div>
                          <p className="text-white/70">YES: {word.yesPrice}</p>
                          <p className="text-white/70">NO: {word.noPrice}</p>
                        </div>
                        <div className="text-4xl font-bold text-white">{word.yesPrice}</div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button className="w-full h-14 bg-white text-black text-lg font-bold uppercase hover:bg-black hover:text-white border-4 border-white">
                          YES [BUY]
                        </button>
                        <button className="w-full h-14 border-4 border-white bg-black text-white text-lg font-bold uppercase hover:bg-white hover:text-black">
                          NO [SELL]
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Stream Tab */}
              {activeTab === 'stream' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Stream Embed */}
                  <div className="lg:col-span-2 border-4 border-white bg-black">
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
                  <div className="lg:col-span-1 border-4 border-white bg-black flex flex-col h-[600px]">
                    <div className="border-b-4 border-white p-4">
                      <h3 className="text-white font-mono text-xl uppercase">CHAT</h3>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                      {chatMessages.map((msg) => (
                        <div key={msg.id} className="font-mono text-sm">
                          <span className="text-white/70">{msg.username}:</span>
                          <span className="text-white ml-2">{msg.message}</span>
                        </div>
                      ))}
                      <div ref={chatEndRef} />
                    </div>

                    <form onSubmit={handleSendMessage} className="border-t-4 border-white p-4">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          placeholder={connected ? "Type a message..." : "Connect wallet to chat"}
                          disabled={!connected}
                          className="flex-1 bg-black border-4 border-white text-white font-mono text-sm px-4 py-2 focus:outline-none focus:bg-white focus:text-black disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        <button
                          type="submit"
                          disabled={!connected || !chatInput.trim()}
                          className="px-6 py-2 bg-white text-black font-bold uppercase border-4 border-white hover:bg-black hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          SEND
                        </button>
                      </div>
                    </form>
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

