'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { useWallet } from '@/contexts/WalletContext'
import { useAchievements } from '@/contexts/AchievementContext'
import { signAndSendTx } from '@/lib/walletUtils'

// ── Types ──────────────────────────────────────────────────

interface PublicPosition {
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

interface OwnerPosition extends PublicPosition {
  totalCostUsd: string
  sellPriceUsd: number
  claimable?: boolean
  claimed?: boolean
  claimableAt?: number | null
  payoutUsd?: string
}

interface Order {
  pubkey: string
  marketId: string
  eventId: string
  status: 'pending' | 'filled' | 'failed' | 'cancelled'
  isYes: boolean
  isBuy: boolean
  contracts: string
  filledContracts: string
  maxFillPriceUsd: string
  avgFillPriceUsd: string
  sizeUsd: string
  createdAt: number
  updatedAt: number
  marketMetadata?: { title: string }
  eventMetadata?: { title: string; imageUrl: string }
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
  feeUsd: number
  grossProceedsUsd: number
  netProceedsUsd: number
  realizedPnl: number
  payoutAmountUsd: number
  marketMetadata?: { title: string }
  eventMetadata?: { title: string; imageUrl: string }
}

interface Achievement {
  id: string
  emoji: string
  title: string
  description: string
  points: number
  unlocked: boolean
  unlockedAt: string | null
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
  pfpEmoji: string | null
  createdAt: string | null
  positions: PublicPosition[]
  history: HistoryEvent[]
  stats: Stats
}

type OwnerTab = 'positions' | 'orders' | 'history' | 'achievements'
type PublicTab = 'positions' | 'activity' | 'achievements'
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

function formatDateFull(ts: number): string {
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
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

const SETTLEMENT_TYPES = new Set(['settle_position', 'payout_claimed'])

function eventPnl(h: HistoryEvent): number {
  const realized = Number(h.realizedPnl) || 0
  if (realized !== 0) return realized
  if (SETTLEMENT_TYPES.has(h.eventType)) {
    const payout = Number(h.payoutAmountUsd) || 0
    if (payout > 0) return payout
  }
  return 0
}

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

// ── Discord SVG icon (reused in multiple places) ───────────

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 00-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 00-4.8 0c-.14-.34-.35-.76-.54-1.09-.01-.02-.04-.03-.07-.03-1.5.26-2.93.71-4.27 1.33-.01 0-.02.01-.03.02-2.72 4.07-3.47 8.03-3.1 11.95 0 .02.01.04.03.05 1.8 1.32 3.53 2.12 5.24 2.65.02.01.05 0 .07-.02.4-.55.76-1.13 1.07-1.74.02-.04 0-.08-.04-.09-.57-.22-1.11-.48-1.64-.78-.04-.02-.04-.08-.01-.11.11-.08.22-.17.33-.25.02-.02.05-.02.07-.01 3.44 1.57 7.15 1.57 10.55 0 .02-.01.05-.01.07.01.11.09.22.17.33.26.04.03.03.09-.01.11-.52.31-1.07.56-1.64.78-.04.01-.05.06-.04.09.32.61.68 1.19 1.07 1.74.02.03.05.03.07.02 1.72-.53 3.45-1.33 5.24-2.65.02-.01.03-.03.03-.05.44-4.53-.73-8.46-3.1-11.95-.01-.01-.02-.02-.04-.02zM8.52 14.91c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12 0 1.17-.84 2.12-1.89 2.12zm6.97 0c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12 0 1.17-.83 2.12-1.89 2.12z" />
    </svg>
  )
}

// ── Spinner ────────────────────────────────────────────────

function Spinner() {
  return <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
}

// ── Page ───────────────────────────────────────────────────

export default function ProfilePage() {
  const { username: usernameParam } = useParams<{ username: string }>()
  const { publicKey, walletType, refreshProfile } = useWallet()
  const { showAchievementToast } = useAchievements()

  // ── Public profile ─────────────────────────────────────
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // ── Ownership & view mode ──────────────────────────────
  // isOwnProfile is derived — only true once both publicKey and profile are loaded
  const isOwnProfile = !!(publicKey && profile?.wallet === publicKey)
  const [viewAsPublic, setViewAsPublic] = useState(false)
  const isOwnerView = isOwnProfile && !viewAsPublic

  // ── Owner edit state ───────────────────────────────────
  const [editingUsername, setEditingUsername] = useState(false)
  const [usernameInput, setUsernameInput] = useState('')
  const [usernameSaving, setUsernameSaving] = useState(false)
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [pfpPickerOpen, setPfpPickerOpen] = useState(false)
  const pfpPickerRef = useRef<HTMLDivElement>(null)
  const [discordUsername, setDiscordUsername] = useState<string | null>(null)
  const [discordStatus, setDiscordStatus] = useState<string | null>(null)
  const [unlinkingDiscord, setUnlinkingDiscord] = useState(false)

  // ── Owner live data ────────────────────────────────────
  const [ownerPositions, setOwnerPositions] = useState<OwnerPosition[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [ownerHistory, setOwnerHistory] = useState<HistoryEvent[]>([])
  const [loadingOwnerPositions, setLoadingOwnerPositions] = useState(false)
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [loadingOwnerHistory, setLoadingOwnerHistory] = useState(false)
  const [closingPubkey, setClosingPubkey] = useState<string | null>(null)
  const [closeStatus, setCloseStatus] = useState<{ msg: string; error: boolean } | null>(null)

  // ── Shared state ───────────────────────────────────────
  const [ownerTab, setOwnerTab] = useState<OwnerTab>('positions')
  const [publicTab, setPublicTab] = useState<PublicTab>('positions')
  const [posFilter, setPosFilter] = useState<PositionFilter>('active')
  const [search, setSearch] = useState('')
  const [pnlPeriod, setPnlPeriod] = useState<PnlPeriod>('ALL')
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [loadingAchievements, setLoadingAchievements] = useState(true)

  // ── Referral state ─────────────────────────────────────
  const [referralCode, setReferralCode] = useState<string | null>(null)
  const [referralCount, setReferralCount] = useState(0)
  const [referredBy, setReferredBy] = useState<string | null>(null)
  const [bonusPointsEarned, setBonusPointsEarned] = useState(0)
  const [referralCopied, setReferralCopied] = useState(false)
  const [applyingCode, setApplyingCode] = useState(false)
  const [applyCodeInput, setApplyCodeInput] = useState('')
  const [applyCodeError, setApplyCodeError] = useState<string | null>(null)
  const [applyCodeSuccess, setApplyCodeSuccess] = useState(false)
  const [referralModalOpen, setReferralModalOpen] = useState(false)
  const [referredUsers, setReferredUsers] = useState<{ wallet: string; username: string; createdAt: string }[]>([])
  const referralModalRef = useRef<HTMLDivElement>(null)

  // Discord params extracted from URL on mount (before we know ownership)
  const [pendingDiscordStatus, setPendingDiscordStatus] = useState<string | null>(null)

  // ── Referral modal: fetch referred users + close on outside click
  const openReferralModal = useCallback(async () => {
    setReferralModalOpen(true)
    if (!publicKey) return
    try {
      const res = await fetch(`/api/referral?wallet=${publicKey}`)
      if (res.ok) {
        const data = await res.json()
        setReferredUsers(data.referredUsers ?? [])
        setReferralCount(data.referralCount ?? 0)
        setBonusPointsEarned(data.bonusPointsEarned ?? 0)
      }
    } catch { /* ignore */ }
  }, [publicKey])

  useEffect(() => {
    if (!referralModalOpen) return
    const handleClick = (e: MouseEvent) => {
      if (referralModalRef.current && !referralModalRef.current.contains(e.target as Node)) {
        setReferralModalOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [referralModalOpen])

  // ── Load achievements (for any viewer) ────────────────
  const fetchAchievements = useCallback(async (wallet: string) => {
    try {
      const res = await fetch(`/api/achievements?wallet=${wallet}`)
      if (res.ok) setAchievements((await res.json()).achievements || [])
    } catch { /* ignore */ }
    setLoadingAchievements(false)
  }, [])

  // ── Load public profile + achievements in parallel ─────
  useEffect(() => {
    if (!usernameParam) return
    setLoading(true)
    setNotFound(false)
    fetch(`/api/profile/${encodeURIComponent(usernameParam)}`)
      .then(async res => {
        if (res.status === 404) { setNotFound(true); return }
        const data = await res.json()
        setProfile(data)
        // Start achievements fetch immediately instead of waiting for next render cycle
        if (data.wallet) fetchAchievements(data.wallet)
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [usernameParam, fetchAchievements])

  // ── Load owner-private data (discord, referral, etc.) ──
  useEffect(() => {
    if (!isOwnProfile || !publicKey) return
    fetch(`/api/profile?wallet=${publicKey}`)
      .then(r => r.json())
      .then(d => {
        setDiscordUsername(d.discordUsername ?? null)
        setReferralCode(d.referralCode ?? null)
        setReferralCount(d.referralCount ?? 0)
        setReferredBy(d.referredBy ?? null)
        setBonusPointsEarned(d.bonusPointsEarned ?? 0)
      })
      .catch(() => {})
  }, [isOwnProfile, publicKey])

  // ── Extract discord callback params from URL on mount ─
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const discord = params.get('discord')
    if (!discord) return
    window.history.replaceState({}, '', window.location.pathname)
    setPendingDiscordStatus(discord)
  }, [])

  // ── Process discord status once we know it's our profile
  useEffect(() => {
    if (!pendingDiscordStatus || !publicKey || !profile) return
    if (profile.wallet !== publicKey) return

    const messages: Record<string, string> = {
      linked: 'Discord linked successfully!',
      already_linked: 'This Discord account is already linked to another wallet.',
      error: 'Failed to link Discord. Please try again.',
      cancelled: 'Discord linking was cancelled.',
    }
    setDiscordStatus(messages[pendingDiscordStatus] ?? null)
    setPendingDiscordStatus(null)

    if (pendingDiscordStatus === 'linked') {
      fetch(`/api/profile?wallet=${publicKey}`)
        .then(r => r.json())
        .then(d => setDiscordUsername(d.discordUsername ?? null))
        .catch(() => {})
    }
    setTimeout(() => setDiscordStatus(null), 5000)
  }, [pendingDiscordStatus, publicKey, profile])

  // ── Close PFP picker on outside click ─────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pfpPickerRef.current && !pfpPickerRef.current.contains(e.target as Node)) {
        setPfpPickerOpen(false)
      }
    }
    if (pfpPickerOpen) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [pfpPickerOpen])

  // ── Owner: fetch live polymarket data ─────────────────
  const fetchOwnerPositions = useCallback(async () => {
    if (!publicKey) return
    try {
      const res = await fetch(`/api/polymarket/positions?ownerPubkey=${publicKey}`)
      if (res.ok) setOwnerPositions((await res.json()).data || [])
    } catch { /* ignore */ }
    setLoadingOwnerPositions(false)
  }, [publicKey])

  const fetchOrders = useCallback(async () => {
    if (!publicKey) return
    try {
      const res = await fetch(`/api/polymarket/orders/list?ownerPubkey=${publicKey}`)
      if (res.ok) setOrders(((await res.json()).data || []).sort((a: Order, b: Order) => b.createdAt - a.createdAt))
    } catch { /* ignore */ }
    setLoadingOrders(false)
  }, [publicKey])

  const fetchOwnerHistory = useCallback(async () => {
    if (!publicKey) return
    try {
      const res = await fetch(`/api/polymarket/history?ownerPubkey=${publicKey}`)
      if (res.ok) setOwnerHistory(((await res.json()).data || []).sort((a: HistoryEvent, b: HistoryEvent) => b.timestamp - a.timestamp))
    } catch { /* ignore */ }
    setLoadingOwnerHistory(false)
  }, [publicKey])

  // Always fetch positions (default tab); lazy-fetch orders/history when their tab is active
  useEffect(() => {
    if (!isOwnProfile) return
    setLoadingOwnerPositions(true)
    fetchOwnerPositions()
    const posInterval = setInterval(fetchOwnerPositions, 30_000)
    return () => clearInterval(posInterval)
  }, [isOwnProfile, fetchOwnerPositions])

  useEffect(() => {
    if (!isOwnProfile || ownerTab !== 'orders') return
    setLoadingOrders(true)
    fetchOrders()
    const ordInterval = setInterval(fetchOrders, 15_000)
    return () => clearInterval(ordInterval)
  }, [isOwnProfile, ownerTab, fetchOrders])

  useEffect(() => {
    if (!isOwnProfile || ownerTab !== 'history') return
    setLoadingOwnerHistory(true)
    fetchOwnerHistory()
    const histInterval = setInterval(fetchOwnerHistory, 30_000)
    return () => clearInterval(histInterval)
  }, [isOwnProfile, ownerTab, fetchOwnerHistory])

  // Reset tabs when toggling public preview
  useEffect(() => {
    setOwnerTab('positions')
    setPublicTab('positions')
    setPosFilter('active')
    setSearch('')
  }, [viewAsPublic])

  // ── Owner: close position ──────────────────────────────
  const handleClosePosition = useCallback(async (pos: OwnerPosition) => {
    if (!publicKey) return
    setClosingPubkey(pos.pubkey)
    setCloseStatus(null)
    try {
      const res = await fetch('/api/polymarket/positions/close', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionPubkey: pos.pubkey, ownerPubkey: publicKey, marketId: pos.marketId }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to close position')
      const data = await res.json()
      if (!data.transaction) throw new Error('No transaction returned')
      const sig = await signAndSendTx(data.transaction, publicKey, walletType!)
      setCloseStatus({ msg: `Close submitted! Tx: ${sig.slice(0, 8)}...${sig.slice(-8)}`, error: false })
      if (data.newAchievements?.length) {
        for (const ach of data.newAchievements) showAchievementToast(ach)
        fetchAchievements(publicKey)
      }
      fetch('/api/polymarket/trades/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: publicKey, marketId: pos.marketId, eventId: pos.eventId,
          isYes: pos.isYes, isBuy: false, side: pos.isYes ? 'yes' : 'no',
          amountUsd: pos.sizeUsd, txSignature: sig, marketTitle: pos.marketMetadata?.title ?? null,
        }),
      }).catch(() => {})
      setTimeout(() => { fetchOwnerPositions(); fetchOrders(); fetchOwnerHistory() }, 3000)
    } catch (e: unknown) {
      setCloseStatus({ msg: e instanceof Error ? e.message : 'Failed to close position', error: true })
    } finally {
      setClosingPubkey(null)
      setTimeout(() => setCloseStatus(null), 10000)
    }
  }, [publicKey, walletType, fetchOwnerPositions, fetchOrders, fetchOwnerHistory, showAchievementToast, fetchAchievements])

  // ── Owner: claim position ──────────────────────────────
  const handleClaimPosition = useCallback(async (pos: OwnerPosition) => {
    if (!publicKey) return
    setClosingPubkey(pos.pubkey)
    setCloseStatus(null)
    try {
      const res = await fetch('/api/polymarket/positions/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionPubkey: pos.pubkey, ownerPubkey: publicKey, marketId: pos.marketId }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to claim position')
      const data = await res.json()
      if (!data.transaction) throw new Error('No transaction returned')
      const sig = await signAndSendTx(data.transaction, publicKey, walletType!)
      setCloseStatus({ msg: `Claim submitted! Tx: ${sig.slice(0, 8)}...${sig.slice(-8)}`, error: false })
      if (data.newAchievements?.length) {
        for (const ach of data.newAchievements) showAchievementToast(ach)
        fetchAchievements(publicKey)
      }
      fetch('/api/polymarket/trades/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: publicKey, marketId: pos.marketId, eventId: pos.eventId,
          isYes: pos.isYes, isBuy: false, side: pos.isYes ? 'yes' : 'no',
          amountUsd: pos.payoutUsd ?? pos.sizeUsd, txSignature: sig, marketTitle: pos.marketMetadata?.title ?? null,
        }),
      }).catch(() => {})
      setTimeout(() => { fetchOwnerPositions(); fetchOrders(); fetchOwnerHistory() }, 3000)
    } catch (e: unknown) {
      setCloseStatus({ msg: e instanceof Error ? e.message : 'Failed to claim position', error: true })
    } finally {
      setClosingPubkey(null)
      setTimeout(() => setCloseStatus(null), 10000)
    }
  }, [publicKey, walletType, fetchOwnerPositions, fetchOrders, fetchOwnerHistory, showAchievementToast, fetchAchievements])

  // ── Owner: save username ───────────────────────────────
  const handleSaveUsername = async () => {
    if (!publicKey) return
    const trimmed = usernameInput.trim()
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(trimmed)) {
      setUsernameError('3-20 characters, letters/numbers/underscores only')
      return
    }
    setUsernameSaving(true)
    setUsernameError(null)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: publicKey, username: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) {
        setUsernameError(data.error || 'Failed to save')
      } else {
        setProfile(p => p ? { ...p, username: trimmed } : p)
        setEditingUsername(false)
        refreshProfile()
        if (data.newAchievements?.length) {
          for (const ach of data.newAchievements) showAchievementToast(ach)
          fetchAchievements(publicKey)
        }
      }
    } catch {
      setUsernameError('Failed to save username')
    } finally {
      setUsernameSaving(false)
    }
  }

  // ── Owner: set PFP emoji ───────────────────────────────
  const handleSetPfp = async (emoji: string | null) => {
    if (!publicKey) return
    setPfpPickerOpen(false)
    const prev = profile?.pfpEmoji ?? null
    setProfile(p => p ? { ...p, pfpEmoji: emoji } : p) // optimistic
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: publicKey, pfpEmoji: emoji }),
      })
      if (!res.ok) {
        setProfile(p => p ? { ...p, pfpEmoji: prev } : p)
      } else {
        refreshProfile()
        const data = await res.json()
        if (data.newAchievements?.length) {
          for (const ach of data.newAchievements) showAchievementToast(ach)
        }
      }
    } catch {
      setProfile(p => p ? { ...p, pfpEmoji: prev } : p)
    }
  }

  // ── Derived data ───────────────────────────────────────

  // Use owner's live history for PNL when in owner view; else use public profile history
  const activeHistory = isOwnerView ? ownerHistory : (profile?.history ?? [])
  const activePositions = isOwnerView ? ownerPositions : (profile?.positions ?? [])

  // Pre-compute PNL per history event once (avoids calling eventPnl 400+ times per render)
  const pnlMap = useMemo(() => {
    const m = new Map<number, number>()
    for (const h of activeHistory) m.set(h.id, eventPnl(h))
    return m
  }, [activeHistory])
  const getPnl = (h: HistoryEvent) => pnlMap.get(h.id) ?? 0

  const periodPnl = useMemo(() => {
    const cutoff = periodCutoff(pnlPeriod)
    const realized = activeHistory
      .filter(h => h.timestamp >= cutoff)
      .reduce((s, h) => s + getPnl(h), 0)
    const unrealized = pnlPeriod === 'ALL'
      ? activePositions.reduce((s, p) => s + (Number(p.pnlUsd) || 0), 0)
      : 0
    return realized + unrealized
  }, [activeHistory, activePositions, pnlPeriod])

  const biggestWin = useMemo(() =>
    activeHistory.reduce((max, h) => { const pnl = getPnl(h); return pnl > max ? pnl : max }, 0),
  [activeHistory])

  const openOrders = useMemo(() => orders.filter(o => o.status === 'pending'), [orders])

  const ownerTotalValue = useMemo(() =>
    ownerPositions.reduce((s, p) => s + (Number(p.sizeUsd) || 0), 0),
  [ownerPositions])

  const ownerTotalPnl = useMemo(() => {
    const unrealized = ownerPositions.reduce((s, p) => s + (Number(p.pnlUsd) || 0), 0)
    const realized = ownerHistory.reduce((s, h) => s + (Number(h.realizedPnl) || 0), 0)
    return unrealized + realized
  }, [ownerPositions, ownerHistory])

  const closedPositions = useMemo(() =>
    activeHistory.filter(h => ['order_closed', 'settle_position', 'payout_claimed'].includes(h.eventType)),
  [activeHistory])

  const unlockedAchievements = useMemo(() => achievements.filter(a => a.unlocked), [achievements])
  const unlockedCount = unlockedAchievements.length

  const filteredPublicPositions = useMemo(() => {
    if (!profile) return []
    const q = search.toLowerCase()
    if (posFilter === 'active') {
      return profile.positions.filter(p => !q || (p.marketMetadata?.title ?? p.marketId).toLowerCase().includes(q))
    }
    return closedPositions.filter(h => !q || (h.marketMetadata?.title ?? h.marketId).toLowerCase().includes(q))
  }, [profile, posFilter, search, closedPositions])

  // ── Layout shell ───────────────────────────────────────
  const shell = (children: React.ReactNode) => (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
            <Header />
            <main className="py-6">{children}</main>
            <Footer />
          </div>
        </div>
      </div>
    </div>
  )

  if (loading) return shell(
    <div className="flex items-center justify-center py-32"><Spinner /></div>
  )

  if (notFound || !profile) return shell(
    <div className="flex flex-col items-center justify-center py-32 gap-3">
      <p className="text-neutral-500">No profile found for <span className="text-white font-medium">@{usernameParam}</span></p>
      <Link href="/leaderboard" className="text-apple-blue text-sm font-medium hover:underline">View leaderboard</Link>
    </div>
  )

  const { stats } = profile
  const pnlPositive = periodPnl >= 0

  return shell(
    <div className="animate-fade-in">

      {/* ── Owner view mode banner ─────────────────────── */}
      {isOwnProfile && (
        <div className="mb-4 flex items-center justify-between px-4 py-2.5 rounded-xl bg-white/5 border border-white/10">
          {viewAsPublic ? (
            <>
              <span className="text-neutral-400 text-sm">Previewing your public profile</span>
              <button
                onClick={() => setViewAsPublic(false)}
                className="text-neutral-400 text-sm font-medium hover:underline"
              >
                ← Back to my profile
              </button>
            </>
          ) : (
            <>
              <span className="text-neutral-400 text-sm">Your profile</span>
              <button
                onClick={() => setViewAsPublic(true)}
                className="text-neutral-400 text-sm font-medium hover:underline"
              >
                View public profile →
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Header panels ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">

        {/* Profile card */}
        <div className="glass rounded-2xl p-6 flex flex-col justify-between min-h-[200px]">
          <div className="flex items-start gap-4">

            {/* Avatar — clickable PFP picker for owner */}
            {isOwnerView ? (
              <div className="relative flex-shrink-0" ref={pfpPickerRef}>
                <button
                  onClick={() => setPfpPickerOpen(!pfpPickerOpen)}
                  className="w-16 h-16 rounded-full flex items-center justify-center shadow-lg bg-white/5 border-2 border-white/10 hover:border-white/30 transition-all"
                  title={profile.pfpEmoji ? 'Change profile picture' : 'Set profile picture'}
                  style={!profile.pfpEmoji ? { background: avatarColor(profile.username ?? profile.wallet) } : undefined}
                >
                  {profile.pfpEmoji ? (
                    <span className="text-3xl">{profile.pfpEmoji}</span>
                  ) : (
                    <span className="text-white text-2xl font-bold select-none">
                      {(profile.username ?? profile.wallet)[0].toUpperCase()}
                    </span>
                  )}
                </button>
                {pfpPickerOpen && (
                  <div className="absolute top-full left-0 mt-2 bg-neutral-900 border border-white/10 rounded-xl p-3 shadow-2xl z-50 animate-scale-in min-w-[200px]">
                    <p className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-2">
                      Choose from unlocked achievements
                    </p>
                    {unlockedAchievements.length === 0 ? (
                      <p className="text-xs text-neutral-500 py-2">Unlock achievements to set a profile picture</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {unlockedAchievements.map(a => (
                          <button
                            key={a.id}
                            onClick={() => handleSetPfp(a.emoji)}
                            className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl hover:bg-white/10 transition-colors ${
                              profile.pfpEmoji === a.emoji ? 'bg-white/15 ring-2 ring-apple-green' : 'bg-white/5'
                            }`}
                            title={a.title}
                          >
                            {a.emoji}
                          </button>
                        ))}
                        {profile.pfpEmoji && (
                          <button
                            onClick={() => handleSetPfp(null)}
                            className="w-10 h-10 rounded-lg flex items-center justify-center text-xs text-neutral-400 hover:bg-white/10 bg-white/5 transition-colors"
                            title="Remove profile picture"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div
                className="w-16 h-16 rounded-full flex-shrink-0 flex items-center justify-center shadow-lg"
                style={{ background: profile.pfpEmoji ? 'rgba(255,255,255,0.05)' : avatarColor(profile.username ?? profile.wallet) }}
              >
                {profile.pfpEmoji ? (
                  <span className="text-3xl">{profile.pfpEmoji}</span>
                ) : (
                  <span className="text-white text-2xl font-bold select-none">
                    {(profile.username ?? profile.wallet)[0].toUpperCase()}
                  </span>
                )}
              </div>
            )}

            {/* Name / username — editable for owner */}
            <div className="flex-1 min-w-0">
              {isOwnerView ? (
                <>
                  {editingUsername ? (
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <input
                        type="text"
                        value={usernameInput}
                        onChange={e => { setUsernameInput(e.target.value); setUsernameError(null) }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleSaveUsername()
                          if (e.key === 'Escape') { setEditingUsername(false); setUsernameError(null) }
                        }}
                        placeholder="username"
                        autoFocus
                        maxLength={20}
                        className="bg-white/5 border border-white/10 rounded-lg px-3 py-1 text-xl font-bold text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/30 w-44"
                      />
                      <button
                        onClick={handleSaveUsername}
                        disabled={usernameSaving}
                        className="px-3 py-1 bg-white text-black text-sm font-semibold rounded-lg hover:bg-neutral-200 transition-colors disabled:opacity-50"
                      >
                        {usernameSaving ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={() => { setEditingUsername(false); setUsernameError(null) }}
                        className="text-neutral-400 text-sm hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mb-1">
                      <h1 className="text-2xl font-bold text-white leading-tight">
                        {profile.username ? `@${profile.username}` : 'Set Username'}
                      </h1>
                      <button
                        onClick={() => { setUsernameInput(profile.username || ''); setEditingUsername(true); setUsernameError(null) }}
                        className="text-neutral-500 hover:text-white transition-colors flex-shrink-0"
                        title="Edit username"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                          <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                        </svg>
                      </button>
                    </div>
                  )}
                  {usernameError && <p className="text-apple-red text-xs mb-1">{usernameError}</p>}
                  <p className="text-neutral-500 text-sm font-mono">
                    {publicKey?.slice(0, 8)}...{publicKey?.slice(-8)}
                  </p>
                </>
              ) : (
                <>
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
                </>
              )}
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

          {/* Achievement badges */}
          <div className="flex items-center gap-3 mt-4 pt-4 border-t border-white/5 flex-wrap">
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
            <Sparkline history={activeHistory} period={pnlPeriod} pnlValue={periodPnl} />
          </div>
        </div>
      </div>

      {/* ── Owner-only sections ────────────────────────── */}
      {isOwnerView && (
        <>
          {/* Discord status toast */}
          {discordStatus && (
            <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium ${
              discordStatus.includes('successfully')
                ? 'bg-apple-green/10 text-apple-green border border-apple-green/20'
                : 'bg-apple-red/10 text-apple-red border border-apple-red/20'
            }`}>
              {discordStatus}
            </div>
          )}

          {/* Discord + Referral row */}
          <div className="mb-4 flex items-stretch gap-3">
            {/* Discord — left half */}
            <div className="flex-1 min-w-0">
              {!discordUsername ? (
                <a
                  href={`/api/discord/link?wallet=${publicKey}`}
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15 transition-colors h-full"
                >
                  <DiscordIcon className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span className="text-amber-400 font-semibold text-sm truncate">Link Discord to earn points</span>
                </a>
              ) : (
                <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-[#5865F2]/10 border border-[#5865F2]/20 h-full">
                  <div className="flex items-center gap-2 min-w-0">
                    <DiscordIcon className="w-4 h-4 text-[#5865F2] flex-shrink-0" />
                    <span className="text-[#5865F2] text-sm font-medium truncate">{discordUsername}</span>
                    <svg className="w-3.5 h-3.5 text-apple-green flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                  <button
                    onClick={async () => {
                      if (!confirm('Unlink your Discord? You will stop earning points until you re-link.')) return
                      setUnlinkingDiscord(true)
                      try {
                        await fetch('/api/discord/unlink', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ wallet: publicKey }),
                        })
                        setDiscordUsername(null)
                      } catch { /* ignore */ }
                      setUnlinkingDiscord(false)
                    }}
                    disabled={unlinkingDiscord}
                    className="text-neutral-500 hover:text-neutral-300 text-xs transition-colors flex-shrink-0 ml-2"
                  >
                    {unlinkingDiscord ? '...' : 'Unlink'}
                  </button>
                </div>
              )}
            </div>

            {/* Referral button — right side */}
            <button
              onClick={openReferralModal}
              className="flex items-center gap-2 px-4 py-3 rounded-xl glass border border-white/10 hover:border-white/20 transition-colors flex-shrink-0"
            >
              <span className="text-sm">🔗</span>
              <span className="text-white text-sm font-medium">Referrals</span>
              {referralCount > 0 && (
                <span className="text-[10px] bg-apple-green/20 text-apple-green px-1.5 py-0.5 rounded-full font-bold">{referralCount}</span>
              )}
            </button>
          </div>

          {/* Referral modal */}
          {referralModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
              <div ref={referralModalRef} className="w-full max-w-md glass rounded-2xl border border-white/10 p-6 shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-white font-bold text-lg">Referrals</h3>
                  <button onClick={() => setReferralModalOpen(false)} className="text-neutral-400 hover:text-white transition-colors">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* OG preview image */}
                {referralCode && (
                  <div className="mb-4 rounded-xl overflow-hidden border border-white/5 relative">
                    {/* Loading spinner — hidden once image loads */}
                    <div id="og-spinner" className="flex items-center justify-center py-16 bg-black/50">
                      <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/og/referral?code=${referralCode}`}
                      alt="Referral preview"
                      className="w-full h-auto hidden"
                      onLoad={(e) => {
                        const img = e.currentTarget
                        img.classList.remove('hidden')
                        const spinner = img.parentElement?.querySelector('#og-spinner')
                        if (spinner) (spinner as HTMLElement).style.display = 'none'
                      }}
                    />
                    {/* Copy image button */}
                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch(`/api/og/referral?code=${referralCode}`)
                          const blob = await res.blob()
                          await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
                          const btn = document.getElementById('copy-img-btn')
                          if (btn) { btn.textContent = '✓ Copied'; setTimeout(() => { btn.textContent = 'Copy Image' }, 2000) }
                        } catch {
                          // Fallback: download instead
                          const a = document.createElement('a')
                          a.href = `/api/og/referral?code=${referralCode}`
                          a.download = `mentioned-referral-${referralCode}.png`
                          a.click()
                        }
                      }}
                      id="copy-img-btn"
                      className="absolute bottom-2 right-2 px-2.5 py-1 bg-black/70 hover:bg-black/90 text-white text-[11px] font-medium rounded-lg backdrop-blur-sm transition-colors border border-white/10"
                    >
                      Copy Image
                    </button>
                  </div>
                )}

                {/* Link + copy */}
                {referralCode && (
                  <div className="flex items-center gap-2 mb-4">
                    <div className="flex-1 bg-white/5 rounded-lg px-3 py-2 text-xs text-neutral-300 font-mono truncate">
                      mentioned.market/ref/{referralCode}
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`https://www.mentioned.market/ref/${referralCode}`)
                        setReferralCopied(true)
                        setTimeout(() => setReferralCopied(false), 2000)
                      }}
                      className="flex-shrink-0 px-3 py-2 bg-white/10 hover:bg-white/15 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      {referralCopied ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                )}

                {/* Stats row */}
                <div className="flex items-center gap-4 mb-4 text-xs text-neutral-400">
                  <span>{referralCount} referred</span>
                  {bonusPointsEarned > 0 && (
                    <span className="text-apple-green">+{bonusPointsEarned} bonus pts</span>
                  )}
                </div>

                {/* Apply a code (if not already referred) */}
                {!referredBy && !applyCodeSuccess && (
                  <div className="mb-4 pt-4 border-t border-white/5">
                    <p className="text-xs text-neutral-400 mb-2">Have someone&apos;s referral code?</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={applyCodeInput}
                        onChange={(e) => { setApplyCodeInput(e.target.value.toUpperCase()); setApplyCodeError(null) }}
                        placeholder="e.g. TAYL3X9K"
                        maxLength={12}
                        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-white/20"
                      />
                      <button
                        disabled={applyingCode || !applyCodeInput.trim()}
                        onClick={async () => {
                          setApplyingCode(true)
                          setApplyCodeError(null)
                          try {
                            const res = await fetch('/api/referral', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ wallet: publicKey, code: applyCodeInput.trim() }),
                            })
                            const data = await res.json()
                            if (!res.ok) {
                              setApplyCodeError(data.error || 'Failed to apply code')
                            } else {
                              setApplyCodeSuccess(true)
                              setReferredBy(data.referredBy)
                            }
                          } catch {
                            setApplyCodeError('Something went wrong')
                          }
                          setApplyingCode(false)
                        }}
                        className="flex-shrink-0 px-3 py-1.5 bg-apple-blue/20 hover:bg-apple-blue/30 text-apple-blue text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                      >
                        {applyingCode ? '...' : 'Apply'}
                      </button>
                    </div>
                    {applyCodeError && <p className="text-xs text-apple-red mt-1">{applyCodeError}</p>}
                  </div>
                )}

                {/* Already referred */}
                {(referredBy || applyCodeSuccess) && (
                  <div className="mb-4 pt-4 border-t border-white/5">
                    <p className="text-xs text-apple-green">
                      ✓ Referred by {referredBy?.slice(0, 6)}...{referredBy?.slice(-4)}
                    </p>
                  </div>
                )}

                {/* Referred users list */}
                <div className="pt-4 border-t border-white/5">
                  <p className="text-xs text-neutral-500 font-medium uppercase tracking-wider mb-2">Your referrals</p>
                  {referredUsers.length === 0 ? (
                    <p className="text-xs text-neutral-600">No referrals yet. Share your link!</p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto scrollbar-hide space-y-1.5">
                      {referredUsers.map((u) => (
                        <div key={u.wallet} className="flex items-center justify-between text-xs">
                          <span className="text-neutral-300 truncate">
                            {u.username !== u.wallet ? `@${u.username}` : `${u.wallet.slice(0, 6)}...${u.wallet.slice(-4)}`}
                          </span>
                          <span className="text-neutral-600 flex-shrink-0 ml-2">
                            {new Date(u.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer note */}
                <p className="text-[11px] text-neutral-600 mt-4 text-center">
                  You both earn 10% of each other&apos;s points
                </p>
              </div>
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="glass rounded-xl p-4">
              <div className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-1">Positions</div>
              <div className="text-white text-xl font-bold">{ownerPositions.length}</div>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-1">Total Value</div>
              <div className="text-white text-xl font-bold">{microToUsd(ownerTotalValue)}</div>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-1">All-time P&L</div>
              <div className={`text-xl font-bold ${ownerTotalPnl >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                {microToUsd(ownerTotalPnl, true)}
              </div>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider mb-1">Open Orders</div>
              <div className="text-white text-xl font-bold">{openOrders.length}</div>
            </div>
          </div>
        </>
      )}

      {/* ── Tabs ──────────────────────────────────────── */}
      <div className="flex items-center gap-1 mb-4 border-b border-white/10">
        {isOwnerView ? (
          ([
            ['positions', 'Positions', ownerPositions.length],
            ['orders', 'Open Orders', openOrders.length],
            ['history', 'History', ownerHistory.length],
            ['achievements', 'Achievements', unlockedCount],
          ] as [OwnerTab, string, number][]).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setOwnerTab(key)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-all duration-200 border-b-2 -mb-px ${
                ownerTab === key ? 'text-white border-white' : 'text-neutral-500 border-transparent hover:text-neutral-300'
              }`}
            >
              {label}
              {count > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  ownerTab === key ? 'bg-white/15 text-white' : 'bg-white/5 text-neutral-500'
                }`}>{count}</span>
              )}
            </button>
          ))
        ) : (
          ([
            ['positions', 'Positions'],
            ['activity', 'Activity'],
            ['achievements', 'Achievements'],
          ] as [PublicTab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setPublicTab(key)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-all duration-200 border-b-2 -mb-px ${
                publicTab === key ? 'text-white border-white' : 'text-neutral-500 border-transparent hover:text-neutral-300'
              }`}
            >
              {label}
              {key === 'achievements' && unlockedCount > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  publicTab === key ? 'bg-white/15 text-white' : 'bg-white/5 text-neutral-500'
                }`}>{unlockedCount}</span>
              )}
            </button>
          ))
        )}
      </div>

      {/* ════════════════════════════════════════════════
          OWNER TAB CONTENT
          ════════════════════════════════════════════════ */}

      {/* Owner: Positions */}
      <div style={{ display: isOwnerView && ownerTab === 'positions' ? undefined : 'none' }}>
          {loadingOwnerPositions ? (
            <div className="flex items-center justify-center py-16"><Spinner /></div>
          ) : ownerPositions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <span className="text-neutral-500 text-sm">No open positions</span>
              <Link href="/" className="text-apple-blue text-sm font-medium hover:underline">Browse markets</Link>
            </div>
          ) : (
            <>
              {closeStatus && (
                <div className={`mb-3 p-3 rounded-lg text-xs ${
                  closeStatus.error
                    ? 'bg-red-500/10 border border-red-500/30 text-red-300'
                    : 'bg-green-500/10 border border-green-500/30 text-green-300'
                }`}>
                  {closeStatus.msg}
                </div>
              )}
              <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_80px] gap-3 px-4 py-2.5 text-[10px] text-neutral-500 font-medium uppercase tracking-wider border-b border-white/5">
                <span>Event</span>
                <span className="text-right">Size</span>
                <span className="text-right">Value</span>
                <span className="text-right">Avg. Price</span>
                <span className="text-right">Mark Price</span>
                <span className="text-right">PNL</span>
                <span className="text-right">Payout if right</span>
                <span className="text-right">Settlement</span>
                <span />
              </div>
              {ownerPositions.map(pos => {
                const contracts = Number(pos.contracts || 0)
                const payoutIfRight = contracts * 1_000_000
                const isClosing = closingPubkey === pos.pubkey
                return (
                  <div
                    key={pos.pubkey}
                    className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_80px] gap-1 md:gap-3 px-4 py-3 md:py-4 border-b border-white/5 hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${pos.isYes ? 'bg-apple-green/15 text-apple-green' : 'bg-apple-red/15 text-apple-red'}`}>
                        {pos.isYes ? 'YES' : 'NO'}
                      </span>
                      <Link href={pos.eventId ? `/polymarkets/event/${pos.eventId}` : '#'} className="text-white text-sm font-medium truncate hover:underline">
                        {pos.marketMetadata?.title || pos.marketId.slice(0, 12) + '...'}
                      </Link>
                    </div>
                    <div className="flex md:block justify-between md:text-right">
                      <span className="text-neutral-500 text-xs md:hidden">Size</span>
                      <span className="text-white text-sm font-medium">{pos.contracts}</span>
                    </div>
                    <div className="flex md:block justify-between md:text-right">
                      <span className="text-neutral-500 text-xs md:hidden">Value</span>
                      <span className="text-white text-sm font-medium">{microToUsd(pos.sizeUsd)}</span>
                    </div>
                    <div className="flex md:block justify-between md:text-right">
                      <span className="text-neutral-500 text-xs md:hidden">Avg. Price</span>
                      <span className="text-neutral-300 text-sm">{microToCents(pos.avgPriceUsd)}</span>
                    </div>
                    <div className="flex md:block justify-between md:text-right">
                      <span className="text-neutral-500 text-xs md:hidden">Mark Price</span>
                      <span className="text-neutral-300 text-sm">{microToCents(pos.markPriceUsd)}</span>
                    </div>
                    <div className="flex md:block justify-between md:text-right">
                      <span className="text-neutral-500 text-xs md:hidden">PNL</span>
                      <div>
                        <span className={`text-sm font-semibold ${Number(pos.pnlUsd) >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                          {Number(pos.pnlUsd) >= 0 ? '+' : ''}{microToUsd(pos.pnlUsd)}
                        </span>
                        <span className={`block text-[10px] ${Number(pos.pnlUsdPercent) >= 0 ? 'text-apple-green/70' : 'text-apple-red/70'}`}>
                          {Number(pos.pnlUsdPercent) >= 0 ? '+' : ''}{((Number(pos.pnlUsdPercent) || 0) / 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="flex md:block justify-between md:text-right">
                      <span className="text-neutral-500 text-xs md:hidden">Payout</span>
                      <span className="text-white text-sm font-medium">{microToUsd(payoutIfRight)}</span>
                    </div>
                    <div className="flex md:block justify-between md:text-right">
                      <span className="text-neutral-500 text-xs md:hidden">Settlement</span>
                      <span className="text-neutral-400 text-sm">
                        {pos.eventMetadata?.closeTime ? formatCloseTime(pos.eventMetadata.closeTime) : '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-end">
                      {pos.claimable && !pos.claimed ? (
                        <button
                          onClick={() => handleClaimPosition(pos)}
                          disabled={isClosing || !!closingPubkey}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-apple-green/30 text-apple-green hover:bg-apple-green/10 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {isClosing ? (
                            <span className="flex items-center gap-1.5">
                              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Claiming
                            </span>
                          ) : 'Claim'}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleClosePosition(pos)}
                          disabled={isClosing || !!closingPubkey}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-apple-red/30 text-apple-red hover:bg-apple-red/10 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {isClosing ? (
                            <span className="flex items-center gap-1.5">
                              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Closing
                            </span>
                          ) : 'Close'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>

      {/* Owner: Open Orders */}
      <div style={{ display: isOwnerView && ownerTab === 'orders' ? undefined : 'none' }}>
          {loadingOrders ? (
            <div className="flex items-center justify-center py-16"><Spinner /></div>
          ) : openOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <span className="text-neutral-500 text-sm">No open orders</span>
              <Link href="/" className="text-apple-blue text-sm font-medium hover:underline">Browse markets</Link>
            </div>
          ) : (
            <>
              <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2.5 text-[10px] text-neutral-500 font-medium uppercase tracking-wider border-b border-white/5">
                <span>Market</span>
                <span className="text-center">Side</span>
                <span className="text-right">Contracts</span>
                <span className="text-right">Max Price</span>
                <span className="text-right">Size</span>
                <span className="text-right">Created</span>
              </div>
              {openOrders.map(order => (
                <div
                  key={order.pubkey}
                  className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-1 md:gap-3 px-4 py-3 md:py-4 border-b border-white/5 hover:bg-white/[0.03] transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${order.isYes ? 'bg-apple-green/15 text-apple-green' : 'bg-apple-red/15 text-apple-red'}`}>
                      {order.isYes ? 'YES' : 'NO'}
                    </span>
                    <Link href={order.eventId ? `/polymarkets/event/${order.eventId}` : '#'} className="text-white text-sm font-medium truncate hover:underline">
                      {order.marketMetadata?.title || order.marketId.slice(0, 12) + '...'}
                    </Link>
                  </div>
                  <div className="flex md:block justify-between md:text-center">
                    <span className="text-neutral-500 text-xs md:hidden">Side</span>
                    <span className={`text-sm font-semibold ${order.isBuy ? 'text-apple-green' : 'text-apple-red'}`}>
                      {order.isBuy ? 'Buy' : 'Sell'}
                    </span>
                  </div>
                  <div className="flex md:block justify-between md:text-right">
                    <span className="text-neutral-500 text-xs md:hidden">Contracts</span>
                    <span className="text-white text-sm">{order.contracts}</span>
                  </div>
                  <div className="flex md:block justify-between md:text-right">
                    <span className="text-neutral-500 text-xs md:hidden">Max Price</span>
                    <span className="text-neutral-300 text-sm">{microToUsd(order.maxFillPriceUsd)}</span>
                  </div>
                  <div className="flex md:block justify-between md:text-right">
                    <span className="text-neutral-500 text-xs md:hidden">Size</span>
                    <span className="text-white text-sm font-medium">{microToUsd(order.sizeUsd)}</span>
                  </div>
                  <div className="flex md:block justify-between md:text-right">
                    <span className="text-neutral-500 text-xs md:hidden">Created</span>
                    <span className="text-neutral-400 text-xs">{formatDate(order.createdAt)}</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

      {/* Owner: History */}
      <div style={{ display: isOwnerView && ownerTab === 'history' ? undefined : 'none' }}>
        <div>
          {loadingOwnerHistory ? (
            <div className="flex items-center justify-center py-16"><Spinner /></div>
          ) : ownerHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <span className="text-neutral-500 text-sm">No trade history yet</span>
              <Link href="/" className="text-apple-blue text-sm font-medium hover:underline">Browse markets</Link>
            </div>
          ) : (
            <>
              <div className="hidden md:grid grid-cols-[2.5fr_0.8fr_0.8fr_0.8fr_1fr_1fr_0.8fr] gap-3 px-4 py-2.5 text-[10px] text-neutral-500 font-medium uppercase tracking-wider border-b border-white/5">
                <span>Event</span>
                <span className="text-center">Action</span>
                <span className="text-center">Status</span>
                <span className="text-right">Price</span>
                <span className="text-right">Deposit / Withdraw</span>
                <span className="text-right">PNL</span>
                <span className="text-right">Fee</span>
              </div>
              {ownerHistory.map(h => {
                const { label, color } = eventLabel(h.eventType)
                let depositWithdraw = '-'
                if (h.depositAmountUsd > 0)      depositWithdraw = `-${microToUsd(h.depositAmountUsd)}`
                else if (h.netProceedsUsd > 0)   depositWithdraw = `+${microToUsd(h.netProceedsUsd)}`
                else if (h.grossProceedsUsd > 0) depositWithdraw = `+${microToUsd(h.grossProceedsUsd)}`
                else if (h.payoutAmountUsd > 0)  depositWithdraw = `+${microToUsd(h.payoutAmountUsd)}`
                const depositPos = depositWithdraw.startsWith('+')
                const price = h.avgFillPriceUsd ? microToCents(h.avgFillPriceUsd)
                  : h.maxBuyPriceUsd ? microToCents(h.maxBuyPriceUsd)
                  : h.minSellPriceUsd ? microToCents(h.minSellPriceUsd) : '-'
                const pnlVal = h.realizedPnl ? microToUsd(h.realizedPnl, true) : '-'
                const pnlPos = h.realizedPnl ? h.realizedPnl > 0 : false
                const fee = h.feeUsd > 0 ? microToUsd(h.feeUsd) : '-'
                return (
                  <div key={h.id} className="grid grid-cols-1 md:grid-cols-[2.5fr_0.8fr_0.8fr_0.8fr_1fr_1fr_0.8fr] gap-1 md:gap-3 px-4 py-3 md:py-4 border-b border-white/5 hover:bg-white/[0.03] transition-colors">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${h.isYes ? 'bg-apple-green/15 text-apple-green' : 'bg-apple-red/15 text-apple-red'}`}>
                          {h.isYes ? 'Yes' : 'No'}
                        </span>
                        <Link href={h.eventId ? `/polymarkets/event/${h.eventId}` : '#'} className="text-white text-sm font-medium truncate hover:underline">
                          {h.marketMetadata?.title || h.marketId?.slice(0, 12) + '...'}
                        </Link>
                      </div>
                      <div className="text-neutral-500 text-[11px]">{formatDateFull(h.timestamp)}</div>
                    </div>
                    <div className="flex md:block justify-between md:text-center">
                      <span className="text-neutral-500 text-xs md:hidden">Action</span>
                      <span className="text-white text-sm font-medium">{h.isBuy ? 'Buy' : 'Sell'}</span>
                    </div>
                    <div className="flex md:block justify-between md:text-center">
                      <span className="text-neutral-500 text-xs md:hidden">Status</span>
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>{label}</span>
                    </div>
                    <div className="flex md:block justify-between md:text-right">
                      <span className="text-neutral-500 text-xs md:hidden">Price</span>
                      <span className="text-white text-sm">{price}</span>
                    </div>
                    <div className="flex md:block justify-between md:text-right">
                      <span className="text-neutral-500 text-xs md:hidden">Deposit / Withdraw</span>
                      <span className={`text-sm font-medium ${depositPos ? 'text-apple-green' : depositWithdraw === '-' ? 'text-neutral-500' : 'text-white'}`}>
                        {depositWithdraw}
                      </span>
                    </div>
                    <div className="flex md:block justify-between md:text-right">
                      <span className="text-neutral-500 text-xs md:hidden">PNL</span>
                      <span className={`text-sm font-semibold ${pnlVal === '-' ? 'text-neutral-500' : pnlPos ? 'text-apple-green' : 'text-apple-red'}`}>
                        {pnlVal}
                      </span>
                    </div>
                    <div className="flex md:block justify-between md:text-right">
                      <span className="text-neutral-500 text-xs md:hidden">Fee</span>
                      <span className="text-neutral-400 text-sm">{fee}</span>
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════════
          PUBLIC TAB CONTENT
          ════════════════════════════════════════════════ */}

      {/* Public: Positions */}
      <div style={{ display: !isOwnerView && publicTab === 'positions' ? undefined : 'none' }}>
        <>
          <div className="flex items-center gap-3 mb-4">
            <div className="flex rounded-lg border border-white/10 overflow-hidden">
              <button
                onClick={() => { setPosFilter('active'); setSearch('') }}
                className={`px-4 py-2 text-xs font-semibold transition-colors ${posFilter === 'active' ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-neutral-300'}`}
              >
                Active
              </button>
              <button
                onClick={() => { setPosFilter('closed'); setSearch('') }}
                className={`px-4 py-2 text-xs font-semibold transition-colors border-l border-white/10 ${posFilter === 'closed' ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-neutral-300'}`}
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

          {posFilter === 'active' && (
            filteredPublicPositions.length === 0 ? (
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
                {(filteredPublicPositions as PublicPosition[]).map(pos => (
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
            )
          )}

          {posFilter === 'closed' && (
            filteredPublicPositions.length === 0 ? (
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
                {(filteredPublicPositions as HistoryEvent[]).map(h => {
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
            )
          )}
        </>
      </div>

      {/* Public: Activity */}
      <div style={{ display: !isOwnerView && publicTab === 'activity' ? undefined : 'none' }}>
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
                : h.minSellPriceUsd ? microToCents(h.minSellPriceUsd) : '—'
              const pnl = getPnl(h)
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
                    <span className={`text-sm font-semibold ${pnl === 0 ? 'text-neutral-500' : pnl > 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                      {pnl !== 0 ? microToUsd(pnl, true) : '—'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Achievements (shared — shown to both owner and public viewers) */}
      <div style={{ display: (isOwnerView ? ownerTab === 'achievements' : publicTab === 'achievements') ? undefined : 'none' }}>
        <div>
          {loadingAchievements ? (
            <div className="flex items-center justify-center py-16"><Spinner /></div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {achievements.map(a => (
                <div
                  key={a.id}
                  className={`rounded-xl border p-4 flex items-start gap-3 transition-all ${
                    a.unlocked ? 'border-white/10 bg-white/5' : 'border-white/5 bg-white/[0.02] opacity-50'
                  }`}
                >
                  <span className={`text-3xl ${a.unlocked ? '' : 'grayscale'}`}>{a.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">{a.title}</span>
                      {a.unlocked && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-apple-green/10 text-apple-green">
                          UNLOCKED
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-400 mt-0.5">{a.description}</p>
                    <p className="text-xs text-neutral-500 mt-1">
                      {a.unlocked ? 'Earned' : 'Reward:'}{' '}
                      <span className="text-apple-green font-medium">+{a.points} pts</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
