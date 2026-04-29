'use client'

import { PrivyProvider } from '@privy-io/react-auth'
import { WalletProvider } from '@/contexts/WalletContext'
import { AchievementProvider } from '@/contexts/AchievementContext'
import ErrorBoundary from '@/components/ErrorBoundary'
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit'

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID!
const MAINNET_HTTP = process.env.NEXT_PUBLIC_HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com'
const MAINNET_WSS = MAINNET_HTTP.replace(/^https?:\/\//, 'wss://')

// Pre-built RPC clients for Privy's embedded wallet transaction signing UI
const solanaMainnetRpc = {
  rpc: createSolanaRpc(MAINNET_HTTP),
  rpcSubscriptions: createSolanaRpcSubscriptions(MAINNET_WSS),
}

export default function WalletProviderWrapper({
  children,
}: {
  children: React.ReactNode
}) {
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
        },
        solana: {
          rpcs: {
            'solana:mainnet': solanaMainnetRpc,
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
