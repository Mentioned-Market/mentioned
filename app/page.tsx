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
        category: 'Speeches',
        title: "Trump Iowa Rally",
        eventTime: new Date(now.getTime() + 2 * 60 * 60 * 1000),
        imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCPwsL0smxRVROhCkwShqqarIa-4xnAdVdAomChQJ_T5mRI0s77w-xoaIXYP2m8tRl-uEGpY2db-WBf6yZIfORA6Azp8_G7mOSTRPFRKHgyuo-4Ltlj_aMHH0t0PkSvdDO95rJOZpBgoS7jAKqkQ_7C86iSDgLJC9vDfV4YSshAaEhuIv2qI0WDcGs0VSLKNYTrz72KduCuH-fH8XBkROiM1zDK2dJlV6R0sCiMjP_Y3Ml19Uglhnihkb8ZD1prCuWa0i_wip0TXSI',
        imageAlt: 'Donald Trump',

        featured: false,
        volume: 125000,
        words: [
          { word: 'Immigration', yesPrice: '0.72', noPrice: '0.28' },
          { word: 'Economy', yesPrice: '0.65', noPrice: '0.35' },
          { word: 'China', yesPrice: '0.58', noPrice: '0.42' },
          { word: 'Border', yesPrice: '0.81', noPrice: '0.19' },
          { word: 'Taxes', yesPrice: '0.45', noPrice: '0.55' },
          { word: 'Jobs', yesPrice: '0.67', noPrice: '0.33' },
        ],
      },
      {
        id: 'drake-album',
        category: 'Music',
        title: 'Drake - For All the Dogs',
        eventTime: new Date(now.getTime() + 4 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&q=80',
        imageAlt: 'Music recording',

        featured: false,
        volume: 89000,
        words: [
          { word: 'Love', yesPrice: '0.89', noPrice: '0.11' },
          { word: 'Money', yesPrice: '0.76', noPrice: '0.24' },
          { word: 'Girl', yesPrice: '0.82', noPrice: '0.18' },
          { word: 'Pain', yesPrice: '0.54', noPrice: '0.46' },
          { word: 'Trust', yesPrice: '0.61', noPrice: '0.39' },
          { word: 'Fame', yesPrice: '0.73', noPrice: '0.27' },
        ],
      },
      {
        id: 'rogan-musk',
        category: 'Podcasts',
        title: 'Joe Rogan EP #2054',
        eventTime: new Date(now.getTime() + 5 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1478737270239-2f02b77fc618?w=800&q=80',
        imageAlt: 'Podcast microphone',

        featured: false,
        volume: 156000,
        words: [
          { word: 'Tesla', yesPrice: '0.91', noPrice: '0.09' },
          { word: 'SpaceX', yesPrice: '0.87', noPrice: '0.13' },
          { word: 'AI', yesPrice: '0.94', noPrice: '0.06' },
          { word: 'Mars', yesPrice: '0.68', noPrice: '0.32' },
          { word: 'Twitter', yesPrice: '0.79', noPrice: '0.21' },
          { word: 'Future', yesPrice: '0.85', noPrice: '0.15' },
        ],
      },
      {
        id: 'colbert-show',
        category: 'TV Shows',
        title: 'The Late Show - December 30',
        eventTime: new Date(now.getTime() + 6 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?w=800&q=80',
        imageAlt: 'TV studio',

        featured: false,
        volume: 67000,
        words: [
          { word: 'Trump', yesPrice: '0.96', noPrice: '0.04' },
          { word: 'Politics', yesPrice: '0.88', noPrice: '0.12' },
          { word: 'Election', yesPrice: '0.71', noPrice: '0.29' },
          { word: 'Congress', yesPrice: '0.59', noPrice: '0.41' },
          { word: 'Joke', yesPrice: '0.93', noPrice: '0.07' },
          { word: 'Audience', yesPrice: '0.84', noPrice: '0.16' },
        ],
      },
      {
        id: 'dune-script',
        category: 'Movies',
        title: 'Dune: Part Three Premiere',
        eventTime: new Date(now.getTime() + 8 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?w=800&q=80',
        imageAlt: 'Movie theater',

        featured: false,
        volume: 98000,
        words: [
          { word: 'Spice', yesPrice: '0.91', noPrice: '0.09' },
          { word: 'Desert', yesPrice: '0.87', noPrice: '0.13' },
          { word: 'Prophecy', yesPrice: '0.74', noPrice: '0.26' },
          { word: 'Emperor', yesPrice: '0.82', noPrice: '0.18' },
          { word: 'Worm', yesPrice: '0.69', noPrice: '0.31' },
          { word: 'Power', yesPrice: '0.78', noPrice: '0.22' },
        ],
      },
      {
        id: 'mr-beast-video',
        category: 'YouTube',
        title: 'MrBeast $1M Challenge',
        eventTime: new Date(now.getTime() + 9 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=800&q=80',
        imageAlt: 'YouTube content',

        featured: false,
        volume: 234000,
        words: [
          { word: 'Insane', yesPrice: '0.89', noPrice: '0.11' },
          { word: 'Crazy', yesPrice: '0.92', noPrice: '0.08' },
          { word: 'Dollar', yesPrice: '0.94', noPrice: '0.06' },
          { word: 'Winner', yesPrice: '0.86', noPrice: '0.14' },
          { word: 'Subscribe', yesPrice: '0.78', noPrice: '0.22' },
          { word: 'Challenge', yesPrice: '0.91', noPrice: '0.09' },
        ],
      },
      {
        id: 'nba-finals-cast',
        category: 'Sports Cast',
        title: 'NBA Finals Game 7',
        eventTime: new Date(now.getTime() + 10 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1504450758481-7338eba7524a?w=800&q=80',
        imageAlt: 'NBA game',

        featured: false,
        volume: 178000,
        words: [
          { word: 'Three', yesPrice: '0.88', noPrice: '0.12' },
          { word: 'Timeout', yesPrice: '0.76', noPrice: '0.24' },
          { word: 'Foul', yesPrice: '0.91', noPrice: '0.09' },
          { word: 'Championship', yesPrice: '0.84', noPrice: '0.16' },
          { word: 'Defense', yesPrice: '0.79', noPrice: '0.21' },
          { word: 'Clutch', yesPrice: '0.67', noPrice: '0.33' },
        ],
      },
      {
        id: 'world-cup-cast',
        category: 'Sports Cast',
        title: 'World Cup Final 2026',
        eventTime: new Date(now.getTime() + 11 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1489944440615-453fc2b6a9a9?w=800&q=80',
        imageAlt: 'World Cup',

        featured: false,
        volume: 145000,
        words: [
          { word: 'Goal', yesPrice: '0.93', noPrice: '0.07' },
          { word: 'Penalty', yesPrice: '0.71', noPrice: '0.29' },
          { word: 'Offside', yesPrice: '0.64', noPrice: '0.36' },
          { word: 'Corner', yesPrice: '0.82', noPrice: '0.18' },
          { word: 'Yellow', yesPrice: '0.77', noPrice: '0.23' },
          { word: 'Champion', yesPrice: '0.86', noPrice: '0.14' },
        ],
      },
      {
        id: 'league-patch',
        category: 'Patch Notes',
        title: 'League of Legends 14.5 Notes',
        eventTime: new Date(now.getTime() + 12 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&q=80',
        imageAlt: 'Gaming',

        featured: false,
        volume: 72000,
        words: [
          { word: 'Nerf', yesPrice: '0.84', noPrice: '0.16' },
          { word: 'Buff', yesPrice: '0.79', noPrice: '0.21' },
          { word: 'Balance', yesPrice: '0.72', noPrice: '0.28' },
          { word: 'Damage', yesPrice: '0.88', noPrice: '0.12' },
          { word: 'Adjusted', yesPrice: '0.91', noPrice: '0.09' },
          { word: 'Rework', yesPrice: '0.56', noPrice: '0.44' },
        ],
      },
      {
        id: 'valorant-patch',
        category: 'Patch Notes',
        title: 'Valorant Episode 8 Act 1',
        eventTime: new Date(now.getTime() + 13 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&q=80',
        imageAlt: 'Valorant',

        featured: false,
        volume: 87000,
        words: [
          { word: 'Agent', yesPrice: '0.87', noPrice: '0.13' },
          { word: 'Weapon', yesPrice: '0.76', noPrice: '0.24' },
          { word: 'Map', yesPrice: '0.68', noPrice: '0.32' },
          { word: 'Ability', yesPrice: '0.92', noPrice: '0.08' },
          { word: 'Fixed', yesPrice: '0.89', noPrice: '0.11' },
          { word: 'Update', yesPrice: '0.94', noPrice: '0.06' },
        ],
      },
      {
        id: 'apple-keynote',
        category: 'Tech Events',
        title: 'Apple WWDC 2025 Keynote',
        eventTime: new Date(now.getTime() + 14 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1611186871348-b1ce696e52c9?w=800&q=80',
        imageAlt: 'Apple',

        featured: false,
        volume: 201000,
        words: [
          { word: 'iPhone', yesPrice: '0.91', noPrice: '0.09' },
          { word: 'Innovation', yesPrice: '0.88', noPrice: '0.12' },
          { word: 'Amazing', yesPrice: '0.94', noPrice: '0.06' },
          { word: 'Revolutionary', yesPrice: '0.73', noPrice: '0.27' },
          { word: 'Privacy', yesPrice: '0.81', noPrice: '0.19' },
          { word: 'Ecosystem', yesPrice: '0.76', noPrice: '0.24' },
        ],
      },
      {
        id: 'google-io',
        category: 'Tech Events',
        title: 'Google I/O 2025 Day 1',
        eventTime: new Date(now.getTime() + 15 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1573804633927-bfcbcd909acd?w=800&q=80',
        imageAlt: 'Google',

        featured: false,
        volume: 189000,
        words: [
          { word: 'AI', yesPrice: '0.96', noPrice: '0.04' },
          { word: 'Android', yesPrice: '0.89', noPrice: '0.11' },
          { word: 'Cloud', yesPrice: '0.74', noPrice: '0.26' },
          { word: 'Search', yesPrice: '0.81', noPrice: '0.19' },
          { word: 'Developer', yesPrice: '0.86', noPrice: '0.14' },
          { word: 'Gemini', yesPrice: '0.92', noPrice: '0.08' },
        ],
      },
      {
        id: 'tesla-earnings',
        category: 'Earnings',
        title: 'Tesla Q4 2024 Earnings Call',
        eventTime: new Date(now.getTime() + 16 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=800&q=80',
        imageAlt: 'Tesla',

        featured: false,
        volume: 134000,
        words: [
          { word: 'Profit', yesPrice: '0.78', noPrice: '0.22' },
          { word: 'Growth', yesPrice: '0.84', noPrice: '0.16' },
          { word: 'Delivery', yesPrice: '0.91', noPrice: '0.09' },
          { word: 'Margin', yesPrice: '0.72', noPrice: '0.28' },
          { word: 'Guidance', yesPrice: '0.88', noPrice: '0.12' },
          { word: 'Production', yesPrice: '0.86', noPrice: '0.14' },
        ],
      },
      {
        id: 'nvidia-earnings',
        category: 'Earnings',
        title: 'Nvidia Q1 2025 Earnings',
        eventTime: new Date(now.getTime() + 17 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1591488320449-011701bb6704?w=800&q=80',
        imageAlt: 'Technology',

        featured: false,
        volume: 167000,
        words: [
          { word: 'Revenue', yesPrice: '0.93', noPrice: '0.07' },
          { word: 'Datacenter', yesPrice: '0.89', noPrice: '0.11' },
          { word: 'Gaming', yesPrice: '0.76', noPrice: '0.24' },
          { word: 'AI', yesPrice: '0.96', noPrice: '0.04' },
          { word: 'Demand', yesPrice: '0.91', noPrice: '0.09' },
          { word: 'Chip', yesPrice: '0.88', noPrice: '0.12' },
        ],
      },
      {
        id: 'musk-reddit-ama',
        category: 'Reddit AMA',
        title: 'Elon Musk AMA - Dec 2024',
        eventTime: new Date(now.getTime() + 18 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1616509091215-57bbece93654?w=800&q=80',
        imageAlt: 'Reddit',

        featured: false,
        volume: 143000,
        words: [
          { word: 'Tesla', yesPrice: '0.91', noPrice: '0.09' },
          { word: 'SpaceX', yesPrice: '0.88', noPrice: '0.12' },
          { word: 'Mars', yesPrice: '0.74', noPrice: '0.26' },
          { word: 'Twitter', yesPrice: '0.82', noPrice: '0.18' },
          { word: 'Crypto', yesPrice: '0.67', noPrice: '0.33' },
          { word: 'Meme', yesPrice: '0.79', noPrice: '0.21' },
        ],
      },
      {
        id: 'obama-ama',
        category: 'Reddit AMA',
        title: 'President Obama AMA 2025',
        eventTime: new Date(now.getTime() + 19 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1540910419892-4a36d2c3266c?w=800&q=80',
        imageAlt: 'Obama',

        featured: false,
        volume: 198000,
        words: [
          { word: 'Healthcare', yesPrice: '0.87', noPrice: '0.13' },
          { word: 'Democracy', yesPrice: '0.91', noPrice: '0.09' },
          { word: 'Climate', yesPrice: '0.84', noPrice: '0.16' },
          { word: 'Hope', yesPrice: '0.78', noPrice: '0.22' },
          { word: 'Change', yesPrice: '0.82', noPrice: '0.18' },
          { word: 'America', yesPrice: '0.93', noPrice: '0.07' },
        ],
      },
      {
        id: 'nyt-article',
        category: 'Articles',
        title: 'NY Times Front Page Jan 1',
        eventTime: new Date(now.getTime() + 20 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800&q=80',
        imageAlt: 'Newspaper',

        featured: false,
        volume: 54000,
        words: [
          { word: 'Crisis', yesPrice: '0.76', noPrice: '0.24' },
          { word: 'Election', yesPrice: '0.83', noPrice: '0.17' },
          { word: 'President', yesPrice: '0.91', noPrice: '0.09' },
          { word: 'Breaking', yesPrice: '0.68', noPrice: '0.32' },
          { word: 'Conflict', yesPrice: '0.72', noPrice: '0.28' },
          { word: 'Economy', yesPrice: '0.88', noPrice: '0.12' },
        ],
      },
      {
        id: 'biden-speech-timing',
        category: 'Timings',
        title: 'Biden State of Union Length',
        eventTime: new Date(now.getTime() + 21 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=800&q=80',
        imageAlt: 'Biden speech',

        featured: false,
        volume: 78000,
        words: [
          { word: '60min', yesPrice: '0.45', noPrice: '0.55' },
          { word: '70min', yesPrice: '0.68', noPrice: '0.32' },
          { word: '80min', yesPrice: '0.72', noPrice: '0.28' },
          { word: '90min', yesPrice: '0.54', noPrice: '0.46' },
          { word: 'Applause', yesPrice: '0.94', noPrice: '0.06' },
          { word: 'Standing', yesPrice: '0.87', noPrice: '0.13' },
        ],
      },
      {
        id: 'got-finale',
        category: 'TV Shows',
        title: 'House of Dragon S3 Finale',
        eventTime: new Date(now.getTime() + 22 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=800&q=80',
        imageAlt: 'TV show',

        featured: false,
        volume: 112000,
        words: [
          { word: 'Dragon', yesPrice: '0.96', noPrice: '0.04' },
          { word: 'Death', yesPrice: '0.88', noPrice: '0.12' },
          { word: 'Battle', yesPrice: '0.91', noPrice: '0.09' },
          { word: 'King', yesPrice: '0.84', noPrice: '0.16' },
          { word: 'Throne', yesPrice: '0.89', noPrice: '0.11' },
          { word: 'Betrayal', yesPrice: '0.76', noPrice: '0.24' },
        ],
      },
      {
        id: 'minecraft-video',
        category: 'YouTube',
        title: 'Dream Minecraft Manhunt #50',
        eventTime: new Date(now.getTime() + 23 * 60 * 60 * 1000),
        imageUrl: 'https://images.unsplash.com/photo-1552820728-8b83bb6b773f?w=800&q=80',
        imageAlt: 'Minecraft',

        featured: false,
        volume: 187000,
        words: [
          { word: 'Speedrun', yesPrice: '0.89', noPrice: '0.11' },
          { word: 'Clutch', yesPrice: '0.82', noPrice: '0.18' },
          { word: 'Diamond', yesPrice: '0.91', noPrice: '0.09' },
          { word: 'Nether', yesPrice: '0.87', noPrice: '0.13' },
          { word: 'Ender', yesPrice: '0.94', noPrice: '0.06' },
          { word: 'Pearl', yesPrice: '0.78', noPrice: '0.22' },
        ],
      },
    ]
  }, [])

  // Filter markets based on selected category
  const markets = useMemo(() => {
    return allMarkets
  }, [allMarkets])

  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
            <Header />
            <main className="flex-1 pt-4 pb-4">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 animate-fade-in">
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

