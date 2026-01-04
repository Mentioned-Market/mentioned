'use client'

// This file just redirects - the pro mode is now integrated into the main event page
import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

export default function EventProRedirect() {
  const params = useParams()
  const router = useRouter()
  const eventId = params.id as string

  useEffect(() => {
    // Redirect to main event page with ?mode=pro query param
    router.replace(`/event/${eventId}?mode=pro`)
  }, [eventId, router])

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <div className="text-xl">Redirecting to Pro mode...</div>
    </div>
  )
}
