'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { useWallet } from '@/contexts/WalletContext'
import ConnectModal from '@/components/ConnectModal'

interface Props {
  slug: string
  title: string
  displayAmount: string
  redirectPath: string
  code: string
}

type Status =
  | 'need_login' // no wallet connected
  | 'signing_in' // wallet connected, session not yet established
  | 'ready' // authenticated, waiting for a code (manual entry)
  | 'claiming' // funding tx in flight
  | 'funded' // success
  | 'processing' // tx may still land — ask user to wait
  | 'error'

const REDIRECT_DELAY_MS = 3500

export default function EventLanding({
  slug,
  title,
  displayAmount,
  redirectPath,
  code,
}: Props) {
  const {
    publicKey,
    authenticated,
    connecting,
    setShowConnectModal,
    connectGoogle,
    connectX,
    refreshBalance,
  } = useWallet()
  const router = useRouter()

  const [status, setStatus] = useState<Status>('need_login')
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [enteredCode, setEnteredCode] = useState('')
  const claimStartedRef = useRef(false)

  const runClaim = useCallback(
    async (codeToUse: string) => {
      const normalized = codeToUse.trim().toUpperCase()
      if (!normalized) {
        setStatus('error')
        setErrorMsg('Please enter your code.')
        return
      }
      claimStartedRef.current = true
      setStatus('claiming')
      setErrorMsg('')
      try {
        const res = await fetch(`/api/promo/${slug}/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: normalized }),
        })
        const data = await res.json().catch(() => ({}))

        if (res.ok && (data.status === 'funded' || data.status === 'already_funded')) {
          setStatus('funded')
          refreshBalance()
          setTimeout(() => router.push(redirectPath), REDIRECT_DELAY_MS)
          return
        }
        if (res.status === 202 || data.status === 'processing') {
          setStatus('processing')
          return
        }
        if (res.status === 403 || data.status === 'closed') {
          setStatus('error')
          setErrorMsg('This event has ended.')
          return
        }
        // Recoverable input errors — let the user re-enter / retry.
        claimStartedRef.current = false
        setStatus('error')
        setErrorMsg(
          data.error ||
            (res.status === 404
              ? "That code isn't valid."
              : res.status === 409
                ? 'That code has already been used.'
                : 'Something went wrong. Please try again.'),
        )
      } catch {
        claimStartedRef.current = false
        setStatus('error')
        setErrorMsg('Network error. Please try again.')
      }
    },
    [slug, redirectPath, refreshBalance, router],
  )

  // Drive the high-level status from wallet/session state.
  useEffect(() => {
    if (!publicKey) {
      setStatus('need_login')
      return
    }
    if (!authenticated) {
      setStatus('signing_in')
      return
    }
    // Authenticated. Auto-claim once if the link carried a code.
    if (!claimStartedRef.current && code) {
      runClaim(code)
      return
    }
    // Authenticated with no code yet — show the manual entry form (unless a
    // claim is already underway/finished).
    setStatus((s) =>
      s === 'signing_in' || s === 'need_login' ? 'ready' : s,
    )
  }, [publicKey, authenticated, code, runClaim])

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-4 py-12">
      <ConnectModal />

      <Image
        src="/src/img/__White Logo.png"
        alt="Mentioned"
        width={180}
        height={180}
        className="mb-2"
        priority
      />
      <p className="text-white/40 text-sm font-medium tracking-wider mb-8">
        {title}
      </p>

      <div className="w-full max-w-sm text-center">
        {/* ── Need login ─────────────────────────────── */}
        {status === 'need_login' && (
          <>
            <h1 className="text-white text-2xl font-bold mb-2">
              Welcome to Mentioned
            </h1>
            <p className="text-neutral-400 text-sm mb-6">
              Sign in and we&apos;ll credit your account with{' '}
              <span className="text-apple-green font-semibold">{displayAmount}</span>{' '}
              to place your first trade.
            </p>
            <button
              onClick={connectGoogle}
              disabled={connecting}
              className="w-full py-3.5 bg-white text-black text-base font-bold rounded-xl hover:bg-neutral-200 transition-colors mb-3 disabled:opacity-60"
            >
              Continue with Google
            </button>
            <button
              onClick={connectX}
              disabled={connecting}
              className="w-full py-3.5 bg-white/10 text-white text-base font-semibold rounded-xl hover:bg-white/15 transition-colors mb-3 disabled:opacity-60"
            >
              Continue with X
            </button>
            <button
              onClick={() => setShowConnectModal(true)}
              className="text-neutral-500 hover:text-neutral-300 text-sm transition-colors"
            >
              More options
            </button>
          </>
        )}

        {/* ── Signing in ─────────────────────────────── */}
        {status === 'signing_in' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Spinner />
            <p className="text-neutral-400 text-sm">Signing you in…</p>
          </div>
        )}

        {/* ── Ready: manual code entry ───────────────── */}
        {status === 'ready' && (
          <>
            <h1 className="text-white text-2xl font-bold mb-2">Enter your code</h1>
            <p className="text-neutral-400 text-sm mb-6">
              Type the code from your invite to claim{' '}
              <span className="text-apple-green font-semibold">{displayAmount}</span>.
            </p>
            <input
              value={enteredCode}
              onChange={(e) => setEnteredCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runClaim(enteredCode)
              }}
              placeholder="YOUR-CODE"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="w-full py-3.5 px-4 bg-white/5 border border-white/10 rounded-xl text-white text-center tracking-widest placeholder:text-neutral-600 focus:outline-none focus:border-apple-blue mb-4"
            />
            <button
              onClick={() => runClaim(enteredCode)}
              disabled={!enteredCode.trim()}
              className="w-full py-3.5 bg-white text-black text-base font-bold rounded-xl hover:bg-neutral-200 transition-colors disabled:opacity-40"
            >
              Claim {displayAmount}
            </button>
          </>
        )}

        {/* ── Claiming ───────────────────────────────── */}
        {status === 'claiming' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Spinner />
            <p className="text-white font-semibold">Crediting your account…</p>
            <p className="text-neutral-500 text-xs">This takes a few seconds.</p>
          </div>
        )}

        {/* ── Funded ─────────────────────────────────── */}
        {status === 'funded' && (
          <>
            <div className="flex items-center justify-center gap-2 text-apple-green mb-3">
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h1 className="text-white text-2xl font-bold mb-2">You&apos;re funded</h1>
            <p className="text-neutral-400 text-sm mb-6">
              <span className="text-apple-green font-semibold">{displayAmount}</span>{' '}
              has been added to your wallet. Time to place your first trade.
            </p>
            <button
              onClick={() => router.push(redirectPath)}
              className="w-full py-3.5 bg-white text-black text-base font-bold rounded-xl hover:bg-neutral-200 transition-colors"
            >
              Start trading →
            </button>
          </>
        )}

        {/* ── Processing (tx may still land) ─────────── */}
        {status === 'processing' && (
          <>
            <div className="flex justify-center mb-3">
              <Spinner />
            </div>
            <h1 className="text-white text-xl font-bold mb-2">Almost there…</h1>
            <p className="text-neutral-400 text-sm mb-6">
              Your funds are on the way. Give it a minute, then head to the markets —
              your balance will appear shortly.
            </p>
            <button
              onClick={() => router.push(redirectPath)}
              className="w-full py-3.5 bg-white/10 text-white text-base font-semibold rounded-xl hover:bg-white/15 transition-colors"
            >
              Go to markets
            </button>
          </>
        )}

        {/* ── Error ──────────────────────────────────── */}
        {status === 'error' && (
          <>
            <h1 className="text-white text-xl font-bold mb-2">Couldn&apos;t claim</h1>
            <p className="text-neutral-400 text-sm mb-6">{errorMsg}</p>
            <input
              value={enteredCode}
              onChange={(e) => setEnteredCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runClaim(enteredCode)
              }}
              placeholder="YOUR-CODE"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="w-full py-3.5 px-4 bg-white/5 border border-white/10 rounded-xl text-white text-center tracking-widest placeholder:text-neutral-600 focus:outline-none focus:border-apple-blue mb-4"
            />
            <button
              onClick={() => runClaim(enteredCode || code)}
              disabled={!(enteredCode.trim() || code)}
              className="w-full py-3.5 bg-white text-black text-base font-bold rounded-xl hover:bg-neutral-200 transition-colors disabled:opacity-40"
            >
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
  )
}
