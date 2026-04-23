'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { useWallet } from '@/contexts/WalletContext'
import MentionedSpinner from '@/components/MentionedSpinner'

// ── Types ──────────────────────────────────────────────────

interface TeamLeaderboardEntry {
  team_id: number
  team_name: string
  team_slug: string
  member_count: number
  weekly_points: number
  all_time_points: number
}

interface MyTeam {
  id: number
  name: string
  slug: string
  join_code: string
  created_by: string
  role: string
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
  if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

type SortKey = 'weekly' | 'alltime'

const ACCENTS = {
  1: { color: '#F2B71F', ring: 'rgba(242,183,31,0.5)', bg: 'rgba(242,183,31,0.06)' },
  2: { color: '#9ba8b5', ring: 'rgba(155,168,181,0.4)', bg: 'rgba(155,168,181,0.04)' },
  3: { color: '#c07b3a', ring: 'rgba(192,123,58,0.4)', bg: 'rgba(192,123,58,0.04)' },
} as const

// ── Animated background ────────────────────────────────────

function AnimatedBackground() {
  return (
    <>
      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes tm-blob1 { 0%{transform:translate(0,0)} 25%{transform:translate(280px,-90px)} 50%{transform:translate(180px,220px)} 75%{transform:translate(-120px,150px)} 100%{transform:translate(0,0)} }
          @keyframes tm-blob2 { 0%{transform:translate(0,0)} 25%{transform:translate(-200px,130px)} 50%{transform:translate(-80px,-160px)} 75%{transform:translate(160px,-80px)} 100%{transform:translate(0,0)} }
          @keyframes tm-blob3 { 0%{transform:translate(0,0)} 33%{transform:translate(160px,-180px)} 66%{transform:translate(-180px,-60px)} 100%{transform:translate(0,0)} }
          #tm-blob1{animation:tm-blob1 22s ease-in-out infinite}
          #tm-blob2{animation:tm-blob2 28s ease-in-out infinite}
          #tm-blob3{animation:tm-blob3 20s ease-in-out infinite}
        `
      }} />
      <div aria-hidden="true" style={{ position: 'fixed', top: 40, left: 0, right: 0, bottom: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
        <div id="tm-blob1" style={{ position: 'absolute', top: '-10%', left: '-10%', width: '45%', height: '50%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(242,183,31,0.18) 0%, rgba(242,183,31,0.05) 60%, transparent 100%)', filter: 'blur(40px)' }} />
        <div id="tm-blob2" style={{ position: 'absolute', top: '30%', right: '-10%', width: '40%', height: '45%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(242,183,31,0.14) 0%, rgba(242,183,31,0.04) 60%, transparent 100%)', filter: 'blur(40px)' }} />
        <div id="tm-blob3" style={{ position: 'absolute', bottom: '5%', left: '10%', width: '30%', height: '35%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(242,183,31,0.10) 0%, rgba(242,183,31,0.02) 60%, transparent 100%)', filter: 'blur(35px)' }} />
      </div>
    </>
  )
}

// ── Team leaderboard row ───────────────────────────────────

function TeamRow({
  rank,
  entry,
  sort,
  isYourTeam,
  index,
  maxPts,
}: {
  rank: number
  entry: TeamLeaderboardEntry
  sort: SortKey
  isYourTeam: boolean
  index: number
  maxPts: number
}) {
  const pts = sort === 'weekly' ? entry.weekly_points : entry.all_time_points
  const a = ACCENTS[rank as keyof typeof ACCENTS]
  const isTop3 = rank <= 3
  const barWidth = maxPts > 0 ? Math.max(2, (pts / maxPts) * 100) : 0

  return (
    <Link
      href={`/teams/${entry.team_slug}`}
      className="group flex items-center gap-3 px-4 py-3 rounded-xl transition-colors duration-150 hover:bg-white/[0.04]"
      style={{
        background: isYourTeam ? 'rgba(242,183,31,0.04)' : isTop3 ? a.bg : index % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent',
        borderLeft: isYourTeam ? '2px solid rgba(242,183,31,0.4)' : isTop3 ? `2px solid ${a.ring}` : '2px solid transparent',
      }}
    >
      {/* Rank */}
      {isTop3 ? (
        <span className="text-base font-black tabular-nums w-7 text-right flex-shrink-0" style={{ color: a.color }}>{rank}</span>
      ) : (
        <span className="text-xs text-neutral-600 tabular-nums w-7 text-right flex-shrink-0 font-medium">{rank}</span>
      )}

      {/* Team icon */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0"
        style={isTop3
          ? { background: a.bg, boxShadow: `0 0 0 1.5px ${a.ring}` }
          : { background: 'rgba(255,255,255,0.04)' }
        }
      >
        🛡️
      </div>

      {/* Name + bar */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p
            className="text-sm font-semibold truncate leading-snug group-hover:text-[#F2B71F] transition-colors"
            style={{ color: isYourTeam ? '#fb923c' : isTop3 ? 'white' : '#d4d4d4' }}
          >
            {entry.team_name}
            {isYourTeam && <span className="ml-1.5 text-[10px] text-neutral-600 font-normal">your team</span>}
          </p>
          <span className="text-[10px] text-neutral-600 flex-shrink-0">{entry.member_count} {entry.member_count === 1 ? 'member' : 'members'}</span>
        </div>
        <div className="mt-1 h-[2px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <div
            className="h-full rounded-full"
            style={{
              width: `${barWidth}%`,
              background: isYourTeam
                ? 'rgba(251,146,60,0.5)'
                : isTop3
                ? a.color
                : `rgba(242,183,31,${0.15 + (barWidth / 100) * 0.35})`,
              opacity: isTop3 ? 0.6 : 1,
            }}
          />
        </div>
      </div>

      {/* Points */}
      <span
        className="text-sm font-bold tabular-nums flex-shrink-0"
        style={{ color: isTop3 ? a.color : '#737373' }}
      >
        {pts.toLocaleString()}
      </span>
    </Link>
  )
}

// ── Create Team modal ─────────────────────────────────────

function CreateTeamModal({
  onClose,
  onCreated,
  wallet,
}: {
  onClose: () => void
  onCreated: (team: MyTeam) => void
  wallet: string
}) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/teams/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), wallet }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to create team'); return }
      onCreated({ ...data.team, role: 'captain' })
    } catch {
      setError('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl p-6 animate-scale-in"
        style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.1)' }}
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-white mb-1">Create a team</h2>
        <p className="text-neutral-500 text-xs mb-5">Pick a name — you&apos;ll get a shareable join code to send to teammates.</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            placeholder="Team name"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={30}
            className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-600 outline-none focus:ring-1 focus:ring-[#F2B71F]/40"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
            autoFocus
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-neutral-500 hover:text-white transition-colors"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || name.trim().length < 2}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 disabled:opacity-40"
              style={{ background: 'rgba(242,183,31,0.15)', color: '#F2B71F', border: '1px solid rgba(242,183,31,0.25)' }}
            >
              {loading ? '...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Join Team modal ───────────────────────────────────────

function JoinTeamModal({
  onClose,
  onJoined,
  wallet,
}: {
  onClose: () => void
  onJoined: (team: MyTeam) => void
  wallet: string
}) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/teams/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), wallet }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to join team'); return }
      onJoined({ ...data.team, role: 'member' })
    } catch {
      setError('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl p-6 animate-scale-in"
        style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.1)' }}
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-white mb-1">Join a team</h2>
        <p className="text-neutral-500 text-xs mb-5">Enter the 6-character join code from your teammate.</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            placeholder="e.g. XK4J9M"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase().slice(0, 6))}
            maxLength={6}
            className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-600 outline-none focus:ring-1 focus:ring-[#F2B71F]/40 tracking-widest font-mono uppercase"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
            autoFocus
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-neutral-500 hover:text-white transition-colors"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || code.length < 6}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 disabled:opacity-40"
              style={{ background: 'rgba(242,183,31,0.15)', color: '#F2B71F', border: '1px solid rgba(242,183,31,0.25)' }}
            >
              {loading ? '...' : 'Join'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── My Team sidebar card ──────────────────────────────────

function MyTeamCard({
  team,
  onLeave,
}: {
  team: MyTeam
  onLeave: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [leaving, setLeaving] = useState(false)

  function copyCode() {
    navigator.clipboard.writeText(team.join_code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="rounded-2xl p-4" style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">🛡️</span>
        <span className="text-neutral-400 text-xs font-medium uppercase tracking-wide">Your Team</span>
        {team.role === 'captain' && (
          <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(242,183,31,0.12)', color: '#F2B71F' }}>
            Captain
          </span>
        )}
      </div>

      <Link href={`/teams/${team.slug}`} className="block mb-3 group">
        <p className="text-white font-bold text-base group-hover:text-[#F2B71F] transition-colors">{team.name}</p>
      </Link>

      <div className="mb-3">
        <p className="text-[10px] text-neutral-600 uppercase tracking-widest mb-1">Join code</p>
        <button
          onClick={copyCode}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-xl transition-all duration-150 hover:bg-white/[0.04]"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <span className="font-mono text-sm font-bold tracking-widest text-white flex-1 text-left">{team.join_code}</span>
          <span className="text-[10px] text-neutral-500">{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      </div>

      <div className="flex gap-2">
        <Link
          href={`/teams/${team.slug}`}
          className="flex-1 py-2 rounded-xl text-xs font-semibold text-center transition-all duration-150 hover:opacity-90"
          style={{ background: 'rgba(242,183,31,0.1)', color: '#F2B71F', border: '1px solid rgba(242,183,31,0.2)' }}
        >
          View team
        </Link>
        <button
          onClick={async () => {
            if (!confirm('Leave your team?')) return
            setLeaving(true)
            onLeave()
          }}
          disabled={leaving}
          className="py-2 px-3 rounded-xl text-xs font-medium text-neutral-600 hover:text-red-400 transition-colors disabled:opacity-40"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          Leave
        </button>
      </div>
    </div>
  )
}

// ── No team sidebar card ──────────────────────────────────

function NoTeamCard({
  connected,
  onCreate,
  onJoin,
}: {
  connected: boolean
  onCreate: () => void
  onJoin: () => void
}) {
  return (
    <div className="rounded-2xl p-4" style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">🛡️</span>
        <span className="text-neutral-400 text-xs font-medium uppercase tracking-wide">Teams</span>
      </div>
      <p className="text-neutral-500 text-xs leading-relaxed mb-4">
        Team up with friends, pool your points, and compete on the team leaderboard each week.
      </p>
      {connected ? (
        <div className="flex flex-col gap-2">
          <button
            onClick={onCreate}
            className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 hover:opacity-90"
            style={{ background: 'rgba(242,183,31,0.15)', color: '#F2B71F', border: '1px solid rgba(242,183,31,0.25)' }}
          >
            Create a team
          </button>
          <button
            onClick={onJoin}
            className="w-full py-2.5 rounded-xl text-sm font-medium text-neutral-400 hover:text-white transition-colors"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            Join with a code
          </button>
        </div>
      ) : (
        <p className="text-neutral-600 text-xs">Connect your wallet to create or join a team.</p>
      )}
    </div>
  )
}

// ── How teams work sidebar card ───────────────────────────

function HowTeamsWorkCard() {
  const steps = [
    { emoji: '🛡️', text: 'Create a team or join one with a code' },
    { emoji: '📈', text: 'Trade on free markets to earn points' },
    { emoji: '🏆', text: 'Team scores = sum of all member points' },
    { emoji: '🎯', text: 'Top teams on the weekly leaderboard' },
  ]
  return (
    <div className="rounded-2xl p-4" style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">⭐</span>
        <span className="text-neutral-400 text-xs font-medium uppercase tracking-wide">How teams work</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {steps.map((s, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <span className="text-sm flex-shrink-0 mt-0.5">{s.emoji}</span>
            <span className="text-xs text-neutral-500 leading-relaxed">{s.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────

export default function TeamsPage() {
  const { publicKey, connected } = useWallet()
  const [entries, setEntries] = useState<TeamLeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<SortKey>('weekly')
  const [countdown, setCountdown] = useState('')
  const [myTeam, setMyTeam] = useState<MyTeam | null | undefined>(undefined)
  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)

  useEffect(() => {
    const tick = () => setCountdown(formatCountdown(getMsUntilNextMonday()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const fetchLeaderboard = useCallback(() => {
    setLoading(true)
    fetch('/api/teams/leaderboard')
      .then(r => r.json())
      .then(j => setEntries(j.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchLeaderboard() }, [fetchLeaderboard])

  useEffect(() => {
    if (!publicKey) { setMyTeam(null); return }
    fetch(`/api/teams/my-team?wallet=${publicKey}`)
      .then(r => r.json())
      .then(j => setMyTeam(j.team ?? null))
      .catch(() => setMyTeam(null))
  }, [publicKey])

  const sorted = [...entries].sort((a, b) =>
    sort === 'weekly' ? b.weekly_points - a.weekly_points : b.all_time_points - a.all_time_points
  )
  const maxPts = sorted.length > 0 ? (sort === 'weekly' ? sorted[0].weekly_points : sorted[0].all_time_points) : 0

  async function handleLeave() {
    if (!publicKey) return
    await fetch('/api/teams/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: publicKey }),
    })
    setMyTeam(null)
    fetchLeaderboard()
  }

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden bg-black">
      <AnimatedBackground />

      <div className="relative z-10 layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex justify-center">
          <div className="w-full max-w-7xl"><Header /></div>
        </div>

        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="flex flex-col w-full max-w-6xl flex-1 py-10">

            {/* Page header */}
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8 animate-fade-in" style={{ animationFillMode: 'both' }}>
              <div>
                <h1 className="text-4xl md:text-5xl font-black tracking-tight" style={{ color: '#F2B71F' }}>
                  Teams
                </h1>
                <p className="text-neutral-600 text-sm mt-1">Compete together on the weekly leaderboard</p>
              </div>

              {/* Countdown */}
              <div
                className="flex items-center gap-3 px-4 py-2.5 rounded-2xl self-start sm:self-auto"
                style={{ background: 'rgba(242,183,31,0.06)', border: '1px solid rgba(242,183,31,0.15)' }}
                suppressHydrationWarning
              >
                <div className="flex flex-col items-start">
                  <span className="text-[9px] text-neutral-600 uppercase tracking-widest leading-none mb-0.5">Resets in</span>
                  <span className="text-xl font-black tabular-nums leading-none" style={{ color: '#F2B71F' }} suppressHydrationWarning>
                    {countdown}
                  </span>
                </div>
              </div>
            </div>

            {/* Two-column layout */}
            <div className="flex flex-col lg:flex-row gap-6 flex-1">

              {/* Main leaderboard */}
              <div className="flex-1 min-w-0 animate-fade-in" style={{ animationDelay: '80ms', animationFillMode: 'both' }}>

                {/* Sort toggle */}
                <div className="flex items-center justify-between mb-5">
                  <span className="text-xs font-medium text-neutral-600 uppercase tracking-widest">Standings</span>
                  <div className="flex items-center gap-0.5 p-0.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    {([['weekly', 'This Week'], ['alltime', 'All Time']] as const).map(([k, lbl]) => (
                      <button
                        key={k}
                        onClick={() => setSort(k)}
                        className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150"
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

                {loading && <MentionedSpinner className="py-20" />}

                {!loading && sorted.length === 0 && (
                  <div className="flex flex-col items-center py-20 gap-3">
                    <p className="text-neutral-500 text-sm">No teams yet — be the first!</p>
                    {connected && !myTeam && (
                      <button
                        onClick={() => setShowCreate(true)}
                        className="text-sm font-semibold hover:opacity-80 transition-opacity"
                        style={{ color: '#F2B71F' }}
                      >
                        Create a team
                      </button>
                    )}
                  </div>
                )}

                {!loading && sorted.length > 0 && (
                  <div
                    className="rounded-2xl overflow-hidden"
                    style={{ background: 'rgba(255,255,255,0.012)', border: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    {/* Column labels */}
                    <div className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <span className="text-[10px] text-neutral-700 uppercase tracking-widest w-7 text-right flex-shrink-0">#</span>
                      <span className="w-8 flex-shrink-0" />
                      <span className="text-[10px] text-neutral-700 uppercase tracking-widest flex-1">Team</span>
                      <span className="text-[10px] text-neutral-700 uppercase tracking-widest flex-shrink-0">Points</span>
                    </div>

                    <div className="p-1">
                      {sorted.map((e, i) => (
                        <TeamRow
                          key={e.team_id}
                          rank={i + 1}
                          entry={e}
                          sort={sort}
                          isYourTeam={myTeam?.id === e.team_id}
                          index={i}
                          maxPts={maxPts}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Sidebar */}
              <div className="w-full lg:w-72 flex-shrink-0 flex flex-col gap-4 animate-fade-in" style={{ animationDelay: '160ms', animationFillMode: 'both' }}>
                {myTeam !== undefined && (
                  myTeam ? (
                    <MyTeamCard team={myTeam} onLeave={handleLeave} />
                  ) : (
                    <NoTeamCard
                      connected={connected}
                      onCreate={() => setShowCreate(true)}
                      onJoin={() => setShowJoin(true)}
                    />
                  )
                )}
                <HowTeamsWorkCard />
              </div>
            </div>

            <div className="mt-16" />
            <Footer />
          </div>
        </div>
      </div>

      {showCreate && publicKey && (
        <CreateTeamModal
          wallet={publicKey}
          onClose={() => setShowCreate(false)}
          onCreated={(team) => {
            setMyTeam(team)
            setShowCreate(false)
            fetchLeaderboard()
          }}
        />
      )}

      {showJoin && publicKey && (
        <JoinTeamModal
          wallet={publicKey}
          onClose={() => setShowJoin(false)}
          onJoined={(team) => {
            setMyTeam(team)
            setShowJoin(false)
            fetchLeaderboard()
          }}
        />
      )}
    </div>
  )
}
