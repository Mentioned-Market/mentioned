'use client'

import { useState, useEffect, useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { useWallet } from '@/contexts/WalletContext'

// ── Types ──────────────────────────────────────────────────

interface Position {
  pubkey: string
  marketId: string
  eventId: string
  isYes: boolean
  contracts: string
  avgPriceUsd: number
  markPriceUsd: number
  pnlUsd: number
  pnlUsdPercent: number
  sizeUsd: string
  eventMetadata?: { title: string; imageUrl: string; closeTime: string }
  marketMetadata?: { title: string }
}

interface HistoryEvent {
  id: number
  eventType: string
  timestamp: number
  marketId: string
  eventId: string
  isBuy: boolean
  isYes: boolean
  avgFillPriceUsd: number
  maxBuyPriceUsd: number
  minSellPriceUsd: number
  depositAmountUsd: number
  netProceedsUsd: number
  grossProceedsUsd: number
  payoutAmountUsd: number
  realizedPnl: number
  feeUsd: number
  marketMetadata?: { title: string }
  eventMetadata?: { title: string; imageUrl: string }
}

interface Stats {
  positionsCount: number
  totalVolume: number
  totalValue: number
  unrealizedPnl: number
  realizedPnl: number
  totalPnl: number
  tradesCount: number
  biggestWin: number
  allTimePoints: number
}

interface PublicProfile {
  username: string | null
  wallet: string
  createdAt: string | null
  positions: Position[]
  history: HistoryEvent[]
  stats: Stats
}

type Tab = 'positions' | 'activity'
type PositionFilter = 'active' | 'closed'
type PnlPeriod = '1D' | '1W' | '1M' | 'ALL'

// ── Helpers ────────────────────────────────────────────────

function microToUsd(micro: number | string | null | undefined, signed = false): string {
  if (micro === null || micro === undefined) return '$0.00'
  const n = typeof micro === 'string' ? Number(micro) : micro
  if (!Number.isFinite(n)) return '$0.00'
  const abs = Math.abs(n) / 1_000_000
  const str = `$${abs.toFixed(2)}`
  if (!signed) return n < 0 ? `-${str}` : str
  if (n === 0) return str
  return n > 0 ? `+${str}` : `-${str}`
}

function microToCents(micro: number | null): string {
  if (micro === null) return '—'
  return `${(micro / 10_000).toFixed(0)}¢`
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function formatJoined(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function formatCloseTime(isoTime: string): string {
  const diff = new Date(isoTime).getTime() - Date.now()
  if (diff <= 0) return 'Settled'
  const h = Math.floor(diff / 3_600_000)
  if (h > 24) return `${Math.floor(h / 24)}d`
  const m = Math.floor((diff % 3_600_000) / 60_000)
  return `${h}h ${m}m`
}

function periodCutoff(period: PnlPeriod): number {
  const now = Date.now()
  if (period === '1D') return (now - 86_400_000) / 1000
  if (period === '1W') return (now - 7 * 86_400_000) / 1000
  if (period === '1M') return (now - 30 * 86_400_000) / 1000
  return 0
}

function periodLabel(period: PnlPeriod): string {
  if (period === '1D') return 'Past Day'
  if (period === '1W') return 'Past Week'
  if (period === '1M') return 'Past Month'
  return 'All Time'
}

function avatarColor(seed: string): string {
  const colors = [
    ['#7c3aed', '#4f46e5'],
    ['#2563eb', '#0891b2'],
    ['#059669', '#0d9488'],
    ['#d97706', '#dc2626'],
    ['#db2777', '#9333ea'],
    ['#ea580c', '#ca8a04'],
  ]
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash)
  const [a, b] = colors[Math.abs(hash) % colors.length]
  return `linear-gradient(135deg, ${a}, ${b})`
}

function displayName(username: string | null, wallet: string): string {
  return username ? `@${username}` : `${wallet.slice(0, 6)}...${wallet.slice(-6)}`
}

// ── Helpers ────────────────────────────────────────────────

const SETTLEMENT_TYPES = new Set(['settle_position', 'payout_claimed'])

// Jupiter leaves realizedPnl = 0 for claim/settle events and puts the value in payoutAmountUsd
function eventPnl(h: HistoryEvent): number {
  const realized = Number(h.realizedPnl) || 0
  if (realized !== 0) return realized
  if (SETTLEMENT_TYPES.has(h.eventType)) {
    const payout = Number(h.payoutAmountUsd) || 0
    if (payout > 0) return payout
  }
  return 0
}

// ── Sparkline ──────────────────────────────────────────────

function Sparkline({ history, period, pnlValue }: {
  history: HistoryEvent[]
  period: PnlPeriod
  pnlValue: number
}) {
  const cutoff = periodCutoff(period)
  const data = useMemo(() => {
    const filtered = history
      .filter(h => h.timestamp >= cutoff && eventPnl(h) !== 0)
      .sort((a, b) => a.timestamp - b.timestamp)
    if (filtered.length === 0) return []
    let cum = 0
    const result: { ts: number; value: number }[] = [{ ts: filtered[0].timestamp, value: 0 }]
    for (const h of filtered) {
      cum += eventPnl(h)
      result.push({ ts: h.timestamp, value: cum })
    }
    return result
  }, [history, cutoff])

  if (data.length < 2) {
    return <div className="h-20 flex items-end"><div className="w-full h-0.5 bg-white/5 rounded-full" /></div>
  }

  const positive = pnlValue >= 0
  const color = positive ? '#34C759' : '#FF3B30'
  const gradientId = positive ? 'pnlFillPos' : 'pnlFillNeg'

  return (
    <ResponsiveContainer width="100%" height={80}>
      <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.2} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="ts" hide />
        <YAxis hide domain={['auto', 'auto']} />
        <ReferenceLine y={0} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        <Tooltip
          cursor={{ stroke: 'rgba(255,255,255,0.12)', strokeWidth: 1 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const point = payload[0].payload as { ts: number; value: number }
            return (
              <div className="bg-neutral-900/95 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs shadow-lg">
                <div className="text-neutral-400 mb-0.5">
                  {new Date(point.ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                <div className={`font-semibold ${point.value >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                  {microToUsd(point.value, true)}
                </div>
              </div>
            )
          }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 3, fill: color, strokeWidth: 0 }}
          animationDuration={500}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ── Event type label ───────────────────────────────────────

function eventLabel(eventType: string): { label: string; color: string } {
  switch (eventType) {
    case 'order_filled':    return { label: 'Filled',  color: 'text-apple-green bg-apple-green/10' }
    case 'order_created':   return { label: 'Created', color: 'text-apple-blue bg-apple-blue/10' }
    case 'order_closed':    return { label: 'Closed',  color: 'text-neutral-300 bg-white/5' }
    case 'order_failed':    return { label: 'Failed',  color: 'text-apple-red bg-apple-red/10' }
    case 'settle_position': return { label: 'Settled', color: 'text-apple-green bg-apple-green/10' }
    case 'payout_claimed':  return { label: 'Claimed', color: 'text-apple-green bg-apple-green/10' }
    default: return { label: eventType.replace(/_/g, ' '), color: 'text-neutral-400 bg-white/5' }
  }
}

// ── Page ───────────────────────────────────────────────────

export default function PublicProfilePage() {
  const { username } = useParams<{ username: string }>()
  const { publicKey } = useWallet()

  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState<Tab>('positions')
  const [posFilter, setPosFilter] = useState<PositionFilter>('active')
  const [search, setSearch] = useState('')
  const [pnlPeriod, setPnlPeriod] = useState<PnlPeriod>('ALL')

  useEffect(() => {
    if (!username) return
    setLoading(true)
    fetch(`/api/profile/${encodeURIComponent(username)}`)
      .then(async res => {
        if (res.status === 404) { setNotFound(true); return }
        setProfile(await res.json())
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [username])

  const isOwnProfile = publicKey && profile?.wallet === publicKey

  // ── Derived data ──────────────────────────────────────────

  const cutoff = profile ? periodCutoff(pnlPeriod) : 0

  const periodPnl = useMemo(() => {
    if (!profile) return 0
    const filtered = profile.history.filter(h => h.timestamp >= cutoff)
    const realized = filtered.reduce((s, h) => s + eventPnl(h), 0)
    const unrealized = pnlPeriod === 'ALL'
      ? profile.positions.reduce((s, p) => s + (Number(p.pnlUsd) || 0), 0)
      : 0
    return realized + unrealized
  }, [profile, cutoff, pnlPeriod])

  const biggestWin = useMemo(() =>
    profile?.history.reduce((max, h) => {
      const pnl = eventPnl(h)
      return pnl > max ? pnl : max
    }, 0) ?? 0,
  [profile])

  const closedPositions = useMemo(() =>
    profile?.history.filter(h =>
      ['order_closed', 'settle_position', 'payout_claimed'].includes(h.eventType)
    ) ?? [],
  [profile])

  const filteredPositions = useMemo(() => {
    if (!profile) return []
    const q = search.toLowerCase()
    if (posFilter === 'active') {
      return profile.positions.filter(p =>
        !q || (p.marketMetadata?.title ?? p.marketId).toLowerCase().includes(q)
      )
    }
    return closedPositions.filter(h =>
      !q || (h.marketMetadata?.title ?? h.marketId).toLowerCase().includes(q)
    )
  }, [profile, posFilter, search, closedPositions])

  // ── Loading ────────────────────────────────────────────────

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-7xl mx-auto px-4 md:px-10 lg:px-20">
        <Header />
        <main className="py-6">{children}</main>
        <Footer />
      </div>
    </div>
  )

  if (loading) return shell(
    <div className="flex items-center justify-center py-32">
      <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
    </div>
  )

  if (notFound || !profile) return shell(
    <div className="flex flex-col items-center justify-center py-32 gap-3">
      <p className="text-neutral-500">No profile found for <span className="text-white font-medium">@{username}</span></p>
      <Link href="/leaderboard" className="text-apple-blue text-sm font-medium hover:underline">View leaderboard</Link>
    </div>
  )

  const { stats } = profile
  const pnlPositive = periodPnl >= 0

  return shell(
    <div className="animate-fade-in">

      {/* Own profile banner */}
      {isOwnProfile && (
        <div className="mb-4 flex items-center justify-between px-4 py-2.5 rounded-xl bg-white/5 border border-white/10">
          <span className="text-neutral-400 text-sm">This is your public profile.</span>
          <Link href="/profile" className="text-white text-sm font-medium hover:underline">Edit profile →</Link>
        </div>
      )}

      {/* ── Header panels ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">

        {/* Profile card */}
        <div className="glass rounded-2xl p-6 flex flex-col justify-between min-h-[200px]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div
                className="w-16 h-16 rounded-full flex-shrink-0 flex items-center justify-center shadow-lg"
                style={{ background: avatarColor(profile.username ?? profile.wallet) }}
              >
                <span className="text-white text-2xl font-bold select-none">
                  {(profile.username ?? profile.wallet)[0].toUpperCase()}
                </span>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white leading-tight">
                  {displayName(profile.username, profile.wallet)}
                </h1>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {profile.createdAt && (
                    <span className="text-neutral-500 text-sm">Joined {formatJoined(profile.createdAt)}</span>
                  )}
                  {profile.username && (
                    <>
                      <span className="text-neutral-700">·</span>
                      <span className="text-neutral-600 text-xs font-mono">
                        {profile.wallet.slice(0, 4)}...{profile.wallet.slice(-4)}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-4 pt-5 mt-5 border-t border-white/5">
            <div>
              <div className="text-white text-lg font-bold">{microToUsd(stats.totalValue)}</div>
              <div className="text-neutral-500 text-xs mt-0.5">Positions Value</div>
            </div>
            <div>
              <div className={`text-lg font-bold ${biggestWin > 0 ? 'text-apple-green' : 'text-neutral-400'}`}>
                {biggestWin > 0 ? microToUsd(biggestWin, true) : '—'}
              </div>
              <div className="text-neutral-500 text-xs mt-0.5">Biggest Win</div>
            </div>
            <div>
              <div className="text-white text-lg font-bold">{stats.tradesCount}</div>
              <div className="text-neutral-500 text-xs mt-0.5">Predictions</div>
            </div>
          </div>

          {/* Records row */}
          <div className="flex items-center gap-3 mt-4 pt-4 border-t border-white/5">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/5">
              <svg className="w-3.5 h-3.5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              <span className="text-yellow-400 text-xs font-semibold">{stats.allTimePoints.toLocaleString()} pts all-time</span>
            </div>
            {biggestWin > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-apple-green/5 border border-apple-green/10">
                <svg className="w-3.5 h-3.5 text-apple-green" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V8.414l-4.293 4.293a1 1 0 01-1.414 0L8 10.414l-4.293 4.293a1 1 0 01-1.414-1.414l5-5a1 1 0 011.414 0L11 10.586 14.586 7H12z" clipRule="evenodd" />
                </svg>
                <span className="text-apple-green text-xs font-semibold">Best P&L {microToUsd(biggestWin, true)}</span>
              </div>
            )}
          </div>
        </div>

        {/* P&L card */}
        <div className="glass rounded-2xl p-6 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${pnlPositive ? 'bg-apple-green' : 'bg-apple-red'}`} />
              <span className="text-neutral-400 text-sm font-medium">Profit / Loss</span>
            </div>
            <div className="flex items-center gap-0.5">
              {(['1D', '1W', '1M', 'ALL'] as PnlPeriod[]).map(p => (
                <button
                  key={p}
                  onClick={() => setPnlPeriod(p)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all duration-150 ${
                    pnlPeriod === p ? 'bg-white/15 text-white' : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className={`text-3xl font-bold mb-0.5 ${pnlPositive ? 'text-apple-green' : 'text-apple-red'}`}>
            {microToUsd(periodPnl, true)}
          </div>
          <div className="text-neutral-500 text-xs mb-4">{periodLabel(pnlPeriod)}</div>

          <div className="flex-1">
            <Sparkline history={profile.history} period={pnlPeriod} pnlValue={periodPnl} />
          </div>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────── */}
      <div className="flex items-center gap-6 border-b border-white/10 mb-4">
        {([['positions', 'Positions'], ['activity', 'Activity']] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all duration-150 ${
              tab === key ? 'text-white border-white' : 'text-neutral-500 border-transparent hover:text-neutral-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Positions tab ─────────────────────────────────── */}
      {tab === 'positions' && (
        <>
          {/* Filter row */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex rounded-lg border border-white/10 overflow-hidden">
              <button
                onClick={() => { setPosFilter('active'); setSearch('') }}
                className={`px-4 py-2 text-xs font-semibold transition-colors ${
                  posFilter === 'active' ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                Active
              </button>
              <button
                onClick={() => { setPosFilter('closed'); setSearch('') }}
                className={`px-4 py-2 text-xs font-semibold transition-colors border-l border-white/10 ${
                  posFilter === 'closed' ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                Closed
              </button>
            </div>
            <div className="flex-1 relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search positions..."
                className="w-full h-9 pl-9 pr-4 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/20 transition-colors"
              />
            </div>
          </div>

          {/* Active positions */}
          {posFilter === 'active' && (
            <>
              {filteredPositions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <span className="text-neutral-500 text-sm">
                    {search ? 'No positions match your search' : 'No open positions'}
                  </span>
                </div>
              ) : (
                <div className="rounded-xl border border-white/5 overflow-hidden">
                  <div className="hidden md:grid grid-cols-[2.5fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2.5 text-[10px] text-neutral-500 font-medium uppercase tracking-wider border-b border-white/5 bg-white/[0.02]">
                    <span>Market</span>
                    <span className="text-right">Avg</span>
                    <span className="text-right">Current</span>
                    <span className="text-right">Value</span>
                    <span className="text-right">Settlement</span>
                  </div>
                  {(filteredPositions as Position[]).map(pos => (
                    <div key={pos.pubkey} className="grid grid-cols-1 md:grid-cols-[2.5fr_1fr_1fr_1fr_1fr] gap-1 md:gap-3 px-4 py-3.5 border-b border-white/5 last:border-b-0 hover:bg-white/[0.03] transition-colors">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${pos.isYes ? 'bg-apple-green/15 text-apple-green' : 'bg-apple-red/15 text-apple-red'}`}>
                          {pos.isYes ? 'YES' : 'NO'}
                        </span>
                        <Link href={pos.eventId ? `/polymarkets/event/${pos.eventId}` : '#'} className="text-white text-sm font-medium truncate hover:underline">
                          {pos.marketMetadata?.title || pos.marketId.slice(0, 16) + '...'}
                        </Link>
                      </div>
                      <div className="flex md:block justify-between md:text-right">
                        <span className="text-neutral-500 text-xs md:hidden">Avg</span>
                        <span className="text-neutral-300 text-sm">{microToCents(pos.avgPriceUsd)}</span>
                      </div>
                      <div className="flex md:block justify-between md:text-right">
                        <span className="text-neutral-500 text-xs md:hidden">Current</span>
                        <span className={`text-sm font-medium ${Number(pos.pnlUsd) >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                          {microToCents(pos.markPriceUsd)}
                        </span>
                      </div>
                      <div className="flex md:block justify-between md:text-right">
                        <span className="text-neutral-500 text-xs md:hidden">Value</span>
                        <span className="text-white text-sm font-medium">{microToUsd(pos.sizeUsd)}</span>
                      </div>
                      <div className="flex md:block justify-between md:text-right">
                        <span className="text-neutral-500 text-xs md:hidden">Settlement</span>
                        <span className="text-neutral-400 text-sm">
                          {pos.eventMetadata?.closeTime ? formatCloseTime(pos.eventMetadata.closeTime) : '—'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Closed positions */}
          {posFilter === 'closed' && (
            <>
              {filteredPositions.length === 0 ? (
                <div className="flex items-center justify-center py-16">
                  <span className="text-neutral-500 text-sm">
                    {search ? 'No positions match your search' : 'No closed positions'}
                  </span>
                </div>
              ) : (
                <div className="rounded-xl border border-white/5 overflow-hidden">
                  <div className="hidden md:grid grid-cols-[2.5fr_1fr_1fr_1fr] gap-3 px-4 py-2.5 text-[10px] text-neutral-500 font-medium uppercase tracking-wider border-b border-white/5 bg-white/[0.02]">
                    <span>Market</span>
                    <span className="text-center">Status</span>
                    <span className="text-right">P&L</span>
                    <span className="text-right">Date</span>
                  </div>
                  {(filteredPositions as HistoryEvent[]).map(h => {
                    const { label, color } = eventLabel(h.eventType)
                    const pnl = h.realizedPnl
                    return (
                      <div key={h.id} className="grid grid-cols-1 md:grid-cols-[2.5fr_1fr_1fr_1fr] gap-1 md:gap-3 px-4 py-3.5 border-b border-white/5 last:border-b-0 hover:bg-white/[0.03] transition-colors">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${h.isYes ? 'bg-apple-green/15 text-apple-green' : 'bg-apple-red/15 text-apple-red'}`}>
                            {h.isYes ? 'YES' : 'NO'}
                          </span>
                          <Link href={h.eventId ? `/polymarkets/event/${h.eventId}` : '#'} className="text-white text-sm font-medium truncate hover:underline">
                            {h.marketMetadata?.title || h.marketId?.slice(0, 16) + '...'}
                          </Link>
                        </div>
                        <div className="flex md:block justify-between md:text-center">
                          <span className="text-neutral-500 text-xs md:hidden">Status</span>
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>{label}</span>
                        </div>
                        <div className="flex md:block justify-between md:text-right">
                          <span className="text-neutral-500 text-xs md:hidden">P&L</span>
                          <span className={`text-sm font-semibold ${pnl > 0 ? 'text-apple-green' : pnl < 0 ? 'text-apple-red' : 'text-neutral-400'}`}>
                            {pnl ? microToUsd(pnl, true) : '—'}
                          </span>
                        </div>
                        <div className="flex md:block justify-between md:text-right">
                          <span className="text-neutral-500 text-xs md:hidden">Date</span>
                          <span className="text-neutral-500 text-xs">{formatDate(h.timestamp)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Activity tab ──────────────────────────────────── */}
      {tab === 'activity' && (
        <>
          {profile.history.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <span className="text-neutral-500 text-sm">No activity yet</span>
            </div>
          ) : (
            <div className="rounded-xl border border-white/5 overflow-hidden">
              <div className="hidden md:grid grid-cols-[2.5fr_0.8fr_0.8fr_0.8fr_1fr_1fr] gap-3 px-4 py-2.5 text-[10px] text-neutral-500 font-medium uppercase tracking-wider border-b border-white/5 bg-white/[0.02]">
                <span>Event</span>
                <span className="text-center">Action</span>
                <span className="text-center">Status</span>
                <span className="text-right">Price</span>
                <span className="text-right">Amount</span>
                <span className="text-right">P&L</span>
              </div>
              {profile.history.map(h => {
                const { label, color } = eventLabel(h.eventType)
                let amount = '—'
                if (h.depositAmountUsd > 0)      amount = `-${microToUsd(h.depositAmountUsd)}`
                else if (h.netProceedsUsd > 0)   amount = `+${microToUsd(h.netProceedsUsd)}`
                else if (h.grossProceedsUsd > 0) amount = `+${microToUsd(h.grossProceedsUsd)}`
                else if (h.payoutAmountUsd > 0)  amount = `+${microToUsd(h.payoutAmountUsd)}`
                const amountPos = amount.startsWith('+')

                const price = h.avgFillPriceUsd ? microToCents(h.avgFillPriceUsd)
                  : h.maxBuyPriceUsd ? microToCents(h.maxBuyPriceUsd)
                  : h.minSellPriceUsd ? microToCents(h.minSellPriceUsd)
                  : '—'

                return (
                  <div key={h.id} className="grid grid-cols-1 md:grid-cols-[2.5fr_0.8fr_0.8fr_0.8fr_1fr_1fr] gap-1 md:gap-3 px-4 py-3.5 border-b border-white/5 last:border-b-0 hover:bg-white/[0.03] transition-colors">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${h.isYes ? 'bg-apple-green/15 text-apple-green' : 'bg-apple-red/15 text-apple-red'}`}>
                          {h.isYes ? 'Yes' : 'No'}
                        </span>
                        <Link href={h.eventId ? `/polymarkets/event/${h.eventId}` : '#'} className="text-white text-sm font-medium truncate hover:underline">
                          {h.marketMetadata?.title || h.marketId?.slice(0, 16) + '...'}
                        </Link>
                      </div>
                      <div className="text-neutral-600 text-[11px]">{formatDate(h.timestamp)}</div>
                    </div>
                    <div className="flex md:block justify-between md:text-center">
                      <span className="text-neutral-500 text-xs md:hidden">Action</span>
                      <span className="text-white text-sm">{h.isBuy ? 'Buy' : 'Sell'}</span>
                    </div>
                    <div className="flex md:block justify-between md:text-center">
                      <span className="text-neutral-500 text-xs md:hidden">Status</span>
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>{label}</span>
                    </div>
                    <div className="flex md:block justify-between md:text-right">
                      <span className="text-neutral-500 text-xs md:hidden">Price</span>
                      <span className="text-neutral-300 text-sm">{price}</span>
                    </div>
                    <div className="flex md:block justify-between md:text-right">
                      <span className="text-neutral-500 text-xs md:hidden">Amount</span>
                      <span className={`text-sm font-medium ${amountPos ? 'text-apple-green' : amount === '—' ? 'text-neutral-500' : 'text-white'}`}>
                        {amount}
                      </span>
                    </div>
                    <div className="flex md:block justify-between md:text-right">
                      <span className="text-neutral-500 text-xs md:hidden">P&L</span>
                      {(() => {
                        const pnl = eventPnl(h)
                        return (
                          <span className={`text-sm font-semibold ${pnl === 0 ? 'text-neutral-500' : pnl > 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                            {pnl !== 0 ? microToUsd(pnl, true) : '—'}
                          </span>
                        )
                      })()}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
