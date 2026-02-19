'use client'

import { useState, useEffect, useMemo } from 'react'
import Header from '@/components/Header'
import MarketCard from '@/components/MarketCard'
import Footer from '@/components/Footer'
import {
  fetchAllMarkets,
  lmsrImpliedPrice,
  MarketStatus,
  marketStatusStr,
  type MarketAccount,
} from '@/lib/mentionMarket'
import type { Address } from '@solana/kit'

const SOL_USD_RATE = 175

type Filter = 'all' | 'open' | 'resolved'

export default function MarketsPage() {
  const [markets, setMarkets] = useState<
    Array<{ pubkey: Address; account: MarketAccount }>
  >([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [marketImages, setMarketImages] = useState<Record<string, string>>({})
  const [marketVolumes, setMarketVolumes] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetchAllMarkets()
      .then(async (all) => {
        if (cancelled) return
        setMarkets(all)
        setLoading(false)

        if (all.length === 0) return
        const ids = all.map((m) => m.account.marketId.toString())

        // Fetch images + volumes in parallel
        const [imgRes, volRes] = await Promise.all([
          fetch(`/api/market-image?marketIds=${ids.join(',')}`).then((r) => r.json()).catch(() => ({ images: {} })),
          fetch(`/api/trades/volume?marketIds=${ids.join(',')}`).then((r) => r.json()).catch(() => ({ volumes: {} })),
        ])

        if (cancelled) return
        if (imgRes.images) setMarketImages(imgRes.images)
        if (volRes.volumes) setMarketVolumes(volRes.volumes)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Failed to fetch markets:', err)
        setError('Failed to load markets')
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    if (filter === 'all') return markets
    if (filter === 'open') return markets.filter((m) => m.account.status === MarketStatus.Open || m.account.status === MarketStatus.Paused)
    return markets.filter((m) => m.account.status === MarketStatus.Resolved)
  }, [markets, filter])

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'resolved', label: 'Resolved' },
  ]

  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
            <Header />
            <main className="flex-1 pt-4 pb-4">
              {/* Page title + filter tabs */}
              <div className="flex items-center justify-between mb-6">
                <h1 className="text-xl md:text-2xl font-bold text-white">Markets</h1>
                <div className="flex items-center gap-1">
                  {filters.map((f) => (
                    <button
                      key={f.key}
                      onClick={() => setFilter(f.key)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        filter === f.key
                          ? 'bg-white/10 text-white'
                          : 'text-neutral-500 hover:text-neutral-300'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Loading */}
              {loading && (
                <div className="flex items-center justify-center py-32">
                  <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                </div>
              )}

              {/* Error */}
              {error && !loading && (
                <div className="flex flex-col items-center justify-center py-32 gap-3">
                  <span className="text-neutral-400 text-lg font-medium">{error}</span>
                  <button
                    onClick={() => window.location.reload()}
                    className="text-apple-blue text-sm font-semibold hover:opacity-80 transition-opacity"
                  >
                    Try again
                  </button>
                </div>
              )}

              {/* Empty state */}
              {!loading && !error && filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center py-32 gap-3">
                  <span className="text-neutral-400 text-lg font-medium">
                    {filter === 'all' ? 'No markets yet' : `No ${filter} markets`}
                  </span>
                  <span className="text-neutral-500 text-sm">
                    {filter === 'all'
                      ? 'Markets created on-chain will appear here'
                      : 'Try a different filter'}
                  </span>
                </div>
              )}

              {/* Market grid */}
              {!loading && !error && filtered.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 animate-fade-in">
                  {filtered.map((m) => {
                    const market = m.account
                    const mKey = market.marketId.toString()
                    const volSol = marketVolumes[mKey] || 0
                    const volUsd = Math.round(volSol * SOL_USD_RATE)
                    const imageUrl = marketImages[mKey] || '/src/img/White Icon.svg'

                    const words = market.words.map((w) => {
                      const price = lmsrImpliedPrice(
                        w.yesQuantity,
                        w.noQuantity,
                        market.liquidityParamB,
                      )
                      return {
                        word: w.label,
                        yesPrice: price.yes.toFixed(2),
                        noPrice: price.no.toFixed(2),
                      }
                    })

                    const statusLabel = market.status === MarketStatus.Resolved
                      ? 'Resolved'
                      : market.status === MarketStatus.Paused
                      ? 'Paused'
                      : ''

                    // Treat resolvesAt > 1 year from now as TBD
                    const resolvesMs = Number(market.resolvesAt) * 1000
                    const oneYearFromNow = Date.now() + 365 * 24 * 60 * 60 * 1000
                    const eventTime = resolvesMs > oneYearFromNow ? null : new Date(resolvesMs)

                    return (
                      <MarketCard
                        key={mKey}
                        id={mKey}
                        category={statusLabel ? `Mentions · ${statusLabel}` : 'Mentions · On-Chain'}
                        title={market.label || `Market #${mKey}`}
                        eventTime={eventTime}
                        imageUrl={imageUrl}
                        imageAlt={market.label || `Market #${mKey}`}
                        imageFilter={imageUrl.endsWith('.svg') ? 'none' : 'grayscale(1) contrast(2) brightness(1.2)'}
                        words={words}
                        volume={volUsd}
                      />
                    )
                  })}
                </div>
              )}
            </main>
            <Footer />
          </div>
        </div>
      </div>
    </div>
  )
}
