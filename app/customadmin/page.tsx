'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { getStatusColor, getStatusLabel, isValidStatusTransition } from '@/lib/customMarketUtils'
import type { CustomMarketRow, CustomMarketWordRow } from '@/lib/db'

interface MarketWithWords extends CustomMarketRow {
  words: CustomMarketWordRow[]
}

export default function CustomAdminPage() {
  const { publicKey } = useWallet()

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
  const [addWordsInput, setAddWordsInput] = useState('')

  // Resolution state
  const [resolutions, setResolutions] = useState<Record<number, boolean | null>>({})

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

  useEffect(() => { fetchMarkets() }, [fetchMarkets])

  const expandMarket = (market: MarketWithWords) => {
    if (expandedId === market.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(market.id)
    setEditTitle(market.title)
    setEditDescription(market.description || '')
    setEditCoverImageUrl(market.cover_image_url || '')
    setEditStreamUrl(market.stream_url || '')
    setEditLockTime(market.lock_time ? new Date(market.lock_time).toISOString().slice(0, 16) : '')
    setAddWordsInput('')
    const res: Record<number, boolean | null> = {}
    market.words.forEach(w => { res[w.id] = w.resolved_outcome })
    setResolutions(res)
  }

  async function handleCreate() {
    if (!publicKey || !title.trim()) {
      show('Title is required', 'error')
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
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      show(`Market "${json.market.title}" created (ID: ${json.market.id})`)
      setTitle('')
      setDescription('')
      setCoverImageUrl('')
      setStreamUrl('')
      setLockTime('')
      setBParameter('500')
      setPlayTokens('1000')
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
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      show(json.message)
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

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-7xl mx-auto px-4 md:px-10 lg:px-20">
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
          <div className="glass rounded-xl p-5 mb-8">
            <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider mb-4">
              Create Market
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <input
                type="text"
                placeholder="Title *"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/20"
              />
              <input
                type="text"
                placeholder="Cover Image URL"
                value={coverImageUrl}
                onChange={e => setCoverImageUrl(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/20"
              />
              <input
                type="text"
                placeholder="Stream URL"
                value={streamUrl}
                onChange={e => setStreamUrl(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/20"
              />
              <input
                type="datetime-local"
                placeholder="Lock Time"
                value={lockTime}
                onChange={e => setLockTime(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/20"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <input
                  type="number"
                  placeholder="b Parameter (default: 500)"
                  value={bParameter}
                  onChange={e => setBParameter(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/20"
                  min="10"
                  max="10000"
                />
                <p className="text-[10px] text-neutral-600 mt-1 px-1">
                  Price sensitivity. Lower = more volatile. For 10 users: 500. For 50 users: 1500.
                </p>
              </div>
              <div>
                <input
                  type="number"
                  placeholder="Play Tokens (default: 1000)"
                  value={playTokens}
                  onChange={e => setPlayTokens(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/20"
                  min="100"
                  max="10000"
                />
                <p className="text-[10px] text-neutral-600 mt-1 px-1">
                  Starting tokens per user. Higher = more trades possible.
                </p>
              </div>
            </div>

            <textarea
              placeholder="Description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="w-full mb-3 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/20 resize-none"
            />

            <textarea
              placeholder="Words (comma or newline separated)"
              value={wordsInput}
              onChange={e => setWordsInput(e.target.value)}
              rows={3}
              className="w-full mb-3 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/20 resize-none"
            />

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
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              </div>
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
                        <span className="text-xs font-mono text-neutral-500">#{market.id}</span>
                        <span className="text-sm font-medium">{market.title}</span>
                        <span className={`text-xs font-semibold ${getStatusColor(market.status)}`}>
                          {getStatusLabel(market.status)}
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
                      <div className="border-t border-white/5 px-4 py-4 space-y-5 bg-white/[0.01]">
                        {/* Edit fields */}
                        <div>
                          <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">Edit Market</h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                            <input
                              type="text"
                              placeholder="Title"
                              value={editTitle}
                              onChange={e => setEditTitle(e.target.value)}
                              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/20"
                            />
                            <input
                              type="text"
                              placeholder="Cover Image URL"
                              value={editCoverImageUrl}
                              onChange={e => setEditCoverImageUrl(e.target.value)}
                              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/20"
                            />
                            <input
                              type="text"
                              placeholder="Stream URL"
                              value={editStreamUrl}
                              onChange={e => setEditStreamUrl(e.target.value)}
                              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/20"
                            />
                            <input
                              type="datetime-local"
                              value={editLockTime}
                              onChange={e => setEditLockTime(e.target.value)}
                              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/20"
                            />
                          </div>
                          <textarea
                            placeholder="Description"
                            value={editDescription}
                            onChange={e => setEditDescription(e.target.value)}
                            rows={2}
                            className="w-full mb-3 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/20 resize-none"
                          />
                          <button
                            onClick={() => handleUpdateMarket(market.id)}
                            className="px-4 py-2 bg-apple-blue text-white text-xs font-semibold rounded-lg hover:bg-apple-blue/80 transition-colors"
                          >
                            Save Changes
                          </button>
                        </div>

                        {/* Words management */}
                        <div>
                          <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">Words</h3>
                          <div className="flex flex-wrap gap-2 mb-3">
                            {market.words.map(w => (
                              <span
                                key={w.id}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 text-sm"
                              >
                                {w.word}
                                {w.resolved_outcome !== null && (
                                  <span className={w.resolved_outcome ? 'text-apple-green' : 'text-apple-red'}>
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
                            <div className="flex gap-2">
                              <input
                                type="text"
                                placeholder="Add words (comma separated)"
                                value={addWordsInput}
                                onChange={e => setAddWordsInput(e.target.value)}
                                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/20"
                              />
                              <button
                                onClick={() => handleAddWords(market.id)}
                                className="px-4 py-2 bg-white/10 text-white text-xs font-semibold rounded-lg hover:bg-white/15 transition-colors"
                              >
                                Add
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Resolution panel (only when locked) */}
                        {market.status === 'locked' && (
                          <div>
                            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">Resolve Words</h3>
                            <div className="space-y-2 mb-3">
                              {market.words.map(w => (
                                <div key={w.id} className="flex items-center gap-3">
                                  <span className="text-sm w-32 truncate">{w.word}</span>
                                  <div className="flex gap-1">
                                    <button
                                      onClick={() => setResolutions(prev => ({ ...prev, [w.id]: true }))}
                                      className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                                        resolutions[w.id] === true
                                          ? 'bg-apple-green text-white'
                                          : 'bg-white/5 text-neutral-400 hover:bg-white/10'
                                      }`}
                                    >
                                      YES
                                    </button>
                                    <button
                                      onClick={() => setResolutions(prev => ({ ...prev, [w.id]: false }))}
                                      className={`px-3 py-1 text-xs rounded-lg transition-colors ${
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
                                onClick={() => setAllResolutions(market.words, true)}
                                className="px-3 py-1.5 text-xs bg-apple-green/20 text-apple-green rounded-lg hover:bg-apple-green/30 transition-colors"
                              >
                                All YES
                              </button>
                              <button
                                onClick={() => setAllResolutions(market.words, false)}
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

                        {/* Status transitions */}
                        <div>
                          <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">Actions</h3>
                          <div className="flex flex-wrap gap-2">
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
                              href={`/custom/${market.id}`}
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
  )
}
