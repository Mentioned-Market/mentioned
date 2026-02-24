'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Header from '@/components/Header'
import SharePnLModal from '@/components/SharePnLModal'
import type { PnLCardData, MarketSummaryData } from '@/lib/generatePnLImage'
import { useWallet } from '@/contexts/WalletContext'
import { useRouter } from 'next/navigation'
import { address as toAddress } from '@solana/kit'
import {
  fetchUserPositions,
  fetchEscrow,
  fetchMarket,
  fetchUserTradeHistory,
  createRedeemIx,
  sendIxs,
  type UserPosition,
  type UserEscrow,
  type UserTradeEntry,
  MarketStatus,
  marketStatusStr,
} from '@/lib/mentionMarket'

type MarketData = Awaited<ReturnType<typeof fetchMarket>>
type CostBasis = { totalCost: number; totalShares: number }

export default function ProfilePage() {
  const { connected, publicKey, signer } = useWallet()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'active' | 'claimable' | 'resolved' | 'history'>('active')

  const [positions, setPositions] = useState<UserPosition[]>([])
  const [escrowData, setEscrowData] = useState<UserEscrow | null>(null)
  const [tradeHistory, setTradeHistory] = useState<UserTradeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [claiming, setClaiming] = useState(false)
  const [claimStatus, setClaimStatus] = useState<{ msg: string; error: boolean } | null>(null)

  // Share P&L modal
  type ShareData = { type: 'word'; data: PnLCardData } | { type: 'market'; data: MarketSummaryData }
  const [shareData, setShareData] = useState<ShareData | null>(null)
  const [expandedMarkets, setExpandedMarkets] = useState<Set<string>>(new Set())

  // Username state
  const [username, setUsername] = useState<string | null>(null)
  const [editingUsername, setEditingUsername] = useState(false)
  const [usernameInput, setUsernameInput] = useState('')
  const [usernameSaving, setUsernameSaving] = useState(false)
  const [usernameError, setUsernameError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!publicKey) {
      setPositions([])
      setEscrowData(null)
      setTradeHistory([])
      setUsername(null)
      setLoading(false)
      return
    }
    try {
      const addr = toAddress(publicKey)
      const [pos, escrow, history, profileRes] = await Promise.all([
        fetchUserPositions(addr),
        fetchEscrow(addr),
        fetchUserTradeHistory(addr).catch(() => [] as UserTradeEntry[]),
        fetch(`/api/profile?wallet=${publicKey}`).then((r) => r.json()).catch(() => ({ username: null })),
      ])
      setPositions(pos)
      setEscrowData(escrow)
      setTradeHistory(history)
      setUsername(profileRes.username)
    } catch (err) {
      console.error('Failed to load profile data:', err)
    }
    setLoading(false)
  }, [publicKey])

  useEffect(() => {
    setLoading(true)
    loadData()
  }, [loadData])

  const activePositions = positions.filter(
    (p) => p.marketStatus === MarketStatus.Open || p.marketStatus === MarketStatus.Paused
  )
  const claimablePositions = positions.filter((p) => p.claimable)
  const resolvedPositions = positions.filter(
    (p) => p.marketStatus === MarketStatus.Resolved
  )

  const escrowSol = escrowData ? Number(escrowData.balance) / 1_000_000_000 : 0
  const activeValue = activePositions.reduce((sum, p) => sum + p.estimatedValueSol, 0)
  const claimableValue = claimablePositions.reduce((sum, p) => sum + p.estimatedValueSol, 0)

  const costBasisMap = useMemo(() => {
    const map: Record<string, CostBasis> = {}
    for (const trade of tradeHistory) {
      const key = `${trade.marketId}-${trade.wordIndex}-${trade.direction}`
      const existing = map[key] || { totalCost: 0, totalShares: 0 }
      if (trade.isBuy) {
        existing.totalCost += trade.cost
        existing.totalShares += trade.quantity
      } else {
        // Sells reduce cost basis proportionally and reduce shares
        existing.totalCost -= trade.cost
        existing.totalShares -= trade.quantity
      }
      // Clamp to 0 to avoid negative cost basis from rounding
      if (existing.totalCost < 0) existing.totalCost = 0
      if (existing.totalShares < 0) existing.totalShares = 0
      map[key] = existing
    }
    return map
  }, [tradeHistory])

  const getCostBasis = (pos: UserPosition): CostBasis => {
    const key = `${pos.marketId}-${pos.wordIndex}-${pos.side}`
    return costBasisMap[key] || { totalCost: 0, totalShares: 0 }
  }

  // Net invested = sum of buy costs minus sell returns
  const totalInvested = useMemo(
    () => tradeHistory.reduce((sum, t) => sum + (t.isBuy ? t.cost : -t.cost), 0),
    [tradeHistory]
  )

  // Realized returns from redeemed (claimed) positions: won + 0 balance = already redeemed
  // Each winning token paid out 1 SOL, so payout = net shares from trades
  const totalRealizedReturns = useMemo(() => {
    return positions
      .filter((p) => p.won === true && p.rawAmount === 0n)
      .reduce((sum, p) => {
        const basis = getCostBasis(p)
        return sum + basis.totalShares // each redeemed share = 1 SOL
      }, 0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, costBasisMap])

  const totalCurrentValue = positions.reduce((sum, p) => sum + p.estimatedValueSol, 0)
  const totalPnl = totalCurrentValue + totalRealizedReturns - totalInvested
  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0

  const handleClaim = async (positionsToClaim: UserPosition[]) => {
    if (!signer || !publicKey || positionsToClaim.length === 0) return
    setClaiming(true)
    setClaimStatus(null)

    try {
      const addr = toAddress(publicKey)
      const marketIds = [...new Set(positionsToClaim.map((p) => p.marketId.toString()))]
      const marketMap = new Map<string, MarketData>()
      for (const mid of marketIds) {
        const m = await fetchMarket(BigInt(mid))
        if (m) marketMap.set(mid, m)
      }

      const ixs = []
      for (const pos of positionsToClaim) {
        const market = marketMap.get(pos.marketId.toString())
        if (!market) continue
        ixs.push(
          await createRedeemIx(addr, pos.marketId, pos.wordIndex, pos.side, market)
        )
      }

      if (ixs.length === 0) {
        setClaimStatus({ msg: 'No valid positions to claim', error: true })
        setClaiming(false)
        return
      }

      await sendIxs(signer, ixs)

      const totalSol = positionsToClaim.reduce((s, p) => s + p.estimatedValueSol, 0)
      setClaimStatus({
        msg: `Claimed ${positionsToClaim.length} position${positionsToClaim.length > 1 ? 's' : ''} for ${totalSol.toFixed(4)} SOL`,
        error: false,
      })

      await loadData()
    } catch (e: unknown) {
      console.error('Claim failed:', e)
      setClaimStatus({ msg: (e as Error).message, error: true })
    } finally {
      setClaiming(false)
      setTimeout(() => setClaimStatus(null), 8000)
    }
  }

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
        setUsername(trimmed)
        setEditingUsername(false)
      }
    } catch {
      setUsernameError('Failed to save username')
    } finally {
      setUsernameSaving(false)
    }
  }

  if (!connected) {
    return (
      <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
        <div className="layout-container flex h-full grow flex-col">
          <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
            <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
              <Header />
              <main className="py-20 text-center">
                <h1 className="text-3xl font-bold mb-4 text-white">Connect your wallet</h1>
                <p className="text-neutral-400 text-base mb-8">
                  Connect your wallet to view your portfolio and positions
                </p>
                <button
                  onClick={() => router.push('/')}
                  className="px-6 py-3 bg-white text-black font-semibold rounded-xl hover:bg-neutral-100 transition-colors"
                >
                  Go Home
                </button>
              </main>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
            <Header />

            <main className="py-4 md:py-6">
              <div className="mb-6">
                {editingUsername ? (
                  <div className="flex items-center gap-2 mb-1">
                    <input
                      type="text"
                      value={usernameInput}
                      onChange={(e) => {
                        setUsernameInput(e.target.value)
                        setUsernameError(null)
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveUsername(); if (e.key === 'Escape') { setEditingUsername(false); setUsernameError(null) } }}
                      placeholder="username"
                      autoFocus
                      maxLength={20}
                      className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xl md:text-2xl font-bold text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/30 w-56"
                    />
                    <button
                      onClick={handleSaveUsername}
                      disabled={usernameSaving}
                      className="px-3 py-1.5 bg-white text-black text-sm font-semibold rounded-lg hover:bg-neutral-200 transition-colors disabled:opacity-50"
                    >
                      {usernameSaving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={() => { setEditingUsername(false); setUsernameError(null) }}
                      className="px-3 py-1.5 text-neutral-400 text-sm font-medium hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 mb-1">
                    <h1 className="text-2xl md:text-3xl font-bold text-white">
                      {username || 'Set Username'}
                    </h1>
                    <button
                      onClick={() => {
                        setUsernameInput(username || '')
                        setEditingUsername(true)
                        setUsernameError(null)
                      }}
                      className="text-neutral-500 hover:text-white transition-colors"
                      title="Edit username"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                        <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                      </svg>
                    </button>
                  </div>
                )}
                {usernameError && (
                  <p className="text-apple-red text-xs mt-1 mb-1">{usernameError}</p>
                )}
                <p className="text-neutral-500 text-sm font-mono">
                  {publicKey?.slice(0, 8)}...{publicKey?.slice(-8)}
                </p>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                </div>
              ) : (
                <>
                  {/* Portfolio Overview */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
                    <div className="glass rounded-xl p-4 md:p-5">
                      <div className="text-neutral-400 text-[10px] md:text-xs font-medium uppercase tracking-wider mb-1">
                        Escrow Balance
                      </div>
                      <div className="text-xl md:text-2xl font-bold text-white">
                        {escrowSol.toFixed(2)} <span className="text-sm text-neutral-400">SOL</span>
                      </div>
                    </div>
                    <div className="glass rounded-xl p-4 md:p-5">
                      <div className="text-neutral-400 text-[10px] md:text-xs font-medium uppercase tracking-wider mb-1">
                        Net Invested
                      </div>
                      <div className="text-xl md:text-2xl font-bold text-white">
                        {Math.max(0, totalInvested).toFixed(2)} <span className="text-sm text-neutral-400">SOL</span>
                      </div>
                    </div>
                    <div className="glass rounded-xl p-4 md:p-5">
                      <div className="text-neutral-400 text-[10px] md:text-xs font-medium uppercase tracking-wider mb-1">
                        Total Returns
                      </div>
                      <div className="text-xl md:text-2xl font-bold text-white">
                        {(totalCurrentValue + totalRealizedReturns).toFixed(2)} <span className="text-sm text-neutral-400">SOL</span>
                      </div>
                    </div>
                    <div className="glass rounded-xl p-4 md:p-5">
                      <div className="text-neutral-400 text-[10px] md:text-xs font-medium uppercase tracking-wider mb-1">
                        {"Total P&L"}
                      </div>
                      <div className={`text-xl md:text-2xl font-bold ${totalPnl >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                        {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(4)} <span className="text-sm">SOL</span>
                      </div>
                      {totalInvested > 0 && (
                        <div className={`text-xs font-semibold mt-0.5 ${totalPnlPct >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                          {totalPnlPct >= 0 ? '+' : ''}{totalPnlPct.toFixed(1)}%
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Tabs */}
                  <div className="flex gap-1 mb-6 border-b border-white/10">
                    <button
                      onClick={() => setActiveTab('active')}
                      className={`px-4 md:px-6 py-3 text-sm font-semibold transition-all ${
                        activeTab === 'active'
                          ? 'border-b-2 border-white text-white'
                          : 'text-neutral-500 hover:text-neutral-300'
                      }`}
                    >
                      Active ({activePositions.length})
                    </button>
                    <button
                      onClick={() => setActiveTab('claimable')}
                      className={`px-4 md:px-6 py-3 text-sm font-semibold transition-all ${
                        activeTab === 'claimable'
                          ? 'border-b-2 border-white text-white'
                          : 'text-neutral-500 hover:text-neutral-300'
                      }`}
                    >
                      Claimable ({claimablePositions.length})
                    </button>
                    <button
                      onClick={() => setActiveTab('resolved')}
                      className={`px-4 md:px-6 py-3 text-sm font-semibold transition-all ${
                        activeTab === 'resolved'
                          ? 'border-b-2 border-white text-white'
                          : 'text-neutral-500 hover:text-neutral-300'
                      }`}
                    >
                      Resolved ({resolvedPositions.length})
                    </button>
                    <button
                      onClick={() => setActiveTab('history')}
                      className={`px-4 md:px-6 py-3 text-sm font-semibold transition-all ${
                        activeTab === 'history'
                          ? 'border-b-2 border-white text-white'
                          : 'text-neutral-500 hover:text-neutral-300'
                      }`}
                    >
                      History ({tradeHistory.length})
                    </button>
                  </div>

                  {/* Active Positions */}
                  {activeTab === 'active' && (
                    <div className="space-y-3">
                      {activePositions.length === 0 ? (
                        <div className="text-center py-16 text-neutral-500">
                          <p className="text-base mb-4">No active positions</p>
                          <button
                            onClick={() => router.push('/')}
                            className="px-6 py-2.5 bg-white text-black font-semibold rounded-xl hover:bg-neutral-100 transition-colors"
                          >
                            Explore Markets
                          </button>
                        </div>
                      ) : (
                        activePositions.map((pos, i) => {
                          const basis = getCostBasis(pos)
                          const pnl = pos.estimatedValueSol - basis.totalCost
                          const pnlPct = basis.totalCost > 0 ? (pnl / basis.totalCost) * 100 : 0
                          const avgPrice = basis.totalShares > 0 ? basis.totalCost / basis.totalShares : 0
                          return (
                            <a
                              key={`${pos.marketId}-${pos.wordIndex}-${i}`}
                              href={`/market/${pos.marketId.toString()}`}
                              className="block glass rounded-xl p-4 md:p-5 hover:bg-white/[0.04] transition-colors"
                            >
                              <div className="flex items-start justify-between mb-3">
                                <div>
                                  <div className="text-xs text-neutral-400 font-medium mb-1">
                                    {"Market #"}{pos.marketId.toString()} {" · "} {pos.marketLabel}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-white font-semibold text-base">
                                      {pos.wordLabel}
                                    </span>
                                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                      pos.side === 'YES'
                                        ? 'bg-apple-green/15 text-apple-green'
                                        : 'bg-apple-red/15 text-apple-red'
                                    }`}>
                                      {pos.side}
                                    </span>
                                    <span className="px-2 py-0.5 rounded bg-white/10 text-neutral-300 text-xs font-medium">
                                      {marketStatusStr(pos.marketStatus)}
                                    </span>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-white font-semibold text-base">
                                    {pos.estimatedValueSol.toFixed(4)} SOL
                                  </div>
                                  {basis.totalCost > 0 && (
                                    <div className={`text-xs font-semibold ${pnl >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                                      {pnl >= 0 ? '+' : ''}{pnl.toFixed(4)} SOL ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                                <div>
                                  <span className="text-neutral-400">Shares </span>
                                  <span className="text-white font-medium">{pos.shares.toFixed(2)}</span>
                                </div>
                                {basis.totalCost > 0 && (
                                  <>
                                    <div>
                                      <span className="text-neutral-400">Cost Basis </span>
                                      <span className="text-white font-medium">{basis.totalCost.toFixed(4)} SOL</span>
                                    </div>
                                    <div>
                                      <span className="text-neutral-400">Avg Price </span>
                                      <span className="text-white font-medium">{(avgPrice * 100).toFixed(0)}c</span>
                                    </div>
                                  </>
                                )}
                              </div>
                            </a>
                          )
                        })
                      )}
                    </div>
                  )}

                  {/* Claim Status */}
                  {claimStatus && (
                    <div
                      className={`mb-4 p-3 rounded-lg text-sm ${
                        claimStatus.error
                          ? 'bg-red-500/10 border border-red-500/30 text-red-300'
                          : 'bg-green-500/10 border border-green-500/30 text-green-300'
                      }`}
                    >
                      {claimStatus.msg}
                    </div>
                  )}

                  {/* Claimable Positions */}
                  {activeTab === 'claimable' && (
                    <div className="space-y-3">
                      {claimablePositions.length === 0 ? (
                        <div className="text-center py-16 text-neutral-500">
                          <p className="text-base">No positions to claim</p>
                        </div>
                      ) : (
                        <>
                          {claimablePositions.length > 1 && (
                            <button
                              onClick={() => handleClaim(claimablePositions)}
                              disabled={claiming}
                              className="w-full py-3 bg-apple-green hover:bg-apple-green/90 text-white font-semibold text-sm rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                              {claiming ? (
                                <>
                                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                  </svg>
                                  Claiming...
                                </>
                              ) : (
                                `Claim All ${claimablePositions.length} Positions (${claimableValue.toFixed(4)} SOL)`
                              )}
                            </button>
                          )}

                          {claimablePositions.map((pos, i) => {
                            const basis = getCostBasis(pos)
                            const profit = pos.estimatedValueSol - basis.totalCost
                            return (
                              <div
                                key={`${pos.marketId}-${pos.wordIndex}-${i}`}
                                className="glass rounded-xl p-4 md:p-5 border border-apple-green/20"
                              >
                                <div className="flex items-start justify-between mb-3">
                                  <div>
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="px-2 py-0.5 rounded bg-apple-green/15 text-apple-green text-xs font-semibold">
                                        Ready to Claim
                                      </span>
                                    </div>
                                    <div className="text-xs text-neutral-400 font-medium mb-1">
                                      {"Market #"}{pos.marketId.toString()} {" · "} {pos.marketLabel}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-white font-semibold text-base">
                                        {pos.wordLabel}
                                      </span>
                                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                        pos.side === 'YES'
                                          ? 'bg-apple-green/15 text-apple-green'
                                          : 'bg-apple-red/15 text-apple-red'
                                      }`}>
                                        {pos.side}
                                      </span>
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => handleClaim([pos])}
                                    disabled={claiming}
                                    className="px-4 py-2 bg-apple-green hover:bg-apple-green/90 text-white font-semibold text-sm rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {claiming ? 'Claiming...' : `Claim ${pos.shares.toFixed(2)} shares`}
                                  </button>
                                </div>
                                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                                  <div>
                                    <span className="text-neutral-400">Shares </span>
                                    <span className="text-white font-medium">{pos.shares.toFixed(2)}</span>
                                  </div>
                                  <div>
                                    <span className="text-neutral-400">Claim Value </span>
                                    <span className="text-apple-green font-semibold">
                                      {pos.estimatedValueSol.toFixed(4)} SOL
                                    </span>
                                  </div>
                                  {basis.totalCost > 0 && (
                                    <>
                                      <div>
                                        <span className="text-neutral-400">Cost Basis </span>
                                        <span className="text-white font-medium">{basis.totalCost.toFixed(4)} SOL</span>
                                      </div>
                                      <div>
                                        <span className="text-neutral-400">Profit </span>
                                        <span className={`font-semibold ${profit >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                                          {profit >= 0 ? '+' : ''}{profit.toFixed(4)} SOL
                                        </span>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </>
                      )}
                    </div>
                  )}

                  {/* Resolved Positions — grouped by market */}
                  {activeTab === 'resolved' && (
                    <div className="space-y-6">
                      {resolvedPositions.length === 0 ? (
                        <div className="text-center py-16 text-neutral-500">
                          <p className="text-base">No resolved positions</p>
                        </div>
                      ) : (
                        (() => {
                          // Group positions by marketId
                          const grouped = new Map<string, UserPosition[]>()
                          for (const pos of resolvedPositions) {
                            const key = pos.marketId.toString()
                            const arr = grouped.get(key) || []
                            arr.push(pos)
                            grouped.set(key, arr)
                          }

                          return Array.from(grouped.entries()).map(([marketId, positions]) => {
                            const marketLabel = positions[0].marketLabel

                            // Compute per-position data for this market group
                            const posData = positions.map((pos) => {
                              const basis = getCostBasis(pos)
                              const isClaimed = pos.won === true && pos.rawAmount === 0n
                              const isSold = pos.won === false && pos.rawAmount === 0n
                              const payout = isClaimed
                                ? basis.totalShares
                                : pos.won && pos.rawAmount > 0n
                                  ? pos.shares
                                  : 0
                              const pnl = payout - basis.totalCost

                              let statusLabel: string
                              let statusClass: string
                              if (isClaimed) {
                                statusLabel = 'Claimed'
                                statusClass = 'bg-apple-green/15 text-apple-green'
                              } else if (isSold) {
                                statusLabel = 'Sold'
                                statusClass = 'bg-neutral-500/15 text-neutral-400'
                              } else if (pos.won) {
                                statusLabel = 'Won'
                                statusClass = 'bg-apple-green/15 text-apple-green'
                              } else {
                                statusLabel = 'Lost'
                                statusClass = 'bg-apple-red/15 text-apple-red'
                              }

                              return { pos, basis, isClaimed, isSold, payout, pnl, statusLabel, statusClass }
                            })

                            // Market-level totals
                            const marketTotalCost = posData.reduce((s, d) => s + d.basis.totalCost, 0)
                            const marketTotalPayout = posData.reduce((s, d) => s + d.payout, 0)
                            const marketTotalPnl = marketTotalPayout - marketTotalCost

                            const isExpanded = expandedMarkets.has(marketId)
                            const toggleExpand = () => {
                              setExpandedMarkets((prev) => {
                                const next = new Set(prev)
                                if (next.has(marketId)) next.delete(marketId)
                                else next.add(marketId)
                                return next
                              })
                            }
                            const correct = posData.filter((d) => d.pos.won === true).length

                            return (
                              <div key={marketId} className="glass rounded-xl border border-white/5 overflow-hidden">
                                {/* Market header — clickable to expand */}
                                <button
                                  onClick={toggleExpand}
                                  className="w-full flex items-center justify-between p-4 md:p-5 hover:bg-white/[0.03] transition-colors text-left"
                                >
                                  <div>
                                    <div className="text-xs text-neutral-500 font-medium mb-1">
                                      Market #{marketId}
                                    </div>
                                    <div className="text-white font-semibold text-base">
                                      {marketLabel}
                                    </div>
                                    <div className="text-xs text-neutral-400 mt-1">
                                      {correct}/{posData.length} correct · {posData.length} words
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <div className="text-right">
                                      <div className={`font-semibold text-base ${marketTotalPnl >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                                        {marketTotalPnl >= 0 ? '+' : ''}{marketTotalPnl.toFixed(4)} SOL
                                      </div>
                                      <div className="text-xs text-neutral-500">
                                        {marketTotalCost.toFixed(4)} invested
                                      </div>
                                    </div>
                                    <span
                                      role="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setShareData({
                                          type: 'market',
                                          data: {
                                            marketLabel,
                                            marketId,
                                            words: posData.map((d) => ({
                                              label: d.pos.wordLabel,
                                              won: d.pos.won === true,
                                              side: d.pos.side,
                                            })),
                                            totalCost: marketTotalCost,
                                            totalPayout: marketTotalPayout,
                                            totalPnl: marketTotalPnl,
                                          },
                                        })
                                      }}
                                      className="px-2.5 py-1.5 glass border border-white/10 rounded-lg text-neutral-400 text-[10px] font-semibold hover:text-white hover:bg-white/10 transition-all duration-200 whitespace-nowrap"
                                    >
                                      Share Market P&L
                                    </span>
                                    <svg
                                      className={`w-4 h-4 text-neutral-500 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </div>
                                </button>

                                {/* Expandable word rows */}
                                {isExpanded && (
                                  <div className="border-t border-white/5">
                                    {posData.map(({ pos, basis, isClaimed, payout, pnl, statusLabel, statusClass }, i) => (
                                      <div
                                        key={`${pos.marketId}-${pos.wordIndex}-${pos.side}-${i}`}
                                        className={`flex items-center justify-between px-4 md:px-5 py-3 hover:bg-white/[0.03] transition-colors ${
                                          i > 0 ? 'border-t border-white/5' : ''
                                        }`}
                                      >
                                        <a href={`/market/${pos.marketId.toString()}`} className="flex items-center gap-2 min-w-0 flex-1">
                                          <span className="text-white font-medium text-sm truncate">
                                            {pos.wordLabel}
                                          </span>
                                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                                            pos.side === 'YES'
                                              ? 'bg-apple-green/15 text-apple-green'
                                              : 'bg-apple-red/15 text-apple-red'
                                          }`}>
                                            {pos.side}
                                          </span>
                                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${statusClass}`}>
                                            {statusLabel}
                                          </span>
                                        </a>
                                        <div className="flex items-center gap-3 shrink-0">
                                          <div className="text-right">
                                            <div className={`font-semibold text-sm ${payout > 0 ? 'text-apple-green' : 'text-white'}`}>
                                              {payout.toFixed(4)}
                                            </div>
                                            {basis.totalCost > 0 && (
                                              <div className={`text-[10px] font-semibold ${pnl >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                                                {pnl >= 0 ? '+' : ''}{pnl.toFixed(4)}
                                              </div>
                                            )}
                                          </div>
                                          <button
                                            onClick={(e) => {
                                              e.preventDefault()
                                              e.stopPropagation()
                                              setShareData({
                                                type: 'word',
                                                data: {
                                                  wordLabel: pos.wordLabel,
                                                  marketLabel: pos.marketLabel,
                                                  marketId: pos.marketId.toString(),
                                                  side: pos.side,
                                                  statusLabel,
                                                  payout,
                                                  costBasis: basis.totalCost,
                                                  pnl,
                                                  shares: isClaimed ? basis.totalShares : pos.shares,
                                                  isClaimed,
                                                },
                                              })
                                            }}
                                            className="px-2.5 py-1 glass border border-white/10 rounded-md text-neutral-400 text-[10px] font-semibold hover:text-white hover:bg-white/10 transition-all duration-200"
                                          >
                                            Share
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })
                        })()
                      )}
                    </div>
                  )}

                  {/* History */}
                  {activeTab === 'history' && (
                    <div className="space-y-3">
                      {tradeHistory.length === 0 ? (
                        <div className="text-center py-16 text-neutral-500">
                          <p className="text-base">No trade history found</p>
                        </div>
                      ) : (
                        tradeHistory.map((trade, i) => (
                          <a
                            key={`${trade.txSignature}-${i}`}
                            href={`https://explorer.solana.com/tx/${trade.txSignature}?cluster=devnet`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block glass rounded-xl p-4 md:p-5 hover:bg-white/[0.04] transition-colors"
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div>
                                <div className="text-xs text-neutral-400 font-medium mb-1">
                                  {"Market #"}{trade.marketId.toString()} {" · "} {trade.marketLabel}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-white font-semibold text-base">
                                    {trade.wordLabel}
                                  </span>
                                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                    trade.isBuy
                                      ? 'bg-apple-green/15 text-apple-green'
                                      : 'bg-orange-500/15 text-orange-400'
                                  }`}>
                                    {trade.isBuy ? 'Buy' : 'Sell'}
                                  </span>
                                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                    trade.direction === 'YES'
                                      ? 'bg-apple-green/15 text-apple-green'
                                      : 'bg-apple-red/15 text-apple-red'
                                  }`}>
                                    {trade.direction}
                                  </span>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className={`font-semibold text-base ${trade.isBuy ? 'text-white' : 'text-apple-green'}`}>
                                  {trade.isBuy ? '-' : '+'}{trade.cost.toFixed(4)} SOL
                                </div>
                                <div className="text-neutral-500 text-xs">
                                  {trade.quantity.toFixed(2)} shares @ {trade.quantity > 0 ? ((trade.cost / trade.quantity) * 100).toFixed(0) : 0}c
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center justify-between text-xs text-neutral-500">
                              <span>
                                {new Date(trade.timestamp * 1000).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                              <span className="font-mono text-[10px] text-neutral-600 hover:text-neutral-400 transition-colors">
                                {trade.txSignature.slice(0, 8)}...
                              </span>
                            </div>
                          </a>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </main>
          </div>
        </div>
      </div>
      <SharePnLModal shareData={shareData} onClose={() => setShareData(null)} />
    </div>
  )
}
