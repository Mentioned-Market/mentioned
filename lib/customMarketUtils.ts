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

// Public-facing status shown on cards and market detail pages.
// - 'open':               trading active
// - 'pending_resolution': lock reached (or lock_time passed) but outcomes not yet finalised
// - 'resolved':           every word has an outcome, but the market's scheduled lock_time
//                         is still in the future (continuous markets that resolve early,
//                         e.g. "what will @X tweet this week" where all target words land
//                         on day 2 of a 6-day window)
// - 'closed':             every word has an outcome AND lock_time has passed (or is unset)
// - 'cancelled':          terminal cancelled state
export type DisplayStatus = 'open' | 'pending_resolution' | 'resolved' | 'closed' | 'cancelled'

export function getDisplayStatus(market: { status: string; lock_time: string | null }): DisplayStatus {
  if (market.status === 'cancelled') return 'cancelled'
  const lockPassed = market.lock_time ? new Date(market.lock_time) <= new Date() : true
  if (market.status === 'resolved') return lockPassed ? 'closed' : 'resolved'
  if (market.status === 'locked')   return 'pending_resolution'
  if (market.status === 'open')     return lockPassed ? 'pending_resolution' : 'open'
  return 'open'
}

export function getDisplayStatusLabel(ds: DisplayStatus): string {
  switch (ds) {
    case 'open':               return 'Open'
    case 'pending_resolution': return 'Pending Resolution'
    case 'resolved':           return 'Resolved'
    case 'closed':             return 'Closed'
    case 'cancelled':          return 'Cancelled'
  }
}

// Tailwind classes for the floating badge on card image overlays (solid bg on image).
export function getDisplayStatusOverlayClasses(ds: DisplayStatus): string {
  switch (ds) {
    case 'open':               return 'bg-[#F2B71F]/80 text-black'
    case 'pending_resolution': return 'bg-orange-500/80 text-black'
    case 'resolved':           return 'bg-blue-500/80 text-white'
    case 'closed':             return 'bg-black/60 text-neutral-300'
    case 'cancelled':          return 'bg-red-500/70 text-white'
  }
}

// Tailwind classes for the inline pill in the market detail meta bar (transparent bg).
export function getDisplayStatusPillClasses(ds: DisplayStatus): string {
  switch (ds) {
    case 'open':               return 'bg-[#F2B71F]/15 text-[#F2B71F]'
    case 'pending_resolution': return 'bg-orange-500/15 text-orange-400'
    case 'resolved':           return 'bg-blue-500/15 text-blue-400'
    case 'closed':             return 'bg-white/10 text-neutral-400'
    case 'cancelled':          return 'bg-red-500/15 text-red-400'
  }
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
