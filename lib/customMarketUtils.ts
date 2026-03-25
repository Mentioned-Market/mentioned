// Shared utilities for custom markets (used by both server scoring and client preview)

import { virtualSellReturn } from './virtualLmsr'

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

/**
 * Each correct share pays out 1 token at resolution.
 */
export function estimatePotentialPayout(shares: number): number {
  return shares
}

/**
 * Preview tokens returned from selling shares at current pool state.
 */
export function estimateSellReturn(
  yesQty: number, noQty: number, side: 'YES' | 'NO', shares: number, b: number,
): number {
  return virtualSellReturn(yesQty, noQty, side, shares, b)
}
