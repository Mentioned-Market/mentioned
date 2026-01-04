'use client'

import { WalletProvider } from '@/contexts/WalletContext'
import { EVMWalletProvider } from '@/contexts/EVMWalletContext'

export default function WalletProviderWrapper({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <EVMWalletProvider>
      <WalletProvider>{children}</WalletProvider>
    </EVMWalletProvider>
  )
}

