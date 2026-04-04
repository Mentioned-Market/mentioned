'use client'

import Header from '@/components/Header'
import Footer from '@/components/Footer'
import Link from 'next/link'

export default function PointsPage() {
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
            <main className="py-6 md:py-10 animate-fade-in max-w-2xl">

              <div className="mb-10">
                <h1 className="text-2xl md:text-3xl font-bold text-white">Points</h1>
                <p className="text-neutral-500 text-sm mt-2">
                  Points reset every Monday at midnight UTC. Top earners each week win real USDC on the <Link href="/leaderboard" className="text-neutral-300 hover:text-white transition-colors underline underline-offset-2">leaderboard</Link>.
                </p>
              </div>

              {/* ── Chat ──────────────────────────────────────── */}
              <section className="mb-10">
                <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-4">Chat</h2>
                <div className="rounded-xl border border-white/10 overflow-hidden">
                  <div className="px-5 py-4 border-b border-white/5 flex items-baseline justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-white">Send a message</p>
                      <p className="text-xs text-neutral-500 mt-1">Counts in both global chat and market chats. Capped at 10 messages per day — after that, extra messages earn nothing until midnight UTC.</p>
                    </div>
                    <span className="text-sm font-bold text-apple-blue tabular-nums flex-shrink-0">2 pts</span>
                  </div>
                  <div className="px-5 py-3 bg-white/[0.02]">
                    <p className="text-xs text-neutral-600">Max per week: 10 messages x 7 days = <span className="text-neutral-400">140 pts</span></p>
                  </div>
                </div>
              </section>

              {/* ── Free markets ──────────────────────────────── */}
              <section className="mb-10">
                <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-4">Free markets</h2>
                <div className="rounded-xl border border-white/10 overflow-hidden">
                  <div className="px-5 py-4 border-b border-white/5">
                    <p className="text-sm font-medium text-white">Win a market</p>
                    <p className="text-xs text-neutral-500 mt-1">
                      When a market resolves, your net profit converts to points at a 0.5x rate. Net profit is tokens received minus tokens spent across all your positions in that market.
                    </p>
                    <p className="text-xs text-neutral-500 mt-2">
                      If you break even or lose, you receive zero points. There is no penalty.
                    </p>
                  </div>
                  <div className="px-5 py-4 border-b border-white/5 bg-white/[0.02]">
                    <p className="text-xs font-medium text-neutral-400 mb-3">Examples</p>
                    <div className="space-y-2">
                      {[
                        { label: 'Spent 200, received 400', net: '+200', pts: '100 pts' },
                        { label: 'Spent 500, received 950', net: '+450', pts: '225 pts' },
                        { label: 'Spent 200, received 80',  net: '-120', pts: '0 pts' },
                      ].map((row) => (
                        <div key={row.label} className="flex items-center justify-between text-xs">
                          <span className="text-neutral-500">{row.label}</span>
                          <div className="flex items-center gap-4">
                            <span className={row.net.startsWith('+') ? 'text-neutral-400 tabular-nums' : 'text-neutral-600 tabular-nums'}>{row.net} tokens</span>
                            <span className="text-white font-medium tabular-nums w-14 text-right">{row.pts}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="px-5 py-3 bg-white/[0.02]">
                    <p className="text-xs text-neutral-600">Points are awarded once per market when it resolves. You must have Discord linked to trade.</p>
                  </div>
                </div>
              </section>

              {/* ── Daily visit streak ────────────────────────── */}
              <section className="mb-10">
                <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-4">Daily visit streak</h2>
                <div className="rounded-xl border border-white/10 overflow-hidden">
                  <div className="px-5 py-4 border-b border-white/5">
                    <p className="text-sm font-medium text-white">Visit Mentioned each day</p>
                    <p className="text-xs text-neutral-500 mt-1">Each unique day you open the site adds to your streak for the week. Streaks reset every Monday. The tiers stack, so hitting 7 days pays out all three bonuses.</p>
                  </div>
                  <div className="divide-y divide-white/5">
                    {[
                      { days: 3, pts: 50 },
                      { days: 5, pts: 75, note: 'stacks with 3-day bonus' },
                      { days: 7, pts: 100, note: 'stacks with both' },
                    ].map((tier) => (
                      <div key={tier.days} className="px-5 py-3 flex items-center justify-between">
                        <div>
                          <span className="text-sm text-white">{tier.days} days this week</span>
                          {tier.note && <span className="text-xs text-neutral-600 ml-2">{tier.note}</span>}
                        </div>
                        <span className="text-sm font-bold text-apple-blue tabular-nums">+{tier.pts} pts</span>
                      </div>
                    ))}
                  </div>
                  <div className="px-5 py-3 bg-white/[0.02] border-t border-white/5">
                    <p className="text-xs text-neutral-600">Visit all 7 days: 50 + 75 + 100 = <span className="text-neutral-400">225 pts total</span></p>
                  </div>
                </div>
              </section>

              {/* ── Achievements ──────────────────────────────── */}
              <section className="mb-10">
                <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Weekly achievements</h2>
                <p className="text-xs text-neutral-600 mb-4">A set of achievements resets each Monday. Each one unlocks once per week and pays out the moment you complete the action. The exact set changes week to week. Below are examples of what a typical week looks like.</p>
                <div className="rounded-xl border border-white/10 overflow-hidden divide-y divide-white/5">
                  {[
                    { title: 'Place a free market trade',  pts: 60  },
                    { title: 'Win a free market trade',    pts: 100 },
                    { title: 'Send a chat message',        pts: 40  },
                    { title: 'Set your username',          pts: 40  },
                    { title: 'Refer a new user',           pts: 100 },
                  ].map((ach) => (
                    <div key={ach.title} className="px-5 py-3 flex items-center justify-between">
                      <span className="text-sm text-neutral-300">{ach.title}</span>
                      <span className="text-sm font-bold text-apple-blue tabular-nums">+{ach.pts} pts</span>
                    </div>
                  ))}
                  <div className="px-5 py-3 bg-white/[0.02] flex items-center justify-between">
                    <span className="text-xs text-neutral-500">Example week total</span>
                    <span className="text-xs font-semibold text-neutral-400 tabular-nums">340 pts</span>
                  </div>
                </div>
              </section>

              {/* ── Weekly totals ─────────────────────────────── */}
              <section className="mb-10">
                <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-4">What a full week looks like</h2>
                <div className="rounded-xl border border-white/10 overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="text-left text-xs font-medium text-neutral-500 px-5 py-3">Source</th>
                        <th className="text-right text-xs font-medium text-neutral-500 px-5 py-3">Max / week</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-sm">
                      <tr>
                        <td className="px-5 py-3 text-neutral-400">Chat</td>
                        <td className="px-5 py-3 text-right text-white tabular-nums">140 pts</td>
                      </tr>
                      <tr>
                        <td className="px-5 py-3 text-neutral-400">Visit streak (7 days)</td>
                        <td className="px-5 py-3 text-right text-white tabular-nums">225 pts</td>
                      </tr>
                      <tr>
                        <td className="px-5 py-3 text-neutral-400">Achievements (example week)</td>
                        <td className="px-5 py-3 text-right text-white tabular-nums">340 pts</td>
                      </tr>
                      <tr>
                        <td className="px-5 py-3 text-neutral-400">Free market wins</td>
                        <td className="px-5 py-3 text-right text-neutral-500">Unlimited</td>
                      </tr>
                      <tr className="border-t border-white/10 bg-white/[0.02]">
                        <td className="px-5 py-3 text-white font-semibold">Without any trading</td>
                        <td className="px-5 py-3 text-right text-apple-blue font-bold tabular-nums">705 pts</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-neutral-600 mt-2">A single well-called market returning 450 tokens profit adds another 225 pts on top.</p>
              </section>

              {/* ── CTA ───────────────────────────────────────── */}
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  href="/markets"
                  className="flex-1 flex items-center justify-center h-10 rounded-xl bg-white text-black text-sm font-semibold hover:bg-neutral-100 transition-colors"
                >
                  Browse free markets
                </Link>
                <Link
                  href="/leaderboard"
                  className="flex-1 flex items-center justify-center h-10 rounded-xl border border-white/10 bg-white/[0.03] text-white text-sm font-medium hover:bg-white/[0.07] transition-colors"
                >
                  View leaderboard
                </Link>
              </div>

            </main>
          </div>
        </div>
        <div className="px-4 md:px-10 lg:px-20 flex justify-center">
          <div className="w-full max-w-7xl">
            <Footer />
          </div>
        </div>
      </div>
    </div>
  )
}
