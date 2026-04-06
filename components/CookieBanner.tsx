'use client'

import { useState, useEffect } from 'react'

export default function CookieBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const decided = document.cookie.split(';').some(c => c.trim().startsWith('mentioned_cookie_consent='))
    if (!decided) setVisible(true)
  }, [])

  const respond = (accept: boolean) => {
    const value = accept ? 'accepted' : 'declined'
    document.cookie = `mentioned_cookie_consent=${value}; Max-Age=31536000; path=/; SameSite=Lax`
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:max-w-sm z-[300] glass border border-white/10 rounded-2xl p-4 shadow-2xl">
      <p className="text-xs text-neutral-400 leading-relaxed mb-3">
        We use cookies to remember your preferences, such as whether you&apos;ve seen the tutorial.
        No tracking or third-party cookies are used. See our{' '}
        <a href="/cookies" className="text-apple-blue hover:underline">Cookie Policy</a>.
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => respond(true)}
          className="flex-1 py-1.5 rounded-lg bg-apple-blue text-white text-xs font-semibold hover:bg-apple-blue/80 transition-colors"
        >
          Accept
        </button>
        <button
          onClick={() => respond(false)}
          className="flex-1 py-1.5 rounded-lg bg-white/5 text-neutral-400 text-xs font-semibold hover:bg-white/10 transition-colors"
        >
          Decline
        </button>
      </div>
    </div>
  )
}
