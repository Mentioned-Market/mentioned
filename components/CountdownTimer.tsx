'use client'

import { useState, useEffect } from 'react'

interface CountdownTimerProps {
  targetTime: Date
}

export default function CountdownTimer({ targetTime }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState({
    hours: 0,
    minutes: 0,
    seconds: 0,
  })
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date().getTime()
      const target = targetTime.getTime()
      const difference = target - now

      if (difference <= 0) {
        setExpired(true)
        return { hours: 0, minutes: 0, seconds: 0 }
      }

      const hours = Math.floor(difference / (1000 * 60 * 60))
      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60))
      const seconds = Math.floor((difference % (1000 * 60)) / 1000)

      return { hours, minutes, seconds }
    }

    setTimeLeft(calculateTimeLeft())

    const interval = setInterval(() => {
      const newTimeLeft = calculateTimeLeft()
      setTimeLeft(newTimeLeft)
      if (newTimeLeft.hours === 0 && newTimeLeft.minutes === 0 && newTimeLeft.seconds === 0) {
        setExpired(true)
        clearInterval(interval)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [targetTime])

  if (expired) {
    return <span className="text-white/70 font-bold text-base">EXPIRED</span>
  }

  const formatTime = (value: number) => {
    return value.toString().padStart(2, '0')
  }

  return (
    <span className="text-white/70 font-bold text-base">
      {formatTime(timeLeft.hours)}:{formatTime(timeLeft.minutes)}:{formatTime(timeLeft.seconds)}
    </span>
  )
}
