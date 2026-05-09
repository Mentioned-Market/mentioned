'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { getStatusColor, getStatusLabel, isValidStatusTransition } from '@/lib/customMarketUtils'
import type { CustomMarketRow, CustomMarketWordRow } from '@/lib/db'
import MentionedSpinner from '@/components/MentionedSpinner'

interface MarketWithWords extends CustomMarketRow {
  words: CustomMarketWordRow[]
}

interface MonitoredStreamRow {
  id: number
  event_id: string
  stream_url: string
  status: 'pending' | 'live' | 'ended' | 'error'
  source: 'twitch' | 'youtube' | 'local-audio' | null
  started_at: string | null
  ended_at: string | null
  minutes_used: string
  cost_cents: number
  error_message: string | null
  worker_pool: string
  kind: 'live' | 'vod'
}

function transcriptionStatusBadge(status: MonitoredStreamRow['status']): string {
  switch (status) {
    case 'pending': return 'bg-yellow-500/20 text-yellow-300'
    case 'live':    return 'bg-apple-green/20 text-apple-green'
    case 'ended':   return 'bg-white/5 text-neutral-400'
    case 'error':   return 'bg-apple-red/20 text-apple-red'
  }
}

function transcriptionStatusText(status: MonitoredStreamRow['status']): string {
  return status === 'error' ? 'text-apple-red' : 'text-neutral-400'
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function CustomAdminPage() {
  const { publicKey } = useWallet()

  const [isAdmin, setIsAdmin] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [markets, setMarkets] = useState<MarketWithWords[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Create form
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [coverImageUrl, setCoverImageUrl] = useState('')
  const [streamUrl, setStreamUrl] = useState('')
  const [lockTime, setLockTime] = useState('')
  const [bParameter, setBParameter] = useState('500')
  const [playTokens, setPlayTokens] = useState('1000')
  const [urlPrefix, setUrlPrefix] = useState('')
  const [marketType, setMarketType] = useState<'continuous' | 'event'>('continuous')
  const [eventStartTime, setEventStartTime] = useState('')
  const [wordsInput, setWordsInput] = useState('')
  const [creating, setCreating] = useState(false)

  // Expanded market for detail view
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // Edit fields for expanded market
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editCoverImageUrl, setEditCoverImageUrl] = useState('')
  const [editStreamUrl, setEditStreamUrl] = useState('')
  const [editLockTime, setEditLockTime] = useState('')
  const [editMarketType, setEditMarketType] = useState<'continuous' | 'event'>('continuous')
  const [editEventStartTime, setEditEventStartTime] = useState('')
  const [addWordsInput, setAddWordsInput] = useState('')

  // Resolution state
  const [resolutions, setResolutions] = useState<Record<number, boolean | null>>({})

  // Transcription monitoring (per-expanded-market)
  const [transcription, setTranscription] = useState<MonitoredStreamRow | null>(null)
  const [transcriptionUrl, setTranscriptionUrl] = useState('')
  const [transcriptionPool, setTranscriptionPool] = useState<'cloud' | 'local'>('cloud')
  const [transcriptionKind, setTranscriptionKind] = useState<'live' | 'vod'>('live')
  const [transcriptionBusy, setTranscriptionBusy] = useState(false)

  const show = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  const fetchMarkets = useCallback(async () => {
    if (!publicKey) return
    try {
      const res = await fetch(`/api/custom?admin=true&wallet=${publicKey}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setMarkets(json.markets || [])
    } catch {
      console.error('Failed to fetch markets')
    } finally {
      setLoading(false)
    }
  }, [publicKey])

  // Check admin status
  useEffect(() => {
    if (!publicKey) {
      setIsAdmin(false)
      setAuthChecked(true)
      return
    }
    fetch(`/api/auth/admin?wallet=${publicKey}`)
      .then(res => res.json())
      .then(json => setIsAdmin(json.admin === true))
      .catch(() => setIsAdmin(false))
      .finally(() => setAuthChecked(true))
  }, [publicKey])

  useEffect(() => {
    if (isAdmin) fetchMarkets()
  }, [isAdmin, fetchMarkets])

  const expandMarket = (market: MarketWithWords) => {
    if (expandedId === market.id) {
      setExpandedId(null)
      setTranscription(null)
      return
    }
    setExpandedId(market.id)
    setEditTitle(market.title)
    setEditDescription(market.description || '')
    setEditCoverImageUrl(market.cover_image_url || '')
    setEditStreamUrl(market.stream_url || '')
    setEditLockTime(market.lock_time ? new Date(market.lock_time).toISOString().slice(0, 16) : '')
    setEditMarketType((market.market_type === 'event' ? 'event' : 'continuous') as 'continuous' | 'event')
    setEditEventStartTime(market.event_start_time ? new Date(market.event_start_time).toISOString().slice(0, 16) : '')
    setAddWordsInput('')
    const res: Record<number, boolean | null> = {}
    market.words.forEach(w => { res[w.id] = w.resolved_outcome })
    setResolutions(res)
    // Reset transcription form; defaults seeded from the market's existing stream URL.
    setTranscription(null)
    setTranscriptionUrl(market.stream_url || '')
    setTranscriptionPool('cloud')
    setTranscriptionKind('live')
  }

  const fetchTranscription = useCallback(async (marketId: number) => {
    try {
      const res = await fetch(`/api/admin/streams?eventId=custom_${marketId}`)
      if (!res.ok) return
      const json = await res.json()
      setTranscription(json.stream ?? null)
    } catch {
      // tolerate transient fetch errors; the next poll tick will retry
    }
  }, [])

  // Initial fetch + 5s polling while a market is expanded so admins see live
  // status changes (pending → live, live → ended, etc.) without reloading.
  useEffect(() => {
    if (expandedId == null) return
    fetchTranscription(expandedId)
    const t = setInterval(() => fetchTranscription(expandedId), 5000)
    return () => clearInterval(t)
  }, [expandedId, fetchTranscription])

  async function handleStartTranscription() {
    if (expandedId == null) return
    const url = transcriptionUrl.trim()
    if (!url) {
      show('Stream URL is required', 'error')
      return
    }
    setTranscriptionBusy(true)
    try {
      const res = await fetch('/api/admin/streams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: `custom_${expandedId}`,
          streamUrl: url,
          workerPool: transcriptionPool,
          kind: transcriptionKind,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to start')
      setTranscription(json.stream)
      show('Transcription requested — worker is claiming the stream')
    } catch (err) {
      show(err instanceof Error ? err.message : 'Failed to start transcription', 'error')
    } finally {
      setTranscriptionBusy(false)
    }
  }

  async function handleCancelTranscription() {
    if (!transcription) return
    if (!confirm('Force-end this transcription? The worker will tear down its pipeline.')) return
    setTranscriptionBusy(true)
    try {
      const res = await fetch(`/api/admin/streams/${transcription.id}/cancel`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to cancel')
      show('Cancel requested — worker will end shortly')
      // Bump status optimistically; the next poll will pick up the worker's transition.
      setTranscription({ ...transcription, status: 'ended' })
    } catch (err) {
      show(err instanceof Error ? err.message : 'Failed to cancel transcription', 'error')
    } finally {
      setTranscriptionBusy(false)
    }
  }

  async function handleCreate() {
    if (!publicKey || !title.trim() || !urlPrefix.trim()) {
      show('Title and URL prefix are required', 'error')
      return
    }
    setCreating(true)
    try {
      const words = wordsInput.split(/[,\n]+/).map(w => w.trim()).filter(Boolean)
      const res = await fetch('/api/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: publicKey,
          title: title.trim(),
          description: description.trim() || undefined,
          coverImageUrl: coverImageUrl.trim() || undefined,
          streamUrl: streamUrl.trim() || undefined,
          lockTime: lockTime || undefined,
          bParameter: parseFloat(bParameter) || 500,
          playTokens: parseInt(playTokens) || 1000,
          words: words.length > 0 ? words : undefined,
          urlPrefix: urlPrefix.trim() || undefined,
          marketType,
          eventStartTime: eventStartTime || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      show(`Market "${json.market.title}" created (${json.market.slug})`)
      setTitle('')
      setDescription('')
      setCoverImageUrl('')
      setStreamUrl('')
      setLockTime('')
      setBParameter('500')
      setPlayTokens('1000')
      setUrlPrefix('')
      setMarketType('continuous')
      setEventStartTime('')
      setWordsInput('')
      fetchMarkets()
    } catch (err: any) {
      show(err.message || 'Failed to create market', 'error')
    } finally {
      setCreating(false)
    }
  }

  async function handleUpdateMarket(marketId: number) {
    if (!publicKey) return
    try {
      const res = await fetch(`/api/custom/${marketId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: publicKey,
          title: editTitle.trim(),
          description: editDescription.trim() || null,
          cover_image_url: editCoverImageUrl.trim() || null,
          stream_url: editStreamUrl.trim() || null,
          lock_time: editLockTime || null,
          market_type: editMarketType,
          event_start_time: editEventStartTime || null,
        }),
      })
      if (!res.ok) throw new Error('Failed to update')
      show('Market updated')
      fetchMarkets()
    } catch (err: any) {
      show(err.message, 'error')
    }
  }

  async function handleStatusChange(marketId: number, currentStatus: string, newStatus: string) {
    if (!publicKey) return
    if (!isValidStatusTransition(currentStatus, newStatus)) {
      show(`Cannot transition from ${currentStatus} to ${newStatus}`, 'error')
      return
    }
    try {
      const res = await fetch(`/api/custom/${marketId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: publicKey, status: newStatus }),
      })
      if (!res.ok) throw new Error('Failed to update status')
      show(`Status changed to ${newStatus}`)
      fetchMarkets()
    } catch (err: any) {
      show(err.message, 'error')
    }
  }

  async function handleAddWords(marketId: number) {
    if (!publicKey || !addWordsInput.trim()) return
    const words = addWordsInput.split(/[,\n]+/).map(w => w.trim()).filter(Boolean)
    try {
      const res = await fetch(`/api/custom/${marketId}/words`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: publicKey, words }),
      })
      if (!res.ok) throw new Error('Failed to add words')
      show(`Added ${words.length} word(s)`)
      setAddWordsInput('')
      fetchMarkets()
    } catch (err: any) {
      show(err.message, 'error')
    }
  }

  async function handleRemoveWord(marketId: number, wordId: number) {
    if (!publicKey) return
    try {
      const res = await fetch(`/api/custom/${marketId}/words`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: publicKey, wordId }),
      })
      if (!res.ok) throw new Error('Failed to remove word')
      show('Word removed')
      fetchMarkets()
    } catch (err: any) {
      show(err.message, 'error')
    }
  }

  async function handleResolve(marketId: number) {
    if (!publicKey) return
    const resolveList = Object.entries(resolutions)
      .filter(([, outcome]) => outcome !== null)
      .map(([wordId, outcome]) => ({ wordId: parseInt(wordId, 10), outcome: outcome! }))

    if (resolveList.length === 0) {
      show('Select outcomes for at least one word', 'error')
      return
    }

    try {
      const res = await fetch(`/api/custom/${marketId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: publicKey, resolutions: resolveList }),
      })
      let json: any = {}
      try { json = await res.json() } catch {}
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`)
      show(json.message)
      fetchMarkets()
    } catch (err: any) {
      show(err.message, 'error')
    }
  }

  async function handleSetFeatured(marketId: number, featured: boolean) {
    if (!publicKey) return
    try {
      const res = await fetch(`/api/custom/${marketId}/featured`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featured }),
      })
      if (!res.ok) throw new Error('Failed to update featured status')
      show(featured ? 'Market set as featured' : 'Featured status removed')
      fetchMarkets()
    } catch (err: any) {
      show(err.message, 'error')
    }
  }

  async function handleDelete(marketId: number) {
    if (!publicKey || !confirm('Delete this market? This cannot be undone.')) return
    try {
      const res = await fetch(`/api/custom/${marketId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: publicKey }),
      })
      if (!res.ok) throw new Error('Failed to delete')
      show('Market deleted')
      if (expandedId === marketId) setExpandedId(null)
      fetchMarkets()
    } catch (err: any) {
      show(err.message, 'error')
    }
  }

  function setAllResolutions(words: CustomMarketWordRow[], outcome: boolean) {
    const res: Record<number, boolean | null> = {}
    words.forEach(w => { res[w.id] = outcome })
    setResolutions(res)
  }

  if (!authChecked) {
    return (
      <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
        <div className="layout-container flex h-full grow flex-col">
          <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
            <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
              <Header />
              <main className="flex-1 flex items-center justify-center">
                <MentionedSpinner className="" />
              </main>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!publicKey || !isAdmin) {
    return (
      <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
        <div className="layout-container flex h-full grow flex-col">
          <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
            <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
              <Header />
              <main className="flex-1 flex flex-col items-center justify-center gap-2">
                <p className="text-neutral-400 text-sm">
                  {!publicKey
                    ? 'Nice try. Connect your wallet first, anon.'
                    : 'You shall not pass. This area is for admins only.'}
                </p>
              </main>
              <Footer />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
            <Header />
            <main className="py-4 md:py-6 animate-fade-in">
          <h1 className="text-2xl md:text-3xl font-bold text-white mb-1">Custom Markets Admin</h1>
          <p className="text-neutral-400 text-sm mb-6">Create and manage free prediction markets</p>

          {message && (
            <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${message.type === 'success' ? 'bg-apple-green/10 text-apple-green' : 'bg-apple-red/10 text-apple-red'}`}>
              {message.text}
            </div>
          )}

          {/* Create Market Form */}
          <div className="glass rounded-xl p-5 md:p-6 mb-8">
            <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider mb-5">
              Create Market
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">Title <span className="text-apple-red">*</span></label>
                <input
                  type="text"
                  placeholder="e.g. What will @WhiteHouse tweet this week?"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">URL Prefix <span className="text-apple-red">*</span></label>
                <input
                  type="text"
                  placeholder="e.g. WHITEHOUSE"
                  value={urlPrefix}
                  onChange={e => setUrlPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20 uppercase"
                />
                <p className="text-[10px] text-neutral-600 mt-1 px-1">
                  URL will be /free/{urlPrefix || 'PREFIX'}-xxxxxx
                </p>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-medium text-neutral-400 mb-1.5">Description</label>
              <textarea
                placeholder="Optional market description shown to users"
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={2}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20 resize-none"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">Cover Image URL</label>
                <input
                  type="text"
                  placeholder="https://..."
                  value={coverImageUrl}
                  onChange={e => setCoverImageUrl(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">Stream URL</label>
                <input
                  type="text"
                  placeholder="YouTube or Twitch URL"
                  value={streamUrl}
                  onChange={e => setStreamUrl(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">Lock Time</label>
                <input
                  type="datetime-local"
                  value={lockTime}
                  onChange={e => setLockTime(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                />
                <p className="text-[10px] text-neutral-600 mt-1 px-1">
                  Trading stops automatically at this time
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">Market Type</label>
                <select
                  value={marketType}
                  onChange={e => setMarketType(e.target.value as 'continuous' | 'event')}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/20"
                >
                  <option value="continuous">Continuous</option>
                  <option value="event">Event</option>
                </select>
                <p className="text-[10px] text-neutral-600 mt-1 px-1">
                  Continuous: always live when open. Event: live only after event starts.
                </p>
              </div>
              {marketType === 'event' && (
                <div>
                  <label className="block text-xs font-medium text-neutral-400 mb-1.5">Event Start Time</label>
                  <input
                    type="datetime-local"
                    value={eventStartTime}
                    onChange={e => setEventStartTime(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                  />
                  <p className="text-[10px] text-neutral-600 mt-1 px-1">
                    &quot;Live&quot; tag appears on the card after this time
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">b Parameter</label>
                <input
                  type="number"
                  placeholder="500"
                  value={bParameter}
                  onChange={e => setBParameter(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                  min="10"
                  max="10000"
                />
                <p className="text-[10px] text-neutral-600 mt-1 px-1">
                  Price sensitivity. Lower = more volatile. 10 users: 500, 50 users: 1500
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">Play Tokens</label>
                <input
                  type="number"
                  placeholder="1000"
                  value={playTokens}
                  onChange={e => setPlayTokens(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                  min="100"
                  max="10000"
                />
                <p className="text-[10px] text-neutral-600 mt-1 px-1">
                  Starting tokens per user. Higher = more trades possible
                </p>
              </div>
            </div>

            <div className="mb-5">
              <label className="block text-xs font-medium text-neutral-400 mb-1.5">Words</label>
              <textarea
                placeholder="Comma or newline separated, e.g. economy, inflation, jobs"
                value={wordsInput}
                onChange={e => setWordsInput(e.target.value)}
                rows={3}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20 resize-none"
              />
            </div>

            <button
              onClick={handleCreate}
              disabled={creating || !publicKey}
              className="px-5 py-2.5 bg-apple-blue text-white text-sm font-semibold rounded-lg hover:bg-apple-blue/80 transition-colors disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create Market'}
            </button>
          </div>

          {/* Markets List */}
          <div>
            <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider mb-4">
              All Markets
            </h2>

            {loading && (
              <MentionedSpinner />
            )}

            {!loading && markets.length === 0 && (
              <p className="text-neutral-500 text-sm py-8 text-center">No custom markets yet</p>
            )}

            {!loading && markets.length > 0 && (
              <div className="space-y-3">
                {markets.map(market => (
                  <div key={market.id} className="rounded-xl border border-white/5 overflow-hidden">
                    {/* Market row header */}
                    <div
                      onClick={() => expandMarket(market)}
                      className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-white/[0.03] transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-neutral-500">{market.slug}</span>
                        <span className="text-sm font-medium">{market.title}</span>
                        <span className={`text-xs font-semibold ${getStatusColor(market.status)}`}>
                          {getStatusLabel(market.status)}
                        </span>
                        {market.is_featured && (
                          <span className="px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 text-[10px] font-bold uppercase tracking-wide">
                            ★ Featured
                          </span>
                        )}
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide ${
                          market.market_type === 'event'
                            ? 'bg-purple-500/20 text-purple-400'
                            : 'bg-white/5 text-neutral-500'
                        }`}>
                          {market.market_type === 'event' ? 'Event' : 'Continuous'}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-neutral-500">
                        <span>{market.words.length} words</span>
                        {market.lock_time && (
                          <span>Locks: {new Date(market.lock_time).toLocaleString()}</span>
                        )}
                        <span className="text-neutral-600">{expandedId === market.id ? '▲' : '▼'}</span>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {expandedId === market.id && (
                      <div className="border-t border-white/5 px-4 py-5 space-y-6 bg-white/[0.01]">
                        {/* Edit fields */}
                        <div>
                          <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-4">Edit Market</h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            <div>
                              <label className="block text-xs font-medium text-neutral-400 mb-1.5">Title</label>
                              <input
                                type="text"
                                value={editTitle}
                                onChange={e => setEditTitle(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-neutral-400 mb-1.5">Cover Image URL</label>
                              <input
                                type="text"
                                placeholder="https://..."
                                value={editCoverImageUrl}
                                onChange={e => setEditCoverImageUrl(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-neutral-400 mb-1.5">Stream URL</label>
                              <input
                                type="text"
                                placeholder="YouTube or Twitch URL"
                                value={editStreamUrl}
                                onChange={e => setEditStreamUrl(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-neutral-400 mb-1.5">Lock Time</label>
                              <input
                                type="datetime-local"
                                value={editLockTime}
                                onChange={e => setEditLockTime(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-neutral-400 mb-1.5">Market Type</label>
                              <select
                                value={editMarketType}
                                onChange={e => setEditMarketType(e.target.value as 'continuous' | 'event')}
                                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20"
                              >
                                <option value="continuous">Continuous</option>
                                <option value="event">Event</option>
                              </select>
                              <p className="text-[10px] text-neutral-600 mt-1 px-1">
                                Continuous: always live when open. Event: live only after event starts.
                              </p>
                            </div>
                            {editMarketType === 'event' && (
                              <div>
                                <label className="block text-xs font-medium text-neutral-400 mb-1.5">Event Start Time</label>
                                <input
                                  type="datetime-local"
                                  value={editEventStartTime}
                                  onChange={e => setEditEventStartTime(e.target.value)}
                                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                                />
                                <p className="text-[10px] text-neutral-600 mt-1 px-1">
                                  &quot;Live&quot; tag appears on the card after this time
                                </p>
                              </div>
                            )}
                          </div>
                          <div className="mb-4">
                            <label className="block text-xs font-medium text-neutral-400 mb-1.5">Description</label>
                            <textarea
                              placeholder="Optional market description"
                              value={editDescription}
                              onChange={e => setEditDescription(e.target.value)}
                              rows={2}
                              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20 resize-none"
                            />
                          </div>
                          <button
                            onClick={() => handleUpdateMarket(market.id)}
                            className="px-4 py-2 bg-apple-blue text-white text-xs font-semibold rounded-lg hover:bg-apple-blue/80 transition-colors"
                          >
                            Save Changes
                          </button>
                        </div>

                        {/* Words management */}
                        <div className="pt-1 border-t border-white/5">
                          <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-4">Words ({market.words.length})</h3>
                          <div className="flex flex-wrap gap-2 mb-4">
                            {market.words.map(w => (
                              <span
                                key={w.id}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 text-sm"
                              >
                                {w.word}
                                {w.resolved_outcome !== null && (
                                  <span className={`text-xs font-semibold ${w.resolved_outcome ? 'text-apple-green' : 'text-apple-red'}`}>
                                    {w.resolved_outcome ? 'YES' : 'NO'}
                                  </span>
                                )}
                                {market.status === 'draft' && (
                                  <button
                                    onClick={() => handleRemoveWord(market.id, w.id)}
                                    className="text-neutral-500 hover:text-apple-red ml-1"
                                  >
                                    ×
                                  </button>
                                )}
                              </span>
                            ))}
                          </div>
                          {market.status === 'draft' && (
                            <div>
                              <label className="block text-xs font-medium text-neutral-400 mb-1.5">Add Words</label>
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  placeholder="Comma separated, e.g. economy, inflation"
                                  value={addWordsInput}
                                  onChange={e => setAddWordsInput(e.target.value)}
                                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20"
                                />
                                <button
                                  onClick={() => handleAddWords(market.id)}
                                  className="px-4 py-2 bg-white/10 text-white text-xs font-semibold rounded-lg hover:bg-white/15 transition-colors"
                                >
                                  Add
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Resolution panel (open or locked markets with unresolved words) */}
                        {(market.status === 'open' || market.status === 'locked') && market.words.some(w => w.resolved_outcome === null) && (
                          <div className="pt-1 border-t border-white/5">
                            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1">Resolve Words</h3>
                            <p className="text-[10px] text-neutral-600 mb-4">
                              {market.status === 'open'
                                ? 'Resolved words are locked — unresolved words remain tradeable'
                                : 'Market is locked — resolve remaining words to complete the market'}
                            </p>
                            <div className="space-y-2.5 mb-4">
                              {market.words.filter(w => w.resolved_outcome === null).map(w => (
                                <div key={w.id} className="flex items-center gap-3">
                                  <span className="text-sm font-medium w-36 truncate" title={w.word}>{w.word}</span>
                                  <div className="flex gap-1.5">
                                    <button
                                      onClick={() => setResolutions(prev => ({ ...prev, [w.id]: true }))}
                                      className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                                        resolutions[w.id] === true
                                          ? 'bg-apple-green text-white'
                                          : 'bg-white/5 text-neutral-400 hover:bg-white/10'
                                      }`}
                                    >
                                      YES
                                    </button>
                                    <button
                                      onClick={() => setResolutions(prev => ({ ...prev, [w.id]: false }))}
                                      className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                                        resolutions[w.id] === false
                                          ? 'bg-apple-red text-white'
                                          : 'bg-white/5 text-neutral-400 hover:bg-white/10'
                                      }`}
                                    >
                                      NO
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => setAllResolutions(market.words.filter(w => w.resolved_outcome === null), true)}
                                className="px-3 py-1.5 text-xs bg-apple-green/20 text-apple-green rounded-lg hover:bg-apple-green/30 transition-colors"
                              >
                                All YES
                              </button>
                              <button
                                onClick={() => setAllResolutions(market.words.filter(w => w.resolved_outcome === null), false)}
                                className="px-3 py-1.5 text-xs bg-apple-red/20 text-apple-red rounded-lg hover:bg-apple-red/30 transition-colors"
                              >
                                All NO
                              </button>
                              <button
                                onClick={() => handleResolve(market.id)}
                                className="px-4 py-1.5 text-xs bg-apple-blue text-white font-semibold rounded-lg hover:bg-apple-blue/80 transition-colors"
                              >
                                Resolve Selected
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Transcription monitoring */}
                        <div className="pt-1 border-t border-white/5">
                          <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">Transcription</h3>
                          {transcription && (transcription.status === 'pending' || transcription.status === 'live') ? (
                            <div className="flex flex-wrap items-center gap-3 mb-2 text-xs text-neutral-300">
                              <span className={`px-2 py-1 rounded ${transcriptionStatusBadge(transcription.status)}`}>
                                {transcription.status.toUpperCase()}
                              </span>
                              <span className="text-neutral-400">
                                {transcription.kind === 'vod' ? 'vod' : 'live'} ·
                                {transcription.source ? ` ${transcription.source} ·` : ''}
                                {' '}{transcription.worker_pool} pool
                              </span>
                              {transcription.started_at && (
                                <span className="text-neutral-500">
                                  started {formatRelative(transcription.started_at)}
                                </span>
                              )}
                              <span className="text-neutral-500">
                                {Number(transcription.minutes_used).toFixed(1)} min · ${(transcription.cost_cents / 100).toFixed(2)}
                              </span>
                              <button
                                onClick={handleCancelTranscription}
                                disabled={transcriptionBusy}
                                className="ml-auto px-3 py-1.5 bg-apple-red/20 text-apple-red text-xs font-semibold rounded-lg hover:bg-apple-red/30 transition-colors disabled:opacity-50"
                              >
                                Force end
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-2 mb-2">
                              {transcription && (
                                <div className="text-xs text-neutral-500">
                                  Last run ({transcription.kind}): <span className={transcriptionStatusText(transcription.status)}>{transcription.status}</span>
                                  {transcription.minutes_used && Number(transcription.minutes_used) > 0 && (
                                    <> · {Number(transcription.minutes_used).toFixed(1)} min · ${(transcription.cost_cents / 100).toFixed(2)}</>
                                  )}
                                  {transcription.error_message && (
                                    <> · <span className="text-apple-red">{transcription.error_message}</span></>
                                  )}
                                </div>
                              )}
                              <div className="flex flex-wrap items-center gap-3">
                                <div className="inline-flex rounded-lg border border-white/10 overflow-hidden text-xs">
                                  <button
                                    type="button"
                                    onClick={() => { setTranscriptionKind('live') }}
                                    className={`px-3 py-1.5 transition-colors ${transcriptionKind === 'live' ? 'bg-white/10 text-neutral-100' : 'text-neutral-400 hover:bg-white/5'}`}
                                  >
                                    Live
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { setTranscriptionKind('vod'); setTranscriptionPool('cloud') }}
                                    className={`px-3 py-1.5 transition-colors ${transcriptionKind === 'vod' ? 'bg-white/10 text-neutral-100' : 'text-neutral-400 hover:bg-white/5'}`}
                                  >
                                    VOD
                                  </button>
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  type="text"
                                  value={transcriptionUrl}
                                  onChange={(e) => setTranscriptionUrl(e.target.value)}
                                  placeholder={transcriptionKind === 'vod'
                                    ? 'https://twitch.tv/videos/<id>  or  https://youtube.com/watch?v=<id>'
                                    : 'https://twitch.tv/<channel>  or  local-audio://laptop'}
                                  className="flex-1 min-w-[260px] px-3 py-1.5 bg-black/40 border border-white/10 rounded-lg text-xs text-neutral-200 placeholder:text-neutral-600"
                                />
                                <select
                                  value={transcriptionPool}
                                  onChange={(e) => setTranscriptionPool(e.target.value as 'cloud' | 'local')}
                                  disabled={transcriptionKind === 'vod'}
                                  title={transcriptionKind === 'vod' ? 'VOD jobs run on the cloud worker only' : ''}
                                  className="px-3 py-1.5 bg-black/40 border border-white/10 rounded-lg text-xs text-neutral-200 disabled:opacity-50"
                                >
                                  <option value="cloud">cloud</option>
                                  <option value="local">local</option>
                                </select>
                                <button
                                  onClick={handleStartTranscription}
                                  disabled={transcriptionBusy || !transcriptionUrl.trim()}
                                  className="px-4 py-1.5 bg-apple-green/20 text-apple-green text-xs font-semibold rounded-lg hover:bg-apple-green/30 transition-colors disabled:opacity-50"
                                >
                                  {transcriptionKind === 'vod' ? 'Start VOD transcription' : 'Start transcription'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Status transitions */}
                        <div className="pt-1 border-t border-white/5">
                          <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">Actions</h3>
                          <div className="flex flex-wrap gap-2">
                            {market.is_featured ? (
                              <button
                                onClick={() => handleSetFeatured(market.id, false)}
                                className="px-4 py-2 bg-yellow-500/20 text-yellow-400 text-xs font-semibold rounded-lg hover:bg-yellow-500/30 transition-colors"
                              >
                                ★ Unset Featured
                              </button>
                            ) : (
                              <button
                                onClick={() => handleSetFeatured(market.id, true)}
                                className="px-4 py-2 bg-yellow-500/10 text-yellow-500 text-xs font-semibold rounded-lg hover:bg-yellow-500/20 transition-colors"
                              >
                                ☆ Set as Featured
                              </button>
                            )}
                            {market.status === 'draft' && (
                              <button
                                onClick={() => handleStatusChange(market.id, market.status, 'open')}
                                className="px-4 py-2 bg-apple-green/20 text-apple-green text-xs font-semibold rounded-lg hover:bg-apple-green/30 transition-colors"
                              >
                                Publish (Open)
                              </button>
                            )}
                            {market.status === 'open' && (
                              <button
                                onClick={() => handleStatusChange(market.id, market.status, 'locked')}
                                className="px-4 py-2 bg-orange-500/20 text-orange-400 text-xs font-semibold rounded-lg hover:bg-orange-500/30 transition-colors"
                              >
                                Lock Predictions
                              </button>
                            )}
                            {market.status !== 'resolved' && market.status !== 'cancelled' && (
                              <button
                                onClick={() => handleStatusChange(market.id, market.status, 'cancelled')}
                                className="px-4 py-2 bg-apple-red/20 text-apple-red text-xs font-semibold rounded-lg hover:bg-apple-red/30 transition-colors"
                              >
                                Cancel
                              </button>
                            )}
                            <button
                              onClick={() => handleDelete(market.id)}
                              className="px-4 py-2 bg-white/5 text-neutral-400 text-xs font-semibold rounded-lg hover:bg-white/10 transition-colors"
                            >
                              Delete
                            </button>
                            <a
                              href={`/free/${market.slug}`}
                              target="_blank"
                              className="px-4 py-2 bg-white/5 text-neutral-300 text-xs font-semibold rounded-lg hover:bg-white/10 transition-colors"
                            >
                              View Page →
                            </a>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
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
