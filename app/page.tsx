'use client'

import { useMemo } from 'react'
import Header from '@/components/Header'
import MarketCard from '@/components/MarketCard'
import Footer from '@/components/Footer'

export default function Home() {
  // Calculate event times
  const allMarkets = useMemo(() => {
    const now = new Date()
    
    return [
      {
        id: 'trump-speech',
        category: 'SPEECHES',
        title: "TRUMP RALLY SPEECH",
        eventTime: new Date(now.getTime() + 2 * 60 * 60 * 1000),
        imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCPwsL0smxRVROhCkwShqqarIa-4xnAdVdAomChQJ_T5mRI0s77w-xoaIXYP2m8tRl-uEGpY2db-WBf6yZIfORA6Azp8_G7mOSTRPFRKHgyuo-4Ltlj_aMHH0t0PkSvdDO95rJOZpBgoS7jAKqkQ_7C86iSDgLJC9vDfV4YSshAaEhuIv2qI0WDcGs0VSLKNYTrz72KduCuH-fH8XBkROiM1zDK2dJlV6R0sCiMjP_Y3Ml19Uglhnihkb8ZD1prCuWa0i_wip0TXSI',
        imageAlt: 'Donald Trump',
        imageFilter: 'grayscale(1) contrast(2) brightness(1.2)',
        featured: false,
        volume: 125000,
        words: [
          { word: 'IMMIGRATION', yesPrice: '0.72', noPrice: '0.28' },
          { word: 'ECONOMY', yesPrice: '0.65', noPrice: '0.35' },
          { word: 'CHINA', yesPrice: '0.58', noPrice: '0.42' },
        ],
      },
      {
        id: 'drake-album',
        category: 'MUSIC',
        title: 'DRAKE ALBUM LYRICS',
        eventTime: new Date(now.getTime() + 4 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&q=80',
        imageAlt: 'Music recording',
        imageFilter: 'grayscale(1) contrast(1.8) brightness(0.9)',
        featured: false,
        volume: 89000,
        words: [],
      },
      {
        id: 'rogan-musk',
        category: 'PODCASTS',
        title: 'JOE ROGAN X ELON MUSK',
        eventTime: new Date(now.getTime() + 5 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1478737270239-2f02b77fc618?w=800&q=80',
        imageAlt: 'Podcast microphone',
        imageFilter: 'grayscale(1) contrast(2) brightness(1.0)',
        featured: false,
        volume: 156000,
        words: [],
      },
      {
        id: 'colbert-show',
        category: 'TV SHOWS',
        title: 'LATE SHOW TONIGHT',
        eventTime: new Date(now.getTime() + 6 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?w=800&q=80',
        imageAlt: 'TV studio',
        imageFilter: 'grayscale(1) contrast(1.9) brightness(1.1)',
        featured: false,
        volume: 67000,
        words: [],
      },
      {
        id: 'dune-script',
        category: 'MOVIES',
        title: 'DUNE PART 3 SCRIPT',
        eventTime: new Date(now.getTime() + 8 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?w=800&q=80',
        imageAlt: 'Movie theater',
        imageFilter: 'grayscale(1) contrast(2) brightness(0.85)',
        featured: false,
        volume: 98000,
        words: [],
      },
      {
        id: 'mr-beast-video',
        category: 'YOUTUBE',
        title: 'MRBEAST NEXT VIDEO',
        eventTime: new Date(now.getTime() + 9 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=800&q=80',
        imageAlt: 'YouTube content',
        imageFilter: 'grayscale(1) contrast(1.7) brightness(0.95)',
        featured: false,
        volume: 234000,
        words: [],
      },
      {
        id: 'nba-finals-cast',
        category: 'SPORTS CAST',
        title: 'NBA FINALS COMMENTARY',
        eventTime: new Date(now.getTime() + 10 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1504450758481-7338eba7524a?w=800&q=80',
        imageAlt: 'NBA game',
        imageFilter: 'grayscale(1) contrast(2.1) brightness(1.0)',
        featured: false,
        volume: 178000,
        words: [],
      },
      {
        id: 'world-cup-cast',
        category: 'SPORTS CAST',
        title: 'WORLD CUP CASTER WORDS',
        eventTime: new Date(now.getTime() + 11 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1489944440615-453fc2b6a9a9?w=800&q=80',
        imageAlt: 'World Cup',
        imageFilter: 'grayscale(1) contrast(2) brightness(0.9)',
        featured: false,
        volume: 145000,
        words: [],
      },
      {
        id: 'league-patch',
        category: 'PATCH NOTES',
        title: 'LEAGUE OF LEGENDS 14.5',
        eventTime: new Date(now.getTime() + 12 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&q=80',
        imageAlt: 'Gaming',
        imageFilter: 'grayscale(1) contrast(1.5) brightness(0.8)',
        featured: false,
        volume: 72000,
        words: [],
      },
      {
        id: 'valorant-patch',
        category: 'PATCH NOTES',
        title: 'VALORANT PATCH 8.0',
        eventTime: new Date(now.getTime() + 13 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&q=80',
        imageAlt: 'Valorant',
        imageFilter: 'grayscale(1) contrast(1.7) brightness(0.85)',
        featured: false,
        volume: 87000,
        words: [],
      },
      {
        id: 'apple-keynote',
        category: 'TECH EVENTS',
        title: 'APPLE KEYNOTE',
        eventTime: new Date(now.getTime() + 14 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1611186871348-b1ce696e52c9?w=800&q=80',
        imageAlt: 'Apple',
        imageFilter: 'grayscale(1) contrast(2) brightness(1.0)',
        featured: false,
        volume: 201000,
        words: [],
      },
      {
        id: 'google-io',
        category: 'TECH EVENTS',
        title: 'GOOGLE I/O CONFERENCE',
        eventTime: new Date(now.getTime() + 15 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1573804633927-bfcbcd909acd?w=800&q=80',
        imageAlt: 'Google',
        imageFilter: 'grayscale(1) contrast(1.7) brightness(1.0)',
        featured: false,
        volume: 189000,
        words: [],
      },
      {
        id: 'tesla-earnings',
        category: 'EARNINGS',
        title: 'TESLA Q4 EARNINGS',
        eventTime: new Date(now.getTime() + 16 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=800&q=80',
        imageAlt: 'Tesla',
        imageFilter: 'grayscale(1) contrast(1.9) brightness(0.95)',
        featured: false,
        volume: 134000,
        words: [],
      },
      {
        id: 'nvidia-earnings',
        category: 'EARNINGS',
        title: 'NVIDIA EARNINGS CALL',
        eventTime: new Date(now.getTime() + 17 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1591488320449-011701bb6704?w=800&q=80',
        imageAlt: 'Technology',
        imageFilter: 'grayscale(1) contrast(1.8) brightness(0.9)',
        featured: false,
        volume: 167000,
        words: [],
      },
      {
        id: 'musk-reddit-ama',
        category: 'REDDIT AMA',
        title: 'ELON MUSK AMA',
        eventTime: new Date(now.getTime() + 18 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1616509091215-57bbece93654?w=800&q=80',
        imageAlt: 'Reddit',
        imageFilter: 'grayscale(1) contrast(1.6) brightness(0.95)',
        featured: false,
        volume: 143000,
        words: [],
      },
      {
        id: 'obama-ama',
        category: 'REDDIT AMA',
        title: 'OBAMA REDDIT AMA',
        eventTime: new Date(now.getTime() + 19 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1540910419892-4a36d2c3266c?w=800&q=80',
        imageAlt: 'Obama',
        imageFilter: 'grayscale(1) contrast(2) brightness(1.0)',
        featured: false,
        volume: 198000,
        words: [],
      },
      {
        id: 'nyt-article',
        category: 'ARTICLES',
        title: 'NYT FRONT PAGE WORD COUNT',
        eventTime: new Date(now.getTime() + 20 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800&q=80',
        imageAlt: 'Newspaper',
        imageFilter: 'grayscale(1) contrast(2.2) brightness(0.9)',
        featured: false,
        volume: 54000,
        words: [],
      },
      {
        id: 'biden-speech-timing',
        category: 'TIMINGS',
        title: 'BIDEN SPEECH DURATION',
        eventTime: new Date(now.getTime() + 21 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=800&q=80',
        imageAlt: 'Biden speech',
        imageFilter: 'grayscale(1) contrast(1.9) brightness(1.0)',
        featured: false,
        volume: 78000,
        words: [],
      },
      {
        id: 'got-finale',
        category: 'TV SHOWS',
        title: 'HOUSE OF DRAGON S3E1',
        eventTime: new Date(now.getTime() + 22 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=800&q=80',
        imageAlt: 'TV show',
        imageFilter: 'grayscale(1) contrast(1.8) brightness(0.85)',
        featured: false,
        volume: 112000,
        words: [],
      },
      {
        id: 'minecraft-video',
        category: 'YOUTUBE',
        title: 'DREAM MINECRAFT VIDEO',
        eventTime: new Date(now.getTime() + 23 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1552820728-8b83bb6b773f?w=800&q=80',
        imageAlt: 'Minecraft',
        imageFilter: 'grayscale(1) contrast(1.7) brightness(0.9)',
        featured: false,
        volume: 187000,
        words: [],
      },
    ]
  }, [])

  // Filter markets based on selected category
  const markets = useMemo(() => {
    return allMarkets
  }, [allMarkets])

  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden">
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
            <Header />
            <main className="flex-1 py-5">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {markets.map((market, index) => (
                  <MarketCard key={index} {...market} />
                ))}
              </div>
            </main>
            <Footer />
          </div>
        </div>
      </div>
    </div>
  )
}

