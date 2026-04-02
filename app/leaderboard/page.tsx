'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { useWallet } from '@/contexts/WalletContext'
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
  pfpEmoji: string | null
  weeklyPoints: number
  allTimePoints: number
  breakdown: { trades: number; wins: number; chats: number; holds: number }
}

// ── Helpers ────────────────────────────────────────────────

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

type SortKey = 'pnl' | 'volume' | 'winRate'
type PointsSortKey = 'weekly' | 'alltime'
type Tab = 'trading' | 'points'

// ── Prize config ───────────────────────────────────────────

const PRIZES = [
  { place: 1, amount: '$40', medal: '🥇', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  { place: 2, amount: '$25', medal: '🥈', color: 'text-neutral-300', bg: 'bg-neutral-300/10', border: 'border-neutral-300/20' },
  { place: 3, amount: '$18', medal: '🥉', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  { place: 4, amount: '$10', medal: null, color: 'text-neutral-400', bg: 'bg-white/5', border: 'border-white/10' },
  { place: 5, amount: '$7',  medal: null, color: 'text-neutral-400', bg: 'bg-white/5', border: 'border-white/10' },
]

function prizeForRank(rank: number) {
  return PRIZES.find(p => p.place === rank) ?? null
}

// ── Rank cell ──────────────────────────────────────────────

function RankCell({ rank }: { rank: number }) {
  const prize = prizeForRank(rank)
  if (prize?.medal) {
    return <span className="text-xl md:text-2xl leading-none">{prize.medal}</span>
  }
  return (
    <span className={`text-base font-bold tabular-nums ${rank <= 5 ? 'text-neutral-300' : 'text-neutral-600'}`}>
      {rank}
    </span>
  )
}

// ── Avatar placeholder ─────────────────────────────────────

function Avatar({ pfpEmoji }: { name: string; pfpEmoji?: string | null; size?: number }) {
  return (
    <span className="text-lg md:text-xl leading-none flex-shrink-0 w-7 md:w-9 flex items-center justify-center">
      {pfpEmoji ?? '⚪'}
    </span>
  )
}

// ── Row highlight for current user ─────────────────────────

function rowClass(isYou: boolean) {
  if (isYou) return 'bg-white/[0.06] border-l-2 border-l-apple-blue'
  return 'hover:bg-white/[0.03]'
}

// ── Component ──────────────────────────────────────────────

export default function LeaderboardPage() {
  const { publicKey } = useWallet()
  const [tab, setTab] = useState<Tab>('points')

  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [weekStart, setWeekStart] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<SortKey>('pnl')
  const [tradingPeriod, setTradingPeriod] = useState<'weekly' | 'alltime'>('weekly')

  const [pointsEntries, setPointsEntries] = useState<PointsEntry[]>([])
  const [pointsWeekStart, setPointsWeekStart] = useState<string>('')
  const [pointsLoading, setPointsLoading] = useState(true)
  const [pointsSort, setPointsSort] = useState<PointsSortKey>('weekly')

  useEffect(() => {
    if (tab !== 'trading') return
    let mounted = true
    async function fetch_() {
      try {
        const res = await fetch(`/api/polymarket/leaderboard?period=${tradingPeriod}`)
        const json = await res.json()
        if (mounted) { setEntries(json.data || []); setWeekStart(json.weekStart || '') }
      } catch { /* ignore */ } finally { if (mounted) setLoading(false) }
    }
    setLoading(true); fetch_()
    const iv = setInterval(fetch_, 60_000)
    return () => { mounted = false; clearInterval(iv) }
  }, [tab, tradingPeriod])

  useEffect(() => {
    let mounted = true
    async function fetch_() {
      try {
        const res = await fetch(`/api/polymarket/leaderboard/points?sort=${pointsSort}`)
        const json = await res.json()
        if (mounted) { setPointsEntries(json.data || []); setPointsWeekStart(json.weekStart || '') }
      } catch { /* ignore */ } finally { if (mounted) setPointsLoading(false) }
    }
    setPointsLoading(true); fetch_()
    return () => { mounted = false }
  }, [pointsSort])

  const sorted = useMemo(() => {
    const copy = [...entries]
    if (sortBy === 'volume') return copy.sort((a, b) => b.volume - a.volume)
    if (sortBy === 'winRate') return copy.sort((a, b) => winRate(b) - winRate(a))
    return copy.sort((a, b) => b.pnl - a.pnl)
  }, [entries, sortBy])

  // Find "you" in the points list
  const youPointsIndex = publicKey ? pointsEntries.findIndex(e => e.wallet === publicKey) : -1
  const youPoints = youPointsIndex >= 0 ? pointsEntries[youPointsIndex] : null
  const youPointsRank = youPointsIndex >= 0 ? youPointsIndex + 1 : null

  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex justify-center">
          <div className="w-full max-w-7xl">
            <Header />
          </div>
        </div>
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="layout-content-container flex flex-col w-full max-w-4xl flex-1">
            <main className="py-6 animate-fade-in">

              {/* ── Page header ─────────────────────────────── */}
              <div className="mb-6">
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl md:text-3xl font-bold text-white">Leaderboard</h1>
                  <InfoTooltip position="below">
                    <div className="space-y-2">
                      <p>Link your Discord on your profile to earn points! The top 5 point earners each week win real USDC. Week ends Sunday night GMT — winners notified via Discord.</p>
                      <table className="w-full text-xs mt-1">
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
                <p className="text-neutral-500 text-sm mt-1" suppressHydrationWarning>
                  {tab === 'points'
                    ? pointsWeekStart ? `Week of ${formatWeekRange(pointsWeekStart)}` : 'This week'
                    : tradingPeriod === 'alltime' ? 'All time' : weekStart ? formatWeekRange(weekStart) : 'This week'}
                </p>
              </div>

              {/* ── Tab pills ────────────────────────────────── */}
              <div className="flex items-center gap-1 mb-4 border-b border-white/5 pb-4">
                {([['points', 'Points'], ['trading', 'P&L / Volume']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-150 ${
                      tab === key ? 'bg-white text-black' : 'text-neutral-500 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}

                {/* Sub-sort pills */}
                <div className="ml-auto flex items-center gap-1">
                  {tab === 'points' && (
                    <>
                      {([['weekly', 'This Week'], ['alltime', 'All Time']] as const).map(([key, label]) => (
                        <button
                          key={key}
                          onClick={() => setPointsSort(key)}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-150 ${
                            pointsSort === key ? 'bg-white/10 text-white' : 'text-neutral-600 hover:text-neutral-300'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </>
                  )}
                  {tab === 'trading' && (
                    <>
                      {([['pnl', 'P&L'], ['volume', 'Volume'], ['winRate', 'Win Rate']] as const).map(([key, label]) => (
                        <button
                          key={key}
                          onClick={() => setSortBy(key)}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-150 ${
                            sortBy === key ? 'bg-white/10 text-white' : 'text-neutral-600 hover:text-neutral-300'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                      {([['weekly', 'Week'], ['alltime', 'All Time']] as const).map(([key, label]) => (
                        <button
                          key={key}
                          onClick={() => setTradingPeriod(key)}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-150 ${
                            tradingPeriod === key ? 'bg-white/10 text-white' : 'text-neutral-600 hover:text-neutral-300'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </div>

              {/* ── Points leaderboard ───────────────────────── */}
              {tab === 'points' && (
                <>
                  {pointsLoading && (
                    <div className="flex items-center justify-center py-24">
                      <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    </div>
                  )}

                  {!pointsLoading && pointsEntries.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-24 gap-3">
                      <span className="text-neutral-500 text-sm">No points earned yet this week</span>
                      <Link href="/markets" className="text-apple-blue text-sm font-medium hover:underline">
                        Start trading to earn points
                      </Link>
                    </div>
                  )}

                  {!pointsLoading && pointsEntries.length > 0 && (
                    <div className="rounded-2xl border border-white/8 overflow-hidden">

                      {/* Column headers */}
                      <div className="grid grid-cols-[40px_minmax(0,1fr)_80px_56px] md:grid-cols-[56px_minmax(0,1fr)_120px_80px] px-3 md:px-5 py-3 text-[11px] text-neutral-600 font-semibold uppercase tracking-widest border-b border-white/5 bg-white/[0.015]">
                        <div>#</div>
                        <div>Trader</div>
                        <div className="text-right">{pointsSort === 'weekly' ? 'Weekly Pts' : 'All-Time Pts'}</div>
                        <div className="text-right">Prize</div>
                      </div>

                      {/* Pinned "you" row if not in top view */}
                      {youPoints && youPointsRank && youPointsRank > pointsEntries.length && (
                        <div className="grid grid-cols-[40px_minmax(0,1fr)_80px_56px] md:grid-cols-[56px_minmax(0,1fr)_120px_80px] px-3 md:px-5 py-3 md:py-4 border-b border-white/8 bg-white/[0.06] border-l-2 border-l-apple-blue">
                          <div className="flex items-center"><RankCell rank={youPointsRank} /></div>
                          <div className="flex items-center gap-2 md:gap-3 min-w-0">
                            <Avatar name={youPoints.username || youPoints.wallet} pfpEmoji={youPoints.pfpEmoji} />
                            <div className="min-w-0">
                              <span className="text-white font-semibold text-sm truncate block">
                                {youPoints.username || truncateWallet(youPoints.wallet)}
                              </span>
                              <span className="text-[10px] text-apple-blue font-medium">you</span>
                            </div>
                          </div>
                          <div className="flex items-center justify-end font-bold text-white text-sm">
                            {(pointsSort === 'weekly' ? youPoints.weeklyPoints : youPoints.allTimePoints).toLocaleString()}
                          </div>
                          <div className="flex items-center justify-end text-neutral-600 text-xs">—</div>
                        </div>
                      )}

                      {pointsEntries.map((entry, i) => {
                        const rank = i + 1
                        const prize = prizeForRank(rank)
                        const pts = pointsSort === 'weekly' ? entry.weeklyPoints : entry.allTimePoints
                        const isYou = publicKey === entry.wallet
                        const displayName = entry.username || truncateWallet(entry.wallet)

                        return (
                          <div
                            key={entry.wallet}
                            className={`grid grid-cols-[40px_minmax(0,1fr)_80px_56px] md:grid-cols-[56px_minmax(0,1fr)_120px_80px] px-3 md:px-5 py-3 md:py-4 border-b border-white/5 last:border-b-0 transition-colors duration-100 ${rowClass(isYou)}`}
                          >
                            <div className="flex items-center">
                              <RankCell rank={rank} />
                            </div>

                            <div className="flex items-center gap-2 md:gap-3 min-w-0">
                              <Avatar name={displayName} pfpEmoji={entry.pfpEmoji} />
                              <div className="min-w-0">
                                <Link
                                  href={`/profile/${entry.username ?? entry.wallet}`}
                                  className="text-white font-semibold text-sm md:text-[15px] hover:underline truncate block"
                                >
                                  {displayName}
                                </Link>
                                {isYou && (
                                  <span className="text-[10px] text-apple-blue font-medium">you</span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center justify-end">
                              <span className={`text-[15px] font-bold tabular-nums ${rank === 1 ? 'text-yellow-400' : 'text-white'}`}>
                                {pts.toLocaleString()}
                              </span>
                            </div>

                            <div className="flex items-center justify-end">
                              {prize ? (
                                <span className={`text-sm font-bold ${prize.color}`}>{prize.amount}</span>
                              ) : (
                                <span className="text-neutral-700 text-xs">—</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )}

              {/* ── Trading leaderboard ──────────────────────── */}
              {tab === 'trading' && (
                <>
                  {loading && (
                    <div className="flex items-center justify-center py-24">
                      <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    </div>
                  )}

                  {!loading && sorted.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-24 gap-3">
                      <span className="text-neutral-500 text-sm">No trades this period</span>
                      <Link href="/polymarkets" className="text-apple-blue text-sm font-medium hover:underline">
                        Browse markets
                      </Link>
                    </div>
                  )}

                  {!loading && sorted.length > 0 && (
                    <div className="rounded-2xl border border-white/8 overflow-hidden">
                      <div className="hidden md:grid grid-cols-[56px_1fr_120px_100px_100px_100px] px-5 py-3 text-[11px] text-neutral-600 font-semibold uppercase tracking-widest border-b border-white/5 bg-white/[0.015]">
                        <div>#</div>
                        <div>Trader</div>
                        <div className="text-right">P&L</div>
                        <div className="text-right">Win Rate</div>
                        <div className="text-right">Wins / Total</div>
                        <div className="text-right">Volume</div>
                      </div>

                      {sorted.map((entry, i) => {
                        const rank = i + 1
                        const wr = winRate(entry)
                        const isYou = publicKey === entry.wallet
                        const displayName = entry.username || truncateWallet(entry.wallet)
                        const pnlColor = entry.pnl > 0 ? 'text-apple-green' : entry.pnl < 0 ? 'text-apple-red' : 'text-neutral-400'

                        return (
                          <div
                            key={entry.wallet}
                            className={`grid grid-cols-1 md:grid-cols-[56px_1fr_120px_100px_100px_100px] px-5 py-4 border-b border-white/5 last:border-b-0 transition-colors duration-100 ${rowClass(isYou)}`}
                          >
                            {/* Mobile */}
                            <div className="flex md:hidden items-center justify-between">
                              <div className="flex items-center gap-3">
                                <RankCell rank={rank} />
                                <Avatar name={displayName} />
                                <div>
                                  <Link href={`/profile/${entry.username ?? entry.wallet}`} className="text-white font-semibold text-sm hover:underline">
                                    {displayName}
                                  </Link>
                                  {isYou && <span className="ml-1 text-[10px] text-apple-blue">you</span>}
                                </div>
                              </div>
                              <span className={`text-sm font-bold ${pnlColor}`}>{microToUsdSigned(entry.pnl)}</span>
                            </div>
                            <div className="flex md:hidden items-center justify-between text-xs text-neutral-500 mt-1.5">
                              <span>{(wr * 100).toFixed(0)}% win · {entry.winningTrades}/{entry.totalTrades}</span>
                              <span>{formatVolume(entry.volume)}</span>
                            </div>

                            {/* Desktop */}
                            <div className="hidden md:flex items-center"><RankCell rank={rank} /></div>
                            <div className="hidden md:flex items-center gap-3">
                              <Avatar name={displayName} />
                              <div>
                                <Link href={`/profile/${entry.username ?? entry.wallet}`} className="text-white font-semibold text-[15px] hover:underline">
                                  {displayName}
                                </Link>
                                {isYou && <span className="ml-2 text-[10px] text-apple-blue">you</span>}
                              </div>
                            </div>
                            <div className={`hidden md:flex items-center justify-end text-[15px] font-bold ${pnlColor}`}>
                              {microToUsdSigned(entry.pnl)}
                            </div>
                            <div className="hidden md:flex items-center justify-end text-sm text-neutral-300">
                              {entry.totalTrades > 0 ? `${(wr * 100).toFixed(0)}%` : '—'}
                            </div>
                            <div className="hidden md:flex items-center justify-end text-sm text-neutral-400">
                              {entry.winningTrades}/{entry.totalTrades}
                            </div>
                            <div className="hidden md:flex items-center justify-end text-sm text-neutral-400">
                              {formatVolume(entry.volume)}
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
