'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { useWallet } from '@/contexts/WalletContext'
import MentionedSpinner from '@/components/MentionedSpinner'

// ── Types ──────────────────────────────────────────────────

interface TeamMember {
  team_id: number
  wallet: string
  role: string
  joined_at: string
  username: string | null
  pfp_emoji: string | null
  weekly_points: number
  all_time_points: number
}

interface TeamData {
  team: {
    id: number
    name: string
    join_code: string
    created_by: string
    created_at: string
  }
  members: TeamMember[]
  weeklyTotal: number
  allTimeTotal: number
  weekStart: string
}

// ── Helpers ────────────────────────────────────────────────

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

// ── Animated background ────────────────────────────────────

function AnimatedBackground() {
  return (
    <>
      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes tp-blob1 { 0%{transform:translate(0,0)} 25%{transform:translate(260px,-80px)} 50%{transform:translate(160px,200px)} 75%{transform:translate(-100px,140px)} 100%{transform:translate(0,0)} }
          @keyframes tp-blob2 { 0%{transform:translate(0,0)} 25%{transform:translate(-180px,120px)} 50%{transform:translate(-60px,-140px)} 75%{transform:translate(140px,-60px)} 100%{transform:translate(0,0)} }
          #tp-blob1{animation:tp-blob1 24s ease-in-out infinite}
          #tp-blob2{animation:tp-blob2 30s ease-in-out infinite}
        `
      }} />
      <div aria-hidden="true" style={{ position: 'fixed', top: 40, left: 0, right: 0, bottom: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
        <div id="tp-blob1" style={{ position: 'absolute', top: '-10%', left: '-10%', width: '45%', height: '50%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(242,183,31,0.16) 0%, rgba(242,183,31,0.04) 60%, transparent 100%)', filter: 'blur(40px)' }} />
        <div id="tp-blob2" style={{ position: 'absolute', top: '30%', right: '-10%', width: '40%', height: '45%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(242,183,31,0.12) 0%, rgba(242,183,31,0.03) 60%, transparent 100%)', filter: 'blur(40px)' }} />
      </div>
    </>
  )
}

// ── Page ───────────────────────────────────────────────────

export default function TeamProfilePage() {
  const params = useParams()
  const teamSlug = params.name as string
  const { publicKey } = useWallet()
  const [data, setData] = useState<TeamData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [sort, setSort] = useState<'weekly' | 'alltime'>('weekly')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!teamSlug) return
    setLoading(true)
    fetch(`/api/teams/${teamSlug}`)
      .then(r => {
        if (r.status === 404) { setNotFound(true); return null }
        return r.json()
      })
      .then(j => { if (j) setData(j) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [teamSlug])

  function copyCode() {
    if (!data) return
    navigator.clipboard.writeText(data.team.join_code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pfpPreview, setPfpPreview] = useState<string | null>(null)
  const [pfpUploading, setPfpUploading] = useState(false)
  const [pfpError, setPfpError] = useState('')
  // Cache-busting key so the img re-fetches after upload
  const [pfpKey, setPfpKey] = useState(0)
  const [pfpImgFailed, setPfpImgFailed] = useState(false)

  const isMember = publicKey ? data?.members.some(m => m.wallet === publicKey) : false
  const myRole = data?.members.find(m => m.wallet === publicKey)?.role
  const isCaptain = myRole === 'captain'

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPfpError('')
    if (!file.type.startsWith('image/')) { setPfpError('Must be an image file'); return }
    if (file.size > 1024 * 1024) { setPfpError('Image must be under 1 MB'); return }
    const reader = new FileReader()
    reader.onload = ev => setPfpPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  async function handlePfpUpload() {
    const file = fileInputRef.current?.files?.[0]
    if (!file || !publicKey || !data) return
    setPfpUploading(true)
    setPfpError('')
    try {
      const form = new FormData()
      form.append('wallet', publicKey)
      form.append('file', file)
      const res = await fetch(`/api/teams/pfp/${teamSlug}`, { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) { setPfpError(json.error ?? 'Upload failed'); return }
      setPfpPreview(null)
      setPfpImgFailed(false)
      setPfpKey(k => k + 1)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch {
      setPfpError('Upload failed')
    } finally {
      setPfpUploading(false)
    }
  }

  const sortedMembers = data ? [...data.members].sort((a, b) =>
    sort === 'weekly' ? b.weekly_points - a.weekly_points : b.all_time_points - a.all_time_points
  ) : []

  const maxPts = sortedMembers.length > 0
    ? (sort === 'weekly' ? sortedMembers[0].weekly_points : sortedMembers[0].all_time_points)
    : 0

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden bg-black">
      <AnimatedBackground />

      <div className="relative z-10 layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex justify-center">
          <div className="w-full max-w-7xl"><Header /></div>
        </div>

        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="flex flex-col w-full max-w-6xl flex-1 py-10">

            {/* Back */}
            <Link
              href="/teams"
              className="flex items-center gap-1.5 text-neutral-600 hover:text-neutral-400 text-xs font-medium transition-colors mb-6 w-fit"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              All teams
            </Link>

            {loading && <MentionedSpinner className="py-32" />}

            {!loading && notFound && (
              <div className="flex flex-col items-center py-32 gap-3">
                <p className="text-neutral-500 text-sm">Team not found</p>
                <Link href="/teams" className="text-sm font-medium hover:underline" style={{ color: '#F2B71F' }}>Back to teams</Link>
              </div>
            )}

            {!loading && data && (
              <div className="flex flex-col lg:flex-row gap-6 flex-1 animate-fade-in" style={{ animationFillMode: 'both' }}>

                {/* Main */}
                <div className="flex-1 min-w-0">

                  {/* Team header */}
                  <div className="mb-8">
                    <div className="flex items-center gap-4 mb-2">
                      {/* PFP avatar */}
                      <div className="relative flex-shrink-0 group">
                        <div
                          className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl overflow-hidden"
                          style={{ background: 'rgba(242,183,31,0.1)', border: '1px solid rgba(242,183,31,0.2)' }}
                        >
                          {pfpPreview ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={pfpPreview} alt="preview" className="w-full h-full object-cover" />
                          ) : pfpImgFailed ? (
                            <span>🛡️</span>
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={pfpKey}
                              src={`/api/teams/pfp/${teamSlug}`}
                              alt={data.team.name}
                              className="w-full h-full object-cover"
                              onError={() => setPfpImgFailed(true)}
                            />
                          )}
                        </div>
                        {/* Upload overlay — captain only */}
                        {isCaptain && !pfpPreview && (
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            className="absolute inset-0 rounded-2xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150 text-[10px] font-semibold text-white"
                            style={{ background: 'rgba(0,0,0,0.6)' }}
                          >
                            Change
                          </button>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white">{data.team.name}</h1>
                        <p className="text-neutral-600 text-xs mt-0.5">
                          {data.members.length} {data.members.length === 1 ? 'member' : 'members'} &middot; since {new Date(data.team.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                    </div>

                    {/* Hidden file input */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileChange}
                    />

                    {/* Upload confirm / error */}
                    {pfpPreview && (
                      <div className="flex items-center gap-2 mt-3">
                        <button
                          onClick={handlePfpUpload}
                          disabled={pfpUploading}
                          className="px-4 py-1.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-40"
                          style={{ background: 'rgba(242,183,31,0.15)', color: '#F2B71F', border: '1px solid rgba(242,183,31,0.25)' }}
                        >
                          {pfpUploading ? 'Uploading...' : 'Save photo'}
                        </button>
                        <button
                          onClick={() => { setPfpPreview(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                          className="px-4 py-1.5 rounded-xl text-xs font-medium text-neutral-500 hover:text-white transition-colors"
                          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
                        >
                          Cancel
                        </button>
                        {pfpError && <p className="text-xs text-red-400">{pfpError}</p>}
                      </div>
                    )}
                    {!pfpPreview && pfpError && <p className="text-xs text-red-400 mt-2">{pfpError}</p>}
                    {isCaptain && !pfpPreview && (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="mt-2 text-[11px] text-neutral-600 hover:text-neutral-400 transition-colors"
                      >
                        + Set team photo
                      </button>
                    )}
                  </div>

                  {/* Stat cards */}
                  <div className="grid grid-cols-2 gap-3 mb-8">
                    <div className="rounded-2xl p-4" style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <p className="text-[10px] text-neutral-600 uppercase tracking-widest mb-1">Weekly points</p>
                      <p className="text-2xl font-black" style={{ color: '#F2B71F' }}>{data.weeklyTotal.toLocaleString()}</p>
                      <p className="text-[10px] text-neutral-700 mt-1">{data.weekStart ? formatWeekRange(data.weekStart) : ''}</p>
                    </div>
                    <div className="rounded-2xl p-4" style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <p className="text-[10px] text-neutral-600 uppercase tracking-widest mb-1">All-time points</p>
                      <p className="text-2xl font-black text-white">{data.allTimeTotal.toLocaleString()}</p>
                      <p className="text-[10px] text-neutral-700 mt-1">{data.members.length} contributors</p>
                    </div>
                  </div>

                  {/* Members table */}
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-xs font-medium text-neutral-600 uppercase tracking-widest">Members</span>
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

                  <div
                    className="rounded-2xl overflow-hidden"
                    style={{ background: 'rgba(255,255,255,0.012)', border: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <div className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <span className="text-[10px] text-neutral-700 uppercase tracking-widest w-7 text-right flex-shrink-0">#</span>
                      <span className="w-8 flex-shrink-0" />
                      <span className="text-[10px] text-neutral-700 uppercase tracking-widest flex-1">Member</span>
                      <span className="text-[10px] text-neutral-700 uppercase tracking-widest flex-shrink-0">Points</span>
                    </div>

                    <div className="p-1">
                      {sortedMembers.map((m, i) => {
                        const pts = sort === 'weekly' ? m.weekly_points : m.all_time_points
                        const name = m.username || truncateWallet(m.wallet)
                        const isYou = publicKey === m.wallet
                        const barWidth = maxPts > 0 ? Math.max(2, (pts / maxPts) * 100) : 0

                        return (
                          <Link
                            key={m.wallet}
                            href={`/profile/${m.username ?? m.wallet}`}
                            className="group flex items-center gap-3 px-4 py-3 rounded-xl transition-colors duration-150 hover:bg-white/[0.04]"
                            style={{
                              background: isYou ? 'rgba(242,183,31,0.04)' : i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent',
                              borderLeft: isYou ? '2px solid rgba(242,183,31,0.4)' : '2px solid transparent',
                            }}
                          >
                            <span className="text-xs text-neutral-600 tabular-nums w-7 text-right flex-shrink-0 font-medium">{i + 1}</span>

                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0" style={{ background: 'rgba(255,255,255,0.04)' }}>
                              {m.pfp_emoji ?? '⚪'}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p
                                  className="text-sm font-semibold truncate leading-snug group-hover:text-[#F2B71F] transition-colors"
                                  style={{ color: isYou ? '#fb923c' : '#d4d4d4' }}
                                >
                                  {name}
                                  {isYou && <span className="ml-1.5 text-[10px] text-neutral-600 font-normal">you</span>}
                                </p>
                                {m.role === 'captain' && (
                                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: 'rgba(242,183,31,0.12)', color: '#F2B71F' }}>
                                    Captain
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 h-[2px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${barWidth}%`,
                                    background: isYou ? 'rgba(251,146,60,0.5)' : `rgba(242,183,31,${0.15 + (barWidth / 100) * 0.35})`,
                                  }}
                                />
                              </div>
                            </div>

                            <span className="text-sm font-bold tabular-nums flex-shrink-0" style={{ color: '#737373' }}>
                              {pts.toLocaleString()}
                            </span>
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {/* Sidebar */}
                <div className="w-full lg:w-72 flex-shrink-0 flex flex-col gap-4 animate-fade-in" style={{ animationDelay: '120ms', animationFillMode: 'both' }}>

                  {/* Join code card */}
                  <div className="rounded-2xl p-4" style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm">🔑</span>
                      <span className="text-neutral-400 text-xs font-medium uppercase tracking-wide">Join code</span>
                    </div>
                    <button
                      onClick={copyCode}
                      className="flex items-center gap-2 w-full px-4 py-3 rounded-xl mb-3 transition-all duration-150 hover:bg-white/[0.04]"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                    >
                      <span className="font-mono text-xl font-black tracking-widest text-white flex-1 text-left">{data.team.join_code}</span>
                      <span className="text-xs text-neutral-500 flex-shrink-0">{copied ? 'Copied!' : 'Copy'}</span>
                    </button>
                    {!isMember && (
                      <p className="text-[10px] text-neutral-600 leading-relaxed">
                        Share this code with friends so they can join your team on the <Link href="/teams" className="underline hover:text-neutral-400">teams page</Link>.
                      </p>
                    )}
                    {isMember && (
                      <p className="text-[10px] text-neutral-600 leading-relaxed">
                        You&apos;re {myRole === 'captain' ? 'the captain' : 'a member'} of this team. Share the code to recruit more teammates.
                      </p>
                    )}
                  </div>

                  {/* Quick stats */}
                  <div className="rounded-2xl p-4" style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm">📊</span>
                      <span className="text-neutral-400 text-xs font-medium uppercase tracking-wide">This week</span>
                    </div>
                    <div className="flex flex-col gap-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-neutral-500">Top earner</span>
                        <span className="text-xs font-semibold text-white truncate max-w-[120px] text-right">
                          {data.members.sort((a, b) => b.weekly_points - a.weekly_points)[0]?.username
                            || truncateWallet(data.members.sort((a, b) => b.weekly_points - a.weekly_points)[0]?.wallet ?? '')}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-neutral-500">Avg. per member</span>
                        <span className="text-xs font-semibold" style={{ color: '#F2B71F' }}>
                          {data.members.length > 0 ? Math.round(data.weeklyTotal / data.members.length).toLocaleString() : 0} pts
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-neutral-500">Active members</span>
                        <span className="text-xs font-semibold text-white">
                          {data.members.filter(m => m.weekly_points > 0).length} / {data.members.length}
                        </span>
                      </div>
                    </div>
                  </div>

                  <Link
                    href="/teams"
                    className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium text-neutral-500 hover:text-white transition-colors"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                    All teams
                  </Link>
                </div>
              </div>
            )}

            <div className="mt-16" />
            <Footer />
          </div>
        </div>
      </div>
    </div>
  )
}
