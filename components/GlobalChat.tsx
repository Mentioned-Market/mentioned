'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useWallet } from '@/contexts/WalletContext'

interface ChatMessage {
  id: number
  wallet: string
  username: string
  message: string
  created_at: string
}

const POLL_INTERVAL = 3000
const MAX_LENGTH = 200
const SEND_COOLDOWN = 500

export default function GlobalChat() {
  const { connected, publicKey } = useWallet()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [unread, setUnread] = useState(0)
  const [username, setUsername] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const openRef = useRef(open)
  const lastIdRef = useRef(0)
  const lastSentRef = useRef(0)

  useEffect(() => {
    openRef.current = open
    if (open) setUnread(0)
  }, [open])

  // Fetch username for optimistic messages
  useEffect(() => {
    if (!publicKey) { setUsername(null); return }
    fetch(`/api/profile?wallet=${publicKey}`)
      .then((r) => r.json())
      .then((d) => setUsername(d.username ?? null))
      .catch(() => {})
  }, [publicKey])

  // Fetch messages (initial load + polling for new)
  const fetchMessages = useCallback(async () => {
    try {
      const url = lastIdRef.current > 0
        ? `/api/chat?after=${lastIdRef.current}`
        : '/api/chat'
      const res = await fetch(url)
      if (!res.ok) return
      const data: ChatMessage[] = await res.json()
      if (data.length === 0) return

      const newLastId = data[data.length - 1].id
      if (newLastId > lastIdRef.current) {
        if (lastIdRef.current > 0 && !openRef.current) {
          setUnread((n) => n + data.length)
        }
        lastIdRef.current = newLastId
      }

      setMessages((prev) => {
        if (prev.length === 0) return data
        // Remove optimistic messages (negative ids) that now have real server rows
        const confirmed = prev.filter((m) => m.id > 0)
        const existingIds = new Set(confirmed.map((m) => m.id))
        const fresh = data.filter((m) => !existingIds.has(m.id))
        return fresh.length > 0 ? [...confirmed, ...fresh] : confirmed.length < prev.length ? confirmed : prev
      })
    } catch {}
  }, [])

  // Initial load + polling
  useEffect(() => {
    fetchMessages()
    const interval = setInterval(fetchMessages, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchMessages])

  // Auto-scroll on new messages when open
  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, open])

  const sendMessage = useCallback(async () => {
    if (!publicKey || !input.trim()) return
    const now = Date.now()
    if (now - lastSentRef.current < SEND_COOLDOWN) return
    lastSentRef.current = now

    const text = input.trim().slice(0, MAX_LENGTH)
    setInput('')

    // Optimistic: show message immediately with a temporary negative id
    const optimistic: ChatMessage = {
      id: -Date.now(),
      wallet: publicKey,
      username: username || `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`,
      message: text,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])

    // Fire-and-forget POST — next poll will bring the real row
    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: publicKey, message: text }),
    }).catch(() => {})
  }, [publicKey, input, username])

  const formatTime = (ts: string) => {
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // Collapsed state — chat bubble
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 md:bottom-6 md:right-6 z-[60] flex items-center gap-2 px-4 py-2.5 bg-neutral-900 border border-white/10 rounded-full shadow-card-hover hover:bg-neutral-800 transition-all duration-200"
      >
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <span className="text-white text-xs font-semibold">Chat</span>
        {unread > 0 && (
          <span className="flex items-center justify-center w-5 h-5 bg-apple-red rounded-full text-white text-[10px] font-bold">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    )
  }

  // Expanded state
  return (
    <div className="fixed bottom-4 right-4 md:bottom-6 md:right-6 z-[60] w-[340px] h-[440px] flex flex-col bg-neutral-900 border border-white/10 rounded-2xl shadow-card-hover animate-scale-in overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span className="text-white text-sm font-semibold">Global Chat</span>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-neutral-400 hover:text-white transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-neutral-500 text-xs">No messages yet. Say something!</p>
          </div>
        )}
        {messages.map((msg) => {
          const isOwn = msg.wallet === publicKey
          return (
            <div key={msg.id} className="flex flex-col gap-0.5">
              <div className="flex items-baseline gap-2">
                {isOwn ? (
                  <span className="text-xs font-semibold text-apple-green">{msg.username}</span>
                ) : (
                  <Link href={`/profile/${msg.wallet}`} className="text-xs font-semibold text-white hover:text-apple-blue transition-colors">
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
