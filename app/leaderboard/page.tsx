'use client'

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
  if (d > 0) return `${d}d ${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m ${String(sec).padStart(2,'0')}s`
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

type PointsSortKey = 'weekly' | 'alltime'

// ── Accent palette per rank ────────────────────────────────

const ACCENTS = {
  1: { color: '#F2B71F', ring: 'rgba(242,183,31,0.5)',  glow: 'rgba(242,183,31,0.18)', bg: 'rgba(242,183,31,0.06)',  label: '1st' },
  2: { color: '#9ba8b5', ring: 'rgba(155,168,181,0.4)', glow: 'rgba(155,168,181,0.12)', bg: 'rgba(155,168,181,0.04)', label: '2nd' },
  3: { color: '#c07b3a', ring: 'rgba(192,123,58,0.4)',  glow: 'rgba(192,123,58,0.12)', bg: 'rgba(192,123,58,0.04)',  label: '3rd' },
} as const

const PRIZES = [
  { place: 1, amount: '$40' },
  { place: 2, amount: '$25' },
  { place: 3, amount: '$18' },
  { place: 4, amount: '$10' },
  { place: 5, amount: '$7'  },
]

// ── Avatar circle ─────────────────────────────────────────

function AvatarCircle({ emoji, rank, large = false }: { emoji?: string | null; rank: number; large?: boolean }) {
  const a = ACCENTS[rank as keyof typeof ACCENTS]
  const size = large ? 'w-[88px] h-[88px] text-5xl' : 'w-16 h-16 text-3xl'
  return (
    <div
      className={`${size} rounded-full flex items-center justify-center flex-shrink-0`}
      style={{
        background: a ? a.bg : 'rgba(255,255,255,0.04)',
        boxShadow: a
          ? `0 0 0 2.5px ${a.ring}, 0 0 28px ${a.glow}`
          : '0 0 0 1.5px rgba(255,255,255,0.08)',
      }}
    >
      {emoji ?? '⚪'}
    </div>
  )
}

// ── Podium ─────────────────────────────────────────────────

function Podium({ top3, sort, you }: { top3: PointsEntry[]; sort: PointsSortKey; you?: string | null }) {
  const slots = [
    { entry: top3[1], rank: 2, shift: 'mt-10' },
    { entry: top3[0], rank: 1, shift: 'mt-0'  },
    { entry: top3[2], rank: 3, shift: 'mt-16' },
  ]

  return (
    <div className="flex items-end justify-center gap-8 md:gap-16 py-6">
      {slots.map(({ entry, rank, shift }) => {
        if (!entry) return <div key={rank} className="w-32" />
        const a = ACCENTS[rank as keyof typeof ACCENTS]
        const pts = sort === 'weekly' ? entry.weeklyPoints : entry.allTimePoints
        const name = entry.username || truncateWallet(entry.wallet)
        const isYou = you === entry.wallet
        const isFirst = rank === 1

        return (
          <div key={rank} className={`flex flex-col items-center gap-2 ${shift}`}>
            {isFirst && (
              <span className="text-xl mb-0.5" style={{ filter: 'drop-shadow(0 2px 8px rgba(242,183,31,0.5))' }}>👑</span>
            )}
            <Link href={`/profile/${entry.username ?? entry.wallet}`}>
              <AvatarCircle emoji={entry.pfpEmoji} rank={rank} large={isFirst} />
            </Link>
            <div className="flex flex-col items-center gap-0.5 mt-1">
              <Link
                href={`/profile/${entry.username ?? entry.wallet}`}
                className="hover:underline font-semibold text-center leading-snug max-w-[120px] truncate"
                style={{ color: isYou ? '#fb923c' : 'white', fontSize: isFirst ? 15 : 13 }}
              >
                {name}
              </Link>
              <span className="text-[11px] font-medium" style={{ color: a.color }}>{a.label}</span>
            </div>
            <div className="text-center">
              <p className="font-bold tabular-nums leading-none" style={{ color: a.color, fontSize: isFirst ? 24 : 18 }}>
                {pts.toLocaleString()}
              </p>
              <p className="text-[9px] text-neutral-700 uppercase tracking-widest mt-0.5">pts</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────

export default function LeaderboardPage() {
  const { publicKey } = useWallet()
  const [entries, setEntries] = useState<PointsEntry[]>([])
  const [weekStart, setWeekStart] = useState('')
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<PointsSortKey>('weekly')
  const [countdown, setCountdown] = useState('')

  useEffect(() => {
    const tick = () => setCountdown(formatCountdown(getMsUntilNextMonday()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const [userEntry, setUserEntry] = useState<PointsEntry | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    const params = new URLSearchParams({ sort })
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

  const youInTop = publicKey ? entries.some(e => e.wallet === publicKey) : false

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden bg-black">
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex justify-center">
          <div className="w-full max-w-7xl"><Header /></div>
        </div>

        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="flex flex-col w-full max-w-6xl flex-1">
            <main className="py-10 space-y-0">

              {/* ── Header row ──────────────────────────────── */}
              <div
                className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-2 animate-fade-in"
                style={{ animationDelay: '0ms', animationFillMode: 'both' }}
              >
                <div className="flex items-center gap-2.5">
                  <h1 className="text-4xl md:text-5xl font-black tracking-tight" style={{ color: '#F2B71F' }}>
                    Leaderboard
                  </h1>
                  <InfoTooltip position="below">
                    <div className="space-y-2 text-[13px]">
                      <p>
                        <span className="text-[#F2B71F] font-semibold">Link your Discord</span> on your profile to earn points!
                        The <span className="text-white font-semibold">top 5</span> point earners each week win{' '}
                        <span className="text-[#F2B71F] font-semibold">real USDC</span>. Week ends{' '}
                        <span className="text-white font-semibold">Sunday night GMT</span>, winners notified via Discord.
                      </p>
                      <table className="w-full text-xs mt-1">
                        <thead><tr className="text-neutral-500">
                          <th className="text-left font-medium pb-1">Place</th>
                          <th className="text-right font-medium pb-1">Prize</th>
                          <th className="text-right font-medium pb-1">%</th>
                        </tr></thead>
                        <tbody className="text-neutral-200">
                          <tr><td className="py-0.5">1st</td><td className="text-right text-yellow-400 font-semibold">$40</td><td className="text-right">40%</td></tr>
                          <tr><td className="py-0.5">2nd</td><td className="text-right text-neutral-300 font-semibold">$25</td><td className="text-right">25%</td></tr>
                          <tr><td className="py-0.5">3rd</td><td className="text-right text-orange-400 font-semibold">$18</td><td className="text-right">18%</td></tr>
                          <tr><td className="py-0.5">4th</td><td className="text-right font-semibold">$10</td><td className="text-right">10%</td></tr>
                          <tr><td className="py-0.5">5th</td><td className="text-right font-semibold">$7</td><td className="text-right">7%</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </InfoTooltip>
                </div>

                {/* Countdown */}
                <div className="flex items-center gap-2" suppressHydrationWarning>
                  <span className="text-[11px] text-neutral-600 uppercase tracking-widest">Resets in</span>
                  <span className="text-2xl font-black tabular-nums" style={{ color: '#F2B71F' }} suppressHydrationWarning>
                    {countdown}
                  </span>
                </div>
              </div>

              {/* week label */}
              {weekStart && (
                <p
                  className="text-neutral-700 text-xs pb-2 animate-fade-in"
                  style={{ animationDelay: '60ms', animationFillMode: 'both' }}
                  suppressHydrationWarning
                >
                  {`Week of ${formatWeekRange(weekStart)}`}
                </p>
              )}

              {/* ── Sort + table ─────────────────────────────── */}
              <div
                className="pt-8 animate-fade-in"
                style={{ animationDelay: '120ms', animationFillMode: 'both' }}
              >
                {/* Sort toggle */}
                <div className="flex items-center justify-between mb-1 pb-3">
                  <span className="text-xs font-medium text-neutral-600 uppercase tracking-widest">All rankings</span>
                  <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-white/[0.05]">
                    {([['weekly','This Week'],['alltime','All Time']] as const).map(([k, lbl]) => (
                      <button
                        key={k}
                        onClick={() => setSort(k)}
                        className="px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-150"
                        style={sort === k
                          ? { background: 'rgba(242,183,31,0.15)', color: '#F2B71F' }
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
                    <p className="text-neutral-500 text-sm">No points earned yet this week</p>
                    <Link href="/markets" className="text-sm font-medium hover:underline" style={{ color: '#F2B71F' }}>
                      Start trading to earn points
                    </Link>
                  </div>
                )}

                {/* Table */}
                {!loading && entries.length > 0 && (
                  <div className="mt-1 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.012)' }}>
                    {/* Col headers */}
                    <div className="grid grid-cols-[64px_minmax(0,1fr)_90px_74px] md:grid-cols-[80px_minmax(0,1fr)_120px_90px] px-4 py-2.5 text-[10px] text-neutral-600 uppercase tracking-widest font-medium border-b border-white/[0.06]">
                      <div className="text-center">Rank</div>
                      <div>Player</div>
                      <div className="text-center">Points</div>
                      <div className="text-center">Prize</div>
                    </div>

                    {entries.map((e, i) => (
                      <Row key={e.wallet} rank={i + 1} entry={e} sort={sort} isYou={publicKey === e.wallet} index={i} />
                    ))}

                    {/* User outside top 100 — pinned at bottom without rank */}
                    {publicKey && userEntry && (
                      <UserPinnedRow entry={userEntry} sort={sort} />
                    )}

                    {/* User has no points at all */}
                    {publicKey && !youInTop && !userEntry && (
                      <UserPinnedRow entry={null} sort={sort} />
                    )}
                  </div>
                )}
              </div>

            </main>
            <Footer />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Table row ──────────────────────────────────────────────

function UserPinnedRow({ entry, sort }: { entry: PointsEntry | null; sort: PointsSortKey }) {
  const pts = entry
    ? sort === 'weekly' ? entry.weeklyPoints : entry.allTimePoints
    : 0
  const name = entry?.username || (entry ? truncateWallet(entry.wallet) : null)

  return (
    <>
      {/* Separator dots */}
      <div className="flex items-center justify-center py-2 border-b border-white/[0.04]">
        <span className="text-neutral-700 text-xs tracking-[0.3em]">...</span>
      </div>
      <div
        className="grid grid-cols-[64px_minmax(0,1fr)_90px_74px] md:grid-cols-[80px_minmax(0,1fr)_120px_90px] px-4 py-4 last:border-b-0 transition-colors duration-100"
        style={{ background: 'rgba(242,183,31,0.05)', borderLeft: '2px solid rgba(242,183,31,0.4)' }}
      >
        {/* No rank */}
        <div className="flex items-center justify-center">
          <span className="text-xs text-neutral-700">&mdash;</span>
        </div>

        {/* Player */}
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.04)' }}
          >
            {entry?.pfpEmoji ?? '⚪'}
          </div>
          <div className="min-w-0">
            {entry ? (
              <Link
                href={`/profile/${entry.username ?? entry.wallet}`}
                className="font-semibold text-sm hover:underline truncate block leading-snug"
                style={{ color: '#fb923c' }}
              >
                {name}
              </Link>
            ) : (
              <span className="font-semibold text-sm" style={{ color: '#fb923c' }}>You</span>
            )}
            <span className="text-[10px] text-neutral-700">you</span>
          </div>
        </div>

        {/* Points */}
        <div className="flex items-center justify-center">
          <span className="font-bold tabular-nums text-sm" style={{ color: pts > 0 ? '#737373' : '#525252' }}>
            {pts.toLocaleString()}
          </span>
        </div>

        {/* Prize */}
        <div className="flex items-center justify-center">
          <span className="text-neutral-800 text-sm">&mdash;</span>
        </div>
      </div>
    </>
  )
}

function Row({ rank, entry, sort, isYou, index = 0 }: { rank: number; entry: PointsEntry; sort: PointsSortKey; isYou: boolean; index?: number }) {
  const pts  = sort === 'weekly' ? entry.weeklyPoints : entry.allTimePoints
  const name = entry.username || truncateWallet(entry.wallet)
  const prize = PRIZES.find(p => p.place === rank)
  const a = ACCENTS[rank as keyof typeof ACCENTS]
  const isTop3 = rank <= 3
  const isEven = index % 2 === 0

  const prizeColors: Record<number, string> = { 1: '#F2B71F', 2: '#9ba8b5', 3: '#c07b3a', 4: '#6b7280', 5: '#6b7280' }

  let rowBg: string
  if (isYou) {
    rowBg = 'rgba(242,183,31,0.05)'
  } else if (isTop3) {
    rowBg = a.bg
  } else {
    rowBg = isEven ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.01)'
  }

  const leftBorder = isYou
    ? '2px solid rgba(242,183,31,0.4)'
    : isTop3
    ? `2px solid ${a.ring}`
    : '2px solid transparent'

  return (
    <div
      className="group grid grid-cols-[64px_minmax(0,1fr)_90px_74px] md:grid-cols-[80px_minmax(0,1fr)_120px_90px] px-4 py-4 border-b border-white/[0.04] last:border-b-0 transition-colors duration-100 hover:bg-white/[0.05]"
      style={{ background: rowBg, borderLeft: leftBorder }}
    >
      {/* Rank */}
      <div className="flex items-center justify-center">
        {isTop3 ? (
          <span className="text-lg font-black" style={{ color: a.color }}>{rank}</span>
        ) : (
          <span className="text-sm text-neutral-600 tabular-nums">{rank}</span>
        )}
      </div>

      {/* Player */}
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0"
          style={
            isTop3
              ? { boxShadow: `0 0 0 1.5px ${a.ring}`, background: a.bg }
              : { background: 'rgba(255,255,255,0.04)' }
          }
        >
          {entry.pfpEmoji ?? '⚪'}
        </div>
        <div className="min-w-0">
          <Link
            href={`/profile/${entry.username ?? entry.wallet}`}
            className="font-semibold text-sm hover:underline truncate block leading-snug"
            style={{ color: isYou ? '#fb923c' : isTop3 ? 'white' : '#d4d4d4' }}
          >
            {name}
          </Link>
          {isYou && <span className="text-[10px] text-neutral-700">you</span>}
        </div>
      </div>

      {/* Points */}
      <div className="flex items-center justify-center">
        <span
          className="font-bold tabular-nums"
          style={{ color: isTop3 ? a.color : '#737373', fontSize: isTop3 ? 15 : 14 }}
        >
          {pts.toLocaleString()}
        </span>
      </div>

      {/* Prize */}
      <div className="flex items-center justify-center">
        {prize ? (
          <span className="text-sm font-semibold" style={{ color: prizeColors[rank] ?? '#6b7280' }}>
            {prize.amount}
          </span>
        ) : (
          <span className="text-neutral-800 text-sm">—</span>
        )}
      </div>
    </div>
  )
}
