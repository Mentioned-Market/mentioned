'use client'

import Link from 'next/link'
import type { FeedItem } from '@/lib/activity'

// ── Shared helpers ─────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function displayName(username: string | null, wallet: string): string {
  return username ? `@${username}` : `${wallet.slice(0, 4)}...${wallet.slice(-4)}`
}

function profileHref(username: string | null, wallet: string): string {
  return `/profile/${username ?? wallet}`
}

function formatUsd(microUsd: string): string {
  const usd = Number(microUsd) / 1_000_000
  if (!Number.isFinite(usd)) return '$0'
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`
  return `$${usd.toFixed(2)}`
}

function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(n >= 10 ? 0 : 1)
}

function formatSol(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return `${n.toFixed(n >= 1 ? 2 : 3)} SOL`
}

function sideBadge(label: string, tone: 'yes' | 'no' | 'neutral') {
  const cls = tone === 'yes'
    ? 'text-apple-green bg-apple-green/10 border-apple-green/20'
    : tone === 'no'
    ? 'text-apple-red bg-apple-red/10 border-apple-red/20'
    : 'text-neutral-400 bg-white/5 border-white/10'
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md border text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  )
}

// ── Actor header (shared across renderers) ─────────────────

function Actor({ item }: { item: FeedItem }) {
  const name = displayName(item.actorUsername, item.actorWallet)
  return (
    <Link
      href={profileHref(item.actorUsername, item.actorWallet)}
      className="flex items-center gap-2 min-w-0 group"
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-white/5 border border-white/10"
      >
        {item.actorPfpEmoji ? (
          <span className="text-base leading-none">{item.actorPfpEmoji}</span>
        ) : (
          <span className="text-white text-sm font-bold">
            {name.replace('@', '').charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <span className="text-white text-sm font-semibold group-hover:underline truncate block">
          {name}
        </span>
      </div>
    </Link>
  )
}

// ── Per-type renderers ─────────────────────────────────────

function PolymarketTradeCard({ item }: { item: FeedItem }) {
  if (item.activity.type !== 'polymarket_trade') return null
  const a = item.activity
  const action = a.isBuy ? 'bought' : 'sold'
  const tone: 'yes' | 'no' = a.isYes ? 'yes' : 'no'
  return (
    <Row item={item} href={`/polymarkets/event/${a.eventId}`}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-neutral-300">
        <span>{action}</span>
        {sideBadge(a.isYes ? 'YES' : 'NO', tone)}
        <span className="text-white font-semibold">{formatUsd(a.amountUsd)}</span>
        {a.marketTitle && (
          <>
            <span className="text-neutral-500">on</span>
            <span className="text-white truncate max-w-[260px]">{a.marketTitle}</span>
          </>
        )}
      </div>
    </Row>
  )
}

function OnchainTradeCard({ item }: { item: FeedItem }) {
  if (item.activity.type !== 'onchain_trade') return null
  const a = item.activity
  const action = a.isBuy ? 'bought' : 'sold'
  const tone: 'yes' | 'no' = a.direction === 0 ? 'yes' : 'no'
  return (
    <Row item={item} href={`/event/${a.marketId}`}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-neutral-300">
        <span>{action}</span>
        {sideBadge(a.direction === 0 ? 'YES' : 'NO', tone)}
        <span className="text-white font-semibold">{formatSol(a.cost)}</span>
        <span className="text-neutral-500">·</span>
        <span className="text-neutral-400">{Math.round(a.impliedPrice * 100)}¢</span>
      </div>
    </Row>
  )
}

function FreeTradeCard({ item }: { item: FeedItem }) {
  if (item.activity.type !== 'free_trade') return null
  const a = item.activity
  const tone: 'yes' | 'no' = a.side === 'YES' ? 'yes' : 'no'
  const verb = a.action === 'buy' ? 'bought' : 'sold'
  return (
    <Row item={item} href={`/free/${a.marketSlug ?? a.marketId}`}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-neutral-300">
        <span>{verb}</span>
        {sideBadge(a.side, tone)}
        <span className="text-white font-semibold">{formatTokens(a.shares)} shares</span>
        <span className="text-neutral-500">on</span>
        <span className="text-white truncate max-w-[220px]">{a.word}</span>
        <span className="text-neutral-500 hidden sm:inline">·</span>
        <span className="text-neutral-500 text-xs truncate max-w-[180px] hidden sm:inline">
          {a.marketTitle}
        </span>
      </div>
    </Row>
  )
}

function AchievementCard({ item }: { item: FeedItem }) {
  if (item.activity.type !== 'achievement_unlocked') return null
  const a = item.activity
  return (
    <Row item={item} href={profileHref(item.actorUsername, item.actorWallet)}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-neutral-300">
        <span>unlocked</span>
        <span className="text-lg leading-none">{a.emoji}</span>
        <span className="text-white font-semibold">{a.title}</span>
        {a.points > 0 && (
          <span className="text-xs font-semibold" style={{ color: '#F2B71F' }}>
            +{a.points} pts
          </span>
        )}
      </div>
    </Row>
  )
}

// ── Row chrome shared by every renderer ────────────────────

function Row({ item, href, children }: { item: FeedItem; href: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-2xl border border-white/5 hover:bg-white/[0.02] transition-colors">
      <Actor item={item} />
      <div className="flex-1 min-w-0">
        <Link href={href} className="block">
          {children}
          <div className="text-neutral-600 text-xs mt-1">{timeAgo(item.createdAt)}</div>
        </Link>
      </div>
    </div>
  )
}

// ── Registry — add a type here to render a new activity ───

const RENDERERS: Record<string, React.FC<{ item: FeedItem }>> = {
  polymarket_trade: PolymarketTradeCard,
  onchain_trade: OnchainTradeCard,
  free_trade: FreeTradeCard,
  achievement_unlocked: AchievementCard,
}

export default function ActivityCard({ item }: { item: FeedItem }) {
  const Renderer = RENDERERS[item.activity.type]
  if (!Renderer) return null
  return <Renderer item={item} />
}
