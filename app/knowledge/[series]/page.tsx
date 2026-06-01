'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

interface SeriesWordStat {
  word: string
  appearances: number
  yes_count: number
  no_count: number
  yes_rate: number
  avg_close_yes_price: number
  total_volume_tokens: number
  total_trades: number
}

interface SeriesMarketWord {
  word_id: number
  word: string
  outcome: 'YES' | 'NO'
  close_yes_price: number
  volume_tokens: number
  trade_count: number
}

interface SeriesMarketSummary {
  market_id: number
  title: string
  slug: string
  cover_image_url: string | null
  resolved_at: string
  yes_words: number
  no_words: number
  volume_tokens: number
  trade_count: number
  words: SeriesMarketWord[]
}

interface SeriesDetail {
  series_slug: string
  market_count: number
  last_resolved_at: string
  first_resolved_at: string
  latest_title: string
  latest_cover_image_url: string | null
  total_volume_tokens: number
  total_trades: number
  resolved_word_count: number
  word_stats: SeriesWordStat[]
  markets: SeriesMarketSummary[]
}

type WordSort = 'appearances' | 'yes_rate_desc' | 'yes_rate_asc' | 'avg_close_desc' | 'avg_close_asc'

function formatPrice(p: number): string {
  if (!Number.isFinite(p)) return '-'
  return p.toFixed(2)
}

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

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatSeriesName(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function SeriesDetailPage() {
  const params = useParams<{ series: string }>()
  const seriesSlug = decodeURIComponent(params?.series || '')

  const [detail, setDetail] = useState<SeriesDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [wordQuery, setWordQuery] = useState('')
  const [wordSort, setWordSort] = useState<WordSort>('appearances')
  const [minAppearances, setMinAppearances] = useState(1)
  const [expandedMarket, setExpandedMarket] = useState<number | null>(null)

  useEffect(() => {
    if (!seriesSlug) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/knowledge/series/${encodeURIComponent(seriesSlug)}`)
      .then(async r => {
        if (r.status === 404) throw new Error('not-found')
        if (!r.ok) throw new Error('fetch-failed')
        return r.json()
      })
      .then(data => {
        if (cancelled) return
        setDetail(data)
      })
      .catch(err => {
        if (cancelled) return
        setError(err.message === 'not-found' ? 'Series not found' : 'Could not load series')
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [seriesSlug])

  const filteredSortedWords = useMemo(() => {
    if (!detail) return []
    const q = wordQuery.trim().toLowerCase()
    let rows = detail.word_stats.filter(w => w.appearances >= minAppearances)
    if (q) rows = rows.filter(w => w.word.toLowerCase().includes(q))
    const sorted = [...rows]
    switch (wordSort) {
      case 'yes_rate_desc':
        sorted.sort((a, b) => b.yes_rate - a.yes_rate || b.appearances - a.appearances)
        break
      case 'yes_rate_asc':
        sorted.sort((a, b) => a.yes_rate - b.yes_rate || b.appearances - a.appearances)
        break
      case 'avg_close_desc':
        sorted.sort((a, b) => b.avg_close_yes_price - a.avg_close_yes_price)
        break
      case 'avg_close_asc':
        sorted.sort((a, b) => a.avg_close_yes_price - b.avg_close_yes_price)
        break
      case 'appearances':
      default:
        sorted.sort((a, b) => b.appearances - a.appearances || b.yes_count - a.yes_count)
        break
    }
    return sorted
  }, [detail, wordQuery, wordSort, minAppearances])

  const highlights = useMemo(() => {
    if (!detail) return null
    const eligible = detail.word_stats.filter(w => w.appearances >= 2)
    const topYes = [...eligible].sort((a, b) => b.yes_rate - a.yes_rate || b.appearances - a.appearances)[0]
    const topNo = [...eligible].sort((a, b) => a.yes_rate - b.yes_rate || b.appearances - a.appearances)[0]
    return {
      topYes: topYes && topYes.yes_rate >= 0.6 ? topYes : null,
      topNo: topNo && topNo.yes_rate <= 0.4 ? topNo : null,
    }
  }, [detail])

  const toggleMarket = useCallback((id: number) => {
    setExpandedMarket(prev => prev === id ? null : id)
  }, [])

  return (
    <>
      <Header />
      <main className="min-h-screen bg-black text-white">
        <div className="px-4 md:px-10 lg:px-20 py-6 md:py-10">
          <div className="max-w-7xl mx-auto">
            {/* Breadcrumb */}
            <div className="text-xs text-neutral-500 mb-4">
              <Link href="/knowledge" className="hover:text-white transition-colors">Knowledge</Link>
              <span className="mx-2 text-neutral-700">/</span>
              <span className="font-mono">{seriesSlug}</span>
            </div>

            {loading ? (
              <LoadingBlock />
            ) : error || !detail ? (
              <div className="rounded-2xl p-10 text-center" style={{ background: 'rgba(10,10,10,0.6)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <p className="text-white text-sm font-medium mb-1">{error || 'Series not found'}</p>
                <Link href="/knowledge" className="inline-block mt-3 text-xs text-neutral-400 hover:text-white">← Back to Knowledge</Link>
              </div>
            ) : (
              <>
                {/* Series header */}
                <SeriesHeader detail={detail} />

                {/* Predictive highlights */}
                {highlights && (highlights.topYes || highlights.topNo) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 mb-6 md:mb-8">
                    {highlights.topYes && (
                      <HighlightCard
                        accent="green"
                        label="Most reliable YES"
                        word={highlights.topYes.word}
                        primary={`${Math.round(highlights.topYes.yes_rate * 100)}% YES`}
                        sub={`${highlights.topYes.yes_count}/${highlights.topYes.appearances} markets · avg close ${formatPrice(highlights.topYes.avg_close_yes_price)}`}
                      />
                    )}
                    {highlights.topNo && (
                      <HighlightCard
                        accent="red"
                        label="Most reliable NO"
                        word={highlights.topNo.word}
                        primary={`${Math.round(highlights.topNo.yes_rate * 100)}% YES`}
                        sub={`${highlights.topNo.yes_count}/${highlights.topNo.appearances} markets · avg close ${formatPrice(highlights.topNo.avg_close_yes_price)}`}
                      />
                    )}
                  </div>
                )}

                {/* Word stats section */}
                <section className="mb-8 md:mb-10">
                  <div className="flex items-baseline justify-between mb-3 md:mb-4">
                    <h2 className="text-lg md:text-xl font-semibold">Word performance</h2>
                    <span className="text-xs text-neutral-500">{filteredSortedWords.length} of {detail.word_stats.length}</span>
                  </div>

                  {/* Filter row */}
                  <div className="rounded-2xl p-3 md:p-4 mb-3 flex flex-col gap-3 md:flex-row md:items-center md:flex-wrap" style={{ background: 'rgba(10,10,10,0.75)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div className="flex-1 min-w-0 md:min-w-[200px] md:max-w-xs">
                      <div className="relative">
                        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
                        </svg>
                        <input
                          type="text"
                          value={wordQuery}
                          onChange={e => setWordQuery(e.target.value)}
                          placeholder="Search words"
                          className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-white/30"
                        />
                      </div>
                    </div>

                    <select
                      value={wordSort}
                      onChange={e => setWordSort(e.target.value as WordSort)}
                      className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
                    >
                      <option value="appearances">Most appearances</option>
                      <option value="yes_rate_desc">Highest YES rate</option>
                      <option value="yes_rate_asc">Lowest YES rate</option>
                      <option value="avg_close_desc">Highest avg close</option>
                      <option value="avg_close_asc">Lowest avg close</option>
                    </select>

                    <div className="flex items-center gap-2 text-xs text-neutral-400">
                      <span>Min appearances</span>
                      <select
                        value={minAppearances}
                        onChange={e => setMinAppearances(parseInt(e.target.value, 10))}
                        className="bg-white/5 border border-white/10 rounded-lg pl-3 pr-7 py-2 text-sm text-white focus:outline-none focus:border-white/30"
                      >
                        {[1, 2, 3, 5, 10].map(n => <option key={n} value={n}>{n}+</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Word stats table */}
                  {filteredSortedWords.length === 0 ? (
                    <div className="rounded-2xl p-8 text-center text-sm text-neutral-500" style={{ background: 'rgba(10,10,10,0.6)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      No words match these filters.
                    </div>
                  ) : (
                    <>
                      {/* Desktop table */}
                      <div className="hidden md:block rounded-2xl overflow-hidden" style={{ background: 'rgba(10,10,10,0.75)', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-500 border-b border-white/8">
                              <th className="px-4 py-3 font-medium">Word</th>
                              <th className="px-4 py-3 font-medium">YES rate</th>
                              <th className="px-4 py-3 font-medium text-right">Apps</th>
                              <th className="px-4 py-3 font-medium text-right">Avg close YES</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredSortedWords.map(w => <WordRow key={w.word} stat={w} totalMarkets={detail.market_count} />)}
                          </tbody>
                        </table>
                      </div>
                      {/* Mobile cards */}
                      <div className="md:hidden flex flex-col gap-2">
                        {filteredSortedWords.map(w => <WordCardMobile key={w.word} stat={w} totalMarkets={detail.market_count} />)}
                      </div>
                    </>
                  )}
                </section>

                {/* Markets section */}
                <section>
                  <div className="flex items-baseline justify-between mb-3 md:mb-4">
                    <h2 className="text-lg md:text-xl font-semibold">All markets</h2>
                    <span className="text-xs text-neutral-500">{detail.markets.length} resolved</span>
                  </div>

                  <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(10,10,10,0.75)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    {detail.markets.map(m => (
                      <MarketRow
                        key={m.market_id}
                        market={m}
                        expanded={expandedMarket === m.market_id}
                        onToggle={() => toggleMarket(m.market_id)}
                      />
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}

function SeriesHeader({ detail }: { detail: SeriesDetail }) {
  const [imgError, setImgError] = useState(false)
  return (
    <div className="rounded-2xl overflow-hidden mb-6 md:mb-8" style={{ background: 'rgba(10,10,10,0.75)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex flex-col md:flex-row">
        <div className="relative md:w-64 md:flex-shrink-0 bg-neutral-800" style={{ minHeight: '160px' }}>
          {(!detail.latest_cover_image_url || imgError) ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-neutral-500 text-3xl">🧠</span>
            </div>
          ) : (
            <img
              src={detail.latest_cover_image_url}
              alt={detail.latest_title}
              className="absolute inset-0 w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          )}
        </div>
        <div className="flex-1 p-4 md:p-6">
          <div className="font-mono text-[11px] text-neutral-500 mb-1">{detail.series_slug}</div>
          <h1 className="text-xl md:text-2xl font-semibold mb-3">{formatSeriesName(detail.series_slug)}</h1>
          <p className="text-xs text-neutral-400 mb-4 line-clamp-2">Latest: {detail.latest_title}</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
            <HeaderStat label="Markets" value={detail.market_count.toString()} />
            <HeaderStat label="Words resolved" value={detail.resolved_word_count.toString()} />
            <HeaderStat label="Last resolved" value={formatRelative(detail.last_resolved_at)} />
          </div>
        </div>
      </div>
    </div>
  )
}

function HeaderStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-0.5">{label}</div>
      <div className="text-base md:text-lg font-semibold text-white">{value}</div>
      {sub && <div className="text-[10px] text-neutral-500">{sub}</div>}
    </div>
  )
}

function HighlightCard({ accent, label, word, primary, sub }: { accent: 'green' | 'red' | 'neutral'; label: string; word: string; primary: string; sub: string }) {
  const accentClasses = {
    green: { bg: 'rgba(52,199,89,0.08)', border: 'rgba(52,199,89,0.3)', text: 'text-apple-green' },
    red:   { bg: 'rgba(255,59,48,0.08)', border: 'rgba(255,59,48,0.3)', text: 'text-apple-red' },
    neutral: { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.1)', text: 'text-white' },
  }[accent]
  return (
    <div className="rounded-2xl p-4" style={{ background: accentClasses.bg, border: `1px solid ${accentClasses.border}` }}>
      <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1">{label}</div>
      <div className="text-lg font-semibold text-white mb-1 truncate">{word}</div>
      <div className={`text-sm font-semibold ${accentClasses.text}`}>{primary}</div>
      <div className="text-[11px] text-neutral-400 mt-1">{sub}</div>
    </div>
  )
}

function YesRateBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100)
  const color = rate >= 0.6 ? 'bg-apple-green' : rate <= 0.4 ? 'bg-apple-red' : 'bg-neutral-400'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden min-w-[60px]">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-mono text-xs w-9 text-right ${rate >= 0.6 ? 'text-apple-green' : rate <= 0.4 ? 'text-apple-red' : 'text-neutral-300'}`}>{pct}%</span>
    </div>
  )
}

function WordRow({ stat, totalMarkets }: { stat: SeriesWordStat; totalMarkets: number }) {
  return (
    <tr className="border-b border-white/5 hover:bg-white/[0.03]">
      <td className="px-4 py-3 font-semibold text-white max-w-[220px] truncate">{stat.word}</td>
      <td className="px-4 py-3 min-w-[140px]"><YesRateBar rate={stat.yes_rate} /></td>
      <td className="px-4 py-3 text-right text-xs">
        <span className="font-mono text-neutral-300">{stat.appearances}</span>
        <span className="text-neutral-600">/</span>
        <span className="font-mono text-neutral-500">{totalMarkets}</span>
      </td>
      <td className="px-4 py-3 text-right font-mono text-xs text-neutral-300">{formatPrice(stat.avg_close_yes_price)}</td>
    </tr>
  )
}

function WordCardMobile({ stat, totalMarkets }: { stat: SeriesWordStat; totalMarkets: number }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'rgba(10,10,10,0.75)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="font-semibold text-white truncate">{stat.word}</span>
        <span className="text-[10px] text-neutral-500 tabular-nums whitespace-nowrap">{stat.appearances}/{totalMarkets} markets</span>
      </div>
      <div className="mb-2"><YesRateBar rate={stat.yes_rate} /></div>
      <div className="flex items-center gap-3 text-[11px] text-neutral-500">
        <span>Avg close <span className="text-neutral-300 font-mono">{formatPrice(stat.avg_close_yes_price)}</span></span>
      </div>
    </div>
  )
}

function MarketRow({ market, expanded, onToggle }: { market: SeriesMarketSummary; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="border-b border-white/5 last:border-b-0">
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 hover:bg-white/[0.03] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">
            <svg className={`w-3 h-3 text-neutral-500 transition-transform ${expanded ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white truncate">{market.title}</div>
            <div className="text-[11px] text-neutral-500 mt-0.5">{formatDate(market.resolved_at)} · {formatRelative(market.resolved_at)}</div>
          </div>
          <div className="hidden sm:flex items-center gap-3 text-[11px] text-neutral-400 whitespace-nowrap">
            <span><span className="text-apple-green font-semibold">{market.yes_words}Y</span> · <span className="text-apple-red font-semibold">{market.no_words}N</span></span>
          </div>
        </div>
      </button>
      {expanded && (
        <div className="bg-white/[0.02] border-t border-white/5 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wide text-neutral-500">Resolved words ({market.words.length})</span>
            <Link
              href={`/free/${market.slug}`}
              className="text-[11px] text-neutral-400 hover:text-white transition-colors"
            >
              Open market →
            </Link>
          </div>
          {market.words.length === 0 ? (
            <div className="text-xs text-neutral-500 py-2">No resolved words.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
              {market.words.map(w => (
                <div key={w.word_id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/5">
                  {w.outcome === 'YES' ? (
                    <span className="inline-flex px-2 py-0.5 rounded-full bg-apple-green/15 text-apple-green text-[10px] font-bold">YES</span>
                  ) : (
                    <span className="inline-flex px-2 py-0.5 rounded-full bg-apple-red/15 text-apple-red text-[10px] font-bold">NO</span>
                  )}
                  <span className="flex-1 text-xs text-white truncate">{w.word}</span>
                  <span className="font-mono text-[11px] text-neutral-400">{formatPrice(w.close_yes_price)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LoadingBlock() {
  return (
    <div className="space-y-4">
      <div
        className="rounded-2xl h-40 relative overflow-hidden"
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
      <div
        className="rounded-2xl h-96 relative overflow-hidden"
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
    </div>
  )
}
