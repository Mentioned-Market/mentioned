'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface TradeItem {
  id: string | number
  wallet: string
  username: string | null
  marketId: string
  eventId: string
  isYes: boolean
  isBuy: boolean
  amountUsd: string
  marketTitle: string | null
  createdAt: string
  type: 'polymarket' | 'free'
  wordLabel?: string | null
  cost?: number | string | null
  slug?: string | null
}

function formatAmount(microUsd: string): string {
  const usd = Number(microUsd) / 1_000_000
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`
  return `$${usd.toFixed(2)}`
}

function formatTokens(cost: number | string | null | undefined): string {
  if (cost == null) return ''
  const n = Number(cost)
  if (isNaN(n)) return ''
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(1)
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function displayName(username: string | null, wallet: string): string {
  if (username) return `@${username}`
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`
}

function profileHref(username: string | null, wallet: string): string {
  return `/profile/${username ?? wallet}`
}

function TradeChip({ trade }: { trade: TradeItem }) {
  const router = useRouter()
  const isYesBuy = trade.isBuy && trade.isYes
  const isNoBuy = trade.isBuy && !trade.isYes
  const label = trade.isBuy
    ? trade.isYes ? 'Bought YES' : 'Bought NO'
    : trade.isYes ? 'Sold YES' : 'Sold NO'

  const dotColor = isYesBuy
    ? 'bg-apple-green'
    : isNoBuy
    ? 'bg-apple-red'
    : 'bg-neutral-500'

  const labelColor = isYesBuy
    ? 'text-apple-green'
    : isNoBuy
    ? 'text-apple-red'
    : 'text-neutral-400'

  const isFree = trade.type === 'free'
  const href = isFree ? `/free/${trade.slug || trade.marketId}` : `/polymarkets/event/${trade.eventId}`

  return (
    <div
      className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 shrink-0 select-none cursor-pointer hover:bg-white/10 hover:border-white/20 transition-colors"
      onClick={() => router.push(href)}
    >
      {isFree && (
        <span className="text-[9px] font-bold uppercase tracking-wide text-[#F2B71F] bg-[#F2B71F]/10 px-1.5 py-0.5 rounded-full leading-none">
          FREE
        </span>
      )}
      <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      <Link
        href={profileHref(trade.username, trade.wallet)}
        className="text-white text-xs font-medium hover:underline max-w-[80px] truncate"
        onClick={e => e.stopPropagation()}
      >
        {displayName(trade.username, trade.wallet)}
      </Link>
      <span className={`text-xs font-semibold ${labelColor}`}>{label}</span>
      {isFree ? (
        <span className="text-[#F2B71F] text-xs font-bold">{formatTokens(trade.cost)} pts</span>
      ) : (
        <span className="text-white text-xs font-bold">{formatAmount(trade.amountUsd)}</span>
      )}
      {(isFree ? trade.wordLabel : trade.marketTitle) && (
        <>
          <span className="text-neutral-600 text-[10px]">·</span>
          <span className="text-neutral-400 text-[10px] max-w-[140px] truncate">
            {isFree ? trade.wordLabel : trade.marketTitle}
          </span>
        </>
      )}
      <span className="text-neutral-500 text-[10px]">{timeAgo(trade.createdAt)}</span>
    </div>
  )
}

export default function TradeTicker() {
  const [trades, setTrades] = useState<TradeItem[]>([])
  const [paused, setPaused] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/trades/recent')
        if (!res.ok) return
        const data = await res.json()
        setTrades(data)
      } catch {
        // silently ignore — ticker is non-critical
      }
    }

    load()
    intervalRef.current = setInterval(load, 60_000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  // Duplicate so the seamless loop works
  const doubled = trades.length > 0 ? [...trades, ...trades] : []

  // ~250px per chip (avg width + gap). Target ~40px/s scroll speed.
  const estimatedHalfWidth = trades.length * 250
  const duration = Math.max(30, estimatedHalfWidth / 40)

  return (
    <div
      className="relative w-full overflow-hidden border-b border-white/10 bg-neutral-950/80 backdrop-blur-sm"
      style={{ height: '40px' }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-label="Recent trades"
    >
      {/* Left fade */}
      <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-16 z-10 bg-gradient-to-r from-neutral-950/80 to-transparent" />
      {/* Right fade */}
      <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-16 z-10 bg-gradient-to-l from-neutral-950/80 to-transparent" />

      {doubled.length > 0 ? (
        <div
          className="flex items-center gap-3 h-full absolute whitespace-nowrap animate-ticker"
          style={{
            willChange: 'transform',
            animationDuration: `${duration}s`,
            animationPlayState: paused ? 'paused' : 'running',
          }}
        >
          {doubled.map((trade, i) => (
            <TradeChip key={`${trade.id}-${i}`} trade={trade} />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-3 h-full px-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-6 rounded-full bg-white/5 shrink-0" style={{ width: `${140 + (i % 3) * 40}px` }} />
          ))}
        </div>
      )}
    </div>
  )
}
