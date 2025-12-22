'use client'

import { WalletProvider } from '@/contexts/WalletContext'

export default function WalletProviderWrapper({
  children,
}: {
  children: React.ReactNode
}) {
  return <WalletProvider>{children}</WalletProvider>
}

