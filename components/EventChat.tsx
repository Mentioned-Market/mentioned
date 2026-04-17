'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useWallet } from '@/contexts/WalletContext'
import { useAchievements } from '@/contexts/AchievementContext'

interface ChatMessage {
  id: number
  event_id: string
  wallet: string
  username: string
  message: string
  created_at: string
  pfp_emoji: string | null
}

interface UserPosition {
  marketId: string
  isYes: boolean
  contracts: string
  avgPriceUsd: number
  pnlUsd: number
  pnlUsdPercent: number
  marketMetadata?: { title: string }
}

interface CustomPosition {
  word_id: number
  word: string
  yes_shares: number
  no_shares: number
  tokens_spent: number
  tokens_received: number
}

interface EventChatProps {
  eventId: string
  marketIds: string[]
}

const MAX_LENGTH = 200
const SEND_COOLDOWN = 500
const FALLBACK_POLL_INTERVAL = 30_000
const SCROLL_LOAD_THRESHOLD = 60

function microToUsd(n: number) {
  return (n / 1_000_000).toFixed(2)
}

export default function EventChat({ eventId, marketIds }: EventChatProps) {
  const { connected, publicKey, username, pfpEmoji } = useWallet()
  const { showAchievementToast } = useAchievements()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const lastIdRef = useRef(0)
  const lastSentRef = useRef(0)
  const sseRef = useRef<EventSource | null>(null)
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Backward pagination state
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const oldestIdRef = useRef<number | null>(null)
  const initialLoadDone = useRef(false)
  const initialScrollDone = useRef(false)

  // Detect free market context from eventId (e.g. "custom_42")
  const customMarketId = eventId.startsWith('custom_') ? parseInt(eventId.slice(7), 10) : null

  // Hover card state
  const [hoveredWallet, setHoveredWallet] = useState<string | null>(null)
  const [hoverPositions, setHoverPositions] = useState<UserPosition[]>([])
  const [hoverCustomPositions, setHoverCustomPositions] = useState<CustomPosition[]>([])
  const [hoverPos, setHoverPos] = useState({ top: 0, left: 0 })
  const [loadingPositions, setLoadingPositions] = useState(false)
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const positionCache = useRef<Map<string, UserPosition[]>>(new Map())
  const customPositionCache = useRef<Map<string, CustomPosition[]>>(new Map())

  // ── Initial load ───────────────────────────────────────
  const fetchInitialMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat/event?eventId=${encodeURIComponent(eventId)}`)
      if (!res.ok) return
      const data: ChatMessage[] = await res.json()
      if (data.length > 0) {
        lastIdRef.current = data[data.length - 1].id
        oldestIdRef.current = data[0].id
        setHasMore(data.length >= 50) // If we got a full page, there may be more
      } else {
        setHasMore(false)
      }
      setMessages(data)
      initialLoadDone.current = true
    } catch {}
  }, [eventId])

  // ── Load older messages (backward pagination) ──────────
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || !hasMore || oldestIdRef.current === null) return
    setLoadingOlder(true)

    const container = messagesContainerRef.current
    const prevScrollHeight = container?.scrollHeight ?? 0

    try {
      const res = await fetch(
        `/api/chat/event?eventId=${encodeURIComponent(eventId)}&before=${oldestIdRef.current}`
      )
      if (!res.ok) return
      const data: { messages: ChatMessage[]; hasMore: boolean } = await res.json()

      if (data.messages.length > 0) {
        oldestIdRef.current = data.messages[0].id
        setMessages((prev) => [...data.messages, ...prev])

        // Preserve scroll position after prepend
        requestAnimationFrame(() => {
          if (container) {
            container.scrollTop = container.scrollHeight - prevScrollHeight
          }
        })
      }
      setHasMore(data.hasMore)
    } catch {} finally {
      setLoadingOlder(false)
    }
  }, [eventId, loadingOlder, hasMore])

  // ── Scroll-to-top detection ────────────────────────────
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const handleScroll = () => {
      if (container.scrollTop < SCROLL_LOAD_THRESHOLD && hasMore && !loadingOlder && initialLoadDone.current) {
        loadOlderMessages()
      }
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [hasMore, loadingOlder, loadOlderMessages])

  // ── SSE connection ─────────────────────────────────────
  const connectSSE = useCallback(() => {
    if (sseRef.current) return

    const es = new EventSource(`/api/chat/stream?channel=event_${encodeURIComponent(eventId)}`)
    sseRef.current = es

    es.onmessage = (event) => {
      try {
        const msg: ChatMessage = JSON.parse(event.data)
        if (msg.id <= lastIdRef.current) return
        lastIdRef.current = msg.id

        setMessages((prev) => {
          const withoutOptimistic = prev.filter((m) => m.id > 0)
          return [...withoutOptimistic, msg]
        })
      } catch {}
    }

    es.onerror = () => {
      disconnectSSE()
      startFallbackPolling()
    }
  }, [eventId])

  const disconnectSSE = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close()
      sseRef.current = null
    }
    stopFallbackPolling()
  }, [])

  // ── Fallback polling (only if SSE fails) ───────────────
  const fetchNewMessages = useCallback(async () => {
    if (lastIdRef.current === 0) return
    try {
      const res = await fetch(
        `/api/chat/event?eventId=${encodeURIComponent(eventId)}&after=${lastIdRef.current}`
      )
      if (!res.ok) return
      const data: ChatMessage[] = await res.json()
      if (data.length === 0) return

      const newLastId = data[data.length - 1].id
      if (newLastId > lastIdRef.current) {
        lastIdRef.current = newLastId
      }

      setMessages((prev) => {
        const confirmed = prev.filter((m) => m.id > 0)
        const existingIds = new Set(confirmed.map((m) => m.id))
        const fresh = data.filter((m) => !existingIds.has(m.id))
        if (fresh.length > 0) return [...confirmed, ...fresh]
        return confirmed.length < prev.length ? confirmed : prev
      })
    } catch {}
  }, [eventId])

  const startFallbackPolling = useCallback(() => {
    if (fallbackTimerRef.current) return
    const poll = async () => {
      if (document.hidden) {
        fallbackTimerRef.current = setTimeout(poll, FALLBACK_POLL_INTERVAL)
        return
      }
      await fetchNewMessages()
      fallbackTimerRef.current = setTimeout(poll, FALLBACK_POLL_INTERVAL)
    }
    fallbackTimerRef.current = setTimeout(poll, FALLBACK_POLL_INTERVAL)
  }, [fetchNewMessages])

  const stopFallbackPolling = useCallback(() => {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current)
      fallbackTimerRef.current = null
    }
  }, [])

  // ── Mount/unmount lifecycle ────────────────────────────
  useEffect(() => {
    // Reset state when eventId changes (navigating between markets)
    setMessages([])
    setHasMore(true)
    setLoadingOlder(false)
    lastIdRef.current = 0
    oldestIdRef.current = null
    initialLoadDone.current = false
    initialScrollDone.current = false

    fetchInitialMessages().then(() => {
      connectSSE()
    })

    return () => {
      disconnectSSE()
      stopFallbackPolling()
    }
  }, [eventId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll within chat container on new messages
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    // Force scroll to bottom on initial load so user sees most recent messages
    if (!initialScrollDone.current && messages.length > 0) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight
      })
      initialScrollDone.current = true
      return
    }
    // Only auto-scroll if user is near the bottom (within 100px)
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
    if (isNearBottom) {
      container.scrollTop = container.scrollHeight
    }
  }, [messages])

  // ── Send message ───────────────────────────────────────
  const sendMessage = useCallback(async () => {
    if (!publicKey || !input.trim()) return
    const now = Date.now()
    if (now - lastSentRef.current < SEND_COOLDOWN) return
    lastSentRef.current = now

    const text = input.trim().slice(0, MAX_LENGTH)
    setInput('')

    const optimistic: ChatMessage = {
      id: -Date.now(),
      event_id: eventId,
      wallet: publicKey,
      username: username || `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`,
      message: text,
      created_at: new Date().toISOString(),
      pfp_emoji: pfpEmoji,
    }
    setMessages((prev) => [...prev, optimistic])

    fetch('/api/chat/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: publicKey, message: text, eventId }),
    }).then(r => r.json()).then(data => {
      if (data.newAchievements?.length) {
        for (const ach of data.newAchievements) showAchievementToast(ach)
      }
    }).catch(() => {})
  }, [publicKey, input, username, pfpEmoji, eventId, showAchievementToast])

  // ── Hover card: fetch positions ────────────────────────
  const fetchUserPositions = useCallback(async (wallet: string) => {
    setLoadingPositions(true)

    if (customMarketId !== null) {
      if (customPositionCache.current.has(wallet)) {
        setHoverCustomPositions(customPositionCache.current.get(wallet)!)
        setLoadingPositions(false)
        return
      }
      try {
        const res = await fetch(`/api/custom/${customMarketId}/positions?wallet=${wallet}`)
        if (!res.ok) { setHoverCustomPositions([]); return }
        const json = await res.json()
        const positions: CustomPosition[] = (json.positions || []).filter(
          (p: CustomPosition) => p.yes_shares >= 0.01 || p.no_shares >= 0.01
        )
        customPositionCache.current.set(wallet, positions)
        if (customPositionCache.current.size > 200) customPositionCache.current.clear()
        setHoverCustomPositions(positions)
      } catch {
        setHoverCustomPositions([])
      } finally {
        setLoadingPositions(false)
      }
    } else {
      if (positionCache.current.has(wallet)) {
        setHoverPositions(positionCache.current.get(wallet)!)
        setLoadingPositions(false)
        return
      }
      try {
        const res = await fetch(`/api/polymarket/positions?ownerPubkey=${wallet}`)
        if (!res.ok) { setHoverPositions([]); return }
        const json = await res.json()
        const marketIdSet = new Set(marketIds)
        const positions: UserPosition[] = (json.data || json || []).filter(
          (p: any) => marketIdSet.has(p.marketId)
        )
        positionCache.current.set(wallet, positions)
        if (positionCache.current.size > 200) positionCache.current.clear()
        setHoverPositions(positions)
      } catch {
        setHoverPositions([])
      } finally {
        setLoadingPositions(false)
      }
    }
  }, [customMarketId, marketIds])

  const handleMouseEnter = useCallback((wallet: string, e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    setHoverPos({ top: rect.bottom + 4, left: rect.left })
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
    hoverTimeout.current = setTimeout(() => {
      setHoveredWallet(wallet)
      fetchUserPositions(wallet)
    }, 300)
  }, [fetchUserPositions])

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
    hoverTimeout.current = setTimeout(() => {
      setHoveredWallet(null)
      setHoverPositions([])
    }, 200)
  }, [])

  const formatTime = (ts: string) => {
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="flex flex-col h-full bg-neutral-900/50 border border-white/5 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <span className="text-white text-sm font-semibold">Event Chat</span>
        <span className="text-neutral-500 text-xs ml-auto">{messages.filter(m => m.id > 0).length} messages</span>
      </div>

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {/* Loading older indicator */}
        {loadingOlder && (
          <div className="flex justify-center py-2">
            <div className="w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
          </div>
        )}
        {!hasMore && messages.length > 0 && (
          <div className="py-2" />
        )}

        {messages.length === 0 && !loadingOlder && (
          <div className="flex items-center justify-center h-full">
            <p className="text-neutral-500 text-xs">No messages yet. Be the first to chat!</p>
          </div>
        )}
        {messages.map((msg) => {
          const isOwn = msg.wallet === publicKey
          return (
            <div key={msg.id} className="flex flex-col gap-0.5">
              <div className="flex items-baseline gap-2">
                {msg.pfp_emoji && (
                  <span className="text-xs">{msg.pfp_emoji}</span>
                )}
                {isOwn ? (
                  <Link
                    href={`/profile/${msg.username}`}
                    className="text-xs font-semibold text-apple-green hover:underline transition-colors"
                    onMouseEnter={(e) => handleMouseEnter(msg.wallet, e)}
                    onMouseLeave={handleMouseLeave}
                  >
                    {msg.username}
                  </Link>
                ) : (
                  <Link
                    href={`/profile/${msg.wallet}`}
                    className="text-xs font-semibold text-white hover:text-apple-blue transition-colors"
                    onMouseEnter={(e) => handleMouseEnter(msg.wallet, e)}
                    onMouseLeave={handleMouseLeave}
                  >
                    {msg.username}
                  </Link>
                )}
                <span className="text-[10px] text-neutral-600">
                  {formatTime(msg.created_at)}
                </span>
              </div>
              <p className="text-sm text-neutral-300 break-words">{msg.message}</p>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Position hover card */}
      {hoveredWallet && (
        <div
          className="fixed z-[70] w-64 bg-neutral-900 border border-white/10 rounded-xl shadow-xl p-3"
          style={{ top: hoverPos.top, left: hoverPos.left }}
          onMouseEnter={() => {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
          }}
          onMouseLeave={handleMouseLeave}
        >
          <div className="text-xs text-neutral-400 mb-2">
            {hoveredWallet.slice(0, 4)}...{hoveredWallet.slice(-4)} positions in this {customMarketId !== null ? 'market' : 'event'}
          </div>
          {loadingPositions ? (
            <div className="text-xs text-neutral-500">Loading...</div>
          ) : customMarketId !== null ? (
            // Free market positions
            hoverCustomPositions.length === 0 ? (
              <div className="text-xs text-neutral-500">No open positions</div>
            ) : (
              <div className="space-y-2">
                {hoverCustomPositions.flatMap((pos) => {
                  const rows = []
                  if (pos.yes_shares >= 0.01) rows.push({ word: pos.word, side: 'YES', shares: pos.yes_shares })
                  if (pos.no_shares >= 0.01) rows.push({ word: pos.word, side: 'NO', shares: pos.no_shares })
                  return rows
                }).slice(0, 6).map((row, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${row.side === 'YES' ? 'bg-apple-green/10 text-apple-green' : 'bg-apple-red/10 text-apple-red'}`}>
                        {row.side}
                      </span>
                      <span className="text-neutral-300 truncate">{row.word}</span>
                    </div>
                    <span className="text-neutral-400 flex-shrink-0">{row.shares.toFixed(1)} shares</span>
                  </div>
                ))}
              </div>
            )
          ) : (
            // Polymarket positions
            hoverPositions.length === 0 ? (
              <div className="text-xs text-neutral-500">No positions in this event</div>
            ) : (
              <div className="space-y-2">
                {hoverPositions.slice(0, 4).map((pos, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${pos.isYes ? 'bg-apple-green/10 text-apple-green' : 'bg-apple-red/10 text-apple-red'}`}>
                        {pos.isYes ? 'YES' : 'NO'}
                      </span>
                      <span className="text-neutral-300 truncate">
                        {pos.marketMetadata?.title || pos.marketId.slice(-8)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-neutral-400">{pos.contracts}ct</span>
                      <span className={pos.pnlUsd >= 0 ? 'text-apple-green' : 'text-apple-red'}>
                        {pos.pnlUsd >= 0 ? '+' : ''}{microToUsd(pos.pnlUsd)}
                      </span>
                    </div>
                  </div>
                ))}
                {hoverPositions.length > 4 && (
                  <div className="text-[10px] text-neutral-500">+{hoverPositions.length - 4} more</div>
                )}
              </div>
            )
          )}
        </div>
      )}

      {/* Input */}
      <div className="px-3 py-3 border-t border-white/5">
        {connected ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              sendMessage()
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={MAX_LENGTH}
              placeholder="Type a message..."
              className="flex-1 h-9 px-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-neutral-500 focus:outline-none focus:border-white/25 transition-colors"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="h-9 px-3 bg-white text-black text-xs font-semibold rounded-lg hover:bg-neutral-100 transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </form>
        ) : (
          <p className="text-neutral-500 text-xs text-center py-1">
            Connect wallet to chat
          </p>
        )}
      </div>
    </div>
  )
}
