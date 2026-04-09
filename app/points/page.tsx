'use client'

import { useState, useEffect } from 'react'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import HowItWorksModal from '@/components/HowItWorksModal'
import Link from 'next/link'
import { useWallet } from '@/contexts/WalletContext'

function getMsUntilNextMonday(): number {
  const now = new Date()
  const day = now.getUTCDay()
  const daysUntilMonday = day === 0 ? 1 : 8 - day
  const nextMonday = new Date(now)
  nextMonday.setUTCDate(now.getUTCDate() + daysUntilMonday)
  nextMonday.setUTCHours(0, 0, 0, 0)
  return nextMonday.getTime() - now.getTime()
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0h 0m'
  const totalSeconds = Math.floor(ms / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  return `${hours}h ${minutes}m`
}

interface Achievement {
  id: string
  emoji: string
  title: string
  description: string
  points: number
  unlocked: boolean
}

export default function PointsPage() {
  const { publicKey, connect, discordLinked } = useWallet()
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [achLoaded, setAchLoaded] = useState(false)
  const [countdown, setCountdown] = useState('')
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  // Referral state
  const [referralCode, setReferralCode] = useState<string | null>(null)
  const [referralCount, setReferralCount] = useState(0)
  const [bonusPointsEarned, setBonusPointsEarned] = useState(0)
  const [referralCopied, setReferralCopied] = useState(false)

  // Live countdown to weekly reset
  useEffect(() => {
    const tick = () => setCountdown(formatCountdown(getMsUntilNextMonday()))
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!publicKey) {
      setAchievements([])
      setAchLoaded(false)
      setReferralCode(null)
      setReferralCount(0)
      setBonusPointsEarned(0)
      return
    }
    fetch(`/api/achievements?wallet=${publicKey}`)
      .then(r => r.json())
      .then(data => {
        setAchievements(data.achievements ?? [])
        setAchLoaded(true)
      })
      .catch(() => setAchLoaded(true))

    fetch(`/api/referral?wallet=${publicKey}`)
      .then(r => r.json())
      .then(data => {
        setReferralCode(data.referralCode ?? null)
        setReferralCount(data.referralCount ?? 0)
        setBonusPointsEarned(data.bonusPointsEarned ?? 0)
      })
      .catch(() => {})
  }, [publicKey])

  // Separate daily login tiers from action achievements
  const actionAchievements = achievements.filter(a => !a.id.startsWith('daily_login_'))
  const completedCount = achievements.filter(a => a.unlocked).length
  const totalPts = achievements.reduce((s, a) => s + a.points, 0)

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
            <main className="py-6 md:py-10 animate-fade-in">

              {/* ── Hero ────────────────────────────────────── */}
              <div className="mb-8 max-w-2xl">
                <h1 className="text-3xl md:text-5xl font-bold text-white tracking-tight">Points</h1>
                <p className="text-neutral-300 text-sm md:text-lg mt-3 leading-relaxed whitespace-nowrap">
                  Top of the{' '}
                  <Link href="/leaderboard" className="text-white font-semibold underline underline-offset-4 decoration-[#F2B71F] hover:decoration-white transition-colors">leaderboard</Link>{' '}
                  wins real USDC every week.
                  {countdown && (
                    <span className="text-[#F2B71F] text-xs md:text-base font-bold tabular-nums ml-2"> <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#F2B71F] animate-pulse align-middle" /> Resets in {countdown}</span>
                  )}
                </p>
              </div>

              {/* ── Login CTA ──────────────────────────────── */}
              {!publicKey && (
                <button
                  onClick={connect}
                  className="group w-full mb-6 rounded-2xl border border-[#F2B71F]/30 bg-gradient-to-br from-[#F2B71F]/[0.10] via-[#F2B71F]/[0.03] to-transparent hover:border-[#F2B71F]/50 transition-colors overflow-hidden"
                >
                  <div className="px-5 md:px-6 py-6 flex items-center justify-between gap-4">
                    <div className="text-left">
                      <p className="text-xl md:text-2xl font-bold text-white">Log in to start earning</p>
                      <p className="text-sm text-neutral-400 mt-1.5">Trade, chat, complete achievements — earn points and win weekly USDC prizes.</p>
                    </div>
                    <div className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-xl bg-[#F2B71F] group-hover:scale-105 transition-transform">
                      <svg className="w-5 h-5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </button>
              )}

              {/* ── Discord link banner ──────────────────────── */}
              {publicKey && discordLinked === false && (
                <a
                  href={`/api/discord/link?wallet=${publicKey}`}
                  className="flex items-center gap-3 mb-6 px-4 py-3 rounded-xl border border-yellow-500/30 bg-yellow-500/[0.06] hover:border-yellow-500/50 transition-colors"
                >
                  <span className="text-lg">⚠️</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-yellow-400">Link your Discord to earn points</p>
                    <p className="text-xs text-neutral-400">Points won&apos;t count toward the leaderboard until Discord is linked.</p>
                  </div>
                  <svg className="w-4 h-4 text-yellow-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </a>
              )}

              {/* ── Featured: Free markets ───────────────────── */}
              <Link
                href="/markets"
                className="group block mb-3 rounded-2xl border border-[#F2B71F]/30 bg-gradient-to-br from-[#F2B71F]/[0.12] via-[#F2B71F]/[0.04] to-transparent hover:border-[#F2B71F]/50 transition-colors overflow-hidden"
              >
                <div className="px-5 md:px-6 py-5 md:py-6 flex items-start justify-between gap-4 border-b border-white/5">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-[#F2B71F] uppercase tracking-widest mb-2">The fastest way to earn</p>
                    <p className="text-2xl md:text-3xl font-bold text-white leading-tight">Trade free markets.<br className="hidden sm:block" /> Win unlimited points.</p>
                    <p className="text-sm md:text-base text-neutral-300 mt-3 leading-relaxed">
                      Play-token markets with zero risk. Profit converts to points at 0.5x. No cap, no penalty for losses.
                    </p>
                  </div>
                  <svg className="w-5 h-5 text-[#F2B71F] group-hover:translate-x-0.5 transition-transform flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
                <div className="grid grid-cols-3 divide-x divide-white/5 bg-black/20">
                  {[
                    { label: 'Profit +200', pts: '+100', muted: false },
                    { label: 'Profit +450', pts: '+225', muted: false },
                    { label: 'Loss −120',   pts: '0',    muted: true  },
                  ].map((row) => (
                    <div key={row.label} className="px-3 md:px-4 py-3 text-center">
                      <p className="text-[11px] text-neutral-400 uppercase tracking-wide">{row.label}</p>
                      <p className={`text-lg font-bold tabular-nums mt-1 ${row.muted ? 'text-neutral-600' : 'text-[#F2B71F]'}`}>{row.pts} pts</p>
                    </div>
                  ))}
                </div>
              </Link>

              {/* ── Passive earnings label ───────────────────── */}
              <div className="flex items-baseline justify-between mt-10 mb-4">
                <h2 className="text-lg md:text-xl font-bold text-white">Earn without trading</h2>
                <p className="text-sm text-neutral-400 tabular-nums">up to <span className="text-white font-semibold">705 pts / week</span></p>
              </div>

              {/* ── 3-col passive earning grid ───────────────── */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                {/* Chat */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
                  <div className="px-4 py-4 border-b border-white/5">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#F2B71F] flex-shrink-0" />
                      <p className="text-sm font-semibold text-white">Chat</p>
                    </div>
                    <p className="text-2xl font-bold text-white tabular-nums">140</p>
                    <p className="text-[11px] text-neutral-400 uppercase tracking-wide mt-0.5">pts / week</p>
                  </div>
                  <div className="px-4 py-2.5 bg-white/[0.015]">
                    <p className="text-xs text-neutral-400">2 pts · first 10 msgs daily</p>
                  </div>
                </div>

                {/* Streak */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
                  <div className="px-4 py-4 border-b border-white/5">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#F2B71F] flex-shrink-0" />
                      <p className="text-sm font-semibold text-white">Daily streak</p>
                    </div>
                    <p className="text-2xl font-bold text-white tabular-nums">225</p>
                    <p className="text-[11px] text-neutral-400 uppercase tracking-wide mt-0.5">pts / week</p>
                  </div>
                  <div className="px-4 py-2.5 bg-white/[0.015]">
                    <p className="text-xs text-neutral-400">3d +50 · 5d +75 · 7d +100</p>
                  </div>
                </div>

                {/* Achievements */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
                  <div className="px-4 py-4 border-b border-white/5">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#F2B71F] flex-shrink-0" />
                      <p className="text-sm font-semibold text-white">Achievements</p>
                    </div>
                    <p className="text-2xl font-bold text-white tabular-nums">~340</p>
                    <p className="text-[11px] text-neutral-400 uppercase tracking-wide mt-0.5">pts / week</p>
                  </div>
                  <div className="px-4 py-2.5 bg-white/[0.015]">
                    <p className="text-xs text-neutral-400">New set every Monday</p>
                  </div>
                </div>
              </div>

              {/* ── This week's achievements ─────────────────── */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden mb-10">
                <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-widest">This week&apos;s achievements</p>
                    {achLoaded && publicKey && (
                      <span className="text-xs text-neutral-400 tabular-nums">{completedCount}/{achievements.length} done</span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-400 tabular-nums">{achLoaded ? totalPts : 340} pts total</p>
                </div>
                <div className="divide-y divide-white/5">
                  {(achLoaded && actionAchievements.length > 0 ? actionAchievements : [
                    { id: 'free_trade', title: 'Place a free market trade', points: 60, unlocked: false },
                    { id: 'win_free_trade', title: 'Win a free market trade', points: 100, unlocked: false },
                    { id: 'send_chat', title: 'Send a chat message', points: 40, unlocked: false },
                    { id: 'set_profile', title: 'Set your username', points: 40, unlocked: false },
                    { id: 'refer_friend', title: 'Refer a new user', points: 100, unlocked: false },
                  ] as Pick<Achievement, 'id' | 'title' | 'points' | 'unlocked'>[]).map((ach) => (
                    <div key={ach.id} className="px-5 py-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {achLoaded && publicKey ? (
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                            ach.unlocked
                              ? 'bg-[#F2B71F]/20 text-[#F2B71F]'
                              : 'border border-white/10 text-transparent'
                          }`}>
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        ) : null}
                        <span className={`text-sm ${ach.unlocked ? 'text-neutral-500 line-through' : 'text-neutral-300'}`}>
                          {ach.title}
                        </span>
                      </div>
                      <span className={`text-sm font-semibold tabular-nums flex-shrink-0 ${ach.unlocked ? 'text-[#F2B71F]' : 'text-[#F2B71F]'}`}>
                        +{ach.points}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="px-5 py-3 border-t border-white/5 bg-white/[0.015]">
                  {publicKey ? (
                    <Link
                      href={`/profile/${publicKey}`}
                      className="text-sm text-[#F2B71F] font-medium hover:text-white transition-colors"
                    >
                      View achievements →
                    </Link>
                  ) : (
                    <button
                      onClick={connect}
                      className="text-sm text-[#F2B71F] font-medium hover:text-white transition-colors"
                    >
                      Log in to track your progress →
                    </button>
                  )}
                </div>
              </div>

              {/* ── Refer Friends ──────────────────────────────── */}
              {publicKey && referralCode && (
                <div className="rounded-2xl border border-[#F2B71F]/30 bg-gradient-to-br from-[#F2B71F]/[0.06] via-transparent to-transparent overflow-hidden mb-10">
                  <div className="px-5 md:px-6 py-5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">🤝</span>
                      <h2 className="text-lg md:text-xl font-bold text-white">Refer Friends</h2>
                    </div>
                    <p className="text-sm text-neutral-400 mb-4">You both earn 10% of each other&apos;s points</p>

                    {/* Copy link */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5">
                        <p className="text-xs text-neutral-300 font-mono truncate">mentioned.market/ref/{referralCode}</p>
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`https://www.mentioned.market/ref/${referralCode}`)
                          setReferralCopied(true)
                          setTimeout(() => setReferralCopied(false), 2000)
                        }}
                        className={`flex-shrink-0 px-4 py-2.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                          referralCopied
                            ? 'bg-apple-green/20 text-apple-green border border-apple-green/30'
                            : 'bg-white/10 hover:bg-white/15 text-white border border-white/10'
                        }`}
                      >
                        {referralCopied ? 'Copied!' : 'Copy link'}
                      </button>
                    </div>

                    {/* Stats */}
                    <div className="flex items-center gap-6 mt-4">
                      <div>
                        <p className="text-[11px] text-neutral-500 uppercase tracking-wide">Referrals</p>
                        <p className={`text-xl font-bold tabular-nums ${referralCount > 0 ? 'text-white' : 'text-neutral-600'}`}>{referralCount}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-neutral-500 uppercase tracking-wide">Bonus points</p>
                        <p className={`text-xl font-bold tabular-nums ${bonusPointsEarned > 0 ? 'text-apple-green' : 'text-neutral-600'}`}>
                          {bonusPointsEarned > 0 ? `+${bonusPointsEarned.toLocaleString()}` : '0'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── CTA ───────────────────────────────────────── */}
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  href="/markets"
                  className="flex-1 flex items-center justify-center h-12 rounded-xl bg-white text-black text-base font-semibold hover:bg-neutral-100 transition-colors"
                >
                  Start trading free markets
                </Link>
                <Link
                  href="/leaderboard"
                  className="flex-1 flex items-center justify-center h-12 rounded-xl border border-white/10 bg-white/[0.03] text-white text-base font-medium hover:bg-white/[0.07] transition-colors"
                >
                  View leaderboard
                </Link>
                <button
                  onClick={() => setShowHowItWorks(true)}
                  className="flex-1 flex items-center justify-center h-12 rounded-xl border border-white/10 bg-white/[0.03] text-white text-base font-medium hover:bg-white/[0.07] transition-colors"
                >
                  How it works
                </button>
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
      <HowItWorksModal open={showHowItWorks} onClose={() => setShowHowItWorks(false)} />
    </div>
  )
}
