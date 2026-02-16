'use client'

import { useRef, useEffect, useState } from 'react'

interface FlashValueProps {
  value: string | number
  className?: string
}

/**
 * Wraps a displayed value and plays a brief flash animation whenever it changes.
 * Uses a key-based re-mount to retrigger the CSS animation.
 */
export default function FlashValue({ value, className = '' }: FlashValueProps) {
  const prevValue = useRef(value)
  const [flashKey, setFlashKey] = useState(0)

  useEffect(() => {
    if (prevValue.current !== value) {
      prevValue.current = value
      setFlashKey((k) => k + 1)
    }
  }, [value])

  return (
    <span
      key={flashKey}
      className={`${className} ${flashKey > 0 ? 'animate-flash-update' : ''}`}
    >
      {value}
    </span>
  )
}
