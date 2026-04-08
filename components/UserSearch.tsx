'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface SearchResult {
  wallet: string
  username: string | null
  pfpEmoji: string | null
}

const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

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

function ResultsList({ results, activeIdx, onNavigate, onHover }: {
  results: SearchResult[]
  activeIdx: number
  onNavigate: (r: SearchResult) => void
  onHover: (i: number) => void
}) {
  if (results.length === 0) {
    return <div className="px-4 py-3 text-neutral-500 text-xs">No users found</div>
  }
  return (
    <>
      {results.map((r, i) => (
        <button
          key={r.wallet}
          onMouseDown={(e) => { e.preventDefault(); onNavigate(r) }}
          onMouseEnter={() => onHover(i)}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100"
          style={{ background: i === activeIdx ? 'rgba(255,255,255,0.06)' : undefined }}
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
      ))}
    </>
  )
}

export default function UserSearch() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const mobileRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const mobileInputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < 2) {
      setResults([])
      setOpen(false)
      setLoading(false)
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/profile/search?q=${encodeURIComponent(q)}`)
        if (res.ok) {
          const data = await res.json()
          setResults(data.results ?? [])
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

  const navigate = (result: SearchResult) => {
    const dest = result.username ?? result.wallet
    router.push(`/profile/${dest}`)
    close()
  }

  const close = () => {
    setQuery('')
    setResults([])
    setOpen(false)
    setMobileOpen(false)
    setActiveIdx(-1)
    inputRef.current?.blur()
    mobileInputRef.current?.blur()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { close(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIdx >= 0 && results[activeIdx]) {
        navigate(results[activeIdx])
      } else if (results.length === 1) {
        navigate(results[0])
      } else if (WALLET_RE.test(query.trim())) {
        router.push(`/profile/${query.trim()}`)
        close()
      }
    }
  }

  // Close desktop dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
      if (mobileRef.current && !mobileRef.current.contains(e.target as Node)) {
        close()
      }
    }
    if (open || mobileOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, mobileOpen])

  // Auto-focus mobile input when opened
  useEffect(() => {
    if (mobileOpen) mobileInputRef.current?.focus()
  }, [mobileOpen])

  const showDropdown = open && (results.length > 0 || (query.length >= 2 && !loading))

  return (
    <>
      {/* ── Desktop: inline search bar ── */}
      <div ref={containerRef} className="relative hidden md:block">
        <div
          className="flex items-center gap-2 h-8 rounded-lg px-3 transition-all duration-200"
          style={{
            background: focused ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
            border: focused ? '1px solid rgba(255,255,255,0.15)' : '1px solid rgba(255,255,255,0.06)',
            width: focused ? 240 : 180,
          }}
        >
          <SearchIcon className="w-3.5 h-3.5 text-neutral-500 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => handleChange(e.target.value)}
            onFocus={() => { setFocused(true); if (query.length >= 2 && results.length > 0) setOpen(true) }}
            onBlur={() => setFocused(false)}
            onKeyDown={handleKeyDown}
            placeholder="Search users..."
            className="bg-transparent text-white text-xs flex-1 outline-none placeholder-neutral-600 min-w-0"
            maxLength={44}
          />
          {loading && <Spinner />}
        </div>

        {showDropdown && (
          <div className="absolute top-full left-0 mt-1.5 w-64 bg-neutral-900 rounded-xl overflow-hidden z-50 shadow-card-hover border border-white/10 animate-scale-in">
            <ResultsList results={results} activeIdx={activeIdx} onNavigate={navigate} onHover={setActiveIdx} />
          </div>
        )}
      </div>

      {/* ── Mobile: search icon + overlay ── */}
      <div ref={mobileRef} className="md:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="flex items-center justify-center w-8 h-8 text-neutral-400 hover:text-white transition-colors"
          aria-label="Search users"
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
                  placeholder="Search users..."
                  className="bg-transparent text-white text-sm flex-1 outline-none placeholder-neutral-500 min-w-0"
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
                <ResultsList results={results} activeIdx={activeIdx} onNavigate={navigate} onHover={setActiveIdx} />
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
