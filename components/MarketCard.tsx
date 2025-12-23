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
  eventTime: Date
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
  
  const baseClasses = "p-4 bg-[#161616] @container rounded-xl border border-[#2a2a2a]"

  return (
    <Link 
      href={`/market/${id}`} 
      className={`${baseClasses} ${className} block hover:bg-[#1f1f1f] hover:border-[#333333] transition-all`}
      onMouseEnter={() => setShowWords(true)}
      onMouseLeave={() => setShowWords(false)}
    >
      <div className="flex flex-col h-full">
        {!showWords ? (
          <>
            <div
              className="w-full bg-center bg-no-repeat aspect-video bg-cover mb-4 rounded-lg"
              style={{
                backgroundImage: `url("${imageUrl}")`,
                filter: imageFilter,
                height: '120px',
              }}
              aria-label={imageAlt}
            />
            <div className="flex flex-col flex-1">
              <p className="text-white text-xl font-bold uppercase leading-tight mb-3">{title}</p>
              {volume > 0 && (
                <p className="text-white/50 text-sm mb-3">
                  VOL: ${volume.toLocaleString()}
                </p>
              )}
              <div className="mt-auto">
                <div className="flex items-center gap-2 text-sm">
                  <p className="text-white/50">ENDS IN:</p>
                  <CountdownTimer targetTime={eventTime} />
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="h-full flex flex-col">
            {words.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 flex-1">
                {words.slice(0, 8).map((word, idx) => (
                  <div key={idx} className="border border-[#2a2a2a] bg-[#0d0d0d] p-2 rounded-lg">
                    <p className="text-white text-xs font-bold uppercase">{word.word}</p>
                    <div className="flex gap-2 mt-1">
                      <span className="text-white/50 text-xs">YES: {word.yesPrice}</span>
                      <span className="text-white/50 text-xs">NO: {word.noPrice}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-white/30 text-sm">No words available yet</p>
              </div>
            )}
            {words.length > 8 && (
              <p className="text-white/30 text-xs mt-2">+{words.length - 8} MORE...</p>
            )}
          </div>
        )}
      </div>
    </Link>
  )
}

