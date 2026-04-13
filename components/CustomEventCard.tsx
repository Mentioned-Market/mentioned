'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

interface WordPrice {
  word_id: number
  word: string
  yes_price: number
  no_price: number
  resolved_outcome?: boolean | null
}

interface CustomMarketSummary {
  id: number
  title: string
  description: string | null
  cover_image_url: string | null
  status: string
  lock_time: string | null
  slug: string
  market_type: string
  event_start_time: string | null
  word_count: number
  trader_count: number
  words_prices: WordPrice[]
}

function formatCloseTime(isoTime: string): string {
  const d = new Date(isoTime)
  const diff = d.getTime() - Date.now()
  if (diff <= 0) return 'Locked'
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }
  return `${hours}h ${minutes}m`
}

function formatEventTime(isoTime: string): string {
  const d = new Date(isoTime)
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
}

const VISIBLE_COUNT = 5

function ScrollingSentimentList({ words, marketUrl }: { words: WordPrice[]; marketUrl: string }) {
  const innerRef = useRef<HTMLDivElement>(null)
  const outerRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef(0)
  const needsScroll = words.length > VISIBLE_COUNT

  useEffect(() => {
    if (!needsScroll || !innerRef.current || !outerRef.current) return
    const inner = innerRef.current
    const outer = outerRef.current
    let raf: number
    let paused = true
    let pauseTimer: ReturnType<typeof setTimeout>
    offsetRef.current = 0

    const step = () => {
      const maxOffset = inner.scrollHeight - outer.clientHeight
      if (!paused && maxOffset > 0) {
        offsetRef.current += 0.2
        if (offsetRef.current >= maxOffset) {
          paused = true
          pauseTimer = setTimeout(() => {
            offsetRef.current = 0
            inner.style.transform = 'translateY(0px)'
            paused = false
          }, 1500)
        }
        inner.style.transform = `translateY(-${offsetRef.current}px)`
      }
      raf = requestAnimationFrame(step)
    }

    pauseTimer = setTimeout(() => {
      paused = false
      raf = requestAnimationFrame(step)
    }, 1500)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(pauseTimer)
    }
  }, [needsScroll, words])

  const fixedHeight = VISIBLE_COUNT * 30 + (VISIBLE_COUNT - 1) * 6

  return (
    <div
      ref={outerRef}
      className="overflow-hidden"
      style={{ height: fixedHeight }}
    >
      <div ref={innerRef} className="flex flex-col gap-1.5">
        {words.map(w => {
          const isResolved = w.resolved_outcome !== null && w.resolved_outcome !== undefined
          const yesPct = isResolved ? (w.resolved_outcome ? 100 : 0) : Math.round(w.yes_price * 100)
          const noPct = 100 - yesPct
          return (
            <Link
              key={w.word_id}
              href={marketUrl}
              className="flex items-center gap-2 h-[30px] px-2 rounded-lg glass hover:bg-white/10 transition-colors"
            >
              <span className="text-white text-xs font-medium truncate flex-1">{w.word}</span>
              {isResolved && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${w.resolved_outcome ? 'bg-apple-green/15 text-apple-green' : 'bg-apple-red/15 text-apple-red'}`}>
                  {w.resolved_outcome ? 'YES' : 'NO'}
                </span>
              )}
              <span className="text-apple-green text-[11px] font-semibold tabular-nums w-12 text-right">{yesPct}c</span>
              <span className="text-apple-red text-[11px] font-semibold tabular-nums w-12 text-right">{noPct}c</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export default function CustomEventCard({ market }: { market: CustomMarketSummary }) {
  const [imgError, setImgError] = useState(false)
  const url = `/free/${market.slug}`
  const lockPassed = market.lock_time ? new Date(market.lock_time) <= new Date() : false
  const isClosed = market.status === 'locked' || (market.status === 'open' && lockPassed)

  // Live logic: continuous markets are live when open, event markets are live when open + event started
  const isLive = market.status === 'open' && !lockPassed && (
    market.market_type === 'continuous' ||
    (market.market_type === 'event' && market.event_start_time && new Date(market.event_start_time) <= new Date())
  )

  return (
    <div className="group relative block overflow-hidden rounded-2xl glass transition-all duration-300 hover-lift">
      {/* Image */}
      <Link href={url} className="block w-full relative overflow-hidden" style={{ height: '140px' }}>
        {market.cover_image_url && !imgError ? (
          <img
            src={market.cover_image_url}
            alt={market.title}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full bg-neutral-800 flex items-center justify-center">
            <span className="text-neutral-500 text-2xl">🎯</span>
          </div>
        )}
        <div className="absolute top-3 left-3">
          {market.status === 'resolved' ? (
            <span className="px-2 py-0.5 rounded-full bg-blue-500/80 text-white text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm">Resolved</span>
          ) : isClosed ? (
            <span className="px-2 py-0.5 rounded-full bg-black/60 text-neutral-300 text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm">Closed</span>
          ) : (
            <span className="px-2 py-0.5 rounded-full bg-[#F2B71F]/80 text-black text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm">Open</span>
          )}
        </div>
        {isLive && (
          <div className="absolute top-3 right-3">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/70 text-apple-red text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-apple-red animate-pulse" />
              Live
            </span>
          </div>
        )}
      </Link>

      <div className="p-4 flex flex-col gap-3">
        <div>
          <Link href={url}>
            <h3 className="text-white text-sm font-semibold leading-tight line-clamp-2 h-[2.5rem] hover:text-neutral-200 transition-colors">
              {market.title}
            </h3>
          </Link>
          {market.market_type === 'event' && market.event_start_time && (
            <p className="text-[11px] text-neutral-500 mt-1">
              {formatEventTime(market.event_start_time)}
            </p>
          )}
        </div>

        {/* Scrolling word sentiment list */}
        {market.words_prices.length > 0 && (
          <ScrollingSentimentList words={market.words_prices} marketUrl={url} />
        )}

        <Link href={url} className="flex items-center gap-2 pt-2 border-t border-white/5">
          <span className="px-2 py-0.5 rounded-full bg-white/5 text-neutral-400 text-[10px] font-medium">
            {market.trader_count} trader{market.trader_count !== 1 ? 's' : ''}
          </span>
          <span className="text-neutral-600 text-[10px]">·</span>
          <span className="px-2 py-0.5 rounded-full bg-white/5 text-neutral-400 text-[10px] font-medium">
            {market.word_count} words
          </span>
          {market.lock_time && market.status === 'open' && !lockPassed && (
            <>
              <span className="text-neutral-600 text-[10px]">·</span>
              <span className="px-2 py-0.5 rounded-full bg-white/5 text-neutral-400 text-[10px] font-medium">
                Closes {formatCloseTime(market.lock_time)}
              </span>
            </>
          )}
        </Link>
      </div>
    </div>
  )
}
