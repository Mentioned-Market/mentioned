'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed')
          }
        })
      },
      { threshold: 0.15 }
    )

    const children = el.querySelectorAll('.reveal')
    children.forEach((child) => observer.observe(child))

    return () => observer.disconnect()
  }, [])

  return ref
}

export default function Home() {
  const scrollRef = useScrollReveal()

  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
            <Header />

            <main className="flex-1" ref={scrollRef}>
              {/* Hero */}
              <section className="flex flex-col items-center justify-center text-center min-h-[85vh] py-20">
                <Image
                  src="/src/img/White Icon.svg"
                  alt="Mentioned"
                  width={48}
                  height={48}
                  className="h-10 md:h-12 w-auto mb-8 hero-logo"
                  priority
                />
                <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-white leading-[1.1] tracking-tight whitespace-nowrap hero-title">
                  Trade on what gets said.
                </h1>
                <p className="mt-6 text-neutral-400 text-lg md:text-xl max-w-md hero-subtitle">
                  Prediction markets for live broadcasts.<br />
                  Pick words. Trade against friends. Win.
                </p>
                <div className="mt-10 flex items-center gap-3 hero-cta">
                  <Link
                    href="/markets"
                    className="h-12 px-8 bg-white text-black text-sm font-semibold rounded-lg hover:bg-neutral-100 transition-all duration-200 shadow-button inline-flex items-center"
                  >
                    Browse Markets
                  </Link>
                  <Link
                    href="/leaderboard"
                    className="h-12 px-8 glass text-white text-sm font-semibold rounded-lg hover:bg-white/10 transition-all duration-200 inline-flex items-center"
                  >
                    Leaderboard
                  </Link>
                </div>

                {/* Scroll indicator */}
                <div className="mt-8 scroll-bounce">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-neutral-600">
                    <path d="M12 5v14M5 12l7 7 7-7" />
                  </svg>
                </div>
              </section>

              {/* How it works */}
              <section className="py-24 md:py-32 border-t border-white/10">
                <div className="flex flex-col items-center text-center gap-20">
                  <div className="reveal reveal-up">
                    <p className="text-neutral-500 text-xs font-semibold uppercase tracking-widest mb-4">How it works</p>
                    <h2 className="text-2xl md:text-4xl font-bold text-white">Three steps. That's it.</h2>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">
                    <div className="reveal reveal-up stagger-1 glass rounded-2xl p-8 text-center">
                      <div className="text-3xl font-bold text-white/20 mb-3">01</div>
                      <h3 className="text-white text-base font-semibold mb-2">Pick a market</h3>
                      <p className="text-neutral-400 text-sm">Tied to a live event. Each has a set of words to trade on.</p>
                    </div>
                    <div className="reveal reveal-up stagger-2 glass rounded-2xl p-8 text-center">
                      <div className="text-3xl font-bold text-white/20 mb-3">02</div>
                      <h3 className="text-white text-base font-semibold mb-2">Buy YES or NO</h3>
                      <p className="text-neutral-400 text-sm">Think it'll be said? Buy YES. Prices move with the crowd.</p>
                    </div>
                    <div className="reveal reveal-up stagger-3 glass rounded-2xl p-8 text-center">
                      <div className="text-3xl font-bold text-white/20 mb-3">03</div>
                      <h3 className="text-white text-base font-semibold mb-2">Collect your winnings</h3>
                      <p className="text-neutral-400 text-sm">Event ends, transcript is checked. Winners get paid.</p>
                    </div>
                  </div>
                </div>
              </section>

              {/* Features */}
              <section className="py-24 md:py-32 border-t border-white/10">
                <div className="flex flex-col items-center text-center gap-20">
                  <div className="reveal reveal-up">
                    <h2 className="text-2xl md:text-4xl font-bold text-white">Built to be competitive.</h2>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 w-full max-w-3xl">
                    <div className="reveal reveal-left glass rounded-2xl p-7 text-left">
                      <h3 className="text-white text-base font-semibold mb-1">Leaderboards</h3>
                      <p className="text-neutral-400 text-sm">Climb the ranks. Top traders get seen.</p>
                    </div>
                    <div className="reveal reveal-right glass rounded-2xl p-7 text-left">
                      <h3 className="text-white text-base font-semibold mb-1">Live chat</h3>
                      <p className="text-neutral-400 text-sm">Talk while you trade. Every market has its own feed.</p>
                    </div>
                    <div className="reveal reveal-left stagger-1 glass rounded-2xl p-7 text-left">
                      <h3 className="text-white text-base font-semibold mb-1">On-chain</h3>
                      <p className="text-neutral-400 text-sm">Solana. Every trade is verifiable. No trust required.</p>
                    </div>
                    <div className="reveal reveal-right stagger-1 glass rounded-2xl p-7 text-left">
                      <h3 className="text-white text-base font-semibold mb-1">Share your P&L</h3>
                      <p className="text-neutral-400 text-sm">Flex your wins. We make it easy.</p>
                    </div>
                  </div>
                </div>
              </section>

              {/* CTA */}
              <section className="py-24 md:py-32 border-t border-white/10">
                <div className="reveal reveal-scale flex flex-col items-center text-center">
                  <h2 className="text-2xl md:text-4xl font-bold text-white mb-3">
                    Markets are live.
                  </h2>
                  <p className="text-neutral-400 text-base mb-8">
                    Jump in.
                  </p>
                  <Link
                    href="/markets"
                    className="h-12 px-8 bg-white text-black text-sm font-semibold rounded-lg hover:bg-neutral-100 transition-all duration-200 shadow-button inline-flex items-center"
                  >
                    Start Trading
                  </Link>
                </div>
              </section>
            </main>

            <Footer />
          </div>
        </div>
      </div>

      <style jsx>{`
        /* Hero entrance animations */
        .hero-logo {
          animation: fadeSlideDown 0.8s ease-out both;
        }
        .hero-title {
          animation: fadeSlideUp 0.8s ease-out 0.15s both;
        }
        .hero-subtitle {
          animation: fadeSlideUp 0.8s ease-out 0.35s both;
        }
        .hero-cta {
          animation: fadeSlideUp 0.8s ease-out 0.55s both;
        }

        @keyframes fadeSlideDown {
          from { opacity: 0; transform: translateY(-30px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* Scroll bounce on arrow */
        .scroll-bounce {
          animation: bounce 2s ease-in-out infinite;
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(8px); }
        }

        /* Scroll-triggered reveal animations */
        .reveal {
          opacity: 0;
          transition: opacity 0.7s ease-out, transform 0.7s ease-out;
        }
        .reveal.reveal-up {
          transform: translateY(50px);
        }
        .reveal.reveal-left {
          transform: translateX(-50px);
        }
        .reveal.reveal-right {
          transform: translateX(50px);
        }
        .reveal.reveal-scale {
          transform: scale(0.9);
        }
        .reveal.revealed {
          opacity: 1;
          transform: translateY(0) translateX(0) scale(1);
        }

        /* Stagger delays */
        .stagger-1 { transition-delay: 0.12s; }
        .stagger-2 { transition-delay: 0.24s; }
        .stagger-3 { transition-delay: 0.36s; }
      `}</style>
    </div>
  )
}
