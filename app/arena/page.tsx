'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
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

function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

const TEAM_PRIZES = [
  { place: 1, amount: '$375', pct: '50%' },
  { place: 2, amount: '$250', pct: '33%' },
  { place: 3, amount: '$125', pct: '17%' },
]

// May 4 00:00 BST = May 3 23:00 UTC
const COMP_OPEN = new Date('2026-05-03T23:00:00.000Z')
// May 18 00:00 BST = May 17 23:00 UTC
const COMP_CLOSE = new Date('2026-05-17T23:00:00.000Z')

function getCountdownState(): { label: string; ms: number } {
  const now = Date.now()
  if (now < COMP_OPEN.getTime()) {
    return { label: 'Arena opens in', ms: COMP_OPEN.getTime() - now }
  }
  return { label: 'Arena ends in', ms: COMP_CLOSE.getTime() - now }
}

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
  isYourTeam,
  index,
  maxPts,
}: {
  rank: number
  entry: TeamLeaderboardEntry
  isYourTeam: boolean
  index: number
  maxPts: number
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const pts = entry.weekly_points
  const prize = TEAM_PRIZES.find(p => p.place === rank)
  const a = ACCENTS[rank as keyof typeof ACCENTS]
  const isTop3 = rank <= 3
  const barWidth = maxPts > 0 ? Math.max(2, (pts / maxPts) * 100) : 0

  return (
    <Link
      href={`/arena/${entry.team_slug}`}
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
        className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 overflow-hidden"
        style={isTop3
          ? { background: a.bg, boxShadow: `0 0 0 1.5px ${a.ring}` }
          : { background: 'rgba(255,255,255,0.04)' }
        }
      >
        {imgFailed ? (
          <span>🛡️</span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/teams/pfp/${entry.team_slug}`}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setImgFailed(true)}
          />
        )}
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

      {/* Prize */}
      {prize ? (
        <span className="text-xs font-semibold w-10 text-right flex-shrink-0" style={{ color: ACCENTS[rank as keyof typeof ACCENTS]?.color ?? '#6b7280' }}>
          {prize.amount}
        </span>
      ) : (
        <span className="w-10 flex-shrink-0" />
      )}
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
  const [confirming, setConfirming] = useState(false)

  async function handleCreate() {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/teams/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), wallet }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to create team'); setConfirming(false); return }
      onCreated({ ...data.team, role: 'captain' })
    } catch {
      setError('Something went wrong')
      setConfirming(false)
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
        {!confirming ? (
          <>
            <h2 className="text-lg font-bold text-white mb-1">Create a team</h2>
            <p className="text-neutral-500 text-xs mb-3">Pick a name. You&apos;ll get a shareable join code to send to teammates.</p>
            <div className="rounded-xl px-3 py-2 mb-4" style={{ background: 'rgba(88,101,242,0.08)', border: '1px solid rgba(88,101,242,0.2)' }}>
              <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(88,101,242,0.9)' }}>
                Discord must be linked and your account must be at least 30 days old to enter the Arena.
              </p>
            </div>
            <form onSubmit={e => { e.preventDefault(); setConfirming(true) }} className="flex flex-col gap-3">
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
                  disabled={name.trim().length < 2}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 disabled:opacity-40"
                  style={{ background: 'rgba(242,183,31,0.15)', color: '#F2B71F', border: '1px solid rgba(242,183,31,0.25)' }}
                >
                  Continue
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold text-white mb-1">Are you sure?</h2>
            <p className="text-neutral-400 text-sm mb-4">
              You&apos;re about to create <span className="font-bold text-white">&ldquo;{name.trim()}&rdquo;</span> as your team for the Arena. This will be your team for the entire competition — choose wisely.
            </p>
            <div className="rounded-xl px-3 py-2 mb-4" style={{ background: 'rgba(242,183,31,0.06)', border: '1px solid rgba(242,183,31,0.2)' }}>
              <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(242,183,31,0.8)' }}>
                You can&apos;t switch teams once you&apos;ve joined the Arena. Make sure this is the team you want to compete with.
              </p>
            </div>
            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-neutral-500 hover:text-white transition-colors"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                Go back
              </button>
              <button
                onClick={handleCreate}
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 disabled:opacity-40"
                style={{ background: 'rgba(242,183,31,0.15)', color: '#F2B71F', border: '1px solid rgba(242,183,31,0.25)' }}
              >
                {loading ? 'Creating...' : 'Create team'}
              </button>
            </div>
          </>
        )}
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
  const [confirming, setConfirming] = useState(false)

  async function handleJoin() {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/teams/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), wallet }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to join team'); setConfirming(false); return }
      onJoined({ ...data.team, role: 'member' })
    } catch {
      setError('Something went wrong')
      setConfirming(false)
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
        {!confirming ? (
          <>
            <h2 className="text-lg font-bold text-white mb-1">Join a team</h2>
            <p className="text-neutral-500 text-xs mb-3">Enter the 6-character join code from your teammate.</p>
            <div className="rounded-xl px-3 py-2 mb-4" style={{ background: 'rgba(88,101,242,0.08)', border: '1px solid rgba(88,101,242,0.2)' }}>
              <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(88,101,242,0.9)' }}>
                Discord must be linked and your account must be at least 30 days old to enter the Arena.
              </p>
            </div>
            <form onSubmit={e => { e.preventDefault(); setConfirming(true) }} className="flex flex-col gap-3">
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
                  disabled={code.length < 6}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 disabled:opacity-40"
                  style={{ background: 'rgba(242,183,31,0.15)', color: '#F2B71F', border: '1px solid rgba(242,183,31,0.25)' }}
                >
                  Continue
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold text-white mb-1">Are you sure?</h2>
            <p className="text-neutral-400 text-sm mb-4">
              You&apos;re about to join a team using code <span className="font-mono font-bold text-white">{code}</span>. This will be your team for the entire Arena competition.
            </p>
            <div className="rounded-xl px-3 py-2 mb-4" style={{ background: 'rgba(242,183,31,0.06)', border: '1px solid rgba(242,183,31,0.2)' }}>
              <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(242,183,31,0.8)' }}>
                You can&apos;t switch teams once you&apos;ve joined the Arena. Make sure this is the team you want to compete with.
              </p>
            </div>
            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-neutral-500 hover:text-white transition-colors"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                Go back
              </button>
              <button
                onClick={handleJoin}
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 disabled:opacity-40"
                style={{ background: 'rgba(242,183,31,0.15)', color: '#F2B71F', border: '1px solid rgba(242,183,31,0.25)' }}
              >
                {loading ? 'Joining...' : 'Join team'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── My Team sidebar card ──────────────────────────────────

function MyTeamCard({ team }: { team: MyTeam }) {
  const [copied, setCopied] = useState(false)

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

      <Link href={`/arena/${team.slug}`} className="block mb-3 group">
        <p className="text-white font-bold text-base group-hover:text-[#F2B71F] transition-colors">{team.name}</p>
      </Link>

      {team.role === 'captain' && (
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
      )}

      <Link
        href={`/arena/${team.slug}`}
        className="block w-full py-2 rounded-xl text-xs font-semibold text-center transition-all duration-150 hover:opacity-90"
        style={{ background: 'rgba(242,183,31,0.1)', color: '#F2B71F', border: '1px solid rgba(242,183,31,0.2)' }}
      >
        View team
      </Link>
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
        <span className="text-sm">⚔️</span>
        <span className="text-neutral-400 text-xs font-medium uppercase tracking-wide">Enter the Arena</span>
      </div>
      <p className="text-neutral-500 text-xs leading-relaxed mb-2">
        Teams can be 1 to 3 members. Go solo if you&apos;re confident, but 3 members is advised. More traders means more points.
      </p>
      <p className="text-neutral-600 text-xs leading-relaxed mb-3">
        Top 3 teams share the <span className="text-[#F2B71F] font-semibold">$750 prize pool</span> (May 4–17).
      </p>
      <div className="rounded-xl px-3 py-2 mb-4" style={{ background: 'rgba(88,101,242,0.08)', border: '1px solid rgba(88,101,242,0.2)' }}>
        <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(88,101,242,0.9)' }}>
          Discord must be linked and your account must be at least 30 days old to enter the Arena.
        </p>
      </div>
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
    { emoji: '🏆', text: 'Team score = sum of all member points' },
    { emoji: '🎯', text: 'Top 3 teams share the $750 prize pool (May 4–17)' },
  ]
  return (
    <div className="rounded-2xl p-4" style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">⭐</span>
        <span className="text-neutral-400 text-xs font-medium uppercase tracking-wide">How the Arena works</span>
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
  const [countdown, setCountdown] = useState('')
  const [countdownLabel, setCountdownLabel] = useState('Arena opens in')
  const [myTeam, setMyTeam] = useState<MyTeam | null | undefined>(undefined)
  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)

  useEffect(() => {
    const tick = () => {
      const { label, ms } = getCountdownState()
      setCountdownLabel(label)
      setCountdown(formatCountdown(ms))
    }
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

  const sorted = [...entries].sort((a, b) => b.weekly_points - a.weekly_points)
  const maxPts = sorted.length > 0 ? sorted[0].weekly_points : 0

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden bg-black">
      <AnimatedBackground />

      <div className="relative z-10 layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex justify-center">
          <div className="w-full max-w-7xl"><Header /></div>
        </div>

        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="flex flex-col w-full max-w-6xl flex-1 py-10">

            {/* Two-column layout */}
            <div className="flex flex-col lg:flex-row gap-6 flex-1 animate-fade-in" style={{ animationFillMode: 'both' }}>

              {/* Main: banner + leaderboard */}
              <div className="flex-1 min-w-0 flex flex-col gap-4">

                {/* Hero banner */}
                <div
                  className="flex items-center justify-between gap-4 rounded-2xl px-6 py-6"
                  style={{ background: 'rgba(242,183,31,0.04)', border: '1px solid rgba(242,183,31,0.12)' }}
                >
                  <div className="flex flex-col flex-1 min-w-0 items-center">
                    <div className="flex flex-col items-start text-left">
                      <h1 className="text-4xl md:text-5xl font-black tracking-tight leading-none" style={{ color: '#F2B71F' }}>
                        The Arena
                      </h1>
                      <p className="text-neutral-300 text-base mt-2">Enter the Mentioned Arena. Form a team, earn points, win prizes.</p>
                      <div className="flex items-center gap-2 mt-3 flex-wrap">
                        <span className="text-xs text-neutral-400 uppercase tracking-widest">May 4–17</span>
                        <span className="text-neutral-500 text-xs">·</span>
                        <span className="text-sm font-semibold" style={{ color: '#F2B71F' }}>$750 prize pool</span>
                        <div className="flex items-center gap-1.5 ml-1">
                          {[['🥇', '$375', '#F2B71F', 'rgba(242,183,31,0.12)'], ['🥈', '$250', '#9ba8b5', 'rgba(155,168,181,0.1)'], ['🥉', '$125', '#c07b3a', 'rgba(192,123,58,0.1)']].map(([medal, amt, color, bg]) => (
                            <span key={amt} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: bg as string, color: color as string }}>
                              {medal} {amt}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/src/img/mentioned_arena_animated_right_facing.svg"
                    alt=""
                    style={{ height: 209, width: 'auto', marginLeft: '-40px', marginTop: '-24px' }}
                    className="hidden sm:block flex-shrink-0"
                  />
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
                      <span className="text-[10px] text-neutral-700 uppercase tracking-widest w-10 text-right flex-shrink-0">Prize</span>
                    </div>

                    <div className="p-1">
                      {sorted.map((e, i) => (
                        <TeamRow
                          key={e.team_id}
                          rank={i + 1}
                          entry={e}
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
                {/* Countdown — centered above YOUR TEAM */}
                <div
                  className="flex flex-col items-center justify-center py-3 rounded-2xl"
                  style={{ background: 'rgba(242,183,31,0.06)', border: '1px solid rgba(242,183,31,0.15)' }}
                  suppressHydrationWarning
                >
                  <span className="text-[9px] text-neutral-600 uppercase tracking-widest leading-none mb-1" suppressHydrationWarning>{countdownLabel}</span>
                  <span className="text-3xl font-black tabular-nums leading-none" style={{ color: '#F2B71F' }} suppressHydrationWarning>
                    {countdown}
                  </span>
                </div>

                {myTeam !== undefined && (
                  myTeam ? (
                    <MyTeamCard team={myTeam} />
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
