'use client'

// Solo prizes paused during Arena competition (May 4 – May 18 2026 BST)
const ARENA_START = new Date('2026-05-03T23:00:00.000Z')
const ARENA_END   = new Date('2026-05-17T23:00:00.000Z')
function isArenaActive(): boolean {
  const now = new Date()
  return now >= ARENA_START && now < ARENA_END
}

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { useWallet } from '@/contexts/WalletContext'
import InfoTooltip from '@/components/InfoTooltip'
import MentionedSpinner from '@/components/MentionedSpinner'

// ── Types ──────────────────────────────────────────────────

interface PointsEntry {
  wallet: string
  username: string | null
  pfpEmoji: string | null
  weeklyPoints: number
  allTimePoints: number
  breakdown: { trades: number; wins: number; chats: number; holds: number }
}

// ── Helpers ────────────────────────────────────────────────

function getMsUntilNextMonday(): number {
  const now = new Date()
  const day = now.getUTCDay()
  const daysUntilMonday = day === 0 ? 1 : 8 - day
  const next = new Date(now)
  next.setUTCDate(now.getUTCDate() + daysUntilMonday)
  next.setUTCHours(0, 0, 0, 0)
  return next.getTime() - now.getTime()
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m`
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
}

function truncateWallet(w: string) {
  return `${w.slice(0, 4)}...${w.slice(-4)}`
}

function formatWeekRange(iso: string) {
  const start = new Date(iso)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)
  const o: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${start.toLocaleDateString(undefined, o)} – ${end.toLocaleDateString(undefined, o)}`
}

type PointsSortKey = 'this' | 'last' | 'alltime'

const TABS: ReadonlyArray<readonly [PointsSortKey, string]> = [
  ['this', 'This Week'],
  ['last', 'Last Week'],
  ['alltime', 'All Time'],
] as const

// ── Accent palette per rank ────────────────────────────────

const ACCENTS = {
  1: { color: '#F2B71F', ring: 'rgba(242,183,31,0.5)',  glow: 'rgba(242,183,31,0.18)', bg: 'rgba(242,183,31,0.06)',  label: '1st', medal: '🥇' },
  2: { color: '#9ba8b5', ring: 'rgba(155,168,181,0.4)', glow: 'rgba(155,168,181,0.12)', bg: 'rgba(155,168,181,0.04)', label: '2nd', medal: '🥈' },
  3: { color: '#c07b3a', ring: 'rgba(192,123,58,0.4)',  glow: 'rgba(192,123,58,0.12)', bg: 'rgba(192,123,58,0.04)',  label: '3rd', medal: '🥉' },
  4: { color: '#6b7280', ring: 'rgba(107,114,128,0.3)', glow: 'rgba(107,114,128,0.08)', bg: 'rgba(107,114,128,0.03)', label: '4th', medal: null },
  5: { color: '#6b7280', ring: 'rgba(107,114,128,0.3)', glow: 'rgba(107,114,128,0.08)', bg: 'rgba(107,114,128,0.03)', label: '5th', medal: null },
} as const

const PRIZES = [
  { place: 1, amount: '$40', pct: '40%' },
  { place: 2, amount: '$25', pct: '25%' },
  { place: 3, amount: '$18', pct: '18%' },
  { place: 4, amount: '$10', pct: '10%' },
  { place: 5, amount: '$7',  pct: '7%'  },
]


// ── Animated background (same as markets page) ─────────────

function AnimatedBackground() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes lb-blob1 {
          0%   { transform: translate(0px, 0px); }
          25%  { transform: translate(300px, -100px); }
          50%  { transform: translate(200px, 240px); }
          75%  { transform: translate(-140px, 160px); }
          100% { transform: translate(0px, 0px); }
        }
        @keyframes lb-blob2 {
          0%   { transform: translate(0px, 0px); }
          25%  { transform: translate(-220px, 140px); }
          50%  { transform: translate(-100px, -180px); }
          75%  { transform: translate(180px, -100px); }
          100% { transform: translate(0px, 0px); }
        }
        @keyframes lb-blob3 {
          0%   { transform: translate(0px, 0px); }
          33%  { transform: translate(180px, -200px); }
          66%  { transform: translate(-200px, -80px); }
          100% { transform: translate(0px, 0px); }
        }
        #lb-blob1 { animation: lb-blob1 22s ease-in-out infinite; }
        #lb-blob2 { animation: lb-blob2 28s ease-in-out infinite; }
        #lb-blob3 { animation: lb-blob3 20s ease-in-out infinite; }
      `}} />
      <div aria-hidden="true" style={{ position: 'fixed', top: 40, left: 0, right: 0, bottom: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
        <div id="lb-blob1" style={{ position: 'absolute', top: '-10%', left: '-10%', width: '45%', height: '50%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(242,183,31,0.18) 0%, rgba(242,183,31,0.05) 60%, transparent 100%)', filter: 'blur(40px)' }} />
        <div id="lb-blob2" style={{ position: 'absolute', top: '30%', right: '-10%', width: '40%', height: '45%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(242,183,31,0.14) 0%, rgba(242,183,31,0.04) 60%, transparent 100%)', filter: 'blur(40px)' }} />
        <div id="lb-blob3" style={{ position: 'absolute', bottom: '5%', left: '10%', width: '30%', height: '35%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(242,183,31,0.10) 0%, rgba(242,183,31,0.02) 60%, transparent 100%)', filter: 'blur(35px)' }} />
      </div>
    </>
  )
}

// ── Ranked row ─────────────────────────────────────────────

function RankedRow({
  rank,
  entry,
  sort,
  isYou,
  index,
  maxPts,
}: {
  rank: number
  entry: PointsEntry
  sort: PointsSortKey
  isYou: boolean
  index: number
  maxPts: number
}) {
  const pts = sort === 'alltime' ? entry.allTimePoints : entry.weeklyPoints
  const name = entry.username || truncateWallet(entry.wallet)
  const prize = PRIZES.find(p => p.place === rank)
  const a = ACCENTS[rank as keyof typeof ACCENTS]
  const isTop5 = rank <= 5
  const isTop3 = rank <= 3
  const barWidth = maxPts > 0 ? Math.max(2, (pts / maxPts) * 100) : 0

  return (
    <Link
      href={`/profile/${entry.username ?? entry.wallet}`}
      className="group flex items-center gap-3 px-4 py-3 rounded-xl transition-colors duration-150 hover:bg-white/[0.04]"
      style={{
        background: isYou ? 'rgba(242,183,31,0.04)' : isTop5 ? a.bg : index % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent',
        borderLeft: isYou ? '2px solid rgba(242,183,31,0.4)' : isTop5 ? `2px solid ${a.ring}` : '2px solid transparent',
      }}
    >
      {/* Rank */}
      {isTop3 ? (
        <span className="text-base font-black tabular-nums w-7 text-right flex-shrink-0" style={{ color: a.color }}>
          {rank}
        </span>
      ) : isTop5 ? (
        <span className="text-sm font-bold tabular-nums w-7 text-right flex-shrink-0" style={{ color: a.color }}>
          {rank}
        </span>
      ) : (
        <span className="text-xs text-neutral-600 tabular-nums w-7 text-right flex-shrink-0 font-medium">
          {rank}
        </span>
      )}

      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0"
        style={isTop5
          ? { background: a.bg, boxShadow: `0 0 0 1.5px ${a.ring}` }
          : { background: 'rgba(255,255,255,0.04)' }
        }
      >
        {entry.pfpEmoji ?? '⚪'}
      </div>

      {/* Name + bar */}
      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-semibold truncate leading-snug group-hover:text-[#F2B71F] transition-colors"
          style={{ color: isYou ? '#fb923c' : isTop5 ? 'white' : '#d4d4d4' }}
        >
          {name}
          {isYou && <span className="ml-1.5 text-[10px] text-neutral-600 font-normal">you</span>}
        </p>
        <div className="mt-1 h-[2px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <div
            className="h-full rounded-full"
            style={{
              width: `${barWidth}%`,
              background: isYou
                ? 'rgba(251,146,60,0.5)'
                : isTop5
                ? a.color
                : `rgba(242,183,31,${0.15 + (barWidth / 100) * 0.35})`,
              opacity: isTop5 ? 0.6 : 1,
            }}
          />
        </div>
      </div>

      {/* Points */}
      <span
        className="text-sm font-bold tabular-nums flex-shrink-0"
        style={{ color: isTop5 ? a.color : '#737373' }}
      >
        {pts.toLocaleString()}
      </span>

      {/* Prize — hidden during Arena */}
      {!isArenaActive() && (prize ? (
        <span className="text-xs font-semibold w-8 text-right flex-shrink-0" style={{ color: ACCENTS[rank as keyof typeof ACCENTS]?.color ?? '#6b7280' }}>
          {prize.amount}
        </span>
      ) : (
        <span className="w-8 flex-shrink-0" />
      ))}
    </Link>
  )
}

// ── User pinned row ────────────────────────────────────────

function UserPinnedRow({ entry, sort }: { entry: PointsEntry | null; sort: PointsSortKey }) {
  const pts = entry ? (sort === 'alltime' ? entry.allTimePoints : entry.weeklyPoints) : 0
  const name = entry?.username || (entry ? truncateWallet(entry.wallet) : null)
  const notRankedCopy = sort === 'last'
    ? 'not ranked last week'
    : sort === 'alltime'
      ? 'not ranked yet'
      : 'not ranked yet this week'

  return (
    <>
      <div className="flex items-center gap-2 py-2 px-4">
        <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <span className="text-neutral-700 text-[10px] tracking-widest">···</span>
        <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
      </div>
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-xl mx-0"
        style={{ background: 'rgba(242,183,31,0.04)', borderLeft: '2px solid rgba(242,183,31,0.3)' }}
      >
        <span className="text-xs text-neutral-700 w-7 text-right flex-shrink-0">—</span>
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0" style={{ background: 'rgba(255,255,255,0.04)' }}>
          {entry?.pfpEmoji ?? '⚪'}
        </div>
        <div className="flex-1 min-w-0">
          {entry ? (
            <Link href={`/profile/${entry.username ?? entry.wallet}`} className="text-sm font-semibold hover:underline truncate block" style={{ color: '#fb923c' }}>
              {name}
            </Link>
          ) : (
            <span className="text-sm font-semibold" style={{ color: '#fb923c' }}>You</span>
          )}
          <p className="text-[10px] text-neutral-700">{notRankedCopy}</p>
        </div>
        <span className="text-sm font-bold tabular-nums flex-shrink-0 text-neutral-600">
          {pts.toLocaleString()}
        </span>
        <span className="w-8 flex-shrink-0" />
      </div>
    </>
  )
}

// ── Prize pool sidebar card ────────────────────────────────

function PrizePoolCard({ weekStart, isPast }: { weekStart: string; isPast?: boolean }) {
  if (isArenaActive()) {
    return (
      <div className="rounded-2xl p-4" style={{ background: 'rgba(242,183,31,0.04)', border: '1px solid rgba(242,183,31,0.15)' }}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm">⚔️</span>
          <span className="text-xs font-medium uppercase tracking-wide" style={{ color: '#F2B71F' }}>Arena Active</span>
        </div>
        <p className="text-neutral-400 text-xs leading-relaxed mb-3">
          Solo prizes are paused May 4-17. All prizes this fortnight are going to the Arena. Prize pool TBD.
        </p>
        <Link
          href="/arena"
          className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl text-xs font-semibold transition-colors"
          style={{ background: 'rgba(242,183,31,0.12)', color: '#F2B71F', border: '1px solid rgba(242,183,31,0.2)' }}
        >
          View Arena
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </Link>
      </div>
    )
  }

  return (
    <div className="rounded-2xl p-4" style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">🏆</span>
        <span className="text-neutral-400 text-xs font-medium uppercase tracking-wide">
          {isPast ? 'Last Week\'s Prize Pool' : 'Weekly Prize Pool'}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {PRIZES.map(p => (
          <div key={p.place} className="flex items-center gap-3">
            <div
              className="w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-black flex-shrink-0"
              style={{ background: ACCENTS[p.place as keyof typeof ACCENTS].bg, color: ACCENTS[p.place as keyof typeof ACCENTS].color }}
            >
              {p.place}
            </div>
            <div className="flex-1">
              <div className="flex justify-between items-center mb-0.5">
                <span className="text-xs text-neutral-500">{p.pct}</span>
                <span className="text-sm font-bold" style={{ color: ACCENTS[p.place as keyof typeof ACCENTS].color }}>{p.amount}</span>
              </div>
              <div className="h-[2px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: p.pct, background: ACCENTS[p.place as keyof typeof ACCENTS].color, opacity: 0.5 }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      {weekStart && (
        <p className="text-[10px] text-neutral-700 mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          Week of {formatWeekRange(weekStart)}
        </p>
      )}
    </div>
  )
}

// ── How to earn sidebar card ───────────────────────────────

function HowToEarnCard() {
  return (
    <div className="rounded-2xl p-4" style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">⭐</span>
        <span className="text-neutral-400 text-xs font-medium uppercase tracking-wide">How to earn</span>
      </div>
      <div className="flex flex-col gap-2.5">
        <div className="flex items-start gap-2.5">
          <span className="text-sm w-5 flex-shrink-0 text-center mt-0.5">🎯</span>
          <div className="flex-1">
            <p className="text-xs text-neutral-300">Win a trade</p>
            <p className="text-[11px] text-neutral-600 leading-snug">Points for every trade placed &amp; won</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-sm w-5 flex-shrink-0 text-center">💬</span>
          <span className="text-xs text-neutral-500 flex-1">Chat message</span>
          <span className="text-xs font-bold" style={{ color: '#F2B71F' }}>+2</span>
        </div>
      </div>

      {/* Achievements callout */}
      <div className="mt-3 pt-3 rounded-xl px-3 py-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(242,183,31,0.04)', border: '1px solid rgba(242,183,31,0.12)' }}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm">🏅</span>
          <span className="text-xs font-semibold" style={{ color: '#F2B71F' }}>Achievements</span>
        </div>
        <p className="text-[11px] text-neutral-500 leading-relaxed">
          Unlock weekly achievements to earn bonus points. Each achievement awards a different amount.
        </p>
      </div>

      <Link
        href="/points"
        className="mt-3 block w-full text-center text-xs font-semibold py-2 rounded-xl transition-colors hover:opacity-90"
        style={{ background: 'rgba(242,183,31,0.1)', color: '#F2B71F', border: '1px solid rgba(242,183,31,0.2)' }}
      >
        Learn more
      </Link>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────

export default function LeaderboardPage() {
  const { publicKey } = useWallet()
  const [entries, setEntries] = useState<PointsEntry[]>([])
  const [weekStart, setWeekStart] = useState('')
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<PointsSortKey>('this')
  const [countdown, setCountdown] = useState('')
  const [userEntry, setUserEntry] = useState<PointsEntry | null>(null)

  useEffect(() => {
    const tick = () => setCountdown(formatCountdown(getMsUntilNextMonday()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let live = true
    setLoading(true)
    const params = new URLSearchParams()
    if (sort === 'alltime') {
      params.set('sort', 'alltime')
    } else {
      params.set('sort', 'weekly')
      params.set('week', sort === 'last' ? 'last' : 'current')
    }
    if (publicKey) params.set('wallet', publicKey)
    fetch(`/api/polymarket/leaderboard/points?${params}`)
      .then(r => r.json())
      .then(j => {
        if (!live) return
        setEntries(j.data ?? [])
        setUserEntry(j.userEntry ?? null)
        setWeekStart(j.weekStart ?? '')
      })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [sort, publicKey])

  const maxPts = entries.length > 0
    ? (sort === 'alltime' ? entries[0].allTimePoints : entries[0].weeklyPoints)
    : 0
  const youInTop = publicKey ? entries.some(e => e.wallet === publicKey) : false
  const showCountdown = sort !== 'last'
  const emptyCopy = sort === 'last'
    ? 'No points were earned last week'
    : sort === 'alltime'
      ? 'No points earned yet'
      : 'No points earned yet this week'

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden bg-black">
      <AnimatedBackground />

      <div className="relative z-10 layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex justify-center">
          <div className="w-full max-w-7xl"><Header /></div>
        </div>

        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="flex flex-col w-full max-w-6xl flex-1 py-10">

            {/* ── Page header ───────────────────────────── */}
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8 animate-fade-in" style={{ animationFillMode: 'both' }}>
              <div className="flex items-center gap-3">
                <div>
                  <h1 className="text-4xl md:text-5xl font-black tracking-tight" style={{ color: '#F2B71F' }}>
                    Leaderboard
                  </h1>
                  <p className="text-neutral-600 text-sm mt-1">Points leaderboard</p>
                  <div className="flex items-center gap-2 mt-2 px-3 py-1.5 rounded-xl w-fit" style={{ background: 'rgba(242,183,31,0.08)', border: '1px solid rgba(242,183,31,0.2)' }}>
                    <svg width="12" height="12" viewBox="0 0 20 20" fill="#F2B71F"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>
                    <span className="text-[11px] font-medium" style={{ color: '#F2B71F' }}>
                      May 4–17: solo prizes paused.{' '}
                      <Link href="/arena" className="underline hover:opacity-80">The Arena</Link>
                      {' '}is live. Prize pool TBD.
                    </span>
                  </div>
                </div>
                {/* InfoTooltip hidden during Arena comp (May 4–17) — restore after */}
              </div>

              {/* Countdown pill (current/all-time) or "Week of …" pill (last week) */}
              <div
                className="flex items-center gap-3 px-4 py-2.5 rounded-2xl self-start sm:self-auto"
                style={{ background: 'rgba(242,183,31,0.06)', border: '1px solid rgba(242,183,31,0.15)' }}
                suppressHydrationWarning
              >
                <div className="flex flex-col items-start">
                  {showCountdown ? (
                    <>
                      <span className="text-[9px] text-neutral-600 uppercase tracking-widest leading-none mb-0.5">Resets in</span>
                      <span className="text-xl font-black tabular-nums leading-none" style={{ color: '#F2B71F' }} suppressHydrationWarning>
                        {countdown}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-[9px] text-neutral-600 uppercase tracking-widest leading-none mb-0.5">Week of</span>
                      <span className="text-xl font-black leading-none" style={{ color: '#F2B71F' }}>
                        {weekStart ? formatWeekRange(weekStart) : '—'}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* ── Two-column layout ──────────────────────── */}
            <div className="flex flex-col lg:flex-row gap-6 flex-1">

              {/* ── Main content ──────────────────────────── */}
              <div className="flex-1 min-w-0 animate-fade-in" style={{ animationDelay: '80ms', animationFillMode: 'both' }}>

                {/* Sort toggle */}
                <div className="flex items-center justify-between mb-5">
                  <span className="text-xs font-medium text-neutral-600 uppercase tracking-widest">Rankings</span>
                  <div className="flex items-center gap-0.5 p-0.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    {TABS.map(([k, lbl]) => (
                      <button
                        key={k}
                        onClick={() => setSort(k)}
                        className="px-2.5 sm:px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap"
                        style={sort === k
                          ? { background: 'rgba(242,183,31,0.15)', color: '#F2B71F', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }
                          : { color: '#6b7280' }
                        }
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Loading */}
                {loading && <MentionedSpinner className="py-20" />}

                {/* Empty */}
                {!loading && entries.length === 0 && (
                  <div className="flex flex-col items-center py-20 gap-3">
                    <p className="text-neutral-500 text-sm">{emptyCopy}</p>
                    {sort !== 'last' && (
                      <Link href="/markets" className="text-sm font-medium hover:underline" style={{ color: '#F2B71F' }}>
                        Start trading to earn points
                      </Link>
                    )}
                  </div>
                )}

                {/* All entries */}
                {!loading && entries.length > 0 && (
                  <div
                    className="rounded-2xl overflow-hidden"
                    style={{ background: 'rgba(255,255,255,0.012)', border: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    {/* Column labels */}
                    <div className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <span className="text-[10px] text-neutral-700 uppercase tracking-widest w-7 text-right flex-shrink-0">#</span>
                      <span className="w-8 flex-shrink-0" />
                      <span className="text-[10px] text-neutral-700 uppercase tracking-widest flex-1">Player</span>
                      <span className="text-[10px] text-neutral-700 uppercase tracking-widest flex-shrink-0">Points</span>
                      {!isArenaActive() && <span className="text-[10px] text-neutral-700 uppercase tracking-widest w-8 text-right flex-shrink-0">Prize</span>}
                    </div>

                    <div className="p-1">
                      {entries.map((e, i) => (
                        <RankedRow
                          key={e.wallet}
                          rank={i + 1}
                          entry={e}
                          sort={sort}
                          isYou={publicKey === e.wallet}
                          index={i}
                          maxPts={maxPts}
                        />
                      ))}

                      {/* Pinned user row */}
                      {publicKey && !youInTop && userEntry && (
                        <UserPinnedRow entry={userEntry} sort={sort} />
                      )}
                      {publicKey && !youInTop && !userEntry && (
                        <UserPinnedRow entry={null} sort={sort} />
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Sidebar ────────────────────────────────── */}
              <div className="w-full lg:w-72 flex-shrink-0 flex flex-col gap-4 animate-fade-in" style={{ animationDelay: '160ms', animationFillMode: 'both' }}>
                <PrizePoolCard weekStart={weekStart} isPast={sort === 'last'} />
                <HowToEarnCard />
              </div>
            </div>

            <div className="mt-16" />
            <Footer />
          </div>
        </div>
      </div>
    </div>
  )
}
