'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'

/* ── Helpers (same as homepage) ─────────────────── */
function lerp(a: number, b: number, t: number) { return a + (b - a) * t }
function clamp01(v: number) { return Math.max(0, Math.min(1, v)) }
function sub(progress: number, start: number, end: number) {
  return clamp01((progress - start) / (end - start))
}
function ease(t: number) { return 1 - Math.pow(1 - t, 3) }

function useAutoPlay(play: boolean, duration: number) {
  const [progress, setProgress] = useState(0)
  const rafRef = useRef<number>()

  useEffect(() => {
    if (!play) return
    setProgress(0)
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      setProgress(t)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [play, duration])

  return progress
}

/* ── Slide 1: Pick a Free Market ──────────────────── */
function SlidePickMarket({ play }: { play: boolean }) {
  const p = useAutoPlay(play, 4400)

  const card1Enter = ease(sub(p, 0, 0.22))
  const card2Enter = ease(sub(p, 0.1, 0.32))
  const card3Enter = ease(sub(p, 0.2, 0.42))
  const selectT = ease(sub(p, 0.52, 0.70))
  const cursorOpacity = clamp01(sub(p, 0.34, 0.44))

  const markets = [
    {
      title: 'Keir Starmer Press Conference',
      emoji: '🎤',
      words: [{ word: 'economy', yes: 0.72 }, { word: 'NHS', yes: 0.58 }, { word: 'reform', yes: 0.41 }],
      selected: true,
      traders: 47,
    },
    {
      title: 'Champions League Final',
      emoji: '⚽',
      words: [{ word: 'penalty', yes: 0.33 }, { word: 'comeback', yes: 0.28 }, { word: 'historic', yes: 0.45 }],
      selected: false,
      traders: 124,
    },
    {
      title: 'Tech Earnings Call',
      emoji: '💻',
      words: [{ word: 'AI', yes: 0.89 }, { word: 'revenue', yes: 0.65 }, { word: 'guidance', yes: 0.44 }],
      selected: false,
      traders: 83,
    },
  ]

  const enters = [card1Enter, card2Enter, card3Enter]

  return (
    <div className="w-full mx-auto relative">
      <div className="space-y-2">
        {markets.map((market, i) => {
          const enterP = enters[i]
          const isSelected = market.selected && selectT > 0
          return (
            <div
              key={market.title}
              className="rounded-xl p-3 relative overflow-hidden cursor-pointer"
              style={{
                opacity: enterP,
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid rgba(52,199,89,${isSelected ? selectT * 0.55 : 0.08})`,
                boxShadow: isSelected ? `0 0 ${selectT * 30}px rgba(52,199,89,${selectT * 0.12}), inset 0 0 ${selectT * 20}px rgba(52,199,89,0.03)` : 'none',
              }}
            >
              {isSelected && (
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background: 'linear-gradient(135deg, transparent 40%, rgba(52,199,89,0.05) 50%, transparent 60%)',
                    animation: 'shimmerSlide 2s ease-in-out infinite',
                  }}
                />
              )}
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-base shrink-0">{market.emoji}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-white text-xs font-semibold truncate">{market.title}</h4>
                    <span className="text-[10px] font-semibold text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded-full shrink-0">Free</span>
                  </div>
                  <div className="flex gap-2.5">
                    {market.words.map((w) => (
                      <div key={w.word} className="flex items-center gap-1 text-[10px]">
                        <span className="text-neutral-500">{w.word}</span>
                        <span className="text-green-400 font-mono">{(w.yes * 100).toFixed(0)}¢</span>
                      </div>
                    ))}
                  </div>
                </div>
                <span className="text-[10px] text-neutral-600 shrink-0">{market.traders} traders</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Cursor */}
      <div
        className="absolute pointer-events-none"
        style={{
          opacity: cursorOpacity,
          left: `${lerp(72, 44, ease(sub(p, 0.38, 0.56)))}%`,
          top: `${lerp(80, 12, ease(sub(p, 0.38, 0.56)))}%`,
          transform: `scale(${lerp(1, 0.88, ease(sub(p, 0.56, 0.66)))})`,
        }}
      >
        <svg viewBox="0 0 320 512" fill="white" width="13" height="20">
          <path d="M0 55.2V426c0 12.2 9.9 22 22 22 6.3 0 12-2.6 16.2-6.8l81.8-86.8 61.8 144.2c2.8 6.6 10.5 9.6 17.1 6.8l40.8-17.2c6.6-2.8 9.6-10.5 6.8-17.1L184.9 327l113.8-3.2c12.2-.3 21.9-10.5 21.3-22.7-.3-6.3-3.2-11.9-7.8-15.8L32.9 37.5C19.4 26.7 0 36.2 0 55.2z" />
        </svg>
      </div>
    </div>
  )
}

/* ── Slide 2: Play with Tokens ────────────────────── */
function SlidePlaceTradeTokens({ play }: { play: boolean }) {
  const progress = useAutoPlay(play, 4800)

  const panelEnter = ease(sub(progress, 0, 0.18))
  const yesT = ease(sub(progress, 0.14, 0.28))
  const amountT = ease(sub(progress, 0.28, 0.52))
  const amount = Math.round(lerp(0, 100, amountT))
  const breakdownT = ease(sub(progress, 0.48, 0.64))
  const pressT = ease(sub(progress, 0.68, 0.78))
  const confirmT = ease(sub(progress, 0.78, 0.94))
  const confirmed = confirmT > 0.5
  const avgPrice = 0.72
  const shares = amount > 0 ? +(amount / avgPrice).toFixed(1) : 0
  const profit = amount > 0 ? +(shares - amount).toFixed(1) : 0

  return (
    <div
      className="rounded-xl p-3 w-full max-w-xs mx-auto"
      style={{
        opacity: panelEnter,
        transform: `translateY(${lerp(20, 0, panelEnter)}px)`,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-neutral-500 text-[10px] uppercase tracking-wider mb-0.5">Selected word</p>
          <p className="text-white font-semibold text-sm">&quot;economy&quot;</p>
        </div>
        <div className="text-right">
          <p className="text-neutral-500 text-[10px]">Current price</p>
          <p className="text-green-400 font-mono text-sm">72¢</p>
        </div>
      </div>

      <div className="flex gap-2 mb-2">
        <button
          className="flex-1 py-1.5 rounded-lg text-xs font-semibold"
          style={{
            background: `rgba(52,199,89,${yesT * 0.2})`,
            border: `1px solid rgba(52,199,89,${yesT * 0.5})`,
            color: yesT > 0.5 ? '#34C759' : '#a3a3a3',
          }}
        >
          YES 72¢
        </button>
        <button className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-neutral-500">
          NO 28¢
        </button>
      </div>

      <div className="mb-2">
        <div
          className="flex items-center rounded-lg px-3 py-1.5"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: `1px solid ${amount > 0 ? 'rgba(52,199,89,0.3)' : 'rgba(255,255,255,0.1)'}`,
          }}
        >
          <span className="text-sm font-mono" style={{ color: amount > 0 ? 'white' : '#525252' }}>{amount || '0'}</span>
          {amountT > 0 && amountT < 1 && (
            <span className="text-white ml-0.5 text-sm" style={{ animation: 'blink 0.8s step-end infinite' }}>|</span>
          )}
          <span className="ml-auto text-[10px] text-blue-400 font-semibold">Free tokens</span>
        </div>
      </div>

      <div
        className="space-y-1 mb-2 overflow-hidden"
        style={{ maxHeight: `${breakdownT * 60}px`, opacity: breakdownT }}
      >
        <div className="flex justify-between text-[11px]">
          <span className="text-neutral-500">Shares you get</span>
          <span className="text-neutral-300 font-mono">{shares}</span>
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-neutral-500">Payout if correct</span>
          <span className="text-green-400 font-mono">{shares} tokens</span>
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-neutral-500">Potential profit</span>
          <span className="text-green-400 font-mono">+{profit} tokens</span>
        </div>
      </div>

      <button
        className="w-full py-2 rounded-lg text-sm font-semibold mb-2"
        style={{
          background: confirmed ? '#34C759' : amount > 0 ? 'white' : 'rgba(255,255,255,0.1)',
          color: confirmed ? 'white' : amount > 0 ? 'black' : '#525252',
          transform: `scale(${pressT > 0 && pressT < 1 ? lerp(1, 0.96, pressT) : 1})`,
        }}
      >
        {confirmed ? '✓ Trade Placed!' : amount > 0 ? 'Place Trade' : 'Enter amount'}
      </button>

      <div style={{ opacity: confirmT, transform: `translateY(${lerp(8, 0, confirmT)}px)` }}>
        <p className="text-green-400 text-xs font-medium text-center">Bought {shares} YES shares of &quot;economy&quot;</p>
      </div>
    </div>
  )
}

/* ── Slide 3: Redeem for Points ───────────────────── */
function SlideRedeemPoints({ play }: { play: boolean }) {
  const p = useAutoPlay(play, 5000)

  const cardEnter = ease(sub(p, 0, 0.18))
  const resultT = ease(sub(p, 0.08, 0.32))
  const resolved = resultT > 0.5
  const pointsT = ease(sub(p, 0.32, 0.58))
  const totalPoints = Math.round(lerp(0, 391, pointsT))
  const leaderboardT = ease(sub(p, 0.55, 0.75))
  const prizeT = ease(sub(p, 0.72, 0.92))

  return (
    <div
      className="w-full mx-auto space-y-2"
      style={{ opacity: cardEnter, transform: `translateY(${lerp(20, 0, cardEnter)}px)` }}
    >
      {/* Result + points card */}
      <div
        className="rounded-xl p-3"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div
          className="flex items-center gap-2 p-2.5 rounded-lg mb-2.5"
          style={{
            background: `rgba(52,199,89,${resultT * 0.08})`,
            border: `1px solid rgba(52,199,89,${resultT * 0.25})`,
          }}
        >
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: resolved ? '#34C759' : '#525252' }}
          />
          <p className="text-xs font-semibold" style={{ color: resolved ? '#34C759' : '#a3a3a3' }}>
            {resolved ? '"economy" mentioned. Resolved YES ✓' : 'Awaiting resolution...'}
          </p>
        </div>

        <div
          className="overflow-hidden"
          style={{ maxHeight: `${pointsT * 84}px`, opacity: pointsT }}
        >
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-neutral-500">Token profit</span>
              <span className="text-green-400 font-mono">+38.9 tokens</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-neutral-500">Points earned (0.5×)</span>
              <span className="text-green-400 font-mono">+341 pts</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-neutral-500">Trade bonus</span>
              <span className="text-green-400 font-mono">+50 pts</span>
            </div>
            <div className="flex justify-between text-[11px] pt-1 border-t border-white/5">
              <span className="text-neutral-400 font-semibold">Total</span>
              <span className="text-white font-bold font-mono">{totalPoints} pts</span>
            </div>
          </div>
        </div>
      </div>

      {/* Leaderboard position */}
      <div
        className="rounded-xl p-2.5 flex items-center gap-3"
        style={{
          opacity: leaderboardT,
          transform: `translateY(${lerp(12, 0, leaderboardT)}px)`,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div className="w-7 h-7 rounded-lg bg-yellow-500/10 flex items-center justify-center text-sm shrink-0">🏆</div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-xs font-semibold">Weekly Leaderboard</p>
          <p className="text-neutral-400 text-[11px]">You&apos;re ranked #12 this week</p>
        </div>
        <span className="text-green-400 text-xs font-mono font-semibold shrink-0">↑ 3</span>
      </div>

      {/* Prize eligibility */}
      <div
        className="rounded-xl p-2.5 flex items-center gap-3"
        style={{
          opacity: prizeT,
          transform: `translateY(${lerp(12, 0, prizeT)}px)`,
          background: `rgba(52,199,89,${prizeT * 0.08})`,
          border: `1px solid rgba(52,199,89,${prizeT * 0.3})`,
          boxShadow: `0 0 ${prizeT * 16}px rgba(52,199,89,${prizeT * 0.07})`,
        }}
      >
        <span className="text-base shrink-0">🎁</span>
        <div>
          <p className="text-green-400 text-xs font-semibold">Cash prize eligible</p>
          <p className="text-neutral-400 text-[11px]">Top traders win real cash every week</p>
        </div>
      </div>
    </div>
  )
}

/* ── Step indicator dots ──────────────────────────── */
function StepDots({ total, active, onGoTo }: { total: number; active: number; onGoTo: (i: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <button
          key={i}
          onClick={() => onGoTo(i)}
          className="transition-all duration-300"
          style={{
            width: i === active ? '20px' : '6px',
            height: '6px',
            borderRadius: '3px',
            background: i === active ? '#34C759' : 'rgba(255,255,255,0.2)',
          }}
          aria-label={`Go to step ${i + 1}`}
        />
      ))}
    </div>
  )
}

/* ── Main Modal ───────────────────────────────────── */
const SLIDES = [
  {
    step: 1,
    title: 'Pick a Free Market',
    desc: 'Browse free markets built around live events: speeches, matches, streams. Free markets use play tokens, so no money is required.',
    Component: SlidePickMarket,
  },
  {
    step: 2,
    title: 'Play with Tokens',
    desc: 'You get free play tokens for each market. Buy YES or NO shares on words you think will come up. Prices shift as others trade.',
    Component: SlidePlaceTradeTokens,
  },
  {
    step: 3,
    title: 'Redeem for Points',
    desc: 'Win tokens, earn points. Points count on the weekly leaderboard and top traders win real cash prizes every week.',
    Component: SlideRedeemPoints,
  },
]

interface HowItWorksModalProps {
  open: boolean
  onClose: () => void
}

export default function HowItWorksModal({ open, onClose }: HowItWorksModalProps) {
  const [step, setStep] = useState(0)
  const [mounted, setMounted] = useState(false)
  const backdropRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => { setMounted(true) }, [])

  // Reset step when opening
  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  // Escape key
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Prevent body scroll
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }, [onClose])

  const goNext = useCallback(() => {
    if (step < SLIDES.length - 1) setStep(s => s + 1)
    else {
      onClose()
      router.push('/markets')
    }
  }, [step, onClose, router])

  const goPrev = useCallback(() => {
    if (step > 0) setStep(s => s - 1)
  }, [step])

  if (!mounted || !open) return null

  const slide = SLIDES[step]
  const SlideComponent = slide.Component
  const isLast = step === SLIDES.length - 1

  return createPortal(
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)' }}
      onClick={handleBackdropClick}
    >
      <div
        className="relative w-full max-w-md rounded-3xl overflow-hidden animate-scale-in"
        style={{ background: 'rgba(12,12,12,0.95)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 32px 80px rgba(0,0,0,0.6)' }}
      >
        {/* Header row */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-blue-500/20 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="#0A84FF">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <span className="text-white text-sm font-semibold">How it works</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-all duration-200"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Animation area — height changes per step so slide 1 sits tight against the text below */}
        <div
          className="relative px-6"
          style={{
            height: step === 0 ? '210px' : '290px',
            overflow: 'hidden',
            transition: 'height 0.28s ease-in-out',
          }}
        >
          {SLIDES.map((s, i) => (
            <div
              key={i}
              className="absolute inset-x-6 top-0"
              style={{
                opacity: i === step ? 1 : 0,
                transform: i === step ? 'translateX(0)' : i < step ? 'translateX(-24px)' : 'translateX(24px)',
                transition: 'opacity 0.28s ease-in-out, transform 0.28s ease-in-out',
                pointerEvents: i === step ? 'auto' : 'none',
              }}
            >
              <s.Component play={i === step} />
            </div>
          ))}
        </div>

        {/* Text content */}
        <div className="px-6 pt-4 pb-2">
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-neutral-500 text-[11px] font-semibold uppercase tracking-widest">Step {slide.step} of {SLIDES.length}</span>
          </div>
          <h3 className="text-white text-xl font-bold mb-1.5 leading-tight">{slide.title}</h3>
          <p className="text-neutral-400 text-sm leading-relaxed">{slide.desc}</p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-5">
          <StepDots total={SLIDES.length} active={step} onGoTo={setStep} />

          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={goPrev}
                className="h-9 px-4 rounded-lg text-sm font-medium text-neutral-400 hover:text-white hover:bg-white/10 transition-all duration-200"
              >
                Back
              </button>
            )}
            <button
              onClick={goNext}
              className="h-9 px-5 rounded-lg text-sm font-semibold bg-white text-black hover:bg-neutral-100 transition-all duration-200"
            >
              {isLast ? 'Browse Markets' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
