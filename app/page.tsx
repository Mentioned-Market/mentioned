'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

interface Pricing {
  buyYesPriceUsd: number
  sellYesPriceUsd: number
  volume: number
}

interface Market {
  marketId: string
  status: string
  result: string | null
  pricing: Pricing
  metadata: {
    title: string
    isTeamMarket: boolean
    rulesPrimary: string
  }
}

interface EventMetadata {
  title: string
  imageUrl: string
  closeTime: string
  slug: string
}

interface PolyEvent {
  eventId: string
  isActive: boolean
  isLive: boolean
  beginAt: string
  category: string
  subcategory: string
  metadata: EventMetadata
  markets: Market[]
  volumeUsd: string
}

const SUBCATEGORY_LABELS: Record<string, string> = {
  lol: 'League of Legends',
  val: 'Valorant',
  cs: 'Counter-Strike',
  dota: 'Dota 2',
  rl: 'Rocket League',
  cod: 'Call of Duty',
}

function formatPrice(microUsd: number): string {
  return (microUsd / 1_000_000).toFixed(2)
}

function formatVolume(volumeUsd: string): string {
  const usd = Number(volumeUsd) / 1_000_000
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`
  return `$${usd.toFixed(0)}`
}

function formatCloseTime(isoTime: string): string {
  const d = new Date(isoTime)
  const now = new Date()
  const diff = d.getTime() - now.getTime()

  if (diff <= 0) return 'Closed'

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  if (hours > 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }

  return `${hours}h ${minutes}m`
}

function EventCard({ event }: { event: PolyEvent }) {
  const [imgError, setImgError] = useState(false)

  const teamMarkets = event.markets.filter(m => m.metadata.isTeamMarket)
  const hasTeams = teamMarkets.length === 2

  const team1 = hasTeams ? teamMarkets[0] : null
  const team2 = hasTeams ? teamMarkets[1] : null
  const team1Pct = team1 ? team1.pricing.buyYesPriceUsd / 10_000 : 50
  const team2Pct = team2 ? team2.pricing.buyYesPriceUsd / 10_000 : 50

  return (
    <Link href={`/polymarkets/event/${event.eventId}`} className="group relative block overflow-hidden rounded-2xl glass hover:bg-white/10 transition-all duration-300 hover-lift">
      <div className="w-full relative overflow-hidden" style={{ height: '140px' }}>
        {!imgError ? (
          <Image
            src={event.metadata.imageUrl}
            alt={event.metadata.title}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, 33vw"
            className="object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full bg-neutral-800 flex items-center justify-center">
            <span className="text-neutral-500 text-2xl">🎮</span>
          </div>
        )}
        <div className="absolute top-3 left-3 flex items-center gap-2">
          {event.isLive && (
            <span className="px-2 py-0.5 rounded-full bg-apple-red/90 text-white text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm">
              Live
            </span>
          )}
          <span className="px-2 py-0.5 rounded-full bg-black/60 text-neutral-300 text-[10px] font-medium backdrop-blur-sm">
            {SUBCATEGORY_LABELS[event.subcategory] || event.subcategory}
          </span>
        </div>
      </div>

      <div className="p-4 flex flex-col gap-3">
        <h3 className="text-white text-sm font-semibold leading-tight line-clamp-2">
          {event.metadata.title}
        </h3>

        {hasTeams && team1 && team2 ? (
          <div className="flex flex-col gap-2">
            <div className="flex w-full h-8 rounded-lg overflow-hidden">
              <div
                className="flex items-center justify-center bg-apple-blue/80 transition-all duration-500"
                style={{ width: `${team1Pct}%` }}
              >
                <span className="text-white text-[11px] font-bold truncate px-2">
                  {team1Pct.toFixed(0)}%
                </span>
              </div>
              <div
                className="flex items-center justify-center bg-apple-red/80 transition-all duration-500"
                style={{ width: `${team2Pct}%` }}
              >
                <span className="text-white text-[11px] font-bold truncate px-2">
                  {team2Pct.toFixed(0)}%
                </span>
              </div>
            </div>

            <div className="flex justify-between items-start gap-2">
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-white text-xs font-medium truncate">{team1.metadata.title}</span>
                <span className="text-apple-blue text-[11px] font-semibold">${formatPrice(team1.pricing.buyYesPriceUsd)}</span>
              </div>
              <div className="flex flex-col items-end min-w-0 flex-1">
                <span className="text-white text-xs font-medium truncate text-right">{team2.metadata.title}</span>
                <span className="text-apple-red text-[11px] font-semibold">${formatPrice(team2.pricing.buyYesPriceUsd)}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {event.markets.map(m => (
              <div key={m.marketId} className="flex items-center justify-between py-1.5 px-2 rounded-lg glass">
                <span className="text-white text-xs font-medium truncate">{m.metadata.title}</span>
                <span className="text-apple-green text-xs font-semibold">${formatPrice(m.pricing.buyYesPriceUsd)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-white/10">
          <span className="text-neutral-500 text-[11px] font-medium">
            Vol {formatVolume(event.volumeUsd)}
          </span>
          <span className="text-neutral-400 text-[11px] font-medium">
            Closes {formatCloseTime(event.metadata.closeTime)}
          </span>
        </div>
      </div>
    </Link>
  )
}

export default function Home() {
  const [events, setEvents] = useState<PolyEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchEvents() {
      try {
        const res = await fetch('/api/polymarket?category=esports')
        if (!res.ok) throw new Error('Failed to fetch events')
        const json = await res.json()
        if (!cancelled) {
          setEvents(json.data || [])
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Something went wrong')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchEvents()
    return () => { cancelled = true }
  }, [])

  const activeEvents = events.filter(e => e.isActive)
  const liveEvents = activeEvents.filter(e => e.isLive)
  const upcomingEvents = activeEvents.filter(e => !e.isLive)

  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
            <Header />
            <main className="flex-1 pt-6 pb-4">
              {/* Loading state */}
              {loading && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="rounded-2xl glass animate-pulse">
                      <div className="h-[140px] bg-neutral-800 rounded-t-2xl" />
                      <div className="p-4 space-y-3">
                        <div className="h-4 bg-neutral-800 rounded w-3/4" />
                        <div className="h-8 bg-neutral-800 rounded" />
                        <div className="h-3 bg-neutral-800 rounded w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Error state */}
              {error && (
                <div className="flex flex-col items-center justify-center py-20">
                  <p className="text-apple-red text-sm font-medium mb-2">Failed to load markets</p>
                  <p className="text-neutral-500 text-xs">{error}</p>
                  <button
                    onClick={() => window.location.reload()}
                    className="mt-4 px-4 py-2 glass rounded-lg text-white text-sm font-medium hover:bg-white/10 transition-colors"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Events */}
              {!loading && !error && (
                <div className="space-y-8 animate-fade-in">
                  {liveEvents.length > 0 && (
                    <section>
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-2 h-2 rounded-full bg-apple-red animate-pulse" />
                        <h2 className="text-white text-lg font-semibold">Live Now</h2>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {liveEvents.map(event => (
                          <EventCard key={event.eventId} event={event} />
                        ))}
                      </div>
                    </section>
                  )}

                  {upcomingEvents.length > 0 && (
                    <section>
                      {liveEvents.length > 0 && (
                        <h2 className="text-white text-lg font-semibold mb-4">Upcoming</h2>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {upcomingEvents.map(event => (
                          <EventCard key={event.eventId} event={event} />
                        ))}
                      </div>
                    </section>
                  )}

                  {activeEvents.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20">
                      <p className="text-neutral-400 text-sm">No esports markets available right now</p>
                    </div>
                  )}
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
