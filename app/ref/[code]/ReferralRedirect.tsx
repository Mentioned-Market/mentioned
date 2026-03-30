'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ReferralRedirect({ code, valid }: { code: string; valid: boolean }) {
  const router = useRouter()

  useEffect(() => {
    if (valid) {
      // Store referral code in cookie via document.cookie (client-side)
      document.cookie = `ref=${code.toUpperCase()};path=/;max-age=${30 * 24 * 60 * 60};samesite=lax`
    }
    router.replace('/')
  }, [code, valid, router])

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#0a0a0a',
      color: '#a3a3a3',
      fontFamily: 'sans-serif',
    }}>
      Redirecting...
    </div>
  )
}
