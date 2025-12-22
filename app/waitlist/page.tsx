'use client'

import { useState } from 'react'
import Header from '@/components/Header'

export default function WaitlistPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // TODO: Add actual API call here
    setSubmitted(true)
    setTimeout(() => {
      setEmail('')
      setSubmitted(false)
    }, 3000)
  }

  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
            <Header />
            
            <main className="flex-1 flex items-center justify-center py-4 md:py-8">
              {/* Animated background elements */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-20 left-10 w-2 h-2 bg-white animate-pulse-flash"></div>
                <div className="absolute top-40 right-20 w-1 h-1 bg-white animate-flicker"></div>
                <div className="absolute bottom-40 left-1/4 w-3 h-3 bg-white animate-strobe-slow"></div>
                <div className="absolute top-1/3 right-1/3 w-1 h-1 bg-white animate-pulse-flash delay-500"></div>
                <div className="absolute bottom-1/4 right-10 w-2 h-2 bg-white animate-flicker delay-1000"></div>
              </div>

              {/* Main content */}
              <div className="relative z-10 flex flex-col items-center justify-center w-full">
                {/* Glitched title */}
                <div className="relative mb-4 md:mb-6">
                  <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold uppercase tracking-widest text-white text-center">
                    <span className="glitch-text" data-text="JOIN THE WAITLIST">
                      JOIN THE WAITLIST
                    </span>
                  </h1>
                  <div className="absolute inset-0 text-4xl md:text-6xl lg:text-7xl font-bold uppercase tracking-widest text-white text-center animate-glitch-move">
                    JOIN THE WAITLIST
                  </div>
                </div>

                {/* Animated border box */}
                <div className="relative w-full max-w-xl md:max-w-2xl">
                  <div className="absolute inset-0 border-4 border-white animate-strobe-border"></div>
                  <div className="absolute -inset-1 border-2 border-white animate-strobe-border-reverse opacity-50"></div>
                  
                  <div className="relative bg-black p-6 md:p-8 lg:p-10 border-4 border-white">
                    {!submitted ? (
                      <form onSubmit={handleSubmit} className="flex flex-col gap-4 md:gap-5">
                        <div className="relative">
                          <label 
                            htmlFor="email" 
                            className="block font-mono text-lg md:text-xl lg:text-2xl uppercase mb-2 md:mb-3 text-white animate-pulse-slow"
                          >
                            ENTER YOUR EMAIL
                          </label>
                          <input
                            type="email"
                            id="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            className="w-full h-12 md:h-14 lg:h-16 bg-black border-4 border-white text-white font-mono text-base md:text-lg lg:text-xl px-3 md:px-4 uppercase focus:outline-none focus:bg-white focus:text-black transition-all duration-0 animate-input-flicker"
                            placeholder="EMAIL@EXAMPLE.COM"
                          />
                          <div className="absolute inset-0 border-4 border-white animate-strobe-input opacity-30 pointer-events-none"></div>
                        </div>
                        
                        <button
                          type="submit"
                          className="w-full h-14 md:h-16 lg:h-18 bg-white text-black border-4 border-black font-bold text-lg md:text-xl lg:text-2xl uppercase tracking-widest hover:bg-black hover:text-white hover:border-white transition-all duration-0 animate-button-pulse relative overflow-hidden"
                        >
                          <span className="relative z-10">SUBMIT</span>
                          <div className="absolute inset-0 bg-black animate-button-strobe"></div>
                        </button>
                      </form>
                    ) : (
                      <div className="text-center py-6 md:py-8">
                        <div className="text-3xl md:text-4xl lg:text-5xl font-bold uppercase text-white font-mono mb-3 md:mb-4 animate-pulse-flash">
                          <span className="glitch-text" data-text="YOU'RE IN">
                            YOU&apos;RE IN
                          </span>
                        </div>
                        <p className="text-white font-mono text-base md:text-lg lg:text-xl uppercase animate-flicker">
                          CHECK YOUR EMAIL
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Animated corner decorations */}
                <div className="absolute top-0 left-0 w-12 h-12 md:w-16 md:h-16 border-t-4 border-l-4 border-white animate-strobe-corner"></div>
                <div className="absolute top-0 right-0 w-12 h-12 md:w-16 md:h-16 border-t-4 border-r-4 border-white animate-strobe-corner-reverse"></div>
                <div className="absolute bottom-0 left-0 w-12 h-12 md:w-16 md:h-16 border-b-4 border-l-4 border-white animate-strobe-corner delay-500"></div>
                <div className="absolute bottom-0 right-0 w-12 h-12 md:w-16 md:h-16 border-b-4 border-r-4 border-white animate-strobe-corner-reverse delay-1000"></div>
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
  )
}

