'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import InfoTooltip from '@/components/InfoTooltip'

// ── Types ──────────────────────────────────────────────────

interface LeaderboardEntry {
  wallet: string
  username: string | null
  pnl: number
  winningTrades: number
  totalTrades: number
  volume: number
}

interface PointsEntry {
  wallet: string
  username: string | null
  weeklyPoints: number
  allTimePoints: number
  breakdown: { trades: number; wins: number; chats: number; holds: number }
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
type PointsSortKey = 'weekly' | 'alltime'
type TradingPeriod = 'weekly' | 'alltime'
type Tab = 'trading' | 'points'

// ── Component ──────────────────────────────────────────────

export default function LeaderboardPage() {
  const [tab, setTab] = useState<Tab>('points')

  // Trading tab state
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [weekStart, setWeekStart] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<SortKey>('pnl')
  const [tradingPeriod, setTradingPeriod] = useState<TradingPeriod>('weekly')

  // Points tab state
  const [pointsEntries, setPointsEntries] = useState<PointsEntry[]>([])
  const [pointsWeekStart, setPointsWeekStart] = useState<string>('')
  const [pointsLoading, setPointsLoading] = useState(true)
  const [pointsSort, setPointsSort] = useState<PointsSortKey>('weekly')

  // ── Fetch trading leaderboard (lazy — only when tab active) ──

  useEffect(() => {
    if (tab !== 'trading') return
    let mounted = true

    async function fetchLeaderboard() {
      try {
        const res = await fetch(`/api/polymarket/leaderboard?period=${tradingPeriod}`)
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

    setLoading(true)
    fetchLeaderboard()
    const interval = setInterval(fetchLeaderboard, 60_000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [tab, tradingPeriod])

  // ── Fetch points leaderboard ───────────────────────────

  useEffect(() => {
    let mounted = true

    async function fetchPoints() {
      try {
        const res = await fetch(`/api/polymarket/leaderboard/points?sort=${pointsSort}`)
        if (!res.ok) throw new Error('Failed to fetch points')
        const json = await res.json()
        if (mounted) {
          setPointsEntries(json.data || [])
          setPointsWeekStart(json.weekStart || '')
        }
      } catch (err) {
        console.error('Points leaderboard fetch error:', err)
      } finally {
        if (mounted) setPointsLoading(false)
      }
    }

    setPointsLoading(true)
    fetchPoints()
    return () => { mounted = false }
  }, [pointsSort])

  // ── Sort trading entries ───────────────────────────────

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
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
            <Header />
            <main className="py-4 md:py-6 animate-fade-in">
          {/* Title */}
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 mb-6">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl md:text-3xl font-bold text-white">Leaderboard</h1>
                <InfoTooltip position="below">
                  <div className="space-y-2">
                    <p>Link your Discord on your profile to earn points! The top 5 point earners each week win real USDC. Week ends Sunday night GMT — winners notified via Discord.</p>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-neutral-500">
                          <th className="text-left font-medium pb-1">Place</th>
                          <th className="text-right font-medium pb-1">Prize</th>
                          <th className="text-right font-medium pb-1">%</th>
                        </tr>
                      </thead>
                      <tbody className="text-neutral-200">
                        <tr><td className="py-0.5">1st</td><td className="text-right text-yellow-400 font-semibold">$40</td><td className="text-right">40%</td></tr>
                        <tr><td className="py-0.5">2nd</td><td className="text-right text-neutral-300 font-semibold">$25</td><td className="text-right">25%</td></tr>
                        <tr><td className="py-0.5">3rd</td><td className="text-right text-orange-400 font-semibold">$18</td><td className="text-right">18%</td></tr>
                        <tr><td className="py-0.5">4th</td><td className="text-right font-semibold">$10</td><td className="text-right">10%</td></tr>
                        <tr><td className="py-0.5">5th</td><td className="text-right font-semibold">$7</td><td className="text-right">7%</td></tr>
                      </tbody>
                    </table>
                  </div>
                </InfoTooltip>
              </div>
              <p className="text-neutral-400 text-sm mt-1" suppressHydrationWarning>
                {tab === 'trading'
                  ? tradingPeriod === 'alltime'
                    ? 'All time rankings'
                    : weekStart
                      ? `Weekly rankings \u00b7 ${formatWeekRange(weekStart)}`
                      : 'Weekly rankings'
                  : pointsWeekStart
                    ? `Points \u00b7 week of ${formatWeekRange(pointsWeekStart)}`
                    : 'Points'}
              </p>
            </div>

            {/* Tab switcher */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setTab('points')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                  tab === 'points'
                    ? 'bg-white/10 text-white'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                Points
              </button>
              <button
                onClick={() => setTab('trading')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                  tab === 'trading'
                    ? 'bg-white/10 text-white'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                P&L / Volume
              </button>
            </div>
          </div>

          {/* ── Trading Tab ──────────────────────────────────── */}
          {tab === 'trading' && (
            <>
              {/* Sort + summary */}
              <div className="flex items-center justify-between mb-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1 mr-4">
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
              </div>

              <div className="flex items-center justify-between mb-4">
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
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setTradingPeriod('weekly')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                      tradingPeriod === 'weekly'
                        ? 'bg-white/10 text-white'
                        : 'text-neutral-500 hover:text-neutral-300'
                    }`}
                  >
                    Weekly
                  </button>
                  <button
                    onClick={() => setTradingPeriod('alltime')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                      tradingPeriod === 'alltime'
                        ? 'bg-white/10 text-white'
                        : 'text-neutral-500 hover:text-neutral-300'
                    }`}
                  >
                    All Time
                  </button>
                </div>
              </div>

              {loading && (
                <div className="flex items-center justify-center py-16">
                  <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                </div>
              )}

              {!loading && sorted.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <span className="text-neutral-500 text-sm">
                    {tradingPeriod === 'alltime' ? 'No trades yet' : 'No trades this week yet'}
                  </span>
                  <Link href="/polymarkets" className="text-apple-blue text-sm font-medium hover:underline">
                    Browse Polymarkets
                  </Link>
                </div>
              )}

              {!loading && sorted.length > 0 && (
                <div className="rounded-xl border border-white/5 overflow-hidden">
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
                    const profileHref = `/profile/${entry.username ?? entry.wallet}`

                    return (
                      <div
                        key={entry.wallet}
                        className="grid grid-cols-1 md:grid-cols-[60px_2fr_1fr_1fr_1fr_1fr] gap-1 md:gap-3 px-4 py-3 border-b border-white/5 last:border-b-0 hover:bg-white/[0.03] transition-colors duration-150"
                      >
                        <div className="flex md:hidden items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            {rankBadge(rank)}
                            <div>
                              <Link href={profileHref} className="text-white text-sm font-medium hover:underline">
                                {entry.username || truncateWallet(entry.wallet)}
                              </Link>
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

                        <div className="hidden md:flex items-center">
                          {rankBadge(rank)}
                        </div>
                        <div className="hidden md:flex items-center gap-2">
                          <Link href={profileHref} className="text-white text-sm font-medium hover:underline">
                            {entry.username || truncateWallet(entry.wallet)}
                          </Link>
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
            </>
          )}

          {/* ── Points Tab ───────────────────────────────────── */}
          {tab === 'points' && (
            <>
              <div className="flex items-center gap-1 mb-4">
                <button
                  onClick={() => setPointsSort('weekly')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                    pointsSort === 'weekly'
                      ? 'bg-white/10 text-white'
                      : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  This Week
                </button>
                <button
                  onClick={() => setPointsSort('alltime')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                    pointsSort === 'alltime'
                      ? 'bg-white/10 text-white'
                      : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  All Time
                </button>
              </div>

              {pointsLoading && (
                <div className="flex items-center justify-center py-16">
                  <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                </div>
              )}

              {!pointsLoading && pointsEntries.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <span className="text-neutral-500 text-sm">No points earned yet</span>
                  <Link href="/polymarkets" className="text-apple-blue text-sm font-medium hover:underline">
                    Start trading to earn points
                  </Link>
                </div>
              )}

              {!pointsLoading && pointsEntries.length > 0 && (
                <div className="rounded-xl border border-white/5 overflow-hidden">
                  <div className="hidden md:grid grid-cols-[60px_2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2.5 text-[10px] text-neutral-500 font-medium uppercase tracking-wider border-b border-white/5 bg-white/[0.02]">
                    <div>Rank</div>
                    <div>Trader</div>
                    <div className="text-right">Weekly Pts</div>
                    <div className="text-right">All-Time Pts</div>
                    <div className="text-right">Trades</div>
                    <div className="text-right">Wins</div>
                    <div className="text-right">Chats / Holds</div>
                  </div>

                  {pointsEntries.map((entry, i) => {
                    const rank = i + 1
                    const primaryPts = pointsSort === 'weekly' ? entry.weeklyPoints : entry.allTimePoints
                    const profileHref = `/profile/${entry.username ?? entry.wallet}`

                    return (
                      <div
                        key={entry.wallet}
                        className="grid grid-cols-1 md:grid-cols-[60px_2fr_1fr_1fr_1fr_1fr_1fr] gap-1 md:gap-3 px-4 py-3 border-b border-white/5 last:border-b-0 hover:bg-white/[0.03] transition-colors duration-150"
                      >
                        {/* Mobile */}
                        <div className="flex md:hidden items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            {rankBadge(rank)}
                            <div>
                              <Link href={profileHref} className="text-white text-sm font-medium hover:underline">
                                {entry.username || truncateWallet(entry.wallet)}
                              </Link>
                              {entry.username && (
                                <span className="text-neutral-500 text-xs ml-2 font-mono">
                                  {truncateWallet(entry.wallet)}
                                </span>
                              )}
                            </div>
                          </div>
                          <span className="text-sm font-semibold text-white">{primaryPts.toLocaleString()} pts</span>
                        </div>
                        <div className="flex md:hidden items-center justify-between text-xs text-neutral-400 mt-1">
                          <span>Trades: {entry.breakdown.trades} · Wins: {entry.breakdown.wins}</span>
                          <span>Chats: {entry.breakdown.chats} · Holds: {entry.breakdown.holds}</span>
                        </div>

                        {/* Desktop */}
                        <div className="hidden md:flex items-center">
                          {rankBadge(rank)}
                        </div>
                        <div className="hidden md:flex items-center gap-2">
                          <Link href={profileHref} className="text-white text-sm font-medium hover:underline">
                            {entry.username || truncateWallet(entry.wallet)}
                          </Link>
                          {entry.username && (
                            <span className="text-neutral-500 text-xs font-mono">
                              {truncateWallet(entry.wallet)}
                            </span>
                          )}
                        </div>
                        <div className="hidden md:flex items-center justify-end text-sm font-semibold text-white">
                          {entry.weeklyPoints.toLocaleString()}
                        </div>
                        <div className="hidden md:flex items-center justify-end text-sm text-neutral-300">
                          {entry.allTimePoints.toLocaleString()}
                        </div>
                        <div className="hidden md:flex items-center justify-end text-sm text-neutral-300">
                          {entry.breakdown.trades}
                        </div>
                        <div className="hidden md:flex items-center justify-end text-sm text-neutral-300">
                          {entry.breakdown.wins}
                        </div>
                        <div className="hidden md:flex items-center justify-end text-sm text-neutral-300">
                          {entry.breakdown.chats} / {entry.breakdown.holds}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
            </main>

            <Footer />
          </div>
        </div>
      </div>
    </div>
  )
}
