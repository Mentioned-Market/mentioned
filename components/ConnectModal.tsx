'use client'

import { useWallet } from '@/contexts/WalletContext'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export default function ConnectModal() {
  const { showConnectModal, setShowConnectModal, connectPhantom, connectPrivy } =
    useWallet()
  const backdropRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (showConnectModal) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [showConnectModal])

  if (!showConnectModal || !mounted) return null

  return createPortal(
    <div
      ref={backdropRef}
      onClick={(e) => {
        if (e.target === backdropRef.current) setShowConnectModal(false)
      }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm mx-4 bg-neutral-900 rounded-2xl border border-white/10 shadow-2xl animate-scale-in overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h2 className="text-lg font-semibold text-white">Connect Wallet</h2>
          <button
            onClick={() => setShowConnectModal(false)}
            className="text-neutral-500 hover:text-white transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-3">
          <button
            onClick={connectPhantom}
            className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all duration-200 group"
          >
            <div className="w-10 h-10 rounded-xl bg-[#AB9FF2] flex items-center justify-center flex-shrink-0">
              <svg
                width="20"
                height="20"
                viewBox="0 0 128 128"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M110.584 64.914H99.142C99.142 38.776 78.011 17.645 51.873 17.645C26.183 17.645 5.32 37.979 4.541 63.444C3.73 89.944 25.594 112.355 52.101 112.355H55.718C79.278 112.355 110.584 91.624 110.584 64.914Z"
                  fill="url(#paint0_linear)"
                />
                <path
                  d="M86.858 64.914C86.858 62.536 84.939 60.617 82.561 60.617C80.183 60.617 78.264 62.536 78.264 64.914C78.264 67.292 80.183 69.211 82.561 69.211C84.939 69.211 86.858 67.292 86.858 64.914Z"
                  fill="white"
                />
                <path
                  d="M69.67 64.914C69.67 62.536 67.751 60.617 65.373 60.617C62.995 60.617 61.076 62.536 61.076 64.914C61.076 67.292 62.995 69.211 65.373 69.211C67.751 69.211 69.67 67.292 69.67 64.914Z"
                  fill="white"
                />
                <defs>
                  <linearGradient
                    id="paint0_linear"
                    x1="57.5"
                    y1="17.645"
                    x2="57.5"
                    y2="112.355"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop stopColor="#534BB1" />
                    <stop offset="1" stopColor="#551BF9" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold text-white group-hover:text-white">
                Phantom
              </div>
              <div className="text-xs text-neutral-500">
                Browser extension wallet
              </div>
            </div>
          </button>

          <button
            onClick={connectPrivy}
            className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all duration-200 group"
          >
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold text-white group-hover:text-white">
                Email / Social
              </div>
              <div className="text-xs text-neutral-500">
                Sign in with Privy
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
