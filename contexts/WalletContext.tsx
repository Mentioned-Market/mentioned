'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'

interface WalletContextType {
  publicKey: PublicKey | null
  balance: number | null
  connect: () => Promise<void>
  disconnect: () => void
  connected: boolean
}

const WalletContext = createContext<WalletContextType | undefined>(undefined)

// Using devnet for development
const SOLANA_RPC_URL = 'https://api.devnet.solana.com'

export function WalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [connected, setConnected] = useState(false)
  const [connection] = useState(() => new Connection(SOLANA_RPC_URL, 'confirmed'))

  useEffect(() => {
    // Check if already connected
    if (typeof window !== 'undefined' && window.solana?.isPhantom) {
      if (window.solana.publicKey) {
        const pubKey = typeof window.solana.publicKey === 'string' 
          ? new PublicKey(window.solana.publicKey)
          : window.solana.publicKey
        setPublicKey(pubKey)
        setConnected(true)
      } else {
        window.solana.connect({ onlyIfTrusted: true }).then((response: { publicKey: PublicKey | string }) => {
          const pubKey = typeof response.publicKey === 'string'
            ? new PublicKey(response.publicKey)
            : response.publicKey
          setPublicKey(pubKey)
          setConnected(true)
        }).catch(() => {
          // Not connected
        })
      }
    }
  }, [])

  useEffect(() => {
    // Listen for account changes
    if (typeof window !== 'undefined' && window.solana) {
      const handleAccountChange = (publicKey: PublicKey | string | null) => {
        if (publicKey) {
          const pubKey = typeof publicKey === 'string'
            ? new PublicKey(publicKey)
            : publicKey
          setPublicKey(pubKey)
          setConnected(true)
        } else {
          setPublicKey(null)
          setBalance(null)
          setConnected(false)
        }
      }
      window.solana.on('accountChanged', handleAccountChange)
      
      return () => {
        if (window.solana?.off) {
          window.solana.off('accountChanged', handleAccountChange)
        }
      }
    }
  }, [])

  useEffect(() => {
    // Fetch balance when publicKey changes
    if (publicKey) {
      const fetchBalance = async () => {
        try {
          const lamports = await connection.getBalance(publicKey)
          setBalance(lamports / LAMPORTS_PER_SOL)
        } catch (error) {
          console.error('Error fetching balance:', error)
          // Try alternative devnet endpoint if main one fails
          try {
            const altConnection = new Connection('https://devnet.solana.com', 'confirmed')
            const lamports = await altConnection.getBalance(publicKey)
            setBalance(lamports / LAMPORTS_PER_SOL)
          } catch (altError) {
            console.error('Error with alternative RPC:', altError)
            // Set balance to null on error
            setBalance(null)
          }
        }
      }
      
      fetchBalance()
      
      // Refresh balance every 10 seconds
      const interval = setInterval(fetchBalance, 10000)

      return () => clearInterval(interval)
    }
  }, [publicKey, connection])

  const connect = async () => {
    if (typeof window !== 'undefined' && window.solana?.isPhantom) {
      try {
        const response = await window.solana.connect()
        const pubKey = typeof response.publicKey === 'string'
          ? new PublicKey(response.publicKey)
          : response.publicKey
        setPublicKey(pubKey)
        setConnected(true)
      } catch (err) {
        console.error('Error connecting to Phantom:', err)
      }
    } else {
      window.open('https://phantom.app/', '_blank')
    }
  }

  const disconnect = async () => {
    if (typeof window !== 'undefined' && window.solana) {
      await window.solana.disconnect()
      setPublicKey(null)
      setBalance(null)
      setConnected(false)
    }
  }

  return (
    <WalletContext.Provider value={{ publicKey, balance, connect, disconnect, connected }}>
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const context = useContext(WalletContext)
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return context
}

declare global {
  interface Window {
    solana?: {
      isPhantom?: boolean
      connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: PublicKey | string }>
      disconnect: () => Promise<void>
      signTransaction: (transaction: any) => Promise<any>
      signAllTransactions: (transactions: any[]) => Promise<any[]>
      on: (event: string, callback: (publicKey: PublicKey | string | null) => void) => void
      off?: (event: string, callback: (publicKey: PublicKey | string | null) => void) => void
      publicKey?: PublicKey | string
    }
  }
}

