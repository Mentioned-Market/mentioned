'use client'

import { WalletProvider } from '@/contexts/WalletContext'
import { AchievementProvider } from '@/contexts/AchievementContext'

export default function WalletProviderWrapper({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <WalletProvider>
      <AchievementProvider>{children}</AchievementProvider>
    </WalletProvider>
  )
}
