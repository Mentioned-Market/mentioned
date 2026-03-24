'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

interface WordSentiment {
  word_id: number
  word: string
  yes_pct: number
  no_pct: number
}

interface CustomMarketSummary {
  id: number
  title: string
  description: string | null
  cover_image_url: string | null
  status: string
  lock_time: string | null
  word_count: number
  prediction_count: number
  words_sentiment: WordSentiment[]
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

const VISIBLE_COUNT = 5

function ScrollingSentimentList({ words, marketId }: { words: WordSentiment[]; marketId: number }) {
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
      style={{ height: needsScroll ? fixedHeight : undefined }}
    >
      <div ref={innerRef} className="flex flex-col gap-1.5">
        {words.map(w => (
          <Link
            key={w.word_id}
            href={`/custom/${marketId}`}
            className="flex items-center gap-2 h-[30px] px-2 rounded-lg glass hover:bg-white/10 transition-colors"
          >
            <span className="text-white text-xs font-medium truncate flex-1">{w.word}</span>
            <span className="text-apple-green text-[11px] font-semibold tabular-nums w-12 text-right">Y {w.yes_pct}%</span>
            <span className="text-apple-red text-[11px] font-semibold tabular-nums w-12 text-right">N {w.no_pct}%</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

export default function CustomEventCard({ market }: { market: CustomMarketSummary }) {
  const [imgError, setImgError] = useState(false)
  const url = `/custom/${market.id}`

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
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-full bg-apple-green/90 text-white text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm">
            Free
          </span>
          {market.status === 'open' && (
            <span className="px-2 py-0.5 rounded-full bg-green-500/80 text-white text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm">
              Open
            </span>
          )}
          {market.status === 'locked' && (
            <span className="px-2 py-0.5 rounded-full bg-orange-500/80 text-white text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm">
              Locked
            </span>
          )}
          {market.status === 'resolved' && (
            <span className="px-2 py-0.5 rounded-full bg-blue-500/80 text-white text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm">
              Resolved
            </span>
          )}
        </div>
      </Link>

      <div className="p-4 flex flex-col gap-3">
        <Link href={url}>
          <h3 className="text-white text-sm font-semibold leading-tight line-clamp-2 h-[2.5rem] hover:text-neutral-200 transition-colors">
            {market.title}
          </h3>
        </Link>

        {/* Scrolling word sentiment list */}
        {market.words_sentiment.length > 0 && (
          <ScrollingSentimentList words={market.words_sentiment} marketId={market.id} />
        )}

        <Link href={url} className="flex items-center gap-2 pt-2 border-t border-white/5">
          <span className="px-2 py-0.5 rounded-full bg-white/5 text-neutral-400 text-[10px] font-medium">
            {market.prediction_count} predictor{market.prediction_count !== 1 ? 's' : ''}
          </span>
          {market.lock_time && market.status === 'open' && (
            <span className="px-2 py-0.5 rounded-full bg-white/5 text-neutral-400 text-[10px] font-medium">
              {formatCloseTime(market.lock_time)}
            </span>
          )}
          <span className="px-2 py-0.5 rounded-full bg-white/5 text-neutral-400 text-[10px] font-medium">
            {market.word_count} words
          </span>
        </Link>
      </div>
    </div>
  )
}
