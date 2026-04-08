'use client'

import { useWallet } from '@/contexts/WalletContext'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export default function ConnectModal() {
  const { showConnectModal, setShowConnectModal, connectPhantom, connectPrivy, connectGoogle, connectX, privyReady } =
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
          <h2 className="text-lg font-semibold text-white">Login</h2>
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
            onClick={connectGoogle}
            disabled={!privyReady}
            className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all duration-200 group disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold text-white group-hover:text-white">
                Google
              </div>
              <div className="text-xs text-neutral-500">
                {privyReady ? 'Continue with Google' : 'Initializing...'}
              </div>
            </div>
          </button>

          <button
            onClick={connectX}
            disabled={!privyReady}
            className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all duration-200 group disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="w-10 h-10 rounded-xl bg-black border border-white/20 flex items-center justify-center flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.259 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/>
              </svg>
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold text-white group-hover:text-white">
                X (Twitter)
              </div>
              <div className="text-xs text-neutral-500">
                {privyReady ? 'Continue with X' : 'Initializing...'}
              </div>
            </div>
          </button>

          <button
            onClick={connectPrivy}
            disabled={!privyReady}
            className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all duration-200 group disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
              {!privyReady ? (
                <span className="text-neutral-500 text-sm tracking-widest">···</span>
              ) : (
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
              )}
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold text-white group-hover:text-white">
                Email
              </div>
              <div className="text-xs text-neutral-500">
                {privyReady ? 'Sign in with email' : 'Initializing...'}
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
