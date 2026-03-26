'use client'

import { PrivyProvider } from '@privy-io/react-auth'
import { WalletProvider } from '@/contexts/WalletContext'
import { AchievementProvider } from '@/contexts/AchievementContext'

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || ''

function MaybePrivyProvider({ children }: { children: React.ReactNode }) {
  // Skip PrivyProvider if app ID is not configured (e.g. during SSR prerender)
  if (!PRIVY_APP_ID) {
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
        embeddedWallets: {
          solana: {
            createOnLogin: 'all-users',
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  )
}

export default function WalletProviderWrapper({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <MaybePrivyProvider>
      <WalletProvider>
        <AchievementProvider>{children}</AchievementProvider>
      </WalletProvider>
    </MaybePrivyProvider>
  )
}
