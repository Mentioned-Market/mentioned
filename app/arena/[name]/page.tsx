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
    bio: string | null
    x_url: string | null
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
    const qs = publicKey ? `?wallet=${publicKey}` : ''
    fetch(`/api/teams/${teamSlug}${qs}`)
      .then(r => {
        if (r.status === 404) { setNotFound(true); return null }
        return r.json()
      })
      .then(j => { if (j) setData(j) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [teamSlug, publicKey])

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

  // Name editing
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError] = useState('')

  async function handleSaveName() {
    if (!publicKey || !data) return
    setNameError('')
    setNameSaving(true)
    try {
      const res = await fetch(`/api/teams/${teamSlug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: publicKey, name: nameInput }),
      })
      const json = await res.json()
      if (!res.ok) { setNameError(json.error ?? 'Failed to save'); return }
      setData(d => d ? { ...d, team: { ...d.team, name: nameInput.trim() } } : d)
      setEditingName(false)
    } catch {
      setNameError('Something went wrong')
    } finally {
      setNameSaving(false)
    }
  }

  // Bio editing
  const [editingBio, setEditingBio] = useState(false)
  const [bioInput, setBioInput] = useState('')
  const [bioSaving, setBioSaving] = useState(false)
  const [bioError, setBioError] = useState('')

  async function handleSaveBio() {
    if (!publicKey || !data) return
    setBioError('')
    setBioSaving(true)
    try {
      const res = await fetch(`/api/teams/${teamSlug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: publicKey, bio: bioInput }),
      })
      const json = await res.json()
      if (!res.ok) { setBioError(json.error ?? 'Failed to save'); return }
      setData(d => d ? { ...d, team: { ...d.team, bio: bioInput.trim() || null } } : d)
      setEditingBio(false)
    } catch {
      setBioError('Something went wrong')
    } finally {
      setBioSaving(false)
    }
  }

  // X link editing
  const [editingX, setEditingX] = useState(false)
  const [xInput, setXInput] = useState('')
  const [xSaving, setXSaving] = useState(false)
  const [xError, setXError] = useState('')

  async function handleSaveX() {
    if (!publicKey || !data) return
    setXError('')
    setXSaving(true)
    try {
      const res = await fetch(`/api/teams/${teamSlug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: publicKey, x_url: xInput.trim() }),
      })
      const json = await res.json()
      if (!res.ok) { setXError(json.error ?? 'Failed to save'); return }
      // Store normalised handle returned from server by re-fetching, or derive locally
      const handle = xInput.trim().replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '').replace(/^@/, '').split('/')[0].split('?')[0]
      setData(d => d ? { ...d, team: { ...d.team, x_url: handle || null } } : d)
      setEditingX(false)
    } catch {
      setXError('Something went wrong')
    } finally {
      setXSaving(false)
    }
  }

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
              href="/arena"
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
                <Link href="/arena" className="text-sm font-medium hover:underline" style={{ color: '#F2B71F' }}>Back to teams</Link>
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
                        {editingName ? (
                          <div className="flex items-center gap-2">
                            <input
                              value={nameInput}
                              onChange={e => setNameInput(e.target.value)}
                              maxLength={30}
                              autoFocus
                              className="text-2xl font-black tracking-tight text-white bg-transparent border-b border-[#F2B71F]/50 outline-none flex-1 min-w-0"
                              onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false) }}
                            />
                            <button
                              onClick={handleSaveName}
                              disabled={nameSaving || nameInput.trim().length < 2}
                              className="text-xs font-semibold px-3 py-1 rounded-lg disabled:opacity-40"
                              style={{ background: 'rgba(242,183,31,0.15)', color: '#F2B71F' }}
                            >
                              {nameSaving ? '...' : 'Save'}
                            </button>
                            <button onClick={() => setEditingName(false)} className="text-xs text-neutral-600 hover:text-white transition-colors">Cancel</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 group/name">
                            <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white">{data.team.name}</h1>
                            {isCaptain && (
                              <button
                                onClick={() => { setNameInput(data.team.name); setNameError(''); setEditingName(true) }}
                                className="opacity-0 group-hover/name:opacity-100 transition-opacity text-neutral-600 hover:text-neutral-400"
                                title="Edit team name"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                              </button>
                            )}
                          </div>
                        )}
                        {nameError && <p className="text-xs text-red-400 mt-1">{nameError}</p>}
                        <p className="text-neutral-400 text-xs mt-0.5">
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
                  </div>

                  {/* Bio + X link grouped */}
                  <div className="flex flex-col gap-2 mb-6">

                  {/* Bio section */}
                  <div>
                    {editingBio ? (
                      <div>
                        <textarea
                          value={bioInput}
                          onChange={e => setBioInput(e.target.value.slice(0, 300))}
                          autoFocus
                          rows={3}
                          placeholder="Tell people about your team — links, socials, anything..."
                          className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-600 outline-none focus:ring-1 focus:ring-[#F2B71F]/40 resize-none"
                          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                        />
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            onClick={handleSaveBio}
                            disabled={bioSaving}
                            className="px-4 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-40"
                            style={{ background: 'rgba(242,183,31,0.15)', color: '#F2B71F', border: '1px solid rgba(242,183,31,0.25)' }}
                          >
                            {bioSaving ? 'Saving...' : 'Save'}
                          </button>
                          <button onClick={() => setEditingBio(false)} className="text-xs text-neutral-600 hover:text-white transition-colors">Cancel</button>
                          <span className="ml-auto text-[10px] text-neutral-700">{bioInput.length}/300</span>
                        </div>
                        {bioError && <p className="text-xs text-red-400 mt-1">{bioError}</p>}
                      </div>
                    ) : data.team.bio ? (
                      <div className="group/bio flex items-start gap-2">
                        <p className="text-neutral-400 text-sm leading-relaxed flex-1 whitespace-pre-wrap break-words">{data.team.bio}</p>
                        {isCaptain && (
                          <button
                            onClick={() => { setBioInput(data.team.bio ?? ''); setBioError(''); setEditingBio(true) }}
                            className="opacity-0 group-hover/bio:opacity-100 transition-opacity text-neutral-600 hover:text-neutral-400 flex-shrink-0 mt-0.5"
                            title="Edit bio"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                        )}
                      </div>
                    ) : isCaptain ? (
                      <button
                        onClick={() => { setBioInput(''); setBioError(''); setEditingBio(true) }}
                        className="text-xs text-neutral-400 hover:text-white transition-colors"
                      >
                        + Add a team bio
                      </button>
                    ) : null}
                  </div>

                  {/* X link */}
                  <div>
                    {editingX ? (
                      <div>
                        <div className="flex items-center gap-2 rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                          <span className="text-neutral-600 text-sm">@</span>
                          <input
                            value={xInput}
                            onChange={e => setXInput(e.target.value)}
                            maxLength={15}
                            autoFocus
                            placeholder="username"
                            className="flex-1 bg-transparent text-sm text-white placeholder-neutral-600 outline-none"
                            onKeyDown={e => { if (e.key === 'Enter') handleSaveX(); if (e.key === 'Escape') setEditingX(false) }}
                          />
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            onClick={handleSaveX}
                            disabled={xSaving}
                            className="px-4 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-40"
                            style={{ background: 'rgba(242,183,31,0.15)', color: '#F2B71F', border: '1px solid rgba(242,183,31,0.25)' }}
                          >
                            {xSaving ? 'Saving...' : 'Save'}
                          </button>
                          <button onClick={() => setEditingX(false)} className="text-xs text-neutral-600 hover:text-white transition-colors">Cancel</button>
                          {data.team.x_url && (
                            <button
                              onClick={async () => {
                                setXSaving(true)
                                setXError('')
                                try {
                                  const res = await fetch(`/api/teams/${teamSlug}`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ wallet: publicKey, x_url: '' }),
                                  })
                                  if (res.ok) { setData(d => d ? { ...d, team: { ...d.team, x_url: null } } : d); setEditingX(false) }
                                } finally { setXSaving(false) }
                              }}
                              className="text-xs text-neutral-700 hover:text-red-400 transition-colors ml-auto"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                        {xError && <p className="text-xs text-red-400 mt-1">{xError}</p>}
                      </div>
                    ) : data.team.x_url ? (
                      <div className="group/x flex items-center gap-2">
                        <a
                          href={`https://x.com/${data.team.x_url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white transition-colors"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                          @{data.team.x_url}
                        </a>
                        {isCaptain && (
                          <button
                            onClick={() => { setXInput(data.team.x_url ?? ''); setXError(''); setEditingX(true) }}
                            className="opacity-0 group-hover/x:opacity-100 transition-opacity text-neutral-600 hover:text-neutral-400"
                            title="Edit X link"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                        )}
                      </div>
                    ) : isCaptain ? (
                      <button
                        onClick={() => { setXInput(''); setXError(''); setEditingX(true) }}
                        className="text-xs text-neutral-400 hover:text-white transition-colors"
                      >
                        + Add X account
                      </button>
                    ) : null}
                  </div>

                  </div>{/* end bio+x group */}

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

                  {/* Join code card — only visible to captain */}
                  {isCaptain && data.team.join_code && (
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
                    <p className="text-[10px] text-neutral-600 leading-relaxed">
                      Share this code with friends so they can join your team on the <Link href="/arena" className="underline hover:text-neutral-400">Arena</Link>.
                    </p>
                  </div>
                  )}

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
                    href="/arena"
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
