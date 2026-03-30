'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useWallet } from '@/contexts/WalletContext'
import ConnectModal from '@/components/ConnectModal'

export default function ReferralLanding({ code, referrerUsername }: { code: string; referrerUsername: string }) {
  const { publicKey, setShowConnectModal } = useWallet()
  const router = useRouter()

  // Store referral cookie on mount
  useEffect(() => {
    document.cookie = `ref=${code.toUpperCase()};path=/;max-age=${30 * 24 * 60 * 60};samesite=lax`
  }, [code])

  // Once wallet is connected, apply referral and redirect to profile
  useEffect(() => {
    if (!publicKey) return

    const apply = async () => {
      try {
        await fetch('/api/referral', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: publicKey, code: code.toUpperCase() }),
        })
      } catch { /* referral cookie is still set as fallback for Discord link */ }

      // Redirect to profile to complete setup (set username, link Discord)
      router.push(`/profile/${publicKey}`)
    }
    apply()
  }, [publicKey, code, router])

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-4">
      <ConnectModal />
      {/* Logo */}
      <Image
        src="/src/img/__White Logo.png"
        alt="Mentioned"
        width={200}
        height={200}
        className="mb-2"
        priority
      />

      {/* mentioned.market */}
      <p className="text-white/40 text-sm font-medium tracking-wider mb-10">mentioned.market</p>

      {/* Referral card */}
      <div className="w-full max-w-sm text-center">
        <h1 className="text-white text-2xl font-bold mb-2">
          You&apos;ve been invited by
        </h1>
        <p className="text-apple-blue text-xl font-semibold mb-6">
          @{referrerUsername}
        </p>

        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 mb-8">
          <p className="text-apple-green text-sm font-medium">
            You both earn 10% of each other&apos;s points
          </p>
        </div>

        {/* Connect wallet button */}
        {!publicKey ? (
          <button
            onClick={() => setShowConnectModal(true)}
            className="w-full py-3.5 bg-white text-black text-base font-bold rounded-xl hover:bg-neutral-200 transition-colors mb-4"
          >
            Connect Wallet to Join
          </button>
        ) : (
          <div className="flex items-center justify-center gap-2 py-3.5 text-apple-green">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            <span className="font-semibold">Connected — redirecting...</span>
          </div>
        )}

        {/* Skip link */}
        <Link
          href="/"
          className="text-neutral-600 hover:text-neutral-400 text-sm transition-colors"
        >
          Skip for now
        </Link>
      </div>

      {/* Referral code display */}
      <p className="text-neutral-700 text-xs mt-12">
        Referral code: {code.toUpperCase()}
      </p>
    </div>
  )
}
