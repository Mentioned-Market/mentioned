'use client'

import { useWallet } from '@/contexts/WalletContext'
import Image from 'next/image'
import Link from 'next/link'
import { useState, useRef, useEffect } from 'react'

export default function Header() {
  const { publicKey, connected, connect, disconnect } = useWallet()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [username, setUsername] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const formatAddress = (pubKey: string | null) => {
    if (!pubKey) return ''
    return `${pubKey.slice(0, 4)}...${pubKey.slice(-4)}`
  }

  useEffect(() => {
    if (!publicKey) { setUsername(null); return }
    fetch(`/api/profile?wallet=${publicKey}`)
      .then(r => r.json())
      .then(d => setUsername(d.username ?? null))
      .catch(() => setUsername(null))
  }, [publicKey])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false)
      }
    }

    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [dropdownOpen])

  return (
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
        <Link
          href="/markets"
          className="text-sm font-medium text-neutral-400 hover:text-white transition-colors duration-200"
        >
          Markets
        </Link>
        <Link
          href="/leaderboard"
          className="text-sm font-medium text-neutral-400 hover:text-white transition-colors duration-200"
        >
          Leaderboard
        </Link>
        <Link
          href="/positions"
          className="text-sm font-medium text-neutral-400 hover:text-white transition-colors duration-200"
        >
          Positions
        </Link>
      </div>
      <div className="flex items-center gap-2 md:gap-3">
        {connected ? (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-1.5 md:gap-2 h-8 md:h-9 px-2.5 md:px-4 glass hover:bg-white/10 text-white text-sm font-medium rounded-lg transition-all duration-200"
            >
              {username
                ? <span className="text-sm font-medium">@{username}</span>
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
                {username && (
                  <Link
                    href={`/profile/${username}`}
                    onClick={() => setDropdownOpen(false)}
                    className="block w-full text-left px-4 py-3 text-neutral-400 text-sm hover:bg-white/10 transition-colors duration-200"
                  >
                    @{username}
                  </Link>
                )}
                <Link
                  href="/profile"
                  onClick={() => setDropdownOpen(false)}
                  className="block w-full text-left px-4 py-3 text-white text-sm font-medium hover:bg-white/10 transition-colors duration-200"
                >
                  {username ? 'Edit Profile' : 'Profile'}
                </Link>
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
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  )
}
