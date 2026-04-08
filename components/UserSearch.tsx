'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface UserResult {
  wallet: string
  username: string | null
  pfpEmoji: string | null
}

interface MarketResult {
  id: number
  title: string
  slug: string
  status: string
  coverImageUrl: string | null
}

const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const PLACEHOLDERS = ['Search users...', 'Search markets...']

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg className="w-3 h-3 animate-spin text-neutral-500 flex-shrink-0" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-apple-green/10 text-apple-green',
  locked: 'bg-yellow-500/10 text-yellow-400',
  resolved: 'bg-white/5 text-neutral-400',
}

function DropdownContent({ users, markets, activeIdx, onNavigateUser, onNavigateMarket, onHover }: {
  users: UserResult[]
  markets: MarketResult[]
  activeIdx: number
  onNavigateUser: (r: UserResult) => void
  onNavigateMarket: (r: MarketResult) => void
  onHover: (i: number) => void
}) {
  if (users.length === 0 && markets.length === 0) {
    return <div className="px-4 py-3 text-neutral-500 text-xs">No results found</div>
  }

  let idx = 0

  return (
    <>
      {users.length > 0 && (
        <>
          <div className="px-4 pt-2.5 pb-1 text-[10px] text-neutral-600 uppercase tracking-widest font-medium">Users</div>
          {users.map((r) => {
            const thisIdx = idx++
            return (
              <button
                key={r.wallet}
                onMouseDown={(e) => { e.preventDefault(); onNavigateUser(r) }}
                onMouseEnter={() => onHover(thisIdx)}
                className="w-full flex items-center gap-3 px-4 py-2 text-left transition-colors duration-100"
                style={{ background: thisIdx === activeIdx ? 'rgba(255,255,255,0.06)' : undefined }}
              >
                <span className="w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  {r.pfpEmoji ?? '⚪'}
                </span>
                <div className="min-w-0">
                  <span className="text-white text-sm font-medium truncate block">
                    {r.username ?? `${r.wallet.slice(0, 4)}...${r.wallet.slice(-4)}`}
                  </span>
                  {r.username && (
                    <span className="text-neutral-600 text-[10px] truncate block">
                      {r.wallet.slice(0, 4)}...{r.wallet.slice(-4)}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </>
      )}

      {markets.length > 0 && (
        <>
          <div className={`px-4 pt-2.5 pb-1 text-[10px] text-neutral-600 uppercase tracking-widest font-medium ${users.length > 0 ? 'border-t border-white/[0.06]' : ''}`}>Markets</div>
          {markets.map((m) => {
            const thisIdx = idx++
            const statusStyle = STATUS_STYLES[m.status] ?? 'bg-white/5 text-neutral-400'
            return (
              <button
                key={m.id}
                onMouseDown={(e) => { e.preventDefault(); onNavigateMarket(m) }}
                onMouseEnter={() => onHover(thisIdx)}
                className="w-full flex items-center gap-3 px-4 py-2 text-left transition-colors duration-100"
                style={{ background: thisIdx === activeIdx ? 'rgba(255,255,255,0.06)' : undefined }}
              >
                <span className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  📊
                </span>
                <div className="min-w-0 flex-1">
                  <span className="text-white text-sm font-medium truncate block">{m.title}</span>
                  <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full mt-0.5 ${statusStyle}`}>
                    {m.status.charAt(0).toUpperCase() + m.status.slice(1)}
                  </span>
                </div>
              </button>
            )
          })}
        </>
      )}
    </>
  )
}

export default function UserSearch() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<UserResult[]>([])
  const [markets, setMarkets] = useState<MarketResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const mobileRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const mobileInputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cycle placeholder text
  useEffect(() => {
    const id = setInterval(() => setPlaceholderIdx(i => (i + 1) % PLACEHOLDERS.length), 3000)
    return () => clearInterval(id)
  }, [])

  const totalResults = users.length + markets.length

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < 2) {
      setUsers([])
      setMarkets([])
      setOpen(false)
      setLoading(false)
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
        if (res.ok) {
          const data = await res.json()
          setUsers(data.results ?? [])
          setMarkets(data.markets ?? [])
          setOpen(true)
        }
      } catch { /* ignore */ }
      setLoading(false)
    }, 300)
  }, [])

  const handleChange = (val: string) => {
    setQuery(val)
    setActiveIdx(-1)
    search(val)
  }

  const navigateUser = (r: UserResult) => {
    router.push(`/profile/${r.username ?? r.wallet}`)
    close()
  }

  const navigateMarket = (m: MarketResult) => {
    router.push(`/free/${m.slug}`)
    close()
  }

  const close = () => {
    setQuery('')
    setUsers([])
    setMarkets([])
    setOpen(false)
    setFocused(false)
    setMobileOpen(false)
    setActiveIdx(-1)
    inputRef.current?.blur()
    mobileInputRef.current?.blur()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { close(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, totalResults - 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIdx >= 0) {
        if (activeIdx < users.length) {
          navigateUser(users[activeIdx])
        } else {
          navigateMarket(markets[activeIdx - users.length])
        }
      } else if (totalResults === 1) {
        if (users.length === 1) navigateUser(users[0])
        else navigateMarket(markets[0])
      } else if (WALLET_RE.test(query.trim())) {
        router.push(`/profile/${query.trim()}`)
        close()
      }
    }
  }

  // Close on outside click (desktop + mobile)
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close()
      }
      if (mobileRef.current && !mobileRef.current.contains(e.target as Node)) {
        close()
      }
    }
    if (focused || open || mobileOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [focused, open, mobileOpen])

  // Auto-focus desktop input when expanded
  useEffect(() => {
    if (focused) inputRef.current?.focus()
  }, [focused])

  // Auto-focus mobile input when opened
  useEffect(() => {
    if (mobileOpen) mobileInputRef.current?.focus()
  }, [mobileOpen])

  const showDropdown = open && (totalResults > 0 || (query.length >= 2 && !loading))
  const placeholder = PLACEHOLDERS[placeholderIdx]

  return (
    <>
      {/* ── Desktop: icon that expands to search bar ── */}
      <div ref={containerRef} className="relative hidden md:block">
        {!focused ? (
          <button
            onClick={() => setFocused(true)}
            className="flex items-center justify-center w-8 h-8 md:w-9 md:h-9 rounded-lg text-neutral-400 hover:text-white transition-colors duration-200"
            aria-label="Search"
          >
            <SearchIcon className="w-4 h-4" />
          </button>
        ) : (
          <div className="flex items-center gap-2 h-8 md:h-9 rounded-lg px-3 bg-white/[0.08] border border-white/[0.15]" style={{ width: 240 }}>
            <SearchIcon className="w-3.5 h-3.5 text-neutral-500 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => handleChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="bg-transparent text-white text-xs flex-1 outline-none ring-0 focus:outline-none focus:ring-0 placeholder-neutral-500 min-w-0"
              maxLength={44}
            />
            {loading && <Spinner />}
          </div>
        )}

        {showDropdown && (
          <div className="absolute top-full right-0 mt-1.5 w-72 bg-neutral-900 rounded-xl overflow-hidden z-50 shadow-card-hover border border-white/10 animate-scale-in max-h-[70vh] overflow-y-auto">
            <DropdownContent users={users} markets={markets} activeIdx={activeIdx} onNavigateUser={navigateUser} onNavigateMarket={navigateMarket} onHover={setActiveIdx} />
          </div>
        )}
      </div>

      {/* ── Mobile: search icon + overlay ── */}
      <div ref={mobileRef} className="md:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="flex items-center justify-center w-8 h-8 text-neutral-400 hover:text-white transition-colors"
          aria-label="Search"
        >
          <SearchIcon className="w-4 h-4" />
        </button>

        {mobileOpen && (
          <div className="fixed inset-x-0 top-0 z-[60] bg-black/95 backdrop-blur-sm px-4 pt-3 pb-2 border-b border-white/10 animate-fade-in">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 flex-1 h-10 rounded-lg px-3 bg-white/[0.08] border border-white/[0.15]">
                <SearchIcon className="w-4 h-4 text-neutral-500 flex-shrink-0" />
                <input
                  ref={mobileInputRef}
                  type="text"
                  value={query}
                  onChange={e => handleChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={placeholder}
                  className="bg-transparent text-white text-sm flex-1 outline-none ring-0 focus:outline-none focus:ring-0 placeholder-neutral-500 min-w-0"
                  maxLength={44}
                />
                {loading && <Spinner />}
              </div>
              <button onClick={close} className="text-neutral-400 text-sm font-medium px-2 py-1">
                Cancel
              </button>
            </div>

            {showDropdown && (
              <div className="mt-2 bg-neutral-900 rounded-xl overflow-hidden border border-white/10 max-h-[60vh] overflow-y-auto">
                <DropdownContent users={users} markets={markets} activeIdx={activeIdx} onNavigateUser={navigateUser} onNavigateMarket={navigateMarket} onHover={setActiveIdx} />
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
