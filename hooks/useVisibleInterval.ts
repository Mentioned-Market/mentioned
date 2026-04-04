'use client'

import { useEffect, useRef } from 'react'

/**
 * Like setInterval, but pauses when the tab is hidden (document.hidden).
 * Fires immediately on mount, then every `delayMs`.
 */
export function useVisibleInterval(callback: () => void, delayMs: number) {
  const savedCallback = useRef(callback)
  savedCallback.current = callback

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null

    function start() {
      if (id !== null) return
      savedCallback.current()
      id = setInterval(() => savedCallback.current(), delayMs)
    }

    function stop() {
      if (id !== null) {
        clearInterval(id)
        id = null
      }
    }

    function onVisibilityChange() {
      if (document.hidden) stop()
      else start()
    }

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [delayMs])
}
