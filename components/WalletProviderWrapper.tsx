'use client'

import { PrivyProvider } from '@privy-io/react-auth'
import { WalletProvider } from '@/contexts/WalletContext'
import { AchievementProvider } from '@/contexts/AchievementContext'

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || ''

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
        embeddedWallets: {
          solana: {
            createOnLogin: 'all-users',
          },
        },
      }}
    >
      <WalletProvider>
        <AchievementProvider>{children}</AchievementProvider>
      </WalletProvider>
    </PrivyProvider>
  )
}
