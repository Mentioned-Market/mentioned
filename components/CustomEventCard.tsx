'use client'

import { useState } from 'react'
import Link from 'next/link'

interface CustomMarketSummary {
  id: number
  title: string
  description: string | null
  cover_image_url: string | null
  status: string
  lock_time: string | null
  word_count: number
  prediction_count: number
}

function formatCloseTime(isoTime: string): string {
  const d = new Date(isoTime)
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  if (diff <= 0) return 'Locked'
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }
  return `${hours}h ${minutes}m`
}

export default function CustomEventCard({ market }: { market: CustomMarketSummary }) {
  const [imgError, setImgError] = useState(false)
  const url = `/custom/${market.id}`

  return (
    <div className="group relative block overflow-hidden rounded-2xl glass transition-all duration-300 hover-lift">
      {/* Image */}
      <Link href={url} className="block w-full relative overflow-hidden" style={{ height: '140px' }}>
        {market.cover_image_url && !imgError ? (
          <img
            src={market.cover_image_url}
            alt={market.title}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full bg-neutral-800 flex items-center justify-center">
            <span className="text-neutral-500 text-2xl">🎯</span>
          </div>
        )}
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-full bg-apple-green/90 text-white text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm">
            Free
          </span>
          {market.status === 'open' && (
            <span className="px-2 py-0.5 rounded-full bg-green-500/80 text-white text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm">
              Open
            </span>
          )}
          {market.status === 'locked' && (
            <span className="px-2 py-0.5 rounded-full bg-orange-500/80 text-white text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm">
              Locked
            </span>
          )}
          {market.status === 'resolved' && (
            <span className="px-2 py-0.5 rounded-full bg-blue-500/80 text-white text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm">
              Resolved
            </span>
          )}
        </div>
      </Link>

      <div className="p-4 flex flex-col gap-3">
        <Link href={url}>
          <h3 className="text-white text-sm font-semibold leading-tight line-clamp-2 h-[2.5rem] hover:text-neutral-200 transition-colors">
            {market.title}
          </h3>
        </Link>

        {market.description && (
          <p className="text-neutral-500 text-xs line-clamp-2">{market.description}</p>
        )}

        <Link href={url} className="flex items-center gap-2 pt-2 border-t border-white/5">
          <span className="px-2 py-0.5 rounded-full bg-white/5 text-neutral-400 text-[10px] font-medium">
            {market.prediction_count} predictor{market.prediction_count !== 1 ? 's' : ''}
          </span>
          {market.lock_time && market.status === 'open' && (
            <span className="px-2 py-0.5 rounded-full bg-white/5 text-neutral-400 text-[10px] font-medium">
              {formatCloseTime(market.lock_time)}
            </span>
          )}
          <span className="px-2 py-0.5 rounded-full bg-white/5 text-neutral-400 text-[10px] font-medium">
            {market.word_count} words
          </span>
        </Link>
      </div>
    </div>
  )
}
