'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface Step {
  text: string
  targetSelector: string
  cardSide?: 'below' | 'left'
}

const STEPS: Step[] = [
  {
    text: "Free markets on Mentioned are completely free to play. No real money, no risk, just your play tokens. Here's a quick guide to get you started.",
    targetSelector: '',
  },
  {
    text: 'Pick a word from the market to place your first trade',
    targetSelector: '[data-tutorial="words-table"]',
  },
  {
    text: "Choose if you think a word will or won't be said. Buy YES or NO using your free play tokens",
    targetSelector: '[data-tutorial="trading-panel"],[data-tutorial="trading-panel-mobile"]',
    cardSide: 'left',
  },
  {
    text: "If you're right, you win! Correct predictions earn platform points which go towards winning our weekly competitions",
    targetSelector: '[data-tutorial="trading-panel"],[data-tutorial="trading-panel-mobile"]',
    cardSide: 'left',
  },
  {
    text: 'The more people agree with you, the more your shares are worth. Watch the odds move as traders pile in',
    targetSelector: '',
  },
]

interface Rect    { x: number; y: number; w: number; h: number }
interface CardPos { left: number; top: number }
interface Props   { onClose: () => void; onStepChange?: (step: number) => void }

const CARD_HEIGHT_EST = 160
const EXIT_MS        = 180  // exit animation duration
const SETTLE_MS      = 380  // scroll settle time (must be >= EXIT_MS)

function cardWidth(winW: number) {
  return Math.min(340, winW - 32)
}

function computeCardPos(spotlight: Rect | null, cardSide: 'below' | 'left', winW: number, winH: number): CardPos {
  const cw = cardWidth(winW)
  if (spotlight) {
    // Only use 'left' if there's actually enough room; otherwise fall through to below/above
    if (cardSide === 'left' && spotlight.x - cw - 16 >= 16) {
      return {
        left: spotlight.x - cw - 16,
        top: Math.max(16, Math.min(
          spotlight.y + spotlight.h / 2 - CARD_HEIGHT_EST / 2,
          winH - CARD_HEIGHT_EST - 16,
        )),
      }
    }
    const idealLeft = spotlight.x + spotlight.w / 2 - cw / 2
    const belowY    = spotlight.y + spotlight.h + 16
    const aboveY    = spotlight.y - CARD_HEIGHT_EST - 16
    return {
      left: Math.max(16, Math.min(idealLeft, winW - cw - 16)),
      top:  belowY + CARD_HEIGHT_EST < winH ? belowY : aboveY > 0 ? aboveY : winH / 2 - CARD_HEIGHT_EST / 2,
    }
  }
  return { left: winW / 2 - cw / 2, top: winH / 2 - CARD_HEIGHT_EST / 2 }
}

export default function MarketTutorial({ onClose, onStepChange }: Props) {
  const [step, setStep]           = useState(0)
  const [shown, setShown]         = useState(0)          // content currently rendered (lags step during exit)
  const [phase, setPhase]         = useState<'in' | 'out'>('out')
  const [spotlight, setSpotlight] = useState<Rect | null>(null)
  const [cardPos, setCardPos]     = useState<CardPos>({ left: 0, top: 0 })
  const rafRef  = useRef<number | null>(null)
  const lockRef = useRef(true)

  const readRect = useCallback((stepIndex: number): Rect | null => {
    const selector = STEPS[stepIndex].targetSelector
    if (!selector) return null
    // Support comma-separated selectors — pick the first one that's actually visible
    const selectors = selector.split(',').map(s => s.trim())
    for (const sel of selectors) {
      const el = document.querySelector(sel) as HTMLElement | null
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const pad = 14
      return { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 }
    }
    return null
  }, [])

  useEffect(() => {
    lockRef.current = true
    setPhase('out')  // trigger exit animation — content (shown) stays on old step

    onStepChange?.(step)

    const selector = STEPS[step].targetSelector
    if (selector) {
      const el = document.querySelector(selector) as HTMLElement | null
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    // After exit anim + scroll settle: swap content, snap positions, play enter
    const t = setTimeout(() => {
      const winW = window.innerWidth
      const winH = window.innerHeight
      const rect = readRect(step)
      const pos  = computeCardPos(rect, STEPS[step].cardSide ?? 'below', winW, winH)

      setShown(step)      // switch text while invisible
      setSpotlight(rect)
      setCardPos(pos)
      lockRef.current = false

      requestAnimationFrame(() => setPhase('in'))
    }, SETTLE_MS)

    return () => clearTimeout(t)
  }, [step, readRect])

  // Keep in sync with scroll/resize/element-resize when not mid-transition
  useEffect(() => {
    const onUpdate = () => {
      if (lockRef.current) return
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        const winW = window.innerWidth
        const winH = window.innerHeight
        const rect = readRect(step)
        setSpotlight(rect)
        setCardPos(computeCardPos(rect, STEPS[step].cardSide ?? 'below', winW, winH))
      })
    }
    window.addEventListener('scroll', onUpdate, { passive: true })
    window.addEventListener('resize', onUpdate, { passive: true })

    // Watch the target element itself for size changes (e.g. trading panel expanding)
    const selector = STEPS[step].targetSelector
    const el = selector ? document.querySelector(selector) : null
    const ro = el ? new ResizeObserver(onUpdate) : null
    if (ro && el) ro.observe(el)

    return () => {
      window.removeEventListener('scroll', onUpdate)
      window.removeEventListener('resize', onUpdate)
      ro?.disconnect()
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [step, readRect])

  const next = () => step < STEPS.length - 1 ? setStep(s => s + 1) : onClose()
  const prev = () => step > 0 && setStep(s => s - 1)

  const hasSpot   = spotlight !== null
  const isVisible = phase === 'in'

  return (
    <div className="fixed inset-0 z-[200]" style={{ pointerEvents: 'none' }}>
      <style>{`
        @keyframes t-exit {
          from { opacity: 1; transform: scale(1)    translateY(0px);  }
          to   { opacity: 0; transform: scale(0.94) translateY(-8px); }
        }
        @keyframes t-enter {
          from { opacity: 0; transform: scale(0.94) translateY(8px); }
          to   { opacity: 1; transform: scale(1)    translateY(0px); }
        }
      `}</style>

      {/* Spotlight box-shadow overlay */}
      <div
        style={{
          position: 'fixed',
          left:   spotlight?.x ?? 0,
          top:    spotlight?.y ?? 0,
          width:  spotlight?.w ?? 0,
          height: spotlight?.h ?? 0,
          borderRadius: 10,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.78)',
          border: hasSpot ? '1.5px solid rgba(255,255,255,0.3)' : 'none',
          opacity: isVisible && hasSpot ? 1 : 0,
          transition: `opacity ${isVisible ? 220 : EXIT_MS}ms ease`,
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* Full dim for no-spotlight steps */}
      {!hasSpot && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.78)',
            opacity: isVisible ? 1 : 0,
            transition: `opacity ${isVisible ? 220 : EXIT_MS}ms ease`,
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />
      )}

      {/* Tutorial card */}
      <div
        className="glass rounded-2xl p-5 shadow-2xl border border-white/10"
        style={{
          position: 'fixed',
          width: cardWidth(typeof window !== 'undefined' ? window.innerWidth : 390),
          left: cardPos.left,
          top:  cardPos.top,
          animation: `${phase === 'out' ? `t-exit ${EXIT_MS}ms` : `t-enter 220ms`} ease forwards`,
          pointerEvents: isVisible ? 'all' : 'none',
          zIndex: 1,
        }}
      >
        {/* Progress dots — always reflect real step */}
        <div className="flex items-center gap-1.5 mb-3">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step ? 'w-6 bg-[#F2B71F]' : i < step ? 'w-1.5 bg-white/30' : 'w-1.5 bg-white/10'
              }`}
            />
          ))}
          <span className="ml-auto text-[10px] text-neutral-500 font-medium">
            {shown + 1} / {STEPS.length}
          </span>
        </div>

        {/* Text — uses shown (lags step) so it never changes during exit */}
        <p className="text-white text-sm leading-relaxed mb-4">
          {STEPS[shown].text}
        </p>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button onClick={onClose} className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors">
            Skip tutorial
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={prev}
                className="px-3 py-1.5 text-xs text-neutral-300 hover:text-white rounded-lg bg-white/5 hover:bg-white/10 transition-all"
              >
                Back
              </button>
            )}
            <button
              onClick={next}
              className="px-4 py-1.5 text-xs font-semibold text-black bg-[#F2B71F] hover:bg-[#F2B71F]/80 rounded-lg transition-all"
            >
              {step === STEPS.length - 1 ? 'Get started' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
