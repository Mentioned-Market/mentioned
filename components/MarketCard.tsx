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
}: MarketCardProps) {
  const [showWords, setShowWords] = useState(false)
  
  const baseClasses = featured
    ? "p-4 border-4 border-black animate-strobe @container z-10 scale-105 bg-black -ml-4 -mr-4 lg:ml-0 lg:mr-0 lg:-mt-8"
    : "p-4 border border-white @container"

  return (
    <Link href={`/market/${id}`} className={`${baseClasses} ${className} block`}>
      <div className="flex flex-col items-stretch justify-start">
        <div
          className="w-full bg-center bg-no-repeat aspect-video bg-cover relative"
          style={{
            backgroundImage: `url("${imageUrl}")`,
            filter: imageFilter,
          }}
          aria-label={imageAlt}
          onMouseEnter={() => setShowWords(true)}
          onMouseLeave={() => setShowWords(false)}
        >
          {showWords && words.length > 0 && (
            <div className="absolute inset-0 bg-black/90 border-4 border-white p-4 overflow-y-auto">
              <p className="text-white font-mono text-xs uppercase mb-3">MENTION WORDS:</p>
              <div className="grid grid-cols-2 gap-2">
                {words.slice(0, 8).map((word, idx) => (
                  <div key={idx} className="border border-white p-2">
                    <p className="text-white font-mono text-sm uppercase">{word.word}</p>
                    <div className="flex gap-2 mt-1">
                      <span className="text-white/70 text-xs">YES: {word.yesPrice}</span>
                      <span className="text-white/70 text-xs">NO: {word.noPrice}</span>
                    </div>
                  </div>
                ))}
              </div>
              {words.length > 8 && (
                <p className="text-white/50 font-mono text-xs mt-2">+{words.length - 8} MORE...</p>
              )}
            </div>
          )}
        </div>
        <div className="flex w-full grow flex-col items-stretch justify-center gap-4 py-4">
          <p className="text-white font-mono text-sm">[{category}]</p>
          <p className="text-white text-4xl font-bold uppercase">{title}</p>
          <div className="flex items-center gap-4 font-mono">
            <p className="text-white/70 text-xl">ENDS IN:</p>
            <CountdownTimer targetTime={eventTime} />
          </div>
          <div className="grid grid-cols-1 gap-2 mt-2">
            <button 
              onClick={(e) => e.preventDefault()}
              className="w-full cursor-pointer items-center justify-center h-16 px-4 bg-white text-black text-2xl font-bold uppercase hover:bg-black hover:text-white border border-white"
            >
              <span>VIEW MARKET</span>
            </button>
          </div>
        </div>
      </div>
    </Link>
  )
}

