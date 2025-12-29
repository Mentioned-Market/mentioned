'use client'

import { useState } from 'react'
import Header from '@/components/Header'
import { useWallet } from '@/contexts/WalletContext'
import { useRouter } from 'next/navigation'

interface Position {
  id: string
  marketTitle: string
  word: string
  side: 'YES' | 'NO'
  shares: number
  avgPrice: number
  currentPrice: number
  invested: number
  currentValue: number
  pnl: number
  pnlPercent: number
  status: 'active' | 'claimable' | 'closed'
  outcome?: 'YES' | 'NO'
  eventTime: Date
}

export default function ProfilePage() {
  const { connected, publicKey, balance } = useWallet()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'active' | 'claimable' | 'history'>('active')

  // Mock data - replace with actual data from Solana
  const positions: Position[] = [
    {
      id: '1',
      marketTitle: "TRUMP'S SPEECH",
      word: 'IMMIGRATION',
      side: 'YES',
      shares: 1000,
      avgPrice: 0.72,
      currentPrice: 0.78,
      invested: 720,
      currentValue: 780,
      pnl: 60,
      pnlPercent: 8.33,
      status: 'active',
      eventTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
    },
    {
      id: '2',
      marketTitle: 'JOE ROGAN EP #2054',
      word: 'AI',
      side: 'YES',
      shares: 500,
      avgPrice: 0.94,
      currentPrice: 0.96,
      invested: 470,
      currentValue: 480,
      pnl: 10,
      pnlPercent: 2.13,
      status: 'active',
      eventTime: new Date(Date.now() + 5 * 60 * 60 * 1000),
    },
    {
      id: '3',
      marketTitle: 'DRAKE - FOR ALL THE DOGS',
      word: 'LOVE',
      side: 'YES',
      shares: 800,
      avgPrice: 0.89,
      currentPrice: 0.89,
      invested: 712,
      currentValue: 712,
      pnl: 0,
      pnlPercent: 0,
      status: 'claimable',
      outcome: 'YES',
      eventTime: new Date(Date.now() - 1 * 60 * 60 * 1000),
    },
    {
      id: '4',
      marketTitle: 'NBA FINALS GAME 7',
      word: 'CLUTCH',
      side: 'NO',
      shares: 600,
      avgPrice: 0.33,
      currentPrice: 0.33,
      invested: 198,
      currentValue: 198,
      pnl: 0,
      pnlPercent: 0,
      status: 'claimable',
      outcome: 'NO',
      eventTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
    },
    {
      id: '5',
      marketTitle: 'APPLE WWDC 2025 KEYNOTE',
      word: 'REVOLUTIONARY',
      side: 'YES',
      shares: 400,
      avgPrice: 0.73,
      currentPrice: 0.00,
      invested: 292,
      currentValue: 0,
      pnl: -292,
      pnlPercent: -100,
      status: 'closed',
      outcome: 'NO',
      eventTime: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
    {
      id: '6',
      marketTitle: 'WORLD CUP FINAL 2026',
      word: 'GOAL',
      side: 'YES',
      shares: 1200,
      avgPrice: 0.93,
      currentPrice: 1.00,
      invested: 1116,
      currentValue: 1200,
      pnl: 84,
      pnlPercent: 7.53,
      status: 'closed',
      outcome: 'YES',
      eventTime: new Date(Date.now() - 48 * 60 * 60 * 1000),
    },
  ]

  const activePositions = positions.filter(p => p.status === 'active')
  const claimablePositions = positions.filter(p => p.status === 'claimable')
  const closedPositions = positions.filter(p => p.status === 'closed')

  const totalInvested = positions.reduce((sum, p) => sum + p.invested, 0)
  const totalValue = positions.filter(p => p.status === 'active').reduce((sum, p) => sum + p.currentValue, 0)
  const totalPnL = positions.reduce((sum, p) => sum + p.pnl, 0)
  const totalPnLPercent = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0

  const handleClaim = (positionId: string) => {
    // TODO: Implement actual claim logic
    console.log('Claiming position:', positionId)
  }

  if (!connected) {
    return (
      <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden">
        <div className="layout-container flex h-full grow flex-col">
          <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
            <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
              <Header />
              <main className="py-20 text-center">
                <h1 className="text-4xl font-bold mb-6">CONNECT YOUR WALLET</h1>
                <p className="text-white/70 text-lg mb-8">
                  Please connect your wallet to view your profile
                </p>
                <button
                  onClick={() => router.push('/')}
                  className="px-8 py-3 bg-white text-black font-bold uppercase rounded-lg hover:bg-white/90 transition-colors"
                >
                  GO HOME
                </button>
              </main>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden">
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
            <Header />
        
        <main className="py-4 max-w-7xl mx-auto">
          {/* Profile Header */}
          <div className="mb-6">
            <h1 className="text-3xl font-bold mb-2">PROFILE</h1>
            <p className="text-white/50 text-sm font-mono">
              {publicKey?.toString().slice(0, 8)}...{publicKey?.toString().slice(-8)}
            </p>
          </div>

          {/* Portfolio Overview */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-[#161616] rounded-xl p-6 border border-[#2a2a2a]">
              <div className="text-white/50 text-sm mb-2">WALLET BALANCE</div>
              <div className="text-3xl font-bold">{balance?.toFixed(2) || '0.00'} SOL</div>
            </div>
            <div className="bg-[#161616] rounded-xl p-6 border border-[#2a2a2a]">
              <div className="text-white/50 text-sm mb-2">INVESTED</div>
              <div className="text-3xl font-bold">${totalInvested.toFixed(2)}</div>
            </div>
            <div className="bg-[#161616] rounded-xl p-6 border border-[#2a2a2a]">
              <div className="text-white/50 text-sm mb-2">CURRENT VALUE</div>
              <div className="text-3xl font-bold">${totalValue.toFixed(2)}</div>
            </div>
            <div className="bg-[#161616] rounded-xl p-6 border border-[#2a2a2a]">
              <div className="text-white/50 text-sm mb-2">TOTAL P&L</div>
              <div className={`text-3xl font-bold ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}
                <span className="text-lg ml-2">({totalPnLPercent >= 0 ? '+' : ''}{totalPnLPercent.toFixed(2)}%)</span>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-6 border-b border-white/10">
            <button
              onClick={() => setActiveTab('active')}
              className={`px-6 py-3 font-bold text-sm uppercase transition-all ${
                activeTab === 'active'
                  ? 'border-b-2 border-white text-white'
                  : 'text-white/50 hover:text-white/70'
              }`}
            >
              ACTIVE POSITIONS ({activePositions.length})
            </button>
            <button
              onClick={() => setActiveTab('claimable')}
              className={`px-6 py-3 font-bold text-sm uppercase transition-all ${
                activeTab === 'claimable'
                  ? 'border-b-2 border-white text-white'
                  : 'text-white/50 hover:text-white/70'
              }`}
            >
              CLAIMABLE ({claimablePositions.length})
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-6 py-3 font-bold text-sm uppercase transition-all ${
                activeTab === 'history'
                  ? 'border-b-2 border-white text-white'
                  : 'text-white/50 hover:text-white/70'
              }`}
            >
              HISTORY ({closedPositions.length})
            </button>
          </div>

          {/* Active Positions */}
          {activeTab === 'active' && (
            <div className="space-y-4">
              {activePositions.length === 0 ? (
                <div className="text-center py-12 text-white/50">
                  <p className="text-lg">No active positions</p>
                  <button
                    onClick={() => router.push('/')}
                    className="mt-4 px-6 py-2 bg-white text-black font-bold uppercase rounded-lg hover:bg-white/90 transition-colors"
                  >
                    EXPLORE MARKETS
                  </button>
                </div>
              ) : (
                activePositions.map((position) => (
                  <div
                    key={position.id}
                    className="bg-[#161616] rounded-xl p-6 border border-[#2a2a2a] hover:border-[#333333] transition-colors"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-xl font-bold mb-1">{position.marketTitle}</h3>
                        <div className="flex items-center gap-3">
                          <span className="text-white/70">Word: <span className="text-white font-bold">{position.word}</span></span>
                          <span className={`px-3 py-1 rounded text-sm font-bold ${
                            position.side === 'YES' ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'
                          }`}>
                            {position.side}
                          </span>
                        </div>
                      </div>
                      <div className={`text-2xl font-bold ${position.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {position.pnl >= 0 ? '+' : ''}{position.pnl.toFixed(2)}
                        <div className="text-sm">{position.pnl >= 0 ? '+' : ''}{position.pnlPercent.toFixed(2)}%</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                      <div>
                        <div className="text-white/50">Shares</div>
                        <div className="font-bold">{position.shares}</div>
                      </div>
                      <div>
                        <div className="text-white/50">Avg Price</div>
                        <div className="font-bold">${position.avgPrice.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-white/50">Current Price</div>
                        <div className="font-bold">${position.currentPrice.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-white/50">Invested</div>
                        <div className="font-bold">${position.invested.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-white/50">Current Value</div>
                        <div className="font-bold">${position.currentValue.toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Claimable Positions */}
          {activeTab === 'claimable' && (
            <div className="space-y-4">
              {claimablePositions.length === 0 ? (
                <div className="text-center py-12 text-white/50">
                  <p className="text-lg">No positions to claim</p>
                </div>
              ) : (
                claimablePositions.map((position) => (
                  <div
                    key={position.id}
                    className="bg-[#161616] rounded-xl p-6 border-2 border-yellow-600/50 hover:border-yellow-600 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="px-3 py-1 bg-yellow-600/20 text-yellow-400 rounded text-sm font-bold uppercase">
                            Ready to Claim
                          </span>
                        </div>
                        <h3 className="text-xl font-bold mb-1">{position.marketTitle}</h3>
                        <div className="flex items-center gap-3">
                          <span className="text-white/70">Word: <span className="text-white font-bold">{position.word}</span></span>
                          <span className={`px-3 py-1 rounded text-sm font-bold ${
                            position.side === 'YES' ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'
                          }`}>
                            {position.side}
                          </span>
                          <span className="text-white/50">Outcome: <span className="text-white font-bold">{position.outcome}</span></span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleClaim(position.id)}
                        className="px-6 py-3 bg-yellow-600 hover:bg-yellow-700 text-black font-bold uppercase rounded-lg transition-colors"
                      >
                        CLAIM {position.shares} SHARES
                      </button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <div className="text-white/50">Shares</div>
                        <div className="font-bold">{position.shares}</div>
                      </div>
                      <div>
                        <div className="text-white/50">Invested</div>
                        <div className="font-bold">${position.invested.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-white/50">Claim Value</div>
                        <div className="font-bold">${position.shares.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-white/50">Profit</div>
                        <div className={`font-bold ${(position.shares - position.invested) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          ${(position.shares - position.invested).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Position History */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              {closedPositions.length === 0 ? (
                <div className="text-center py-12 text-white/50">
                  <p className="text-lg">No closed positions</p>
                </div>
              ) : (
                closedPositions.map((position) => (
                  <div
                    key={position.id}
                    className="bg-[#161616] rounded-xl p-6 border border-[#2a2a2a] opacity-80"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="px-3 py-1 bg-white/10 text-white/50 rounded text-sm font-bold uppercase">
                            Closed
                          </span>
                        </div>
                        <h3 className="text-xl font-bold mb-1">{position.marketTitle}</h3>
                        <div className="flex items-center gap-3">
                          <span className="text-white/70">Word: <span className="text-white font-bold">{position.word}</span></span>
                          <span className={`px-3 py-1 rounded text-sm font-bold ${
                            position.side === 'YES' ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'
                          }`}>
                            {position.side}
                          </span>
                          <span className="text-white/50">Outcome: <span className="text-white font-bold">{position.outcome}</span></span>
                        </div>
                      </div>
                      <div className={`text-2xl font-bold ${position.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {position.pnl >= 0 ? '+' : ''}{position.pnl.toFixed(2)}
                        <div className="text-sm">{position.pnl >= 0 ? '+' : ''}{position.pnlPercent.toFixed(2)}%</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                      <div>
                        <div className="text-white/50">Shares</div>
                        <div className="font-bold">{position.shares}</div>
                      </div>
                      <div>
                        <div className="text-white/50">Avg Price</div>
                        <div className="font-bold">${position.avgPrice.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-white/50">Final Price</div>
                        <div className="font-bold">${position.currentPrice.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-white/50">Invested</div>
                        <div className="font-bold">${position.invested.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-white/50">Final Value</div>
                        <div className="font-bold">${position.currentValue.toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </main>
          </div>
        </div>
      </div>
    </div>
  )
}

