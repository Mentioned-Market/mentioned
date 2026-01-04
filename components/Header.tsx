'use client'

import { useEVMWallet } from '@/contexts/EVMWalletContext'
import Image from 'next/image'
import { useState, useRef, useEffect } from 'react'
import { formatUnits } from 'viem'
import { contracts, abis } from '@/lib/contracts'

export default function Header() {
  const { address, isConnected, connect, disconnect, publicClient } = useEVMWallet()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Fetch USDC balance
  useEffect(() => {
    if (address && publicClient) {
      fetchBalance()
      const interval = setInterval(fetchBalance, 10000)
      return () => clearInterval(interval)
    }
  }, [address, publicClient])

  const fetchBalance = async () => {
    if (!address) return
    try {
      const balance = await publicClient.readContract({
        address: contracts.mockUSDC,
        abi: abis.mockUSDC,
        functionName: 'balanceOf',
        args: [address],
      })
      setUsdcBalance(balance as bigint)
    } catch (err) {
      console.error('Error fetching balance:', err)
    }
  }

  const formatBalance = (bal: bigint | null) => {
    if (bal === null) return '0.00'
    return parseFloat(formatUnits(bal, 6)).toFixed(2)
  }

  const formatAddress = (addr: string | null) => {
    if (!addr) return ''
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
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
    <header className="flex items-center justify-between py-5 backdrop-blur-xl bg-black/30 sticky top-0 z-50 -mx-4 md:-mx-10 lg:-mx-20 px-4 md:px-10 lg:px-20 border-b border-white/10">
      <a href="/" className="flex items-center gap-3 text-white hover:opacity-70 transition-opacity duration-300" aria-label="Mentioned - Mention Markets Home">
        <div className="relative w-10 h-10 flex-shrink-0">
          <Image
            src="/src/logo.png"
            alt="Mentioned - Mention Markets Platform Logo"
            fill
            className="object-contain"
            priority
          />
        </div>
        <div className="flex flex-col">
          <h1 className="text-white text-xl font-semibold tracking-tight">
            Mentioned
          </h1>
          <span className="text-xs text-neutral-400 font-medium">
            Mention Markets
          </span>
        </div>
      </a>
      <div className="flex items-center gap-3">
        {isConnected ? (
          <>
            {/* mUSDC Balance */}
            <div className="hidden md:flex items-center gap-2 px-3 py-2 glass rounded-lg">
              <span className="text-neutral-400 text-xs font-medium">Balance</span>
              <span className="text-white font-semibold text-sm">{formatBalance(usdcBalance)} mUSDC</span>
            </div>

            {/* Dropdown Menu */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-2 h-9 px-4 glass hover:bg-white/10 text-white text-sm font-medium rounded-lg transition-all duration-200"
              >
                <span className="font-mono text-xs">{formatAddress(address)}</span>
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
            className="h-9 px-5 bg-white text-black text-sm font-semibold rounded-lg hover:bg-neutral-100 transition-all duration-200 shadow-button"
          >
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  )
}

