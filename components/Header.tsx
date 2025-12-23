'use client'

import { useWallet } from '@/contexts/WalletContext'
import { PublicKey } from '@solana/web3.js'
import Image from 'next/image'
import { useState, useRef, useEffect } from 'react'

export default function Header() {
  const { connect, disconnect, connected, balance, publicKey } = useWallet()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const formatBalance = (bal: number | null) => {
    if (bal === null) return '0.00'
    return bal.toFixed(2)
  }

  const formatAddress = (pubKey: PublicKey | null) => {
    if (!pubKey) return ''
    const address = pubKey.toString()
    return `${address.slice(0, 4)}...${address.slice(-4)}`
  }

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
    <header className="flex items-center justify-between py-6">
      <a href="/" className="flex items-center gap-3 text-white hover:opacity-80 transition-opacity">
        <div className="relative w-10 h-10 flex-shrink-0">
          <Image
            src="/src/logo.png"
            alt="Mentioned Logo"
            fill
            className="object-contain"
            priority
          />
        </div>
        <h1 className="text-white text-xl font-bold uppercase tracking-wider">
          MENTIONED
        </h1>
      </a>
      <div className="flex items-center gap-6">
        {connected ? (
          <>
            {/* SOL Balance */}
            <div className="flex items-center gap-2">
              <span className="text-white/50 text-sm uppercase">Balance</span>
              <span className="text-white font-bold text-lg">{formatBalance(balance)} SOL</span>
            </div>

            {/* Dropdown Menu */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-2 h-10 px-4 bg-[#1a1a1a] hover:bg-[#252525] text-white text-sm font-medium rounded-lg transition-colors"
              >
                <span>{formatAddress(publicKey)}</span>
                <span className="text-xs">{dropdownOpen ? '▲' : '▼'}</span>
              </button>

              {dropdownOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-[#1a1a1a] rounded-lg overflow-hidden z-50 shadow-xl">
                  <button
                    onClick={() => {
                      setDropdownOpen(false)
                      // Navigate to profile (placeholder for now)
                    }}
                    className="w-full text-left px-4 py-3 text-white text-sm hover:bg-[#252525] transition-colors"
                  >
                    Profile
                  </button>
                  <div className="border-t border-white/10"></div>
                  <button
                    onClick={() => {
                      setDropdownOpen(false)
                      disconnect()
                    }}
                    className="w-full text-left px-4 py-3 text-white text-sm hover:bg-[#252525] transition-colors"
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
            className="h-10 px-6 bg-white text-black text-sm font-bold uppercase rounded-lg hover:bg-white/90 transition-colors"
          >
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  )
}

