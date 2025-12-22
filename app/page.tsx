'use client'

import { useMemo } from 'react'
import Header from '@/components/Header'
import Ticker from '@/components/Ticker'
import MarketCard from '@/components/MarketCard'
import Footer from '@/components/Footer'

export default function Home() {
  // Calculate event times (example: 2 hours from now for Trump, 4 hours for Starmer)
  const markets = useMemo(() => {
    const now = new Date()
    const trumpEventTime = new Date(now.getTime() + 2 * 60 * 60 * 1000) // 2 hours from now
    const starmerEventTime = new Date(now.getTime() + 4 * 60 * 60 * 1000) // 4 hours from now
    const chelseaEventTime = new Date(now.getTime() + 6 * 60 * 60 * 1000) // 6 hours from now
    const leagueEventTime = new Date(now.getTime() + 8 * 60 * 60 * 1000) // 8 hours from now

    return [
    {
      id: 'trump-speech',
      category: 'POLITICS',
      title: "TRUMP'S SPEECH",
      eventTime: trumpEventTime,
      imageUrl:
        'https://lh3.googleusercontent.com/aida-public/AB6AXuCPwsL0smxRVROhCkwShqqarIa-4xnAdVdAomChQJ_T5mRI0s77w-xoaIXYP2m8tRl-uEGpY2db-WBf6yZIfORA6Azp8_G7mOSTRPFRKHgyuo-4Ltlj_aMHH0t0PkSvdDO95rJOZpBgoS7jAKqkQ_7C86iSDgLJC9vDfV4YSshAaEhuIv2qI0WDcGs0VSLKNYTrz72KduCuH-fH8XBkROiM1zDK2dJlV6R0sCiMjP_Y3Ml19Uglhnihkb8ZD1prCuWa0i_wip0TXSI',
      imageAlt: 'Glitched and pixelated image of Donald Trump',
      imageFilter: 'grayscale(1) contrast(2) brightness(1.2)',
      featured: false,
      words: [
        { word: 'IMMIGRATION', yesPrice: '0.72', noPrice: '0.28' },
        { word: 'ECONOMY', yesPrice: '0.65', noPrice: '0.35' },
        { word: 'CHINA', yesPrice: '0.58', noPrice: '0.42' },
        { word: 'BORDER', yesPrice: '0.81', noPrice: '0.19' },
        { word: 'TAXES', yesPrice: '0.45', noPrice: '0.55' },
        { word: 'JOBS', yesPrice: '0.67', noPrice: '0.33' },
        { word: 'TRADE', yesPrice: '0.52', noPrice: '0.48' },
        { word: 'AMERICA', yesPrice: '0.89', noPrice: '0.11' },
        { word: 'FREEDOM', yesPrice: '0.76', noPrice: '0.24' },
        { word: 'VICTORY', yesPrice: '0.83', noPrice: '0.17' },
      ],
    },
    {
      id: 'starmer-qa',
      category: 'POLITICS',
      title: 'KEIR STARMER PRIME MINISTER Q&A',
      eventTime: starmerEventTime,
      imageUrl:
        'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=800&q=80',
      imageAlt: 'Black and white image of Keir Starmer',
      imageFilter: 'grayscale(1) contrast(1.8) brightness(0.9)',
      featured: true,
      words: [
        { word: 'BREXIT', yesPrice: '0.15', noPrice: '0.85' },
        { word: 'NHS', yesPrice: '0.78', noPrice: '0.22' },
        { word: 'HOUSING', yesPrice: '0.62', noPrice: '0.38' },
        { word: 'CLIMATE', yesPrice: '0.71', noPrice: '0.29' },
        { word: 'EDUCATION', yesPrice: '0.68', noPrice: '0.32' },
        { word: 'INFLATION', yesPrice: '0.55', noPrice: '0.45' },
      ],
    },
    {
      id: 'chelsea-man-city',
      category: 'SPORTS',
      title: 'CHELSEA VS MAN CITY',
      eventTime: chelseaEventTime,
      imageUrl:
        'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800&q=80',
      imageAlt: 'Black and white image of football stadium',
      imageFilter: 'grayscale(1) contrast(2) brightness(1.0)',
      featured: false,
      words: [
        { word: 'GOAL', yesPrice: '0.45', noPrice: '0.55' },
        { word: 'PENALTY', yesPrice: '0.32', noPrice: '0.68' },
        { word: 'RED CARD', yesPrice: '0.28', noPrice: '0.72' },
        { word: 'HAT TRICK', yesPrice: '0.15', noPrice: '0.85' },
        { word: 'OVERTIME', yesPrice: '0.38', noPrice: '0.62' },
      ],
    },
    {
      id: 'league-patch',
      category: 'GAMING',
      title: 'LEAGUE PATCH NOTES',
      eventTime: leagueEventTime,
      imageUrl:
        'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&q=80',
      imageAlt: 'Black and white image of gaming setup',
      imageFilter: 'grayscale(1) contrast(1.5) brightness(0.8)',
      featured: false,
      className: '-mt-16 md:mt-0 lg:ml-8 lg:-mr-8',
      words: [
        { word: 'NERF', yesPrice: '0.42', noPrice: '0.58' },
        { word: 'BUFF', yesPrice: '0.38', noPrice: '0.62' },
        { word: 'NEW CHAMPION', yesPrice: '0.25', noPrice: '0.75' },
        { word: 'RANKED', yesPrice: '0.51', noPrice: '0.49' },
        { word: 'SKIN', yesPrice: '0.67', noPrice: '0.33' },
      ],
    }
    ]
  }, [])

  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden">
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
            <Header />
            <Ticker />
            <main className="flex-1 py-5">
              <div className="flex items-center gap-2 p-3 border-y border-white/50 overflow-x-auto">
                <button className="flex h-8 shrink-0 items-center justify-center bg-white text-black px-4 font-bold text-sm uppercase hover:bg-black hover:text-white border border-white">
                  [ALL]
                </button>
                <button className="flex h-8 shrink-0 items-center justify-center border border-white px-4 font-bold text-sm uppercase hover:bg-white hover:text-black hover:border-white">
                  [POLITICS]
                </button>
                <button className="flex h-8 shrink-0 items-center justify-center border border-white px-4 font-bold text-sm uppercase hover:bg-white hover:text-black hover:border-white">
                  [SPORTS]
                </button>
                <button className="flex h-8 shrink-0 items-center justify-center border border-white px-4 font-bold text-sm uppercase hover:bg-white hover:text-black hover:border-white">
                  [GAMING]
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-0 mt-5">
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

