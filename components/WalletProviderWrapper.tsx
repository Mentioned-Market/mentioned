'use client'

import { useState, useEffect } from 'react'
import { PrivyProvider } from '@privy-io/react-auth'
import { WalletProvider } from '@/contexts/WalletContext'
import { AchievementProvider } from '@/contexts/AchievementContext'
import ErrorBoundary from '@/components/ErrorBoundary'
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit'
import { SOLANA_CLUSTER } from '@/lib/solanaConfig'

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? ''
const MAINNET_HTTP = process.env.NEXT_PUBLIC_HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com'
const MAINNET_WSS = MAINNET_HTTP.replace(/^https?:\/\//, 'wss://')

// Pre-built RPC clients for Privy's embedded wallet transaction signing UI.
const solanaMainnetRpc = {
  rpc: createSolanaRpc(MAINNET_HTTP),
  rpcSubscriptions: createSolanaRpcSubscriptions(MAINNET_WSS),
}

// Only register a devnet RPC when the paid stack is actually on devnet — keeps
// devnet out of the bundle on mainnet while staying one env-flag away.
const solanaDevnetRpc = (() => {
  if (SOLANA_CLUSTER !== 'devnet') return null
  const http = process.env.NEXT_PUBLIC_HELIUS_DEVNET_RPC_URL || 'https://api.devnet.solana.com'
  return {
    rpc: createSolanaRpc(http),
    rpcSubscriptions: createSolanaRpcSubscriptions(http.replace(/^https?:\/\//, 'wss://')),
  }
})()

export default function WalletProviderWrapper({
  children,
}: {
  children: React.ReactNode
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  if (!mounted || !PRIVY_APP_ID) {
    return <>{children}</>
  }
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#FFFFFF',
        },
        loginMethods: ['email', 'google', 'twitter'],
        embeddedWallets: {
          solana: {
            createOnLogin: 'all-users',
          },
          showWalletUIs: false,
        },
        solana: {
          rpcs: {
            'solana:mainnet': solanaMainnetRpc,
            ...(solanaDevnetRpc ? { 'solana:devnet': solanaDevnetRpc } : {}),
          },
        },
      }}
    >
      <ErrorBoundary>
        <WalletProvider>
          <AchievementProvider>{children}</AchievementProvider>
        </WalletProvider>
      </ErrorBoundary>
    </PrivyProvider>
  )
}
