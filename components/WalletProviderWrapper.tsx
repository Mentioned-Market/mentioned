'use client'

import { useState, useEffect } from 'react'
import { PrivyProvider } from '@privy-io/react-auth'
import { WalletProvider } from '@/contexts/WalletContext'
import { AchievementProvider } from '@/contexts/AchievementContext'
import ErrorBoundary from '@/components/ErrorBoundary'
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit'
import { SOLANA_CLUSTER } from '@/lib/solanaConfig'

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? ''

// Public (keyless) endpoints only. Privy no longer broadcasts — every flow uses
// its sign-only signTransaction and our same-origin proxies do the sending
// (lib/rpcSend) — so this config is effectively vestigial. It exists because the
// SDK requires an RPC map, and it must NEVER point at a keyed URL: anything
// referenced here is inlined into the public browser bundle.
const solanaMainnetRpc = {
  rpc: createSolanaRpc('https://api.mainnet-beta.solana.com'),
  rpcSubscriptions: createSolanaRpcSubscriptions('wss://api.mainnet-beta.solana.com'),
}

// Only register a devnet RPC when the paid stack is actually on devnet — keeps
// devnet out of the bundle on mainnet while staying one env-flag away.
const solanaDevnetRpc =
  SOLANA_CLUSTER === 'devnet'
    ? {
        rpc: createSolanaRpc('https://api.devnet.solana.com'),
        rpcSubscriptions: createSolanaRpcSubscriptions('wss://api.devnet.solana.com'),
      }
    : null

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
