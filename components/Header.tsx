'use client'

import { useWallet } from '@/contexts/WalletContext'
import ConnectModal from '@/components/ConnectModal'
import PrivyFundsModal from '@/components/PrivyFundsModal'
import Image from 'next/image'
import Link from 'next/link'
import { useState, useRef, useEffect } from 'react'

export default function Header() {
  const { publicKey, connected, connect, disconnect, username, pfpEmoji, discordLinked, profileLoading, walletReady, walletType } = useWallet()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [showDiscordTooltip, setShowDiscordTooltip] = useState(false)
  const [showFundsModal, setShowFundsModal] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const discordTooltipRef = useRef<HTMLDivElement>(null)

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

  return (
    <>
      <header className="flex items-center justify-between py-3 md:py-5 backdrop-blur-xl bg-black/30 sticky top-0 z-50 -mx-4 md:-mx-10 lg:-mx-20 px-4 md:px-10 lg:px-20 border-b border-white/10">
        <div className="flex items-center gap-4 md:gap-6">
          <Link href="/" className="flex items-center text-white hover:opacity-70 transition-opacity duration-300 flex-shrink-0" aria-label="Mentioned - Home">
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
        </div>
        <div className="flex items-center gap-2 md:gap-3">
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
                  <Link
                    href={`/api/discord/link?wallet=${publicKey}`}
                    onClick={() => setShowDiscordTooltip(false)}
                    className="mt-2 block text-center text-xs font-semibold px-3 py-1.5 rounded-lg bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 transition-colors duration-200"
                  >
                    Link Discord
                  </Link>
                </div>
              )}
            </div>
          )}
          {!walletReady || (connected && discordLinked === null) ? (
            <div className="h-8 md:h-9 px-3 md:px-4 glass rounded-lg flex items-center">
              <span className="text-neutral-500 text-sm tracking-widest">···</span>
            </div>
          ) : connected ? (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-1.5 md:gap-2 h-8 md:h-9 px-2.5 md:px-4 glass hover:bg-white/10 text-white text-sm font-medium rounded-lg transition-all duration-200"
              >
                {pfpEmoji && <span className="text-base">{pfpEmoji}</span>}
                {username
                  ? <span className="text-sm font-medium">{username}</span>
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
                <Link href="/markets" onClick={() => setMobileMenuOpen(false)} className="block px-4 py-3 text-white text-sm font-medium hover:bg-white/10 transition-colors duration-200">Markets</Link>
                <Link href="/leaderboard" onClick={() => setMobileMenuOpen(false)} className="block px-4 py-3 text-white text-sm font-medium hover:bg-white/10 transition-colors duration-200">Leaderboard</Link>
                <Link href="/positions" onClick={() => setMobileMenuOpen(false)} className="block px-4 py-3 text-white text-sm font-medium hover:bg-white/10 transition-colors duration-200">Positions</Link>
                <div className="border-t border-white/10"></div>
                {publicKey && (
                  <Link
                    href={username ? `/profile/${username}` : `/profile/${publicKey}`}
                    onClick={() => setMobileMenuOpen(false)}
                    className="block px-4 py-3 text-neutral-400 text-sm hover:bg-white/10 transition-colors duration-200"
                  >
                    My Profile
                  </Link>
                )}
                <div className="border-t border-white/10"></div>
                <button
                  onClick={() => {
                    setMobileMenuOpen(false)
                    window.dispatchEvent(new Event('open-bug-report'))
                  }}
                  className="block w-full text-left px-4 py-3 text-neutral-500 text-sm hover:bg-white/10 transition-colors duration-200"
                >
                  Report a Bug
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <ConnectModal />
      <PrivyFundsModal open={showFundsModal} onClose={() => setShowFundsModal(false)} />
    </>
  )
}
