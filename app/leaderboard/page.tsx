'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

// ── Types ──────────────────────────────────────────────────

interface LeaderboardEntry {
  wallet: string
  username: string | null
  pnl: number
  winningTrades: number
  totalTrades: number
  volume: number
}

// ── Helpers ────────────────────────────────────────────────

function microToUsd(micro: number): string {
  if (!Number.isFinite(micro) || micro === 0) return '$0.00'
  return `$${(Math.abs(micro) / 1_000_000).toFixed(2)}`
}

function microToUsdSigned(micro: number): string {
  if (!Number.isFinite(micro) || micro === 0) return '$0.00'
  const sign = micro > 0 ? '+' : '-'
  return `${sign}$${(Math.abs(micro) / 1_000_000).toFixed(2)}`
}

function formatVolume(micro: number): string {
  if (!Number.isFinite(micro) || micro === 0) return '$0'
  const usd = Math.abs(micro) / 1_000_000
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`
  return `$${usd.toFixed(0)}`
}

function truncateWallet(w: string): string {
  return `${w.slice(0, 4)}...${w.slice(-4)}`
}

function formatWeekRange(weekStartIso: string): string {
  const start = new Date(weekStartIso)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`
}

function winRate(entry: LeaderboardEntry): number {
  if (entry.totalTrades === 0) return 0
  return entry.winningTrades / entry.totalTrades
}

// ── Sort ───────────────────────────────────────────────────

type SortKey = 'pnl' | 'volume' | 'winRate'

// ── Component ──────────────────────────────────────────────

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [weekStart, setWeekStart] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<SortKey>('pnl')

  useEffect(() => {
    let mounted = true

    async function fetchLeaderboard() {
      try {
        const res = await fetch('/api/polymarket/leaderboard')
        if (!res.ok) throw new Error('Failed to fetch leaderboard')
        const json = await res.json()
        if (mounted) {
          setEntries(json.data || [])
          setWeekStart(json.weekStart || '')
        }
      } catch (err) {
        console.error('Leaderboard fetch error:', err)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    fetchLeaderboard()
    const interval = setInterval(fetchLeaderboard, 60_000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  const sorted = useMemo(() => {
    const copy = [...entries]
    switch (sortBy) {
      case 'pnl':
        return copy.sort((a, b) => b.pnl - a.pnl)
      case 'volume':
        return copy.sort((a, b) => b.volume - a.volume)
      case 'winRate':
        return copy.sort((a, b) => winRate(b) - winRate(a))
      default:
        return copy
    }
  }, [entries, sortBy])

  // ── Summary stats ──────────────────────────────────────

  const totalTraders = entries.length
  const totalVolume = entries.reduce((s, e) => s + e.volume, 0)
  const topPnl = entries.length > 0 ? Math.max(...entries.map(e => e.pnl)) : 0
  const bestWinRate = entries.length > 0
    ? Math.max(...entries.map(e => winRate(e)))
    : 0

  // ── Rank badge ──────────────────────────────────────────

  function rankBadge(rank: number) {
    if (rank === 1) return <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-yellow-500/15 text-yellow-400 text-xs font-bold">1</span>
    if (rank === 2) return <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-neutral-300/15 text-neutral-300 text-xs font-bold">2</span>
    if (rank === 3) return <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-orange-500/15 text-orange-400 text-xs font-bold">3</span>
    return <span className="inline-flex items-center justify-center w-7 h-7 text-neutral-500 text-xs font-medium">{rank}</span>
  }

  // ── Sort buttons ───────────────────────────────────────

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: 'pnl', label: 'P&L' },
    { key: 'volume', label: 'Volume' },
    { key: 'winRate', label: 'Win Rate' },
  ]

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-7xl mx-auto px-4 md:px-10 lg:px-20">
        <Header />

        <main className="py-4 md:py-6 animate-fade-in">
          {/* Title */}
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 mb-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-white">Leaderboard</h1>
              {weekStart && (
                <p className="text-neutral-400 text-sm mt-1">
                  Weekly rankings &middot; {formatWeekRange(weekStart)}
                </p>
              )}
            </div>

            {/* Sort */}
            <div className="flex items-center gap-1">
              {sortOptions.map(s => (
                <button
                  key={s.key}
                  onClick={() => setSortBy(s.key)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                    sortBy === s.key
                      ? 'bg-white/10 text-white'
                      : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="glass rounded-xl p-4">
              <div className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-1">Traders</div>
              <div className="text-white text-xl font-bold">{totalTraders}</div>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-1">Total Volume</div>
              <div className="text-white text-xl font-bold">{formatVolume(totalVolume)}</div>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-1">Top P&L</div>
              <div className={`text-xl font-bold ${topPnl > 0 ? 'text-apple-green' : topPnl < 0 ? 'text-apple-red' : 'text-white'}`}>
                {microToUsdSigned(topPnl)}
              </div>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-1">Best Win Rate</div>
              <div className="text-white text-xl font-bold">
                {totalTraders > 0 ? `${(bestWinRate * 100).toFixed(0)}%` : '—'}
              </div>
            </div>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            </div>
          )}

          {/* Empty state */}
          {!loading && sorted.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <span className="text-neutral-500 text-sm">No trades this week yet</span>
              <Link href="/polymarkets" className="text-apple-blue text-sm font-medium hover:underline">
                Browse Polymarkets
              </Link>
            </div>
          )}

          {/* Table */}
          {!loading && sorted.length > 0 && (
            <div className="rounded-xl border border-white/5 overflow-hidden">
              {/* Desktop header */}
              <div className="hidden md:grid grid-cols-[60px_2fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2.5 text-[10px] text-neutral-500 font-medium uppercase tracking-wider border-b border-white/5 bg-white/[0.02]">
                <div>Rank</div>
                <div>Trader</div>
                <div className="text-right">P&L</div>
                <div className="text-right">Win Rate</div>
                <div className="text-right">Winning Trades</div>
                <div className="text-right">Volume</div>
              </div>

              {sorted.map((entry, i) => {
                const rank = i + 1
                const wr = winRate(entry)
                const pnlColor = entry.pnl > 0 ? 'text-apple-green' : entry.pnl < 0 ? 'text-apple-red' : 'text-neutral-400'

                return (
                  <div
                    key={entry.wallet}
                    className="grid grid-cols-1 md:grid-cols-[60px_2fr_1fr_1fr_1fr_1fr] gap-1 md:gap-3 px-4 py-3 border-b border-white/5 last:border-b-0 hover:bg-white/[0.03] transition-colors duration-150"
                  >
                    {/* Mobile layout */}
                    <div className="flex md:hidden items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        {rankBadge(rank)}
                        <div>
                          <span className="text-white text-sm font-medium">
                            {entry.username || truncateWallet(entry.wallet)}
                          </span>
                          {entry.username && (
                            <span className="text-neutral-500 text-xs ml-2 font-mono">
                              {truncateWallet(entry.wallet)}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className={`text-sm font-semibold ${pnlColor}`}>
                        {microToUsdSigned(entry.pnl)}
                      </span>
                    </div>
                    <div className="flex md:hidden items-center justify-between text-xs text-neutral-400 mt-1">
                      <span>Win Rate: {(wr * 100).toFixed(0)}% ({entry.winningTrades}/{entry.totalTrades})</span>
                      <span>Vol: {formatVolume(entry.volume)}</span>
                    </div>

                    {/* Desktop layout */}
                    <div className="hidden md:flex items-center">
                      {rankBadge(rank)}
                    </div>
                    <div className="hidden md:flex items-center gap-2">
                      <span className="text-white text-sm font-medium">
                        {entry.username || truncateWallet(entry.wallet)}
                      </span>
                      {entry.username && (
                        <span className="text-neutral-500 text-xs font-mono">
                          {truncateWallet(entry.wallet)}
                        </span>
                      )}
                    </div>
                    <div className={`hidden md:flex items-center justify-end text-sm font-semibold ${pnlColor}`}>
                      {microToUsdSigned(entry.pnl)}
                    </div>
                    <div className="hidden md:flex items-center justify-end text-sm text-neutral-300">
                      {entry.totalTrades > 0 ? `${(wr * 100).toFixed(0)}%` : '—'}
                    </div>
                    <div className="hidden md:flex items-center justify-end text-sm text-neutral-300">
                      {entry.winningTrades}/{entry.totalTrades}
                    </div>
                    <div className="hidden md:flex items-center justify-end text-sm text-neutral-300">
                      {formatVolume(entry.volume)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </main>

        <Footer />
      </div>
    </div>
  )
}
