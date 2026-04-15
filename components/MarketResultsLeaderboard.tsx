'use client'

import { useState } from 'react'
import Link from 'next/link'

interface WordResult {
  word_id: number
  word: string
  outcome: 'YES' | 'NO'
  yes_shares: number
  no_shares: number
  tokens_spent: number
  tokens_received: number
  net_tokens: number
}

interface TraderResult {
  wallet: string
  username: string | null
  pfp_emoji: string | null
  total_spent: number
  total_received: number
  net_tokens: number
  pnl_pct: number | null
  points_earned: number
  words: WordResult[]
}

interface Props {
  leaderboard: TraderResult[]
  currentWallet?: string | null
}

const MEDAL = ['🥇', '🥈', '🥉']

function formatNet(n: number) {
  if (n >= 0) return `+${n.toFixed(1)}`
  return n.toFixed(1)
}

function formatPct(n: number | null) {
  if (n === null) return '—'
  if (n >= 0) return `+${n.toFixed(1)}%`
  return `${n.toFixed(1)}%`
}

export default function MarketResultsLeaderboard({ leaderboard, currentWallet }: Props) {
  const [expandedWallet, setExpandedWallet] = useState<string | null>(null)

  if (leaderboard.length === 0) return null

  const winners = leaderboard.filter(t => t.net_tokens > 0)
  const losers = leaderboard.filter(t => t.net_tokens <= 0)

  return (
    <div className="mb-6">
      <h2 className="text-base font-semibold text-white mb-3">Market Results</h2>
      <div className="glass rounded-2xl overflow-hidden">

        {/* Header row */}
        <div className="grid grid-cols-[1.5rem_1fr_auto_auto_auto] gap-x-3 px-4 py-2 border-b border-white/5 text-[10px] text-neutral-500 uppercase tracking-wide">
          <span />
          <span>Trader</span>
          <span className="text-right w-16">P&amp;L</span>
          <span className="text-right w-14">P&amp;L %</span>
          <span className="text-right w-14">Points</span>
        </div>

        <div className="divide-y divide-white/5">
          {leaderboard.map((trader, i) => {
            const isMe = trader.wallet === currentWallet
            const isExpanded = expandedWallet === trader.wallet
            const netPositive = trader.net_tokens > 0

            return (
              <div key={trader.wallet}>
                <button
                  onClick={() => setExpandedWallet(isExpanded ? null : trader.wallet)}
                  className={`w-full grid grid-cols-[1.5rem_1fr_auto_auto_auto] gap-x-3 items-center px-4 py-3 text-left transition-colors ${
                    isMe ? 'bg-[#F2B71F]/5' : 'hover:bg-white/[0.02]'
                  }`}
                >
                  {/* Rank */}
                  <span className="text-sm text-center leading-none">
                    {i < 3 ? MEDAL[i] : <span className="text-neutral-600 text-xs">{i + 1}</span>}
                  </span>

                  {/* Trader identity */}
                  <div className="flex items-center gap-2 min-w-0">
                    {trader.pfp_emoji && (
                      <span className="text-base leading-none flex-shrink-0">{trader.pfp_emoji}</span>
                    )}
                    <div className="min-w-0">
                      <span className={`text-sm font-medium truncate block ${isMe ? 'text-[#F2B71F]' : 'text-white'}`}>
                        {trader.username || `${trader.wallet.slice(0, 4)}...${trader.wallet.slice(-4)}`}
                        {isMe && <span className="ml-1 text-[10px] text-[#F2B71F]/70">(you)</span>}
                      </span>
                      <span className="text-[10px] text-neutral-600">
                        {trader.words.length} word{trader.words.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>

                  {/* Net tokens */}
                  <span className={`text-sm font-semibold tabular-nums w-16 text-right ${netPositive ? 'text-apple-green' : 'text-apple-red'}`}>
                    {formatNet(trader.net_tokens)}
                  </span>

                  {/* P&L % */}
                  <span className={`text-xs tabular-nums w-14 text-right ${netPositive ? 'text-apple-green' : 'text-neutral-500'}`}>
                    {formatPct(trader.pnl_pct)}
                  </span>

                  {/* Points */}
                  <span className={`text-xs tabular-nums w-14 text-right ${trader.points_earned > 0 ? 'text-[#F2B71F]' : 'text-neutral-600'}`}>
                    {trader.points_earned > 0 ? `+${trader.points_earned}` : '0'}
                  </span>
                </button>

                {/* Expanded per-word breakdown */}
                {isExpanded && (
                  <div className="bg-white/[0.02] border-t border-white/5 px-4 py-3">
                    <div className="space-y-2">
                      {trader.words.map(w => {
                        const held = w.outcome === 'YES' ? w.yes_shares : w.no_shares
                        const wNet = w.net_tokens
                        return (
                          <div key={w.word_id} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0 ${
                                w.outcome === 'YES'
                                  ? 'bg-apple-green/15 text-apple-green'
                                  : 'bg-apple-red/15 text-apple-red'
                              }`}>
                                {w.outcome}
                              </span>
                              <span className="text-neutral-300 truncate">{w.word}</span>
                              {held >= 0.01 && (
                                <span className="text-neutral-500 flex-shrink-0">{held.toFixed(0)} shares</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                              <span className="text-neutral-500">
                                {w.tokens_spent.toFixed(0)} spent
                              </span>
                              <span className={`font-medium tabular-nums ${wNet > 0 ? 'text-apple-green' : wNet < 0 ? 'text-apple-red' : 'text-neutral-500'}`}>
                                {formatNet(wNet)}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                      <div className="pt-2 border-t border-white/5 flex justify-between text-xs">
                        <span className="text-neutral-500">Total</span>
                        <div className="flex gap-3">
                          <span className="text-neutral-500">{trader.total_spent.toFixed(0)} spent</span>
                          <span className={`font-semibold tabular-nums ${netPositive ? 'text-apple-green' : 'text-apple-red'}`}>
                            {formatNet(trader.net_tokens)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Link
                      href={`/profile/${trader.username || trader.wallet}`}
                      className="mt-3 inline-block text-[11px] text-neutral-500 hover:text-apple-blue transition-colors"
                    >
                      View profile
                    </Link>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Summary footer */}
        <div className="px-4 py-2.5 border-t border-white/5 flex gap-4 text-[11px] text-neutral-500">
          <span>{winners.length} winner{winners.length !== 1 ? 's' : ''}</span>
          <span>{losers.length} loser{losers.length !== 1 ? 's' : ''}</span>
          <span>{leaderboard.length} total trader{leaderboard.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  )
}
