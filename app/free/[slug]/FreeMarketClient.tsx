'use client'

import { useState, useCallback } from 'react'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import CustomMarketPageContent from '@/components/CustomMarketPageContent'
import LoadingScreen from '@/components/LoadingScreen'

interface Props {
  initialMarketId: number | null
}

export default function FreeMarketClient({ initialMarketId }: Props) {
  const [overlayFading, setOverlayFading] = useState(false)
  const [overlayGone, setOverlayGone] = useState(false)

  const handleLoaded = useCallback(() => {
    setOverlayFading(true)
    setTimeout(() => setOverlayGone(true), 450)
  }, [])

  if (initialMarketId === null) {
    return (
      <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
        <div className="layout-container flex h-full grow flex-col">
          <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
            <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
              <Header />
              <main className="flex-1 flex items-center justify-center">
                <p className="text-neutral-400 text-sm">Market not found</p>
              </main>
              <Footer />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {!overlayGone && <LoadingScreen fading={overlayFading} />}
      <CustomMarketPageContent marketId={initialMarketId} onLoaded={handleLoaded} />
    </>
  )
}
