// Shared activity type definitions. Server code (API routes, webhook, achievement
// unlock) emits rows using these types; client code (feed page, activity cards)
// reads them. Adding a new activity type = extend the union, wire an emission
// site, and register a renderer in components/feed/activityRegistry.tsx.

export type ActivityType =
  | 'polymarket_trade'
  | 'onchain_trade'
  | 'free_trade'
  | 'achievement_unlocked'

export interface PolymarketTradeMeta {
  eventId: string
  marketId: string
  marketTitle: string | null
  isYes: boolean
  isBuy: boolean
  side: string
  amountUsd: string
}

export interface OnchainTradeMeta {
  marketId: string
  wordIndex: number
  direction: number // 0 = YES, 1 = NO
  isBuy: boolean
  quantity: number
  cost: number
  impliedPrice: number
}

export interface FreeTradeMeta {
  marketId: number
  marketTitle: string
  marketSlug: string | null
  wordId: number
  word: string
  action: 'buy' | 'sell'
  side: 'YES' | 'NO'
  shares: number
  cost: number
  yesPrice: number
  noPrice: number
}

export interface AchievementUnlockedMeta {
  achievementId: string
  emoji: string
  title: string
  points: number
}

export type ActivityMetadata =
  | ({ type: 'polymarket_trade' } & PolymarketTradeMeta)
  | ({ type: 'onchain_trade' } & OnchainTradeMeta)
  | ({ type: 'free_trade' } & FreeTradeMeta)
  | ({ type: 'achievement_unlocked' } & AchievementUnlockedMeta)

// Row shape delivered to the client by /api/feed
export interface FeedItem {
  id: string
  actorWallet: string
  actorUsername: string | null
  actorPfpEmoji: string | null
  createdAt: string
  activity: ActivityMetadata
}
