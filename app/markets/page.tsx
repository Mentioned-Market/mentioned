'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import CustomEventCard from '@/components/CustomEventCard'
import MentionedSpinner from '@/components/MentionedSpinner'
import { useWallet } from '@/contexts/WalletContext'

// ── Types ──────────────────────────────────────────────────────────────────

interface Pricing {
  buyYesPriceUsd: number
  sellYesPriceUsd: number
  volume: number
}

interface Market {
  marketId: string
  status: string
  result: string | null
  pricing: Pricing
  metadata: {
    title: string
    isTeamMarket: boolean
    rulesPrimary: string
  }
}

interface EventMetadata {
  title: string
  imageUrl: string
  closeTime: string
  slug: string
}

interface PolyEvent {
  eventId: string
  isActive: boolean
  isLive: boolean
  beginAt: string
  category: string
  subcategory: string
  metadata: EventMetadata
  markets: Market[]
  volumeUsd: string
}

interface CustomMarketSummary {
  id: number
  title: string
  description: string | null
  cover_image_url: string | null
  status: string
  lock_time: string | null
  slug: string
  is_featured: boolean
  market_type: string
  event_start_time: string | null
  word_count: number
  trader_count: number
  words_prices: { word_id: number; word: string; yes_price: number; no_price: number }[]
}

interface TopTrader {
  wallet: string
  username: string | null
  pfpEmoji: string | null
  weeklyPoints: number
}

interface TrendingWord {
  word: string
  market_title: string
  slug: string
  trade_count: number
}

interface SidebarData {
  topTraders: TopTrader[]
  trendingWords: TrendingWord[]
  weekStart: string
}

// ── Sidebar cache (persists across SPA navigations) ──────────────────────

const SIDEBAR_STALE_MS = 60 * 1000 // 1 minute
let sidebarCache: { data: SidebarData; prevData: SidebarData | null; fetchedAt: number } | null = null

// ── Helpers ────────────────────────────────────────────────────────────────

const SUBCATEGORY_LABELS: Record<string, string> = {
  lol: 'League of Legends',
  val: 'Valorant',
  cs: 'Counter-Strike',
  dota: 'Dota 2',
  rl: 'Rocket League',
  cod: 'Call of Duty',
}

function formatPrice(microUsd: number): string {
  return (microUsd / 1_000_000).toFixed(2)
}

function formatVolume(volumeUsd: string): string {
  const usd = Number(volumeUsd) / 1_000_000
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`
  return `$${usd.toFixed(0)}`
}

function formatCloseTime(isoTime: string): string {
  const d = new Date(isoTime)
  const diff = d.getTime() - Date.now()
  if (diff <= 0) return 'Closed'
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }
  return `${hours}h ${minutes}m`
}

function truncateWallet(w: string) {
  return `${w.slice(0, 4)}...${w.slice(-4)}`
}

function getMsUntilNextMonday(): number {
  const now = new Date()
  const day = now.getUTCDay() // 0=Sun 1=Mon
  const daysUntilMonday = day === 0 ? 1 : 8 - day
  const nextMonday = new Date(now)
  nextMonday.setUTCDate(now.getUTCDate() + daysUntilMonday)
  nextMonday.setUTCHours(0, 0, 0, 0)
  return nextMonday.getTime() - now.getTime()
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0h 0m 0s'
  const totalSeconds = Math.floor(ms / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s`
  return `${hours}h ${minutes}m ${seconds}s`
}

// ── Subcomponents ──────────────────────────────────────────────────────────

const VISIBLE_COUNT = 5

function ScrollingWordList({ markets, eventId }: { markets: Market[]; eventId: string }) {
  const innerRef = useRef<HTMLDivElement>(null)
  const outerRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef(0)
  const needsScroll = markets.length > VISIBLE_COUNT

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

    pauseTimer = setTimeout(() => { paused = false; raf = requestAnimationFrame(step) }, 1500)
    return () => { cancelAnimationFrame(raf); clearTimeout(pauseTimer) }
  }, [needsScroll, markets])

  const fixedHeight = VISIBLE_COUNT * 30 + (VISIBLE_COUNT - 1) * 6

  return (
    <div ref={outerRef} className="overflow-hidden" style={{ height: needsScroll ? fixedHeight : undefined }}>
      <div ref={innerRef} className="flex flex-col gap-1.5">
        {markets.map(m => {
          const noPriceRaw = 1_000_000 - (m.pricing.buyYesPriceUsd ?? 0)
          return (
            <Link
              key={m.marketId}
              href={`/polymarkets/event/${eventId}?market=${encodeURIComponent(m.marketId)}`}
              className="flex items-center gap-2 h-[30px] px-2 rounded-lg glass hover:bg-white/10 transition-colors"
            >
              <span className="text-white text-xs font-medium truncate flex-1">{m.metadata.title}</span>
              <span className="text-apple-green text-[11px] font-semibold tabular-nums w-12 text-right">Y {formatPrice(m.pricing.buyYesPriceUsd)}</span>
              <span className="text-apple-red text-[11px] font-semibold tabular-nums w-12 text-right">N {formatPrice(noPriceRaw)}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function EventCard({ event }: { event: PolyEvent }) {
  const [imgError, setImgError] = useState(false)
  const teamMarkets = event.markets.filter(m => m.metadata.isTeamMarket)
  const hasTeams = teamMarkets.length === 2
  const team1 = hasTeams ? teamMarkets[0] : null
  const team2 = hasTeams ? teamMarkets[1] : null
  const team1Pct = team1 ? team1.pricing.buyYesPriceUsd / 10_000 : 50
  const team2Pct = team2 ? team2.pricing.buyYesPriceUsd / 10_000 : 50
  const eventUrl = `/polymarkets/event/${event.eventId}`

  return (
    <div className="group relative block overflow-hidden rounded-2xl glass transition-all duration-300 hover-lift">
      <Link href={eventUrl} className="block w-full relative overflow-hidden" style={{ height: '140px' }}>
        {!imgError ? (
          <Image
            src={event.metadata.imageUrl}
            alt={event.metadata.title}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, 33vw"
            className="object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full bg-neutral-800 flex items-center justify-center">
            <span className="text-neutral-500 text-2xl">🎮</span>
          </div>
        )}
        <div className="absolute top-3 left-3 flex items-center gap-2">
          {event.isLive && (
            <span className="px-2 py-0.5 rounded-full bg-apple-red/90 text-white text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm">Live</span>
          )}
          <span className="px-2 py-0.5 rounded-full bg-black/60 text-neutral-300 text-[10px] font-medium backdrop-blur-sm">
            {SUBCATEGORY_LABELS[event.subcategory] || event.subcategory}
          </span>
        </div>
      </Link>
      <div className="p-4 flex flex-col gap-3">
        <Link href={eventUrl}>
          <h3 className="text-white text-sm font-semibold leading-tight line-clamp-2 h-[2.5rem] hover:text-neutral-200 transition-colors">
            {event.metadata.title}
          </h3>
        </Link>
        {hasTeams && team1 && team2 ? (
          <Link href={eventUrl} className="flex flex-col gap-2">
            <div className="flex w-full h-8 rounded-lg overflow-hidden">
              <div className="flex items-center justify-center bg-apple-blue/80 transition-all duration-500" style={{ width: `${team1Pct}%` }}>
                <span className="text-white text-[11px] font-bold truncate px-2">{team1Pct.toFixed(0)}%</span>
              </div>
              <div className="flex items-center justify-center bg-apple-red/80 transition-all duration-500" style={{ width: `${team2Pct}%` }}>
                <span className="text-white text-[11px] font-bold truncate px-2">{team2Pct.toFixed(0)}%</span>
              </div>
            </div>
            <div className="flex justify-between items-start gap-2">
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-white text-xs font-medium truncate">{team1.metadata.title}</span>
                <span className="text-apple-blue text-[11px] font-semibold">${formatPrice(team1.pricing.buyYesPriceUsd)}</span>
              </div>
              <div className="flex flex-col items-end min-w-0 flex-1">
                <span className="text-white text-xs font-medium truncate text-right">{team2.metadata.title}</span>
                <span className="text-apple-red text-[11px] font-semibold">${formatPrice(team2.pricing.buyYesPriceUsd)}</span>
              </div>
            </div>
          </Link>
        ) : (
          <ScrollingWordList markets={event.markets} eventId={event.eventId} />
        )}
        <Link href={eventUrl} className="flex items-center gap-2 pt-2 border-t border-white/5">
          <span className="px-2 py-0.5 rounded-full bg-white/5 text-neutral-400 text-[10px] font-medium">{formatVolume(event.volumeUsd)} vol</span>
          <span className="px-2 py-0.5 rounded-full bg-white/5 text-neutral-400 text-[10px] font-medium">{formatCloseTime(event.metadata.closeTime)}</span>
          <span className="px-2 py-0.5 rounded-full bg-white/5 text-neutral-400 text-[10px] font-medium">{event.markets.length} words</span>
        </Link>
      </div>
    </div>
  )
}

// Prize split tooltip — uses fixed positioning to escape backdrop-filter stacking contexts
function PrizeTooltip() {
  const [visible, setVisible] = useState(false)

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <span className="text-apple-green font-semibold underline decoration-dotted cursor-default">
        USDC prize pool
      </span>
      {visible && (
        <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 w-36 bg-neutral-900 border border-white/10 rounded-xl p-2.5 shadow-lg z-[9999] pointer-events-none">
          <p className="text-neutral-400 text-[10px] font-medium uppercase tracking-wide mb-1.5">Weekly prizes</p>
          <div className="flex justify-between text-[11px] mb-1"><span className="text-yellow-400">1st</span><span className="text-white font-semibold">$40</span></div>
          <div className="flex justify-between text-[11px] mb-1"><span className="text-neutral-300">2nd</span><span className="text-white font-semibold">$25</span></div>
          <div className="flex justify-between text-[11px] mb-1"><span className="text-orange-400">3rd</span><span className="text-white font-semibold">$18</span></div>
          <div className="flex justify-between text-[11px] mb-1"><span className="text-neutral-400">4th</span><span className="text-white font-semibold">$10</span></div>
          <div className="flex justify-between text-[11px]"><span className="text-neutral-400">5th</span><span className="text-white font-semibold">$7</span></div>
        </div>
      )}
    </span>
  )
}

// Points explainer banner — shown at top of free markets column
function PointsExplainerBanner() {
  const { connected, discordLinked, setShowConnectModal, publicKey } = useWallet()

  return (
    <div className="rounded-2xl border border-white/10 p-4 mb-4 relative z-10" style={{ background: '#0d0d0d' }}>
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full bg-[#F2B71F] animate-pulse" />
          <span className="text-neutral-400 text-xs font-medium uppercase tracking-wide">Weekly Competition</span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-1">
          <h2 className="text-xl font-bold leading-tight">
            <span className="text-white">Earn </span>
            <span className="text-[#F2B71F]">Points</span>
            <span className="text-white">, Win </span>
            <span className="text-apple-green">Prizes.</span>
          </h2>
          <Link
            href="/points"
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#F2B71F]/15 text-[#F2B71F] text-xs font-semibold hover:bg-[#F2B71F]/25 transition-colors whitespace-nowrap"
          >
            How to earn
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
        <p className="text-neutral-500 text-[11px] mt-2">
          Get <Link href="/points" className="text-[#F2B71F] font-semibold hover:underline">500 tokens</Link> to use per free market.{' '}
          {!connected ? (
            <>
              <button
                onClick={() => setShowConnectModal(true)}
                className="text-[#F2B71F] font-semibold hover:underline"
              >
                Log in
              </button>
              {' and '}
              <button
                onClick={() => setShowConnectModal(true)}
                className="text-[#5865F2] font-semibold hover:underline"
              >
                link Discord
              </button>
              {' to earn points.'}
            </>
          ) : !discordLinked ? (
            <>
              <Link
                href={`/profile/${publicKey}`}
                className="text-[#5865F2] font-semibold hover:underline"
              >
                Link Discord
              </Link>
              {' to earn points.'}
            </>
          ) : (
            <>
              Trade to earn <span className="text-[#F2B71F] font-semibold">points</span>.
            </>
          )}
          {' '}Top traders share the <PrizeTooltip />.
        </p>
      </div>
    </div>
  )
}

// Featured market — large hero card for one free market
function FeaturedMarket({ market }: { market: CustomMarketSummary }) {
  const [imgError, setImgError] = useState(false)
  const url = `/free/${market.slug}`
  const lockPassed = market.lock_time ? new Date(market.lock_time) <= new Date() : false
  const isLive = market.status === 'open' && !lockPassed && (
    market.market_type === 'continuous' ||
    (market.market_type === 'event' && market.event_start_time && new Date(market.event_start_time) <= new Date())
  )

  const topWords = market.words_prices.slice(0, 4)

  return (
    <Link href={url} className="group relative block overflow-hidden rounded-2xl glass transition-all duration-300 hover-lift mb-6">
      <div className="relative overflow-hidden" style={{ height: '220px' }}>
        {market.cover_image_url && !imgError ? (
          <img
            src={market.cover_image_url}
            alt={market.title}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-neutral-800 to-neutral-900 flex items-center justify-center">
            <span className="text-neutral-500 text-4xl">🎯</span>
          </div>
        )}
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

        {/* Badges */}
        <div className="absolute top-3 left-3 flex items-center gap-2">
          {market.status === 'open' && (
            <span className="px-2 py-0.5 rounded-full bg-[#F2B71F]/80 text-black text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm">Open</span>
          )}
          <span className="px-2 py-0.5 rounded-full bg-black/60 text-neutral-200 text-[10px] font-medium backdrop-blur-sm">Featured</span>
        </div>
        {isLive && (
          <div className="absolute top-3 right-3">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/70 text-apple-red text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-apple-red animate-pulse" />
              Live
            </span>
          </div>
        )}

        {/* Title overlaid at bottom of image */}
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <h2 className="text-white text-lg font-bold leading-snug line-clamp-2 drop-shadow">
            {market.title}
          </h2>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-neutral-300 text-xs">{market.trader_count} trader{market.trader_count !== 1 ? 's' : ''}</span>
            <span className="text-neutral-500 text-xs">·</span>
            <span className="text-neutral-300 text-xs">{market.word_count} words</span>
            {market.lock_time && market.status === 'open' && formatCloseTime(market.lock_time) !== 'Closed' && (
              <>
                <span className="text-neutral-500 text-xs">·</span>
                <span className="text-neutral-300 text-xs">Closes {formatCloseTime(market.lock_time)}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Word grid */}
      {topWords.length > 0 && (
        <div className="p-4 grid grid-cols-2 gap-2">
          {topWords.map(w => {
            const yesPct = Math.round(w.yes_price * 100)
            const noPct = 100 - yesPct
            return (
              <div key={w.word_id} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5">
                <span className="text-white text-xs font-medium truncate flex-1">{w.word}</span>
                <span className="text-apple-green text-[11px] font-semibold tabular-nums">{yesPct}c</span>
                <span className="text-neutral-600 text-[10px]">/</span>
                <span className="text-apple-red text-[11px] font-semibold tabular-nums">{noPct}c</span>
              </div>
            )
          })}
        </div>
      )}
    </Link>
  )
}

// ── Sidebar Widgets ────────────────────────────────────────────────────────

function WeekCycleBanner({ countdown }: { countdown: string }) {
  return (
    <div className="rounded-2xl glass p-4 mb-4" style={{ background: '#0d0d0d' }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-2 h-2 rounded-full bg-[#F2B71F] animate-pulse" />
        <span className="text-neutral-400 text-xs font-medium uppercase tracking-wide">Week Cycle</span>
      </div>
      <div className="flex items-center justify-between gap-2 mt-1">
        <p className="text-[#F2B71F] text-xl font-bold tabular-nums whitespace-nowrap">{countdown}</p>
        <Link
          href="/leaderboard"
          className="px-3 py-2 rounded-xl bg-[#F2B71F]/15 text-[#F2B71F] text-xs font-semibold hover:bg-[#F2B71F]/25 transition-colors whitespace-nowrap"
        >
          Leaderboard
        </Link>
      </div>
      <p className="text-neutral-500 text-[11px] mt-2">Resets every Monday. Top 5 share the prize pool.</p>
    </div>
  )
}

function TrendingWordsWidget({ words }: { words: TrendingWord[] }) {
  // Compute initial highlights from module-level cache (survives unmount)
  const [highlights] = useState<Map<string, number | 'new'>>(() => {
    const prev = sidebarCache?.prevData?.trendingWords
    if (!prev || prev.length === 0) return new Map()

    const oldRanks = new Map<string, number>()
    prev.forEach((w, i) => oldRanks.set(w.word, i))

    const changed = new Map<string, number | 'new'>()
    words.forEach((w, i) => {
      const oldRank = oldRanks.get(w.word)
      if (oldRank === undefined) {
        changed.set(w.word, 'new')
      } else if (oldRank !== i) {
        changed.set(w.word, oldRank - i)
      }
    })
    return changed
  })
  const [visible, setVisible] = useState(highlights.size > 0)

  // Auto-clear highlights after 2s
  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(() => setVisible(false), 2000)
    return () => clearTimeout(timer)
  }, [visible])

  if (words.length === 0) return null
  return (
    <div className="rounded-2xl glass overflow-hidden p-4 mb-4" style={{ background: '#0d0d0d' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-neutral-400 text-xs font-medium uppercase tracking-wide">Trending Words</span>
        <span className="text-neutral-600 text-[10px]">7d</span>
      </div>
      <div className="flex flex-col gap-2">
        {words.map((w, i) => {
          const shift = highlights.get(w.word)
          const show = visible && shift !== undefined

          return (
            <Link
              key={w.word}
              href={`/free/${w.slug}`}
              className="flex items-center gap-3 group rounded-lg px-1 -mx-1 transition-colors duration-700"
              style={{
                backgroundColor: show ? 'rgba(242, 183, 31, 0.08)' : 'transparent',
              }}
            >
              <span className="text-neutral-600 text-xs font-bold w-4 text-right tabular-nums shrink-0">#{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-semibold truncate group-hover:text-[#F2B71F] transition-colors">{w.word}</p>
                <p className="text-neutral-500 text-[10px] truncate">{w.market_title}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {show && (
                  <span className={`text-[10px] font-semibold tabular-nums ${
                    shift === 'new' ? 'text-[#F2B71F]'
                      : (shift as number) > 0 ? 'text-emerald-400'
                      : 'text-red-400'
                  }`}>
                    {shift === 'new' ? 'NEW' : (shift as number) > 0 ? `▲${shift}` : `▼${Math.abs(shift as number)}`}
                  </span>
                )}
                <span className="text-neutral-400 text-[10px] tabular-nums">{w.trade_count} trades</span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function TopTradersWidget({ traders, grow }: { traders: TopTrader[]; grow?: boolean }) {
  const [highlights] = useState<Map<string, number | 'new'>>(() => {
    const prev = sidebarCache?.prevData?.topTraders
    if (!prev || prev.length === 0) return new Map()

    const oldRanks = new Map<string, number>()
    prev.forEach((t, i) => oldRanks.set(t.wallet, i))

    const changed = new Map<string, number | 'new'>()
    traders.forEach((t, i) => {
      const oldRank = oldRanks.get(t.wallet)
      if (oldRank === undefined) {
        changed.set(t.wallet, 'new')
      } else if (oldRank !== i) {
        changed.set(t.wallet, oldRank - i)
      }
    })
    return changed
  })
  const [visible, setVisible] = useState(highlights.size > 0)

  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(() => setVisible(false), 2000)
    return () => clearTimeout(timer)
  }, [visible])

  if (traders.length === 0) return null
  const medalColors = ['text-yellow-400', 'text-neutral-300', 'text-orange-400', 'text-neutral-500', 'text-neutral-500']
  const medals = ['🥇', '🥈', '🥉', null, null]

  return (
    <div className={`rounded-2xl glass p-4 ${grow ? 'flex-1' : 'mb-4'}`} style={{ background: '#0d0d0d' }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-neutral-400 text-xs font-medium uppercase tracking-wide">Top Traders</span>
        <Link href="/leaderboard" className="text-[#F2B71F] text-[10px] font-medium hover:underline">
          Full rankings
        </Link>
      </div>
      <div className="flex flex-col gap-3">
        {traders.map((t, i) => {
          const shift = highlights.get(t.wallet)
          const show = visible && shift !== undefined

          return (
            <Link
              key={t.wallet}
              href={`/profile/${t.username ?? t.wallet}`}
              className="flex items-center gap-3 group rounded-lg px-1 -mx-1 transition-colors duration-700"
              style={{
                backgroundColor: show ? 'rgba(242, 183, 31, 0.08)' : 'transparent',
              }}
            >
              <span className="text-sm w-5 text-center shrink-0">
                {medals[i] ?? <span className={`text-xs font-bold tabular-nums ${medalColors[i]}`}>{i + 1}</span>}
              </span>
              <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-sm shrink-0">
                {t.pfpEmoji ?? '👤'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-semibold truncate group-hover:text-[#F2B71F] transition-colors">
                  {t.username ? `@${t.username}` : truncateWallet(t.wallet)}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {show && (
                  <span className={`text-[10px] font-semibold tabular-nums ${
                    shift === 'new' ? 'text-[#F2B71F]'
                      : (shift as number) > 0 ? 'text-emerald-400'
                      : 'text-red-400'
                  }`}>
                    {shift === 'new' ? 'NEW' : (shift as number) > 0 ? `▲${shift}` : `▼${Math.abs(shift as number)}`}
                  </span>
                )}
                <span className="text-[#F2B71F] text-xs font-bold tabular-nums">
                  +{t.weeklyPoints.toLocaleString()} pts
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// ── Animated background blobs ──────────────────────────────────────────────

function AnimatedBackground() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes mkt-blob1 {
          0%   { transform: translate(0px, 0px); }
          25%  { transform: translate(320px, -120px); }
          50%  { transform: translate(220px, 260px); }
          75%  { transform: translate(-160px, 180px); }
          100% { transform: translate(0px, 0px); }
        }
        @keyframes mkt-blob2 {
          0%   { transform: translate(0px, 0px); }
          25%  { transform: translate(-240px, 160px); }
          50%  { transform: translate(-120px, -200px); }
          75%  { transform: translate(200px, -120px); }
          100% { transform: translate(0px, 0px); }
        }
        @keyframes mkt-blob3 {
          0%   { transform: translate(0px, 0px); }
          33%  { transform: translate(200px, -220px); }
          66%  { transform: translate(-220px, -100px); }
          100% { transform: translate(0px, 0px); }
        }
        #mkt-blob1 { animation: mkt-blob1 20s ease-in-out infinite; }
        #mkt-blob2 { animation: mkt-blob2 25s ease-in-out infinite; }
        #mkt-blob3 { animation: mkt-blob3 18s ease-in-out infinite; }
      `}} />
      <div aria-hidden="true" style={{ position: 'fixed', top: 40, left: 0, right: 0, bottom: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
        <div id="mkt-blob1" style={{ position: 'absolute', top: '-10%', left: '-10%', width: '45%', height: '50%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(242,183,31,0.20) 0%, rgba(242,183,31,0.06) 60%, transparent 100%)', filter: 'blur(40px)' }} />
        <div id="mkt-blob2" style={{ position: 'absolute', top: '20%', right: '-10%', width: '40%', height: '45%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(242,183,31,0.18) 0%, rgba(242,183,31,0.05) 60%, transparent 100%)', filter: 'blur(40px)' }} />
        <div id="mkt-blob3" style={{ position: 'absolute', bottom: '5%', left: '-5%', width: '30%', height: '35%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(242,183,31,0.12) 0%, rgba(242,183,31,0.03) 60%, transparent 100%)', filter: 'blur(35px)' }} />
      </div>
    </>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function MarketsPage() {
  const [events, setEvents] = useState<PolyEvent[]>([])
  const [customMarkets, setCustomMarkets] = useState<CustomMarketSummary[]>([])
  const [sidebarData, setSidebarData] = useState<SidebarData | null>(null)
  const [sidebarLoading, setSidebarLoading] = useState(true)
  const [polyLoading, setPolyLoading] = useState(false)
  const [customLoading, setCustomLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState('')
  const [paidOpen, setPaidOpen] = useState(false)
  const polyFetchedRef = useRef(false)

  // Live countdown
  useEffect(() => {
    const tick = () => setCountdown(formatCountdown(getMsUntilNextMonday()))
    tick()
    const id = setInterval(tick, 1_000)
    return () => clearInterval(id)
  }, [])

  // Fetch free markets
  useEffect(() => {
    let cancelled = false
    fetch('/api/custom')
      .then(res => res.ok ? res.json() : { markets: [] })
      .then(data => { if (!cancelled) setCustomMarkets(data.markets || []) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setCustomLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Fetch sidebar data (use cached if < 1 min old, preserve previous for animations)
  useEffect(() => {
    if (sidebarCache && Date.now() - sidebarCache.fetchedAt < SIDEBAR_STALE_MS) {
      setSidebarData(sidebarCache.data)
      setSidebarLoading(false)
      return
    }
    const prevData = sidebarCache?.data ?? null
    fetch('/api/markets/sidebar')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) {
          sidebarCache = { data, prevData, fetchedAt: Date.now() }
          setSidebarData(data)
        }
      })
      .catch(() => {})
      .finally(() => setSidebarLoading(false))
  }, [])

  // Fetch paid markets only when the section is expanded
  useEffect(() => {
    if (!paidOpen || polyFetchedRef.current) return
    polyFetchedRef.current = true
    setPolyLoading(true)
    fetch('/api/polymarket?category=mentions')
      .then(res => { if (!res.ok) throw new Error('Failed to fetch events'); return res.json() })
      .then(data => setEvents(data.data || []))
      .catch(err => setError(err instanceof Error ? err.message : 'Something went wrong'))
      .finally(() => setPolyLoading(false))
  }, [paidOpen])

  const activeEvents = events.filter(e => e.isActive)
  const liveEvents = activeEvents.filter(e => e.isLive)
  const upcomingEvents = activeEvents.filter(e => !e.isLive)

  const pageReady = !customLoading && !sidebarLoading
  const featuredMarket = customMarkets.find(m => m.is_featured) ?? null
  const remainingMarkets = customMarkets.filter(m => featuredMarket ? m.id !== featuredMarket.id : true)

  return (
    <>
    <AnimatedBackground />
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden">
      <div className="layout-container flex h-full grow flex-col" style={{ position: 'relative', zIndex: 1 }}>
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
            <Header />
            <main className="flex-1 pt-6 pb-4">

              {!pageReady ? (
                <div className="flex items-center justify-center py-32">
                  <MentionedSpinner />
                </div>
              ) : (
                <div className="animate-fade-up">
                  {/* Free markets + sidebar — two columns */}
                  <div className="flex gap-6 items-stretch mb-8">

                    {/* Free markets */}
                    <div className="flex-1 min-w-0">
                      <PointsExplainerBanner />
                      {featuredMarket && (
                        <div style={{ background: '#000', borderRadius: '1rem' }}>
                          <FeaturedMarket market={featuredMarket} />
                        </div>
                      )}
                      {remainingMarkets.filter(m => m.status !== 'resolved').length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                          {remainingMarkets
                            .filter(m => m.status !== 'resolved')
                            .map(market => (
                              <div key={`custom-${market.id}`} style={{ background: '#000', borderRadius: '1rem' }}>
                                <CustomEventCard market={market} />
                              </div>
                            ))}
                        </div>
                      )}
                      {customMarkets.filter(m => m.status !== 'resolved').length === 0 && (
                        <p className="text-neutral-500 text-sm py-4">No free markets available right now</p>
                      )}
                    </div>

                    {/* Sidebar */}
                    <aside className="hidden lg:flex lg:flex-col w-72 shrink-0">
                      <WeekCycleBanner countdown={countdown} />
                      {sidebarData && (
                        <>
                          <TrendingWordsWidget words={sidebarData.trendingWords} />
                          <TopTradersWidget traders={sidebarData.topTraders} grow />
                        </>
                      )}
                    </aside>
                  </div>
                </div>
              )}

              {/* Paid Markets — collapsible, loads on expand */}
              {pageReady && <section className="border-t border-white/10 pt-6 mt-2">
                <button
                  onClick={() => setPaidOpen(o => !o)}
                  className="flex items-center gap-3 w-full text-left mb-4 group"
                >
                  <span className="px-2 py-0.5 rounded-full bg-apple-blue/20 text-apple-blue text-[10px] font-bold uppercase">Paid</span>
                  <h2 className="text-white text-lg font-semibold flex-1">Paid Prediction Markets</h2>
                  <svg
                    width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    className={`text-neutral-400 group-hover:text-white transition-all duration-200 ${paidOpen ? 'rotate-180' : ''}`}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {paidOpen && (
                  polyLoading ? (
                    <MentionedSpinner />
                  ) : error ? (
                    <div className="flex flex-col items-start gap-2 py-4">
                      <p className="text-apple-red text-sm font-medium">Failed to load paid markets</p>
                      <button
                        onClick={() => {
                          polyFetchedRef.current = false
                          setError(null)
                          setPolyLoading(true)
                          fetch('/api/polymarket?category=mentions')
                            .then(res => { if (!res.ok) throw new Error('Failed'); return res.json() })
                            .then(data => setEvents(data.data || []))
                            .catch(err => setError(err instanceof Error ? err.message : 'Something went wrong'))
                            .finally(() => setPolyLoading(false))
                        }}
                        className="px-4 py-2 glass rounded-lg text-white text-sm font-medium hover:bg-white/10 transition-colors"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <>
                      {liveEvents.length > 0 && (
                        <div className="mb-6">
                          <div className="flex items-center gap-2 mb-4">
                            <div className="w-2 h-2 rounded-full bg-apple-red animate-pulse" />
                            <h3 className="text-white text-base font-semibold">Live Now</h3>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {liveEvents.map(event => <EventCard key={event.eventId} event={event} />)}
                          </div>
                        </div>
                      )}
                      {upcomingEvents.length > 0 && (
                        <div>
                          {liveEvents.length > 0 && <h3 className="text-white text-base font-semibold mb-4">Upcoming</h3>}
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {upcomingEvents.map(event => <EventCard key={event.eventId} event={event} />)}
                          </div>
                        </div>
                      )}
                      {activeEvents.length === 0 && !polyLoading && (
                        <p className="text-neutral-500 text-sm py-4">No paid markets available right now</p>
                      )}
                    </>
                  )
                )}
              </section>}

              {/* Mobile sidebar widgets — stacked below main content */}
              {pageReady && (
                <div className="lg:hidden mt-8 space-y-4">
                  <WeekCycleBanner countdown={countdown} />
                  {sidebarData && (
                    <>
                      <TrendingWordsWidget words={sidebarData.trendingWords} />
                      <TopTradersWidget traders={sidebarData.topTraders} />
                    </>
                  )}
                </div>
              )}

            </main>
            <Footer />
          </div>
        </div>
      </div>
    </div>
    </>
  )
}
