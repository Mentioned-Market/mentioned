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
      <div className="flex flex-col h-[280px]">
        {!showWords ? (
          <>
            <div
              className="w-full bg-center bg-no-repeat aspect-video bg-cover mb-4 rounded-lg flex-shrink-0"
              style={{
                backgroundImage: `url("${imageUrl}")`,
                filter: imageFilter,
                height: '120px',
              }}
              aria-label={imageAlt}
            />
            <div className="flex flex-col flex-1">
              <p className="text-white text-xl font-bold uppercase leading-tight mb-3 line-clamp-2">{title}</p>
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
          <div className="h-full flex flex-col py-2">
            {words.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 flex-1 overflow-hidden">
                {words.slice(0, 6).map((word, idx) => (
                  <div key={idx} className="border border-[#2a2a2a] bg-[#0d0d0d] p-2 rounded-lg flex flex-col min-h-0">
                    <p className="text-white text-xs font-bold uppercase mb-2 truncate" title={word.word}>{word.word}</p>
                    <div className="flex flex-col gap-1 mt-auto">
                      <div className="flex items-center justify-between">
                        <span className="text-green-400 text-[10px] font-bold">YES</span>
                        <span className="text-white text-xs font-bold">${word.yesPrice}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-red-400 text-[10px] font-bold">NO</span>
                        <span className="text-white text-xs font-bold">${word.noPrice}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-white/30 text-sm">No words available yet</p>
              </div>
            )}
            {words.length > 6 && (
              <p className="text-white/30 text-xs mt-2 text-center">+{words.length - 6} MORE...</p>
            )}
          </div>
        )}
      </div>
    </Link>
  )
}

