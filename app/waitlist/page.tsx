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
            
            <main className="flex-1 py-8 md:py-12">
              <div className="relative z-10 flex flex-col items-center w-full max-w-2xl mx-auto animate-fade-in">
                {/* Title */}
                <div className="mb-8 text-center">
                  <h1 className="text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tight mb-3 bg-gradient-to-b from-white to-neutral-400 bg-clip-text text-transparent">
                    Join the Waitlist
                  </h1>
                  <p className="text-base text-neutral-400 leading-relaxed max-w-xl mx-auto">
                    Get early access to Mentioned and start trading predictions on what gets mentioned.
                  </p>
                </div>

                {/* Form Box */}
                <div className="w-full">
                  <div className="glass rounded-2xl p-8 md:p-10 shadow-card-hover">
                    {!submitted ? (
                      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
                        <div>
                          <label 
                            htmlFor="email" 
                            className="block text-sm font-medium mb-3 text-neutral-300"
                          >
                            Email Address
                          </label>
                          <input
                            type="email"
                            id="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            disabled={loading}
                            className="w-full h-12 bg-black/50 border border-white/20 rounded-xl text-white text-base px-4 focus:outline-none focus:border-white/50 transition-all duration-200 disabled:opacity-50 placeholder:text-neutral-600"
                            placeholder="you@example.com"
                          />
                        </div>
                        
                        {error && (
                          <div className="text-center text-apple-red text-sm font-medium bg-apple-red/10 rounded-lg py-3 px-4">
                            {error}
                          </div>
                        )}
                        
                        <button
                          type="submit"
                          disabled={loading}
                          className="w-full h-12 bg-white text-black font-semibold text-base rounded-xl hover:bg-neutral-100 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-button"
                        >
                          {loading ? 'Submitting...' : 'Join Waitlist'}
                        </button>
                      </form>
                    ) : (
                      <div className="text-center py-8 animate-scale-in">
                        <div className="w-16 h-16 bg-apple-green/20 rounded-full flex items-center justify-center mx-auto mb-4">
                          <svg className="w-8 h-8 text-apple-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <div className="text-2xl md:text-3xl font-semibold text-white mb-3">
                          You're all set!
                        </div>
                        <p className="text-neutral-400 text-base mb-2">
                          Check your email for confirmation
                        </p>
                        <p className="text-neutral-500 text-sm">
                          We'll notify you when we launch
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Social Links */}
                <div className="mt-8 text-center">
                  <p className="text-neutral-500 text-sm mb-3 font-medium">Join Our Community</p>
                  <div className="flex gap-6 justify-center">
                    <a 
                      href="https://discord.gg/gsD7vf6YRx" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-neutral-400 hover:text-white transition-colors duration-200 font-medium text-sm"
                    >
                      Discord
                    </a>
                    <span className="text-neutral-600">•</span>
                    <a 
                      href="https://x.com/mentionedmarket" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-neutral-400 hover:text-white transition-colors duration-200 font-medium text-sm"
                    >
                      Twitter
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
