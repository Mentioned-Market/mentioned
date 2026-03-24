// Shared utilities for custom markets (used by both server scoring and client preview)

export type SentimentBand = 'unpopular' | 'split' | 'popular'

export interface BandResult {
  band: SentimentBand
  yesPoints: number
  noPoints: number
}

/**
 * Classify sentiment into scoring bands.
 * <40% YES = YES is unpopular (150 if correct), NO is popular (50 if correct)
 * 40-60% = split (100 either way)
 * >60% YES = YES is popular (50 if correct), NO is unpopular (150 if correct)
 */
export function getSentimentBand(yesPct: number): BandResult {
  if (yesPct < 40) return { band: 'unpopular', yesPoints: 150, noPoints: 50 }
  if (yesPct > 60) return { band: 'popular', yesPoints: 50, noPoints: 150 }
  return { band: 'split', yesPoints: 100, noPoints: 100 }
}

export function getPointsForPrediction(yesPct: number, prediction: boolean): number {
  const band = getSentimentBand(yesPct)
  return prediction ? band.yesPoints : band.noPoints
}

export const INCORRECT_PENALTY = 100
export const PARTICIPATION_BONUS = 25
export const PARTICIPATION_THRESHOLD = 4

export type CustomMarketStatus = 'draft' | 'open' | 'locked' | 'resolved' | 'cancelled'

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['open', 'cancelled'],
  open: ['locked', 'cancelled'],
  locked: ['resolved', 'cancelled'],
  resolved: [],
  cancelled: [],
}

export function isValidStatusTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'draft': return 'text-amber-400'
    case 'open': return 'text-green-400'
    case 'locked': return 'text-orange-400'
    case 'resolved': return 'text-blue-400'
    case 'cancelled': return 'text-red-400'
    default: return 'text-gray-400'
  }
}

export function getStatusLabel(status: string): string {
  switch (status) {
    case 'draft': return 'Draft'
    case 'open': return 'Open'
    case 'locked': return 'Locked'
    case 'resolved': return 'Resolved'
    case 'cancelled': return 'Cancelled'
    default: return status
  }
}

export function isMarketOpen(market: { status: string; lock_time: string | null }): boolean {
  if (market.status !== 'open') return false
  if (market.lock_time && new Date(market.lock_time) <= new Date()) return false
  return true
}
