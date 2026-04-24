'use client'

import { useState } from 'react'
import { useWallet } from '@/contexts/WalletContext'

interface Props {
  targetWallet: string
  initialFollowing: boolean
  onChange?: (nowFollowing: boolean) => void
  // Size variant: 'sm' for inline next to usernames, 'md' for the profile header.
  size?: 'sm' | 'md'
}

export default function FollowButton({ targetWallet, initialFollowing, onChange, size = 'md' }: Props) {
  const { publicKey, connected, connect } = useWallet()
  const [following, setFollowing] = useState(initialFollowing)
  const [hovered, setHovered] = useState(false)
  const [busy, setBusy] = useState(false)

  // Don't render on self. Parent should already filter, but belt-and-braces.
  if (publicKey && publicKey === targetWallet) return null

  const toggle = async () => {
    if (busy) return
    if (!connected) {
      connect()
      return
    }
    setBusy(true)
    const method = following ? 'DELETE' : 'POST'
    const prev = following
    // Optimistic update — revert on failure.
    setFollowing(!prev)
    onChange?.(!prev)
    try {
      const res = await fetch('/api/follow', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetWallet }),
      })
      if (!res.ok) throw new Error('failed')
    } catch {
      setFollowing(prev)
      onChange?.(prev)
    } finally {
      setBusy(false)
    }
  }

  const isUnfollowHover = following && hovered
  const label = busy
    ? (following ? 'Unfollowing…' : 'Following…')
    : isUnfollowHover
    ? 'Unfollow'
    : following
    ? 'Following'
    : 'Follow'

  const padding = size === 'sm' ? 'px-3 py-1 text-xs' : 'px-4 py-1.5 text-sm'
  const base = `inline-flex items-center justify-center rounded-lg font-semibold transition-all duration-150 ${padding} disabled:opacity-60`

  // Three visual states: not-following (solid), following (subtle), following+hover (red tint).
  const cls = !following
    ? `${base} bg-white text-black hover:bg-neutral-200`
    : isUnfollowHover
    ? `${base} bg-apple-red/10 text-apple-red border border-apple-red/30`
    : `${base} bg-white/5 text-white border border-white/15 hover:bg-white/10`

  return (
    <button
      type="button"
      onClick={toggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={busy}
      className={cls}
    >
      {label}
    </button>
  )
}
