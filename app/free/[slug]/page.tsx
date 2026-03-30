'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import CustomMarketPageContent from '@/components/CustomMarketPageContent'

export default function FreeMarketPage() {
  const params = useParams()
  const slug = params.slug as string

  const [marketId, setMarketId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    fetch(`/api/custom/by-slug/${encodeURIComponent(slug)}`)
      .then(res => {
        if (!res.ok) throw new Error('Market not found')
        return res.json()
      })
      .then(data => setMarketId(data.id))
      .catch(() => setError('Market not found'))
  }, [slug])

  if (error) {
    return (
      <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
        <div className="layout-container flex h-full grow flex-col">
          <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
            <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
              <Header />
              <main className="flex-1 flex items-center justify-center">
                <p className="text-neutral-400 text-sm">{error}</p>
              </main>
              <Footer />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (marketId === null) {
    return (
      <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
        <div className="layout-container flex h-full grow flex-col">
          <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
            <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
              <Header />
              <main className="flex-1 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              </main>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return <CustomMarketPageContent marketId={marketId} />
}
