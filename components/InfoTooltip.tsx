'use client'

import { useState, useRef, useEffect } from 'react'

interface InfoTooltipProps {
  children: React.ReactNode
  position?: 'above' | 'below' | 'right'
}

export default function InfoTooltip({ children, position = 'above' }: InfoTooltipProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button
        onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="w-5 h-5 rounded-full bg-white/10 text-neutral-400 hover:text-white hover:bg-white/20 transition-colors flex items-center justify-center text-xs font-semibold leading-none"
        aria-label="Info"
      >
        i
      </button>
      {open && position === 'above' && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-72 p-3 rounded-xl bg-neutral-900 border border-white/10 shadow-xl z-50 text-xs text-neutral-300 leading-relaxed">
          {children}
          <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-neutral-900" />
        </div>
      )}
      {open && position === 'below' && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-72 p-3 rounded-xl bg-neutral-900 border border-white/10 shadow-xl z-50 text-xs text-neutral-300 leading-relaxed">
          {children}
          <div className="absolute left-1/2 -translate-x-1/2 bottom-full w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[6px] border-b-neutral-900" />
        </div>
      )}
      {open && position === 'right' && (
        <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 w-72 p-3 rounded-xl bg-neutral-900 border border-white/10 shadow-xl z-50 text-xs text-neutral-300 leading-relaxed">
          {children}
          <div className="absolute right-full top-1/2 -translate-y-1/2 w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-r-[6px] border-r-neutral-900" />
        </div>
      )}
    </div>
  )
}
