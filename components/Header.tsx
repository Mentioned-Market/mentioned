'use client'

import { useWallet } from '@/contexts/WalletContext'
import Image from 'next/image'
import { useState, useRef, useEffect, useCallback } from 'react'
import { address as toAddress } from '@solana/kit'
import { fetchEscrow, fetchUserPositions, lamportsToSol } from '@/lib/mentionMarket'
import DepositModal from '@/components/DepositModal'
import FlashValue from '@/components/FlashValue'

export default function Header() {
  const { publicKey, connected, connect, disconnect } = useWallet()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [depositOpen, setDepositOpen] = useState(false)
  const [escrowBalance, setEscrowBalance] = useState<bigint | null>(null)
  const [positionValueSol, setPositionValueSol] = useState(0)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const formatAddress = (pubKey: string | null) => {
    if (!pubKey) return ''
    return `${pubKey.slice(0, 4)}...${pubKey.slice(-4)}`
  }

  const loadEscrow = useCallback(async () => {
    if (!publicKey) {
      setEscrowBalance(null)
      return
    }
    try {
      const escrow = await fetchEscrow(toAddress(publicKey))
      setEscrowBalance(escrow ? escrow.balance : 0n)
    } catch {
      setEscrowBalance(null)
    }
  }, [publicKey])

  const loadPositions = useCallback(async () => {
    if (!publicKey) {
      setPositionValueSol(0)
      return
    }
    try {
      const positions = await fetchUserPositions(toAddress(publicKey))
      const total = positions.reduce((sum, p) => sum + p.estimatedValueSol, 0)
      setPositionValueSol(total)
    } catch {
      setPositionValueSol(0)
    }
  }, [publicKey])

  // Fetch escrow + positions on connect, poll every 15s
  useEffect(() => {
    if (!publicKey) {
      setEscrowBalance(null)
      setPositionValueSol(0)
      return
    }
    loadEscrow()
    loadPositions()
    const interval = setInterval(() => {
      loadEscrow()
      loadPositions()
    }, 15_000)
    return () => clearInterval(interval)
  }, [publicKey, loadEscrow, loadPositions])

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

  const cashDisplay = escrowBalance !== null ? lamportsToSol(escrowBalance) : '0.00'
  const cashSol = escrowBalance !== null ? Number(escrowBalance) / 1_000_000_000 : 0
  const portfolioDisplay = (cashSol + positionValueSol).toFixed(2)

  return (
    <>
      <header className="flex items-center justify-between py-3 md:py-5 backdrop-blur-xl bg-black/30 sticky top-0 z-50 -mx-4 md:-mx-10 lg:-mx-20 px-4 md:px-10 lg:px-20 border-b border-white/10">
        <a href="/" className="flex items-center text-white hover:opacity-70 transition-opacity duration-300 flex-shrink-0" aria-label="Mentioned - Mention Markets Home">
          <Image
            src="/src/img/White Logo.svg"
            alt="Mentioned - Mention Markets Platform Logo"
            width={160}
            height={26}
            className="h-6 md:h-7 w-auto"
            priority
          />
        </a>
        <div className="flex items-center gap-2 md:gap-3">
          {connected ? (
            <>
              {/* Portfolio / Cash — desktop */}
              <div className="hidden md:flex items-center gap-3 h-9 px-3 glass rounded-lg">
                <span className="text-neutral-400 text-xs font-medium">Portfolio</span>
                <FlashValue value={`${portfolioDisplay} SOL`} className="text-white font-semibold text-sm" />
                <div className="w-px h-4 bg-white/10" />
                <span className="text-neutral-400 text-xs font-medium">Cash</span>
                <FlashValue value={`${cashDisplay} SOL`} className="text-white font-semibold text-sm" />
              </div>

              {/* Mobile: compact cash display */}
              <div className="flex md:hidden items-center h-8 px-2.5 glass rounded-lg">
                <FlashValue value={`${cashDisplay} SOL`} className="text-white font-semibold text-xs" />
              </div>

              {/* Deposit button */}
              <button
                onClick={() => setDepositOpen(true)}
                className="h-8 md:h-9 px-2.5 md:px-3 bg-white text-black text-xs font-semibold rounded-lg hover:bg-neutral-100 transition-all duration-200"
              >
                Deposit
              </button>

              {/* Address dropdown */}
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-1.5 md:gap-2 h-8 md:h-9 px-2.5 md:px-4 glass hover:bg-white/10 text-white text-sm font-medium rounded-lg transition-all duration-200"
                >
                  <span className="font-mono text-xs">{formatAddress(publicKey)}</span>
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
                    <a
                      href="/profile"
                      onClick={() => setDropdownOpen(false)}
                      className="block w-full text-left px-4 py-3 text-white text-sm font-medium hover:bg-white/10 transition-colors duration-200"
                    >
                      Profile
                    </a>
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
            </>
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

      {/* Deposit Modal */}
      <DepositModal
        open={depositOpen}
        onClose={() => setDepositOpen(false)}
        onSuccess={loadEscrow}
      />
    </>
  )
}
