'use client'

import { useState, useEffect } from 'react'
import Header from '@/components/Header'
import { useWallet } from '@/contexts/WalletContext'
import { useRouter } from 'next/navigation'
import { address as toAddress } from '@solana/kit'
import {
  fetchUserPositions,
  fetchEscrow,
  type UserPosition,
  type UserEscrow,
  MarketStatus,
  lamportsToSol,
  marketStatusStr,
} from '@/lib/mentionMarket'

export default function ProfilePage() {
  const { connected, publicKey, balance } = useWallet()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'active' | 'claimable' | 'history'>('active')

  const [positions, setPositions] = useState<UserPosition[]>([])
  const [escrowData, setEscrowData] = useState<UserEscrow | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!publicKey) {
      setPositions([])
      setEscrowData(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)

    Promise.all([
      fetchUserPositions(toAddress(publicKey)),
      fetchEscrow(toAddress(publicKey)),
    ])
      .then(([pos, escrow]) => {
        if (cancelled) return
        setPositions(pos)
        setEscrowData(escrow)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to load profile data:', err)
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [publicKey])

  const activePositions = positions.filter(
    (p) => p.market.status === MarketStatus.Active || p.market.status === MarketStatus.Paused
  )
  const claimablePositions = positions.filter((p) => p.claimable)

  const escrowSol = escrowData ? Number(escrowData.balance) / 1_000_000_000 : 0
  const activeValue = activePositions.reduce((sum, p) => sum + p.estimatedValueSol, 0)
  const claimableValue = claimablePositions.reduce((sum, p) => sum + p.estimatedValueSol, 0)

  const handleClaim = (position: UserPosition) => {
    // TODO: Implement actual claim transaction
    console.log('Claiming position:', position.market.label, position.side)
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
              {/* Profile Header */}
              <div className="mb-6">
                <h1 className="text-2xl md:text-3xl font-bold text-white mb-1">Profile</h1>
                <p className="text-neutral-500 text-sm font-mono">
                  {publicKey?.slice(0, 8)}...{publicKey?.slice(-8)}
                </p>
              </div>

              {/* Loading */}
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
                        Active Positions
                      </div>
                      <div className="text-xl md:text-2xl font-bold text-white">
                        {activeValue.toFixed(2)} <span className="text-sm text-neutral-400">SOL</span>
                      </div>
                    </div>
                    <div className="glass rounded-xl p-4 md:p-5">
                      <div className="text-neutral-400 text-[10px] md:text-xs font-medium uppercase tracking-wider mb-1">
                        Claimable
                      </div>
                      <div className="text-xl md:text-2xl font-bold text-apple-green">
                        {claimableValue.toFixed(2)} <span className="text-sm">SOL</span>
                      </div>
                    </div>
                    <div className="glass rounded-xl p-4 md:p-5">
                      <div className="text-neutral-400 text-[10px] md:text-xs font-medium uppercase tracking-wider mb-1">
                        Total Positions
                      </div>
                      <div className="text-xl md:text-2xl font-bold text-white">
                        {positions.length}
                      </div>
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
                      onClick={() => setActiveTab('history')}
                      className={`px-4 md:px-6 py-3 text-sm font-semibold transition-all ${
                        activeTab === 'history'
                          ? 'border-b-2 border-white text-white'
                          : 'text-neutral-500 hover:text-neutral-300'
                      }`}
                    >
                      History
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
                        activePositions.map((pos, i) => (
                          <a
                            key={`${pos.wordMarketPubkey}-${i}`}
                            href={`/market/${pos.market.marketId.toString()}`}
                            className="block glass rounded-xl p-4 md:p-5 hover:bg-white/[0.04] transition-colors"
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <div className="text-xs text-neutral-400 font-medium mb-1">
                                  Market #{pos.market.marketId.toString()}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-white font-semibold text-base">
                                    {pos.market.label}
                                  </span>
                                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                    pos.side === 'YES'
                                      ? 'bg-apple-green/15 text-apple-green'
                                      : 'bg-apple-red/15 text-apple-red'
                                  }`}>
                                    {pos.side}
                                  </span>
                                  <span className="px-2 py-0.5 rounded bg-white/10 text-neutral-300 text-xs font-medium">
                                    {marketStatusStr(pos.market.status)}
                                  </span>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-white font-semibold text-base">
                                  {pos.estimatedValueSol.toFixed(4)} SOL
                                </div>
                                <div className="text-neutral-500 text-xs">
                                  est. value
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-6 text-sm">
                              <div>
                                <span className="text-neutral-400">Shares </span>
                                <span className="text-white font-medium">{pos.shares.toFixed(2)}</span>
                              </div>
                              <div>
                                <span className="text-neutral-400">Collateral </span>
                                <span className="text-white font-medium">
                                  {lamportsToSol(pos.market.totalCollateral)} SOL
                                </span>
                              </div>
                            </div>
                          </a>
                        ))
                      )}
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
                        claimablePositions.map((pos, i) => (
                          <div
                            key={`${pos.wordMarketPubkey}-${i}`}
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
                                  Market #{pos.market.marketId.toString()}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-white font-semibold text-base">
                                    {pos.market.label}
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
                                onClick={() => handleClaim(pos)}
                                className="px-4 py-2 bg-apple-green hover:bg-apple-green/90 text-white font-semibold text-sm rounded-xl transition-colors"
                              >
                                Claim {pos.shares.toFixed(0)} shares
                              </button>
                            </div>
                            <div className="flex gap-6 text-sm">
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
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* History */}
                  {activeTab === 'history' && (
                    <div className="text-center py-16 text-neutral-500">
                      <p className="text-base">Historical data is not yet available on-chain</p>
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
