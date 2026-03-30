'use client'

import { useState, useEffect } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

interface StreamEntry {
  eventId: string
  streamUrl: string
  updatedAt: string
}

export default function PolyAdminPage() {
  const { publicKey } = useWallet()
  const [isAdmin, setIsAdmin] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)

  const [streams, setStreams] = useState<StreamEntry[]>([])
  const [loading, setLoading] = useState(true)

  // Form state
  const [eventId, setEventId] = useState('')
  const [streamUrl, setStreamUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

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

  async function fetchStreams() {
    try {
      const res = await fetch('/api/streams')
      const json = await res.json()
      setStreams(json.streams || [])
    } catch {
      console.error('Failed to fetch streams')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAdmin) fetchStreams()
  }, [isAdmin])

  async function handleSave() {
    if (!eventId.trim() || !streamUrl.trim()) {
      setMessage({ type: 'error', text: 'Both fields are required' })
      return
    }

    setSaving(true)
    setMessage(null)

    try {
      const res = await fetch('/api/streams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: eventId.trim(), streamUrl: streamUrl.trim(), wallet: publicKey }),
      })

      if (!res.ok) throw new Error('Failed to save')

      setMessage({ type: 'success', text: `Stream saved for ${eventId}` })
      setEventId('')
      setStreamUrl('')
      fetchStreams()
    } catch {
      setMessage({ type: 'error', text: 'Failed to save stream' })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch('/api/streams', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: id, wallet: publicKey }),
      })
      fetchStreams()
    } catch {
      console.error('Failed to delete stream')
    }
  }

  // Auth gate
  if (!authChecked) {
    return (
      <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
        <div className="layout-container flex h-full grow flex-col">
          <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
            <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
              <Header />
              <main className="flex-1 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
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
                  {!publicKey ? 'Connect your wallet to access this page.' : 'You do not have admin access.'}
                </p>
              </main>
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
          <h1 className="text-2xl md:text-3xl font-bold text-white mb-1">Poly Admin</h1>
          <p className="text-neutral-400 text-sm mb-6">Manage live stream embeds for events</p>

          {/* Add / Update Stream */}
          <div className="glass rounded-xl p-5 mb-8">
            <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider mb-4">
              Add or Update Stream
            </h2>

            <div className="flex flex-col md:flex-row gap-3 mb-3">
              <input
                type="text"
                placeholder="Event ID (e.g. POLY-257513)"
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/20"
              />
              <input
                type="text"
                placeholder="Stream URL (e.g. https://www.twitch.tv/esl_csgo)"
                value={streamUrl}
                onChange={(e) => setStreamUrl(e.target.value)}
                className="flex-[2] bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/20"
              />
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2.5 bg-apple-blue text-white text-sm font-semibold rounded-lg hover:bg-apple-blue/80 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>

            {message && (
              <p className={`text-xs ${message.type === 'success' ? 'text-apple-green' : 'text-apple-red'}`}>
                {message.text}
              </p>
            )}
          </div>

          {/* Current Streams */}
          <div>
            <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider mb-4">
              Active Streams
            </h2>

            {loading && (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              </div>
            )}

            {!loading && streams.length === 0 && (
              <p className="text-neutral-500 text-sm py-8 text-center">No streams configured</p>
            )}

            {!loading && streams.length > 0 && (
              <div className="rounded-xl border border-white/5 overflow-hidden">
                <div className="hidden md:grid grid-cols-[1fr_2fr_1fr_80px] gap-3 px-4 py-2.5 text-[10px] text-neutral-500 font-medium uppercase tracking-wider border-b border-white/5 bg-white/[0.02]">
                  <div>Event ID</div>
                  <div>Stream URL</div>
                  <div>Updated</div>
                  <div></div>
                </div>

                {streams.map((s) => (
                  <div
                    key={s.eventId}
                    className="grid grid-cols-1 md:grid-cols-[1fr_2fr_1fr_80px] gap-1 md:gap-3 px-4 py-3 border-b border-white/5 last:border-b-0 hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="flex items-center">
                      <a
                        href={`/polymarkets/event/${s.eventId}`}
                        className="text-sm text-apple-blue hover:underline font-mono"
                      >
                        {s.eventId}
                      </a>
                    </div>
                    <div className="flex items-center text-sm text-neutral-300 truncate">
                      {s.streamUrl}
                    </div>
                    <div className="flex items-center text-xs text-neutral-500">
                      {new Date(s.updatedAt).toLocaleString()}
                    </div>
                    <div className="flex items-center justify-end">
                      <button
                        onClick={() => handleDelete(s.eventId)}
                        className="text-xs text-apple-red hover:text-apple-red/80 font-medium transition-colors"
                      >
                        Remove
                      </button>
                    </div>
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
