'use client'

import { useState } from 'react'
import Link from 'next/link'
import CountdownTimer from './CountdownTimer'

interface Word {
  word: string
  yesPrice: string
  noPrice: string
}

interface MarketCardProps {
  id: string
  category: string
  title: string
  eventTime: Date | null
  imageUrl: string
  imageAlt: string
  imageFilter?: string
  featured?: boolean
  className?: string
  words?: Word[]
  volume?: number
}

export default function MarketCard({
  id,
  category,
  title,
  eventTime,
  imageUrl,
  imageAlt,
  imageFilter = "grayscale(1) contrast(2) brightness(1.2)",
  featured = false,
  className = "",
  words = [],
  volume = 0,
}: MarketCardProps) {
  const [showWords, setShowWords] = useState(false)

  return (
    <Link 
      href={`/market/${id}`} 
      className={`group relative block overflow-hidden rounded-2xl glass hover:bg-white/10 transition-all duration-300 hover-lift ${className}`}
      onMouseEnter={() => setShowWords(true)}
      onMouseLeave={() => setShowWords(false)}
    >
      <div className="flex flex-col h-[280px]">
        {!showWords ? (
          <>
            <div
              className="w-full bg-center bg-no-repeat aspect-video bg-cover flex-shrink-0"
              style={{
                backgroundImage: `url("${imageUrl}")`,
                filter: imageFilter,
                height: '120px',
              }}
              aria-label={imageAlt}
            />
            <div className="flex flex-col flex-1 p-4">
              <div className="text-xs font-medium text-neutral-400 mb-2">{category}</div>
              <h3 className="text-white text-base font-semibold leading-tight mb-3 line-clamp-2">{title}</h3>
              {volume > 0 && (
                <div className="text-neutral-500 text-xs font-medium mb-3">
                  Volume: ${volume.toLocaleString()}
                </div>
              )}
              <div className="mt-auto pt-3 border-t border-white/10">
                <div className="flex items-center gap-2 text-xs">
                  {eventTime ? (
                    <>
                      <span className="text-neutral-400 font-medium">Event starts in</span>
                      <CountdownTimer targetTime={eventTime} />
                    </>
                  ) : (
                    <span className="text-neutral-400 font-medium">Event time TBD</span>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="h-full flex flex-col p-3">
            {words.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 flex-1 overflow-hidden">
                {words.slice(0, 6).map((word, idx) => (
                  <div key={idx} className="glass rounded-lg p-2.5 flex flex-col min-h-0 hover:bg-white/10 transition-colors duration-200">
                    <p className="text-white text-xs font-semibold mb-auto pb-2 truncate" title={word.word}>{word.word}</p>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-apple-green text-[10px] font-semibold">Yes</span>
                        <span className="text-white text-xs font-semibold">${word.yesPrice}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-apple-red text-[10px] font-semibold">No</span>
                        <span className="text-white text-xs font-semibold">${word.noPrice}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-neutral-500 text-sm">No words available yet</p>
              </div>
            )}
            {words.length > 6 && (
              <p className="text-neutral-500 text-xs mt-2 text-center font-medium">+{words.length - 6} more</p>
            )}
          </div>
        )}
      </div>
    </Link>
  )
}

