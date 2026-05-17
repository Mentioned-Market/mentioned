'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'

interface PopupData {
  username: string | null
  wallet: string
  pfpEmoji: string | null
  createdAt: string | null
  allTimePoints: number
  totalTrades: number
  tokenPnl: number
  winRate: number | null
  recentTrades: Array<{
    marketTitle: string
    word: string
    action: string
    side: string
    cost: number
    createdAt: string
    marketSlug: string | null
  }>
}

interface Props {
  identifier: string | null
  onClose: () => void
}

function truncateWallet(w: string) {
  return `${w.slice(0, 4)}...${w.slice(-4)}`
}

function formatJoined(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

export default function UserProfilePopup({ identifier, onClose }: Props) {
  const [data, setData] = useState<PopupData | null>(null)
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const popupRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!identifier) { setData(null); return }
    setLoading(true)
    setData(null)
    fetch(`/api/profile/${encodeURIComponent(identifier)}/popup`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [identifier])

  const handleClose = useCallback(() => onClose(), [onClose])

  useEffect(() => {
    if (!identifier) return
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) handleClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [identifier, handleClose])

  useEffect(() => {
    if (!identifier) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [identifier, handleClose])

  if (!mounted || !identifier) return null

  const profileHref = data ? `/profile/${data.username ?? data.wallet}` : `/profile/${identifier}`
  const displayName = data
    ? (data.username ? `@${data.username}` : truncateWallet(data.wallet))
    : null
  const pnlPositive = (data?.tokenPnl ?? 0) >= 0

  const popup = (
    <>
      <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm" onClick={handleClose} />

      <div
        ref={popupRef}
        className="fixed z-[91] w-[340px] rounded-2xl overflow-hidden shadow-2xl"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: '#0A0A0A',
          border: '1px solid rgba(242,183,31,0.12)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-4 py-4"
          style={{
            background: 'radial-gradient(ellipse at 10% 80%, rgba(242,183,31,0.16) 0%, transparent 55%), linear-gradient(160deg, #161100 0%, #0d0900 60%, #050400 100%)',
            borderBottom: '1px solid rgba(242,183,31,0.10)',
          }}
        >
          {/* Close */}
          <button
            onClick={handleClose}
            className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors text-sm"
            style={{ position: 'absolute' }}
          >
            ✕
          </button>

          <div className="flex items-center gap-3 pr-8">
            {/* Avatar */}
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-xl flex-shrink-0"
              style={{
                background: 'rgba(242,183,31,0.08)',
                boxShadow: '0 0 0 1.5px rgba(242,183,31,0.2)',
              }}
            >
              {data?.pfpEmoji ?? (loading ? '' : '⚪')}
            </div>

            {/* Name */}
            <div className="min-w-0 flex-1">
              {loading || !data ? (
                <>
                  <div className="h-5 w-28 rounded bg-white/10 animate-pulse mb-1.5" />
                  <div className="h-3 w-20 rounded bg-white/5 animate-pulse" />
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1.5">
                    <p className="text-white font-bold text-[15px] leading-tight truncate">{displayName}</p>
                    <Link
                      href={profileHref}
                      onClick={handleClose}
                      className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                      title="View full profile"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 9.5L9.5 2.5M9.5 2.5H5M9.5 2.5V7" stroke="#F2B71F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </Link>
                  </div>
                  <p className="text-neutral-500 text-[11px] font-mono mt-0.5">
                    {truncateWallet(data.wallet)}
                    {data.createdAt && (
                      <span className="ml-1.5 text-neutral-600 font-sans not-italic">· {formatJoined(data.createdAt)}</span>
                    )}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 p-3 pb-0">
          <StatCard label="All-time Points" value={loading || !data ? null : data.allTimePoints.toLocaleString()} valueColor="#F2B71F" loading={loading} />
          <StatCard label="Token P&L" value={loading || !data ? null : `${pnlPositive ? '+' : ''}${Math.round(data.tokenPnl).toLocaleString()}`} valueColor={pnlPositive ? '#34C759' : '#FF3B30'} loading={loading} />
          <StatCard label="Total Trades" value={loading || !data ? null : data.totalTrades.toLocaleString()} loading={loading} />
          <StatCard
            label="Win Rate"
            value={loading || !data ? null : data.winRate !== null ? `${Math.round(data.winRate * 100)}%` : 'N/A'}
            valueColor={data?.winRate != null ? (data.winRate >= 0.5 ? '#34C759' : '#FF3B30') : undefined}
            loading={loading}
          />
        </div>

        {/* Recent trades */}
        <div className="p-3">
          <p className="text-neutral-600 text-[10px] uppercase tracking-widest font-medium mb-2">
            Recent Trades
          </p>
          {loading ? (
            <div className="space-y-1.5">
              {[1, 2, 3].map(i => <div key={i} className="h-9 rounded-lg bg-white/[0.04] animate-pulse" />)}
            </div>
          ) : data && data.recentTrades.length > 0 ? (
            <div className="space-y-1.5">
              {data.recentTrades.slice(0, 3).map((t, i) => <TradeRow key={i} trade={t} />)}
            </div>
          ) : (
            <p className="text-neutral-700 text-xs text-center py-4">No trades yet</p>
          )}
        </div>
      </div>
    </>
  )

  return createPortal(popup, document.body)
}

function StatCard({
  label, value, valueColor, loading,
}: {
  label: string
  value: string | null
  valueColor?: string
  loading: boolean
}) {
  return (
    <div
      className="rounded-xl px-3 py-2.5"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <p className="text-neutral-500 text-[9px] uppercase tracking-widest font-semibold mb-1">{label}</p>
      {loading || value === null ? (
        <div className="h-5 w-14 rounded bg-white/10 animate-pulse" />
      ) : (
        <p className="text-sm font-bold" style={{ color: valueColor ?? '#e5e5e5' }}>{value}</p>
      )}
    </div>
  )
}

function TradeRow({ trade }: { trade: PopupData['recentTrades'][number] }) {
  const isBuy = trade.action === 'buy'
  const isYes = trade.side === 'YES'
  const sideColor = isYes ? '#34C759' : '#FF3B30'
  const dotColor = isBuy ? (isYes ? '#34C759' : '#FF3B30') : 'rgba(255,255,255,0.25)'

  return (
    <div
      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: dotColor }} />
      <div className="flex-1 min-w-0">
        <p className="text-white text-[12px] font-medium truncate leading-tight">{trade.word}</p>
        <p className="text-neutral-600 text-[10px] truncate leading-tight mt-0.5">{trade.marketTitle}</p>
      </div>
      <span
        className="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap flex-shrink-0"
        style={{ color: sideColor, background: `${sideColor}18` }}
      >
        {isBuy ? 'Buy' : 'Sell'} {trade.side}
      </span>
      <span className="text-neutral-400 text-[11px] font-semibold tabular-nums flex-shrink-0">
        {Math.round(trade.cost)}
      </span>
    </div>
  )
}
