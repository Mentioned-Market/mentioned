'use client'

import { useWallet } from '@/contexts/WalletContext'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'

export default function UsernameModal() {
  const { authenticated, username, profileLoading, refreshProfile } = useWallet()
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [usernameInput, setUsernameInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [fadeOut, setFadeOut] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (authenticated && username === null && !profileLoading) {
      setVisible(true)
      setFadeOut(false)
    }
  }, [authenticated, username, profileLoading])

  function close() {
    setFadeOut(true)
    setTimeout(() => {
      setVisible(false)
      setFadeOut(false)
    }, 300)
  }

  async function handleSave() {
    const trimmed = usernameInput.trim()
    if (!trimmed) {
      setError('Username cannot be empty')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to save username')
        return
      }
      refreshProfile()
      close()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (visible) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [visible])

  if (!mounted || !visible) return null

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm transition-opacity duration-300 ${fadeOut ? 'opacity-0' : 'opacity-100'}`}
    >
      <div
        className={`w-full max-w-sm mx-4 bg-neutral-900 rounded-2xl border border-white/10 shadow-2xl overflow-hidden transition-all duration-300 ${fadeOut ? 'opacity-0 scale-95' : 'animate-scale-in'}`}
      >
        <div className="px-8 pt-8 pb-7 space-y-6">
          {/* Header */}
          <div className="text-center space-y-3">
            <div className="flex justify-center">
              <Image src="/src/img/White Logo.svg" alt="Mentioned" width={140} height={23} className="h-6 w-auto" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-semibold text-white">Welcome to Mentioned</h2>
              <p className="text-sm text-neutral-500">Choose a username to get started</p>
            </div>
          </div>

          {/* Input */}
          <div className="space-y-1.5">
            <div className="flex items-center bg-white/5 rounded-xl px-4 py-3.5 gap-1.5">
              <span className="text-neutral-500 text-sm select-none">@</span>
              <input
                type="text"
                value={usernameInput}
                onChange={(e) => { setUsernameInput(e.target.value); setError(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !saving) handleSave() }}
                placeholder="yourname"
                maxLength={20}
                autoFocus
                className="bg-transparent text-white text-sm flex-1 outline-none placeholder-neutral-600"
              />
            </div>
            <p className="text-xs text-neutral-600 px-1">3–20 characters, letters, numbers, and underscores only</p>
            {error && <p className="text-xs text-red-400 px-1">{error}</p>}
          </div>

          {/* CTA */}
          <button
            onClick={handleSave}
            disabled={saving || !usernameInput.trim()}
            className="w-full py-3.5 rounded-xl bg-white text-black text-sm font-semibold hover:bg-white/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Set Username'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
