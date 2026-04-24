'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import MentionedSpinner from '@/components/MentionedSpinner'
import ActivityCard from '@/components/feed/ActivityCard'
import { useWallet } from '@/contexts/WalletContext'
import type { FeedItem } from '@/lib/activity'

interface FeedResponse {
  items: FeedItem[]
  nextCursor: string | null
}

const PAGE_SIZE = 20
const POLL_MS = 30_000

export default function FeedPage() {
  const { connected, connect, walletReady } = useWallet()

  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Track seen ids so poll-refresh only prepends genuinely new items.
  const seenIdsRef = useRef<Set<string>>(new Set())

  const loadInitial = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/feed?limit=${PAGE_SIZE}`, { cache: 'no-store' })
      if (res.status === 401) {
        setLoading(false)
        return
      }
      if (!res.ok) throw new Error('Failed')
      const data: FeedResponse = await res.json()
      seenIdsRef.current = new Set(data.items.map(i => i.id))
      setItems(data.items)
      setNextCursor(data.nextCursor)
    } catch {
      setError('Could not load feed. Try again in a moment.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await fetch(`/api/feed?limit=${PAGE_SIZE}&cursor=${nextCursor}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed')
      const data: FeedResponse = await res.json()
      const fresh = data.items.filter(i => !seenIdsRef.current.has(i.id))
      for (const i of fresh) seenIdsRef.current.add(i.id)
      setItems(prev => [...prev, ...fresh])
      setNextCursor(data.nextCursor)
    } catch {
      // Leave existing items visible; silent failure on pagination is fine.
    } finally {
      setLoadingMore(false)
    }
  }, [nextCursor, loadingMore])

  const pollForNew = useCallback(async () => {
    try {
      const res = await fetch(`/api/feed?limit=${PAGE_SIZE}`, { cache: 'no-store' })
      if (!res.ok) return
      const data: FeedResponse = await res.json()
      const fresh = data.items.filter(i => !seenIdsRef.current.has(i.id))
      if (fresh.length === 0) return
      for (const i of fresh) seenIdsRef.current.add(i.id)
      setItems(prev => [...fresh, ...prev])
    } catch {
      // ignore — polling is best-effort
    }
  }, [])

  // Initial load + poll when connected
  useEffect(() => {
    if (!walletReady) return
    if (!connected) {
      setItems([])
      setLoading(false)
      return
    }
    loadInitial()
  }, [connected, walletReady, loadInitial])

  useEffect(() => {
    if (!connected) return
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') pollForNew()
    }, POLL_MS)
    return () => clearInterval(id)
  }, [connected, pollForNew])

  // Infinite scroll via sentinel
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!nextCursor) return
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) loadMore()
    }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [nextCursor, loadMore])

  return (
    <main className="min-h-screen flex flex-col bg-black">
      <Header />

      <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
        <div className="flex flex-col w-full max-w-3xl flex-1 py-10">

          <div className="mb-8 animate-fade-in" style={{ animationFillMode: 'both' }}>
            <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white">Feed</h1>
            <p className="text-neutral-500 text-sm mt-1">
              Latest activity from people you follow
            </p>
          </div>

          {/* Not connected */}
          {walletReady && !connected && (
            <EmptyState
              title="Connect to see your feed"
              body="Sign in to follow other traders and see their activity in real time."
              action={<button onClick={connect} className="px-5 py-2 bg-white text-black text-sm font-semibold rounded-lg hover:bg-neutral-100 transition-colors">Connect</button>}
            />
          )}

          {/* Loading */}
          {connected && loading && <MentionedSpinner className="py-20" />}

          {/* Error */}
          {connected && !loading && error && (
            <div className="text-center py-20">
              <p className="text-neutral-500 text-sm mb-4">{error}</p>
              <button
                onClick={loadInitial}
                className="text-sm font-medium hover:underline"
                style={{ color: '#F2B71F' }}
              >
                Try again
              </button>
            </div>
          )}

          {/* Empty feed (connected, no items) */}
          {connected && !loading && !error && items.length === 0 && (
            <EmptyState
              title="Your feed is empty"
              body="Follow people to see their trades and achievements here. Find traders on the leaderboard, or search by username."
              action={
                <Link
                  href="/leaderboard"
                  className="px-5 py-2 text-sm font-semibold rounded-lg transition-colors"
                  style={{ background: 'rgba(242,183,31,0.12)', color: '#F2B71F', border: '1px solid rgba(242,183,31,0.25)' }}
                >
                  Browse leaderboard
                </Link>
              }
            />
          )}

          {/* Items */}
          {connected && !loading && !error && items.length > 0 && (
            <div className="flex flex-col gap-2">
              {items.map(item => (
                <ActivityCard key={item.id} item={item} />
              ))}
              {nextCursor && (
                <div ref={sentinelRef} className="py-6 flex justify-center">
                  {loadingMore && <MentionedSpinner className="" />}
                </div>
              )}
              {!nextCursor && items.length >= PAGE_SIZE && (
                <div className="text-center py-8 text-neutral-600 text-xs">You&apos;re all caught up.</div>
              )}
            </div>
          )}

        </div>
      </div>

      <Footer />
    </main>
  )
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-20 gap-3">
      <h2 className="text-white text-lg font-semibold">{title}</h2>
      <p className="text-neutral-500 text-sm max-w-md">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
