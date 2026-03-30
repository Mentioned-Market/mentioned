'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import { usePathname } from 'next/navigation'

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

const MAX_WORDS = 200

export default function BugReportButton() {
  const [isOpen, setIsOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const modalRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { publicKey } = useWallet()
  const pathname = usePathname()

  // Hide on homepage (scroll-driven slideshow conflicts)
  const isHomepage = pathname === '/'

  const wordCount = countWords(message)

  const getDebugInfo = useCallback((): Record<string, string> => {
    const info: Record<string, string> = {
      URL: window.location.href,
      'User Agent': navigator.userAgent,
      'Screen Size': `${window.innerWidth}x${window.innerHeight}`,
      Timestamp: new Date().toISOString(),
      'Color Depth': `${window.screen.colorDepth}-bit`,
      Language: navigator.language,
    }
    if (publicKey) {
      info['Wallet'] = publicKey
    }
    return info
  }, [publicKey])

  const handleSubmit = async () => {
    if (!message.trim() || wordCount > MAX_WORDS) return

    setStatus('sending')
    setErrorMsg('')

    try {
      const res = await fetch('/api/bug-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message.trim(),
          debugInfo: getDebugInfo(),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setStatus('error')
        setErrorMsg(data.error || 'Something went wrong')
        return
      }

      setStatus('sent')
      setMessage('')
      setTimeout(() => {
        setIsOpen(false)
        setStatus('idle')
      }, 2000)
    } catch {
      setStatus('error')
      setErrorMsg('Network error. Please try again.')
    }
  }

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return
    function handleClick(e: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setStatus('idle')
        setErrorMsg('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false)
        setStatus('idle')
        setErrorMsg('')
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen])

  // Focus textarea when modal opens
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isOpen])

  if (isHomepage) return null

  return (
    <>
      {/* Floating button — bottom-left, raised on mobile to clear bottom sheets */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-20 left-4 md:bottom-6 md:left-6 z-50
            w-10 h-10 rounded-full
            bg-neutral-800/90 hover:bg-neutral-700 border border-white/10
            flex items-center justify-center
            transition-colors shadow-lg
            text-neutral-400 hover:text-white"
          aria-label="Report a bug"
          title="Report a bug"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="w-5 h-5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </button>
      )}

      {/* Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div
            ref={modalRef}
            className="w-full max-w-md bg-neutral-900 border border-white/10 rounded-xl shadow-2xl p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Report a Bug</h2>
              <button
                onClick={() => {
                  setIsOpen(false)
                  setStatus('idle')
                  setErrorMsg('')
                }}
                className="text-neutral-400 hover:text-white transition-colors"
                aria-label="Close"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-5 h-5"
                >
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
            </div>

            {status === 'sent' ? (
              <div className="text-center py-8">
                <p className="text-green-400 font-medium text-lg">Thanks for your report!</p>
                <p className="text-neutral-400 text-sm mt-1">We&apos;ll look into it.</p>
              </div>
            ) : (
              <>
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe the bug you encountered..."
                  rows={5}
                  className="w-full bg-neutral-800 border border-white/10 rounded-lg p-3
                    text-white placeholder-neutral-500 text-sm resize-none
                    focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/20"
                  disabled={status === 'sending'}
                />

                <div className="flex items-center justify-between mt-2 mb-4">
                  <span
                    className={`text-xs ${
                      wordCount > MAX_WORDS ? 'text-red-400' : 'text-neutral-500'
                    }`}
                  >
                    {wordCount}/{MAX_WORDS} words
                  </span>
                  <span className="text-xs text-neutral-600">
                    Debug info will be included automatically
                  </span>
                </div>

                {errorMsg && (
                  <p className="text-red-400 text-sm mb-3">{errorMsg}</p>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={
                    status === 'sending' ||
                    !message.trim() ||
                    wordCount > MAX_WORDS
                  }
                  className="w-full py-2.5 rounded-lg font-medium text-sm transition-colors
                    bg-red-600 hover:bg-red-500 text-white
                    disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {status === 'sending' ? 'Submitting...' : 'Submit Bug Report'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
