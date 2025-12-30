'use client'

import { useState } from 'react'
import Header from '@/components/Header'

export default function WaitlistPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to join waitlist')
      }

      setSubmitted(true)
      setTimeout(() => {
        setEmail('')
        setSubmitted(false)
      }, 5000)
    } catch (err: any) {
      setError(err.message)
      setTimeout(() => setError(''), 3000)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
      {/* SEO Content - Hidden but indexable */}
      <div className="sr-only">
        <h2>Mentioned - The Premier Mention Markets Platform</h2>
        <p>Join Mentioned, the leading mention markets platform where you can trade predictions on what words get mentioned in speeches, podcasts, earnings calls, and live events. Mentioned markets revolutionize prediction trading.</p>
        <p>Sign up for early access to Mentioned.markets and start trading mention predictions today. Mentioned is the future of prediction markets focused on real-world mentions.</p>
        <p>Why choose Mentioned? Mentioned offers the most comprehensive mention markets platform with real-time trading on speeches, political events, tech conferences, earnings calls, and more.</p>
        <ul>
          <li>Mentioned Markets - Trade what gets mentioned</li>
          <li>Prediction Markets for Mentions - Mentioned platform</li>
          <li>Speech Prediction Trading - Join Mentioned</li>
          <li>Event Mention Markets - Mentioned.markets</li>
          <li>Podcast Mention Trading - Mentioned protocol</li>
        </ul>
      </div>
      
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
            <Header />
            
            <main className="flex-1 flex items-center justify-center py-4 md:py-8">
              {/* Main content */}
              <div className="relative z-10 flex flex-col items-center justify-center w-full">
                {/* Title */}
                <div className="relative mb-8 md:mb-12">
                  <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold uppercase tracking-wider text-white text-center">
                    JOIN THE MENTIONED WAITLIST
                  </h1>
                  <p className="text-white/70 text-center mt-4 text-lg">
                    Get early access to Mentioned - The premier mention markets platform
                  </p>
                  <p className="text-white/50 text-center mt-2 text-sm">
                    Trade predictions on mentions in speeches, podcasts, and events
                  </p>
                </div>

                {/* Form Box */}
                <div className="relative w-full max-w-xl md:max-w-2xl">
                  <div className="relative bg-[#1a1a1a] p-8 md:p-12 lg:p-16 rounded-2xl border-2 border-white/20">
                    {!submitted ? (
                      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
                        <div className="relative">
                          <label 
                            htmlFor="email" 
                            className="block text-lg md:text-xl uppercase mb-3 text-white/90 font-bold"
                          >
                            EMAIL ADDRESS
                          </label>
                          <input
                            type="email"
                            id="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            disabled={loading}
                            className="w-full h-14 md:h-16 bg-black border-2 border-white/30 rounded-lg text-white text-base md:text-lg px-4 uppercase focus:outline-none focus:border-white transition-all disabled:opacity-50"
                            placeholder="EMAIL@EXAMPLE.COM"
                          />
                        </div>
                        
                        {error && (
                          <div className="text-center text-red-400 text-sm font-bold">
                            ⚠️ {error}
                          </div>
                        )}
                        
                        <button
                          type="submit"
                          disabled={loading}
                          className="w-full h-14 md:h-16 bg-white text-black font-bold text-lg md:text-xl uppercase tracking-wider hover:bg-white/90 transition-all rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {loading ? 'SUBMITTING...' : 'SUBMIT'}
                        </button>
                      </form>
                    ) : (
                      <div className="text-center py-8">
                        <div className="text-3xl md:text-4xl lg:text-5xl font-bold uppercase text-white mb-4">
                          YOU&apos;RE IN!
                        </div>
                        <p className="text-white/70 text-base md:text-lg mb-4">
                          CHECK YOUR EMAIL FOR CONFIRMATION
                        </p>
                        <p className="text-white/50 text-sm">
                          We'll notify you when mainnet launches
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Social Links */}
                <div className="mt-8 text-center">
                  <p className="text-white/50 text-sm mb-4">JOIN OUR COMMUNITY</p>
                  <div className="flex gap-6 justify-center">
                    <a 
                      href="https://discord.gg/gsD7vf6YRx" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-white hover:text-yellow-400 transition-colors font-bold uppercase text-sm"
                    >
                      Discord
                    </a>
                    <span className="text-white/30">•</span>
                    <a 
                      href="https://x.com/mentionedmarket" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-white hover:text-yellow-400 transition-colors font-bold uppercase text-sm"
                    >
                      Twitter/X
                    </a>
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
