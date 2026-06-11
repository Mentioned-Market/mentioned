'use client'

import { useWallet } from '@/contexts/WalletContext'
import { useAchievements } from '@/contexts/AchievementContext'
import ConnectModal from '@/components/ConnectModal'
import UsernameModal from '@/components/UsernameModal'
import PrivyFundsModal from '@/components/PrivyFundsModal'
import HowItWorksModal from '@/components/HowItWorksModal'
import Image from 'next/image'
import Link from 'next/link'
import { useState, useRef, useEffect, useCallback } from 'react'
import UserSearch from '@/components/UserSearch'

function formatUsdc(baseUnits: string | null): string {
  if (!baseUnits) return '—'
  return '$' + (Number(BigInt(baseUnits)) / 1_000_000).toFixed(2)
}

// Last successful wallet summary, kept at module level so it survives the
// Header remount on every page navigation. Without it, each navigation starts
// from null, refetches, and often hits the API's 5s/wallet cooldown — leaving
// the balance pill empty for seconds even though we showed values moments ago.
let summaryCache: { wallet: string; usdc: string | null; portfolio: string | null } | null = null

// When the last summary fetch started, per wallet — module level for the same
// reason as summaryCache. Navigations within SUMMARY_REFRESH_MIN_MS of a fetch
// reuse cached values instead of refetching, so route changes can't trip the
// API's 5s/wallet cooldown.
let lastSummaryFetch: { wallet: string; at: number } | null = null
const SUMMARY_REFRESH_MIN_MS = 10_000

// Shimmer placeholder sized to match the balance text while a first load runs.
function BalanceSkeleton() {
  return <div className="h-3.5 w-12 rounded bg-white/10 animate-pulse" aria-hidden="true" />
}

export default function Header() {
  const { publicKey, connected, connect, disconnect, username, pfpEmoji, discordLinked, profileLoading, walletReady, walletType, connecting, refreshProfile } = useWallet()
  const { showAchievementToast } = useAchievements()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const [showDiscordTooltip, setShowDiscordTooltip] = useState(false)
  const [showFundsModal, setShowFundsModal] = useState(false)
  // Seed from the module cache so navigations show the last-known values
  // immediately while a background refresh runs.
  const [usdcBalance, setUsdcBalance] = useState<string | null>(
    () => (summaryCache && summaryCache.wallet === publicKey ? summaryCache.usdc : null)
  )
  const [portfolioValue, setPortfolioValue] = useState<string | null>(
    () => (summaryCache && summaryCache.wallet === publicKey ? summaryCache.portfolio : null)
  )
  const [refreshingSummary, setRefreshingSummary] = useState(false)
  const [refreshCooldown, setRefreshCooldown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const discordTooltipRef = useRef<HTMLDivElement>(null)
  const visitTrackedRef = useRef(false)

  const formatAddress = (pubKey: string | null) => {
    if (!pubKey) return ''
    return `${pubKey.slice(0, 4)}...${pubKey.slice(-4)}`
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false)
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setMobileMenuOpen(false)
      }
      if (discordTooltipRef.current && !discordTooltipRef.current.contains(event.target as Node)) {
        setShowDiscordTooltip(false)
      }
    }

    if (dropdownOpen || mobileMenuOpen || showDiscordTooltip) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [dropdownOpen, mobileMenuOpen, showDiscordTooltip])

  // Track daily visit once per session when wallet connects
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'discord_callback' && e.data?.status === 'linked') {
        refreshProfile()
        setShowDiscordTooltip(false)
      } else if (e.data?.type === 'discord_linked') {
        refreshProfile()
        setShowDiscordTooltip(false)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [refreshProfile])

  useEffect(() => {
    if (!connected || !publicKey || visitTrackedRef.current) return
    visitTrackedRef.current = true

    fetch('/api/visit', { method: 'POST' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.newAchievements?.length) return
        for (const ach of data.newAchievements) {
          showAchievementToast(ach)
        }
      })
      .catch(() => {})
  }, [connected, publicKey, showAchievementToast])

  // Fetch USDC balance + portfolio value. Manual-refresh only (a tiny button in the
  // header) so we don't hammer the RPC with a background poll — the user pulls a
  // fresh read after trading.
  const loadWalletSummary = useCallback((isRetry = false) => {
    if (!publicKey) return
    if (!isRetry) lastSummaryFetch = { wallet: publicKey, at: Date.now() }
    setRefreshingSummary(true)
    fetch(`/api/paid-markets/wallet-summary?wallet=${publicKey}`)
      .then(async r => {
        // API enforces a 5s/wallet cooldown; a fresh page load can collide with a
        // recent refresh — retry once after the cooldown so the values still fill.
        // Keep refreshingSummary true through the wait so the skeleton/spinner
        // doesn't flash off and back on.
        if (r.status === 429 && !isRetry) {
          const retryAfter = Number(r.headers.get('Retry-After') || 5)
          setTimeout(() => loadWalletSummary(true), retryAfter * 1000)
          return 'retry-scheduled' as const
        }
        return r.ok ? r.json() : null
      })
      .then(data => {
        if (data === 'retry-scheduled') return
        setRefreshingSummary(false)
        if (!data) return
        setUsdcBalance(data.usdcBalance)
        setPortfolioValue(data.portfolioValue)
        summaryCache = { wallet: publicKey, usdc: data.usdcBalance, portfolio: data.portfolioValue }
      })
      .catch(() => setRefreshingSummary(false))
  }, [publicKey])

  // Manual refresh with a 5s client-side cooldown so the button can't be spammed
  // (the API also enforces its own 5s/wallet cooldown as a backstop).
  const handleManualRefresh = useCallback(() => {
    if (refreshingSummary || refreshCooldown) return
    setRefreshCooldown(true)
    loadWalletSummary()
    setTimeout(() => setRefreshCooldown(false), 5000)
  }, [refreshingSummary, refreshCooldown, loadWalletSummary])

  useEffect(() => {
    if (!connected || !publicKey) {
      setUsdcBalance(null)
      setPortfolioValue(null)
      return
    }
    // On wallet switch, drop the previous wallet's values (or restore this
    // wallet's cached ones) before the background refresh lands.
    const cached = summaryCache && summaryCache.wallet === publicKey ? summaryCache : null
    setUsdcBalance(cached ? cached.usdc : null)
    setPortfolioValue(cached ? cached.portfolio : null)
    // Header remounts on every navigation; skip the refetch when a fetch for
    // this wallet ran recently so route changes don't hit the API cooldown.
    // Only skip when cached values exist — otherwise the pill would sit empty.
    if (
      cached &&
      lastSummaryFetch &&
      lastSummaryFetch.wallet === publicKey &&
      Date.now() - lastSummaryFetch.at < SUMMARY_REFRESH_MIN_MS
    ) {
      return
    }
    loadWalletSummary()
  }, [connected, publicKey, loadWalletSummary])

  return (
    <>
      <header className="sticky top-0 z-50 w-screen ml-[calc(50%-50vw)] border-b border-white/10" style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
        <div className="px-4 md:px-10 lg:px-20">
         <div className="max-w-7xl mx-auto flex items-center justify-between py-3 md:py-5">
        <div className="flex items-center gap-4 md:gap-6">
          <Link href={connected ? "/markets" : "/"} className="flex items-center text-white hover:opacity-70 transition-opacity duration-300 flex-shrink-0" aria-label="Mentioned - Home">
            <Image
              src="/src/img/White Logo.svg"
              alt="Mentioned Logo"
              width={160}
              height={26}
              className="h-6 md:h-7 w-auto"
              priority
            />
          </Link>
          {/* Desktop nav links */}
          <Link href="/markets" className="hidden md:block text-sm font-medium text-neutral-400 hover:text-white transition-colors duration-200">Markets</Link>
          <Link href="/leaderboard" className="hidden md:block text-sm font-medium text-neutral-400 hover:text-white transition-colors duration-200">Leaderboard</Link>
          <Link href="/positions" className="hidden md:block text-sm font-medium text-neutral-400 hover:text-white transition-colors duration-200">Positions</Link>
          <Link href="/arena" className="hidden md:block text-sm font-medium text-neutral-400 hover:text-white transition-colors duration-200">Arena</Link>
          <Link href="/knowledge" className="hidden md:block text-sm font-medium text-neutral-400 hover:text-white transition-colors duration-200">Knowledge</Link>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <UserSearch />
          {/* How it works button — desktop only */}
          <button
            onClick={() => setShowHowItWorks(true)}
            className="hidden md:flex items-center gap-1.5 h-8 md:h-9 px-3 md:px-4 rounded-lg text-sm font-medium text-[#F2B71F] hover:text-[#F2B71F]/80 bg-[#F2B71F]/10 hover:bg-[#F2B71F]/20 transition-all duration-200 border border-[#F2B71F]/20 hover:border-[#F2B71F]/30"
          >
            <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            How it works
          </button>

          {/* USDC balance display — desktop only, logged-in only. Rendered as soon
              as the wallet connects: cached values show instantly, a shimmer
              covers the first load instead of the pill being invisible. */}
          {connected && (
            <div className="hidden md:flex items-center gap-1">
              <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="text-center">
                  <div className="text-[10px] text-neutral-500 font-medium leading-none mb-0.5">Portfolio</div>
                  <div className="text-sm font-bold text-apple-green leading-none tabular-nums">
                    {portfolioValue !== null ? formatUsdc(portfolioValue) : refreshingSummary ? <BalanceSkeleton /> : '—'}
                  </div>
                </div>
                <div className="w-px h-6 bg-white/10" />
                <div className="text-center">
                  <div className="text-[10px] text-neutral-500 font-medium leading-none mb-0.5">Cash</div>
                  <div className="text-sm font-bold text-apple-green leading-none tabular-nums">
                    {usdcBalance !== null ? formatUsdc(usdcBalance) : refreshingSummary ? <BalanceSkeleton /> : '—'}
                  </div>
                </div>
                <button
                  onClick={handleManualRefresh}
                  disabled={refreshingSummary || refreshCooldown}
                  aria-label="Refresh balances"
                  title={refreshCooldown ? 'Please wait a few seconds' : 'Refresh balances'}
                  className="text-neutral-500 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className={`w-3.5 h-3.5 ${refreshingSummary ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {walletReady && connected && discordLinked === false && (
            <div className="relative" ref={discordTooltipRef}>
              <button
                onClick={() => setShowDiscordTooltip(!showDiscordTooltip)}
                className="flex items-center justify-center w-8 h-8 md:w-9 md:h-9 rounded-lg bg-yellow-500/20 border border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/30 transition-all duration-200"
                aria-label="Discord not linked"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" />
                </svg>
              </button>
              {showDiscordTooltip && (
                <div className="absolute right-0 mt-2 w-64 bg-neutral-900 border border-yellow-500/40 rounded-xl p-3 z-50 shadow-card-hover animate-scale-in">
                  <p className="text-yellow-400 text-xs font-semibold mb-1">Discord not linked</p>
                  <p className="text-neutral-300 text-xs leading-relaxed">You won&apos;t earn points on the leaderboard until you link your Discord account.</p>
                  <button
                    onClick={() => {
                      setShowDiscordTooltip(false)
                      window.open(`/api/discord/link?wallet=${publicKey}`, '_blank', 'width=500,height=700')
                    }}
                    className="mt-2 block w-full text-center text-xs font-semibold px-3 py-1.5 rounded-lg bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 transition-colors duration-200"
                  >
                    Link Discord
                  </button>
                </div>
              )}
            </div>
          )}
          {connecting || (connected && profileLoading) ? (
            <div className="h-8 md:h-9 px-4 glass rounded-lg flex items-center gap-[5px]">
              {([0, 0.15, 0.3] as const).map((delay) => (
                <span
                  key={delay}
                  className="w-[5px] h-[5px] rounded-full bg-neutral-400 inline-block"
                  style={{ animation: `dot-bounce 1.2s ease-in-out ${delay}s infinite` }}
                />
              ))}
            </div>
          ) : connected ? (
            <div className="relative hidden md:block" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-1.5 md:gap-2 h-8 md:h-9 px-2.5 md:px-4 glass hover:bg-white/10 text-white text-sm font-medium rounded-lg transition-all duration-200"
              >
                {pfpEmoji && <span className="text-base">{pfpEmoji}</span>}
                {username
                  ? (
                    <>
                      <span className="text-sm font-medium md:hidden">{username.length > 3 ? username.slice(0, 3) + '…' : username}</span>
                      <span className="text-sm font-medium hidden md:inline">{username}</span>
                    </>
                  )
                  : <span className="font-mono text-xs">{formatAddress(publicKey)}</span>
                }
                <svg
                  className={`w-3 h-3 transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {dropdownOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-neutral-900 rounded-xl overflow-hidden z-50 shadow-card-hover animate-scale-in border border-white/10">
                  <Link
                    href={username ? `/profile/${username}` : `/profile/${publicKey}`}
                    onClick={() => setDropdownOpen(false)}
                    className="block w-full text-left px-4 py-3 text-white text-sm font-medium hover:bg-white/10 transition-colors duration-200"
                  >
                    My Profile
                  </Link>
                  <div className="border-t border-white/10"></div>
                  <Link
                    href="/points"
                    onClick={() => setDropdownOpen(false)}
                    className="block w-full text-left px-4 py-3 text-[#F2B71F] text-sm font-semibold hover:bg-white/10 transition-colors duration-200"
                  >
                    Points & Prizes
                  </Link>
                  {walletType === 'privy' && (
                    <>
                      <div className="border-t border-white/10"></div>
                      <button
                        onClick={() => {
                          setDropdownOpen(false)
                          setShowFundsModal(true)
                        }}
                        className="w-full text-left px-4 py-3 text-white text-sm font-medium hover:bg-white/10 transition-colors duration-200"
                      >
                        Deposit / Withdraw
                      </button>
                    </>
                  )}
                  <div className="border-t border-white/10"></div>
                  <button
                    onClick={() => {
                      setDropdownOpen(false)
                      window.dispatchEvent(new Event('open-bug-report'))
                    }}
                    className="w-full text-left px-4 py-3 text-neutral-400 text-sm hover:bg-white/10 transition-colors duration-200"
                  >
                    Report a Bug
                  </button>
                  <div className="border-t border-white/10"></div>
                  <button
                    onClick={() => {
                      setDropdownOpen(false)
                      disconnect()
                    }}
                    className="w-full text-left px-4 py-3 text-apple-red text-sm font-medium hover:bg-white/10 transition-colors duration-200"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={connect}
              className="h-8 md:h-9 px-4 md:px-5 bg-white text-black text-xs md:text-sm font-semibold rounded-lg hover:bg-neutral-100 transition-all duration-200 shadow-button"
            >
              Login
            </button>
          )}

          {/* Mobile burger button */}
          <div className="relative md:hidden" ref={mobileMenuRef}>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="flex items-center justify-center w-8 h-8 text-white"
              aria-label="Menu"
            >
              {mobileMenuOpen ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 12h18M3 6h18M3 18h18" />
                </svg>
              )}
            </button>

            {mobileMenuOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-neutral-900 rounded-xl overflow-hidden z-50 shadow-card-hover animate-scale-in border border-white/10">
                {/* Profile — top of menu when connected */}
                {connected && publicKey && (
                  <>
                    <Link
                      href={username ? `/profile/${username}` : `/profile/${publicKey}`}
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-3 text-white text-sm font-medium hover:bg-white/10 transition-colors duration-200"
                    >
                      {pfpEmoji && <span className="text-base leading-none">{pfpEmoji}</span>}
                      <span>{username ? `@${username}` : formatAddress(publicKey)}</span>
                    </Link>
                    <div className="border-t border-white/10" />
                  </>
                )}
                <Link href="/markets" onClick={() => setMobileMenuOpen(false)} className="block px-4 py-3 text-white text-sm font-medium hover:bg-white/10 transition-colors duration-200">Markets</Link>
                <Link href="/leaderboard" onClick={() => setMobileMenuOpen(false)} className="block px-4 py-3 text-white text-sm font-medium hover:bg-white/10 transition-colors duration-200">Leaderboard</Link>
                <Link href="/positions" onClick={() => setMobileMenuOpen(false)} className="block px-4 py-3 text-white text-sm font-medium hover:bg-white/10 transition-colors duration-200">Positions</Link>
                <Link href="/arena" onClick={() => setMobileMenuOpen(false)} className="block px-4 py-3 text-white text-sm font-medium hover:bg-white/10 transition-colors duration-200">Arena</Link>
                <Link href="/knowledge" onClick={() => setMobileMenuOpen(false)} className="block px-4 py-3 text-white text-sm font-medium hover:bg-white/10 transition-colors duration-200">Knowledge</Link>
                <Link href="/points" onClick={() => setMobileMenuOpen(false)} className="block px-4 py-3 text-[#F2B71F] text-sm font-semibold hover:bg-white/10 transition-colors duration-200">Points & Prizes</Link>
                <div className="border-t border-white/10" />
                <button
                  onClick={() => {
                    setMobileMenuOpen(false)
                    setShowHowItWorks(true)
                  }}
                  className="w-full text-left px-4 py-3 text-neutral-400 text-sm hover:bg-white/10 transition-colors duration-200 flex items-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" className="shrink-0">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                  How it works
                </button>
                <button
                  onClick={() => {
                    setMobileMenuOpen(false)
                    window.dispatchEvent(new Event('open-bug-report'))
                  }}
                  className="block w-full text-left px-4 py-3 text-neutral-500 text-sm hover:bg-white/10 transition-colors duration-200"
                >
                  Report a Bug
                </button>
                {/* Disconnect — bottom of menu when connected */}
                {connected && (
                  <>
                    <div className="border-t border-white/10" />
                    <button
                      onClick={() => {
                        setMobileMenuOpen(false)
                        disconnect()
                      }}
                      className="w-full text-left px-4 py-3 text-apple-red text-sm font-medium hover:bg-white/10 transition-colors duration-200"
                    >
                      Disconnect
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
         </div>
        </div>
      </header>
      <ConnectModal />
      <UsernameModal />
      <PrivyFundsModal open={showFundsModal} onClose={() => setShowFundsModal(false)} />
      <HowItWorksModal open={showHowItWorks} onClose={() => setShowHowItWorks(false)} />
    </>
  )
}
