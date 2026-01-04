'use client'

import { createContext, useContext, ReactNode, useState, useEffect } from 'react'
import { createPublicClient, createWalletClient, custom, http, type WalletClient, type PublicClient } from 'viem'
import { baseSepolia } from 'viem/chains'

interface EVMWalletContextType {
  address: string | null
  isConnected: boolean
  connect: () => Promise<void>
  disconnect: () => void
  walletClient: WalletClient | null
  publicClient: PublicClient
}

const EVMWalletContext = createContext<EVMWalletContextType | undefined>(undefined)

export function EVMWalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null)

  // Public client for reading
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http('https://sepolia.base.org'),
  })

  useEffect(() => {
    // Check if already connected
    if (typeof window !== 'undefined' && window.ethereum) {
      window.ethereum.request({ method: 'eth_accounts' })
        .then((accounts: string[]) => {
          if (accounts.length > 0) {
            setAddress(accounts[0])
            setIsConnected(true)
            createWalletClientInstance(accounts[0])
          }
        })
        .catch(console.error)

      // Listen for account changes
      window.ethereum.on('accountsChanged', (accounts: string[]) => {
        if (accounts.length > 0) {
          setAddress(accounts[0])
          setIsConnected(true)
          createWalletClientInstance(accounts[0])
        } else {
          setAddress(null)
          setIsConnected(false)
          setWalletClient(null)
        }
      })

      // Listen for chain changes
      window.ethereum.on('chainChanged', () => {
        window.location.reload()
      })
    }
  }, [])

  const createWalletClientInstance = (account: string) => {
    if (typeof window !== 'undefined' && window.ethereum) {
      const client = createWalletClient({
        account: account as `0x${string}`,
        chain: baseSepolia,
        transport: custom(window.ethereum),
      })
      setWalletClient(client)
    }
  }

  const connect = async () => {
    if (typeof window !== 'undefined' && window.ethereum) {
      try {
        const accounts = await window.ethereum.request({ 
          method: 'eth_requestAccounts' 
        }) as string[]
        
        if (accounts.length > 0) {
          setAddress(accounts[0])
          setIsConnected(true)
          createWalletClientInstance(accounts[0])

          // Switch to Base Sepolia if not already on it
          try {
            await window.ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: '0x14a34' }], // 84532 in hex
            })
          } catch (switchError: any) {
            // Chain doesn't exist, add it
            if (switchError.code === 4902) {
              await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [{
                  chainId: '0x14a34',
                  chainName: 'Base Sepolia',
                  nativeCurrency: {
                    name: 'Ether',
                    symbol: 'ETH',
                    decimals: 18,
                  },
                  rpcUrls: ['https://sepolia.base.org'],
                  blockExplorerUrls: ['https://sepolia.basescan.org'],
                }],
              })
            }
          }
        }
      } catch (error) {
        console.error('Error connecting to MetaMask:', error)
      }
    } else {
      window.open('https://metamask.io/download/', '_blank')
    }
  }

  const disconnect = () => {
    setAddress(null)
    setIsConnected(false)
    setWalletClient(null)
  }

  return (
    <EVMWalletContext.Provider value={{ 
      address, 
      isConnected, 
      connect, 
      disconnect, 
      walletClient,
      publicClient 
    }}>
      {children}
    </EVMWalletContext.Provider>
  )
}

export function useEVMWallet() {
  const context = useContext(EVMWalletContext)
  if (context === undefined) {
    throw new Error('useEVMWallet must be used within EVMWalletProvider')
  }
  return context
}

declare global {
  interface Window {
    ethereum?: any
  }
}
