'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

interface TopWord {
  word: string
  appearances: number
  yes_count: number
  yes_rate: number
}

interface MarketSeriesRow {
  series_slug: string
  market_count: number
  resolved_word_count: number
  last_resolved_at: string
  first_resolved_at: string
  latest_title: string
  latest_cover_image_url: string | null
  total_volume_tokens: number
  total_trades: number
  top_words: TopWord[]
}

type Sort = 'recent' | 'markets'

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const diff = Date.now() - then
  if (diff < 0) return 'just now'
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  const w = Math.floor(d / 7)
  if (w < 5) return `${w}w ago`
  const mo = Math.floor(d / 30)
  return `${mo}mo ago`
}

function formatSeriesName(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

export default function KnowledgePage() {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 250)
  const [sort, setSort] = useState<Sort>('recent')
  const [series, setSeries] = useState<MarketSeriesRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim())
    if (sort) params.set('sort', sort)
    fetch(`/api/knowledge?${params.toString()}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('fetch failed')))
      .then(data => {
        if (cancelled) return
        setSeries(data.series || [])
      })
      .catch(() => {
        if (cancelled) return
        setError('Could not load market series')
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [debouncedQuery, sort])

  return (
    <>
      <Header />
      <main className="min-h-screen bg-black text-white">
        <div className="px-4 md:px-10 lg:px-20 py-6 md:py-10">
          <div className="max-w-7xl mx-auto">
            {/* Page header */}
            <div className="mb-6 md:mb-8">
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1.5">Knowledge</h1>
              <p className="text-sm text-neutral-400">
                Every resolved market grouped by series. Click into a series to see how each word has historically resolved, then use the data to inform your next trade.
              </p>
            </div>

            {/* Filter bar */}
            <div className="rounded-2xl p-3 md:p-4 mb-4 md:mb-6" style={{ background: 'rgba(10,10,10,0.75)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)' }}>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:flex-wrap">
                <div className="flex-1 min-w-0 md:min-w-[240px] md:max-w-xs">
                  <div className="relative">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
                    </svg>
                    <input
                      type="text"
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      placeholder="Search series (e.g. whitehouse)"
                      className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-white/30 transition-colors"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg p-1">
                  {([
                    { v: 'recent' as const, label: 'Most recent' },
                    { v: 'markets' as const, label: 'Most markets' },
                  ]).map(o => (
                    <button
                      key={o.v}
                      onClick={() => setSort(o.v)}
                      className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                        sort === o.v ? 'bg-white/10 text-white' : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Series grid */}
            {loading ? (
              <SkeletonGrid />
            ) : error ? (
              <EmptyState>{error}</EmptyState>
            ) : series.length === 0 ? (
              <EmptyState>
                <p className="text-white text-sm font-medium mb-1">No resolved market series yet</p>
                <p className="text-neutral-500 text-xs">Once markets finish resolving they&apos;ll show up here.</p>
              </EmptyState>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
                {series.map(s => <SeriesCard key={s.series_slug} series={s} />)}
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}

function SeriesCard({ series }: { series: MarketSeriesRow }) {
  const [imgError, setImgError] = useState(false)
  return (
    <Link
      href={`/knowledge/${encodeURIComponent(series.series_slug)}`}
      className="group relative block overflow-hidden rounded-2xl transition-all duration-300 hover-lift"
      style={{ background: 'rgba(10,10,10,0.75)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)' }}
    >
      {/* Cover */}
      <div className="relative overflow-hidden bg-neutral-800" style={{ height: '120px' }}>
        {(!series.latest_cover_image_url || imgError) ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-neutral-500 text-2xl">🧠</span>
          </div>
        ) : (
          <img
            src={series.latest_cover_image_url}
            alt={series.latest_title}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <div className="absolute top-3 left-3">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-black/60 text-white backdrop-blur-sm">
            {series.market_count} {series.market_count === 1 ? 'market' : 'markets'}
          </span>
        </div>
        <div className="absolute bottom-3 left-3 right-3">
          <div className="font-mono text-[11px] text-neutral-300 truncate">{series.series_slug}</div>
          <h3 className="text-white text-base font-semibold leading-tight line-clamp-1 mt-0.5">
            {formatSeriesName(series.series_slug)}
          </h3>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col gap-3">
        {/* Top words */}
        {series.top_words.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">Top words by appearances</div>
            <div className="flex flex-col gap-1">
              {series.top_words.map(w => (
                <YesRateBar key={w.word} word={w.word} appearances={w.appearances} yesCount={w.yes_count} totalMarkets={series.market_count} />
              ))}
            </div>
          </div>
        ) : (
          <div className="text-xs text-neutral-500">No resolved words yet</div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-2 pt-2 border-t border-white/5 text-[11px] text-neutral-400">
          <span>{series.resolved_word_count} words</span>
          <span className="text-neutral-700">·</span>
          <span className="text-neutral-500">{formatRelative(series.last_resolved_at)}</span>
        </div>
      </div>
    </Link>
  )
}

function YesRateBar({ word, appearances, yesCount, totalMarkets }: { word: string; appearances: number; yesCount: number; totalMarkets: number }) {
  const yesRate = appearances > 0 ? yesCount / appearances : 0
  const yesPct = Math.round(yesRate * 100)
  const color = yesRate >= 0.6 ? 'bg-apple-green' : yesRate <= 0.4 ? 'bg-apple-red' : 'bg-neutral-400'
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-white font-medium truncate min-w-0 flex-1">{word}</span>
      <div className="w-14 md:w-20 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${yesPct}%` }} />
      </div>
      <span className="font-mono text-[11px] text-neutral-400 w-8 text-right">{yesPct}%</span>
      <span className="text-[10px] text-neutral-500 w-10 text-right tabular-nums">{appearances}/{totalMarkets}</span>
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-10 text-center" style={{ background: 'rgba(10,10,10,0.6)', border: '1px solid rgba(255,255,255,0.08)' }}>
      {children}
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl h-[280px] relative overflow-hidden"
          style={{ background: 'rgba(10,10,10,0.75)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(90deg, transparent 30%, rgba(255,255,255,0.055) 50%, transparent 70%)',
              animation: 'shimmerSlide 2.2s ease-in-out infinite',
            }}
          />
        </div>
      ))}
    </div>
  )
}
