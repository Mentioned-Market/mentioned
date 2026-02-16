'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Header from '@/components/Header'
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

  const loadData = useCallback(async () => {
    if (!publicKey) {
      setPositions([])
      setEscrowData(null)
      setTradeHistory([])
      setLoading(false)
      return
    }
    try {
      const addr = toAddress(publicKey)
      const [pos, escrow, history] = await Promise.all([
        fetchUserPositions(addr),
        fetchEscrow(addr),
        fetchUserTradeHistory(addr).catch(() => [] as UserTradeEntry[]),
      ])
      setPositions(pos)
      setEscrowData(escrow)
      setTradeHistory(history)
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
      existing.totalCost += trade.cost
      existing.totalShares += trade.quantity
      map[key] = existing
    }
    return map
  }, [tradeHistory])

  const getCostBasis = (pos: UserPosition): CostBasis => {
    const key = `${pos.marketId}-${pos.wordIndex}-${pos.side}`
    return costBasisMap[key] || { totalCost: 0, totalShares: 0 }
  }

  const totalInvested = useMemo(
    () => tradeHistory.reduce((sum, t) => sum + t.cost, 0),
    [tradeHistory]
  )
  const totalCurrentValue = positions.reduce((sum, p) => sum + p.estimatedValueSol, 0)
  const totalPnl = totalCurrentValue - totalInvested
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
                <h1 className="text-2xl md:text-3xl font-bold text-white mb-1">Profile</h1>
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
                        Total Invested
                      </div>
                      <div className="text-xl md:text-2xl font-bold text-white">
                        {totalInvested.toFixed(2)} <span className="text-sm text-neutral-400">SOL</span>
                      </div>
                    </div>
                    <div className="glass rounded-xl p-4 md:p-5">
                      <div className="text-neutral-400 text-[10px] md:text-xs font-medium uppercase tracking-wider mb-1">
                        Current Value
                      </div>
                      <div className="text-xl md:text-2xl font-bold text-white">
                        {totalCurrentValue.toFixed(2)} <span className="text-sm text-neutral-400">SOL</span>
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

                  {/* Resolved Positions */}
                  {activeTab === 'resolved' && (
                    <div className="space-y-3">
                      {resolvedPositions.length === 0 ? (
                        <div className="text-center py-16 text-neutral-500">
                          <p className="text-base">No resolved positions</p>
                        </div>
                      ) : (
                        resolvedPositions.map((pos, i) => {
                          const basis = getCostBasis(pos)
                          const pnl = pos.estimatedValueSol - basis.totalCost
                          const isWinner = pos.claimable || pos.estimatedValueSol > 0
                          return (
                            <a
                              key={`${pos.marketId}-${pos.wordIndex}-${i}`}
                              href={`/market/${pos.marketId.toString()}`}
                              className={`block glass rounded-xl p-4 md:p-5 hover:bg-white/[0.04] transition-colors ${
                                isWinner ? 'border border-apple-green/20' : 'border border-white/5'
                              }`}
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
                                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                      isWinner
                                        ? 'bg-apple-green/15 text-apple-green'
                                        : 'bg-apple-red/15 text-apple-red'
                                    }`}>
                                      {isWinner ? 'Won' : 'Lost'}
                                    </span>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-white font-semibold text-base">
                                    {pos.estimatedValueSol.toFixed(4)} SOL
                                  </div>
                                  {basis.totalCost > 0 && (
                                    <div className={`text-xs font-semibold ${pnl >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                                      {pnl >= 0 ? '+' : ''}{pnl.toFixed(4)} SOL
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
                                  <div>
                                    <span className="text-neutral-400">Cost Basis </span>
                                    <span className="text-white font-medium">{basis.totalCost.toFixed(4)} SOL</span>
                                  </div>
                                )}
                                <div>
                                  <span className="text-neutral-400">Payout </span>
                                  <span className={`font-medium ${isWinner ? 'text-apple-green' : 'text-neutral-500'}`}>
                                    {isWinner ? `${pos.estimatedValueSol.toFixed(4)} SOL` : '0 SOL'}
                                  </span>
                                </div>
                              </div>
                            </a>
                          )
                        })
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
                                    trade.direction === 'YES'
                                      ? 'bg-apple-green/15 text-apple-green'
                                      : 'bg-apple-red/15 text-apple-red'
                                  }`}>
                                    {trade.direction}
                                  </span>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-white font-semibold text-base">
                                  {trade.cost.toFixed(4)} SOL
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
    </div>
  )
}
