'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@/contexts/WalletContext'

// Redirect /profile → /profile/{wallet} for connected users, or home for guests.
// We wait briefly before redirecting unauthenticated users so Phantom's silent
// auto-connect has a chance to fire before we conclude no wallet is connected.
export default function ProfileRedirect() {
  const { publicKey } = useWallet()
  const router = useRouter()
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), 800)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (publicKey) {
      router.replace(`/profile/${publicKey}`)
    } else if (settled) {
      router.replace('/')
    }
  }, [publicKey, settled, router])

  return null
}
