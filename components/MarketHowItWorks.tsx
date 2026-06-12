'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// Shared "How does this work?" popover used on both free and paid market pages.
// `variant` swaps the copy: free markets use play tokens + points; paid markets
// use real USDC (1:1 redemption, real profit/loss).
type Variant = 'free' | 'paid'

const COPY: Record<Variant, React.ReactNode[]> = {
  free: [
    <>You get <span className="text-[#F2B71F] font-semibold">500 free play tokens</span> for each market. No real money involved.</>,
    <>Pick <span className="text-apple-green font-semibold">YES</span> or <span className="text-apple-red font-semibold">NO</span> on whether a word will be said. Prices shift as more people trade.</>,
    <>If you&apos;re right, each share pays out <span className="text-white font-semibold">1 token</span>. Wrong shares pay <span className="text-neutral-300 font-semibold">nothing</span>.</>,
    <>Every token of profit earns <span className="text-apple-blue font-semibold">0.5 platform points</span> toward the weekly leaderboard.</>,
  ],
  paid: [
    <>These markets trade in <span className="text-[#F2B71F] font-semibold">real USDC</span>. Profits and losses are real money.</>,
    <>Pick <span className="text-apple-green font-semibold">YES</span> or <span className="text-apple-red font-semibold">NO</span> on whether a word will be said. Prices shift as more people trade.</>,
    <>If you&apos;re right, each winning share redeems for <span className="text-white font-semibold">$1 USDC</span>. Wrong shares are worth <span className="text-neutral-300 font-semibold">nothing</span>.</>,
    <>You need a small amount of <span className="text-white font-semibold">SOL</span> in your wallet for network fees to trade.</>,
  ],
}

export default function MarketHowItWorks({
  variant,
  onRerunTutorial,
  upward,
  compact,
}: {
  variant: Variant
  onRerunTutorial?: () => void
  upward?: boolean
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({})

  useEffect(() => { setMounted(true) }, [])

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      if (upward) {
        const panel = btnRef.current.closest<HTMLElement>('[data-trading-panel]')
        if (panel) {
          const panelRect = panel.getBoundingClientRect()
          setPopupStyle({
            position: 'fixed',
            top: Math.max(8, rect.top + rect.height / 2 - 110),
            right: window.innerWidth - panelRect.left + 10,
            width: 300,
            zIndex: 99999,
          })
        } else {
          // Mobile bottom bar — center popup above the button
          const popupWidth = 300
          const left = Math.max(8, Math.min(rect.left + rect.width / 2 - popupWidth / 2, window.innerWidth - popupWidth - 8))
          setPopupStyle({
            position: 'fixed',
            bottom: window.innerHeight - rect.top + 8,
            left,
            width: popupWidth,
            zIndex: 99999,
          })
        }
      } else {
        // Right-align the popup to the button (opens LEFTward) so a right-side
        // trigger never runs off the right edge of the screen.
        setPopupStyle({
          position: 'fixed',
          top: rect.bottom + 8,
          right: Math.max(8, window.innerWidth - rect.right),
          width: 300,
          zIndex: 99999,
        })
      }
    }
    setOpen(v => !v)
  }

  const popupContent = open ? (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 99998 }}
        onClick={() => setOpen(false)}
      />
      <div
        style={{ ...popupStyle, backgroundColor: '#141414' }}
        className="rounded-xl p-4 shadow-2xl border border-white/15 animate-scale-in"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-white">How it works</span>
          <button onClick={() => setOpen(false)} className="text-neutral-500 hover:text-white">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="space-y-3 text-xs text-neutral-400 leading-relaxed">
          {COPY[variant].map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
        {onRerunTutorial && (
          <button
            onClick={() => { setOpen(false); onRerunTutorial() }}
            className="mt-3 w-full text-center text-[11px] text-[#F2B71F] transition-colors"
          >
            Rerun tutorial
          </button>
        )}
      </div>
    </>
  ) : null

  return (
    <div className={compact ? 'inline-block' : 'mb-3'}>
      <button
        ref={btnRef}
        onClick={handleOpen}
        className={compact
          ? "flex items-center gap-1 px-2 py-1 rounded-lg bg-[#F2B71F]/10 border border-[#F2B71F]/20 text-[11px] text-[#F2B71F] hover:bg-[#F2B71F]/15 transition-colors"
          : "flex items-center gap-1.5 w-full px-3 py-2 rounded-lg bg-[#F2B71F]/10 border border-[#F2B71F]/20 text-xs text-[#F2B71F] hover:bg-[#F2B71F]/15 transition-colors"
        }
      >
        <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-[13px] font-bold leading-none">?</span>
        {!compact && <span className="font-medium">How does this work?</span>}
      </button>
      {mounted && createPortal(popupContent, document.body)}
    </div>
  )
}
