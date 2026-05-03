// Competition window: May 4 00:00 UTC – May 18 00:00 UTC (exclusive end)
// Update these dates for future competition runs.
export const COMP_START = new Date('2026-05-04T00:00:00.000Z')
export const COMP_END   = new Date('2026-05-18T00:00:00.000Z')

export function isCompActive(): boolean {
  const now = new Date()
  return now >= COMP_START && now < COMP_END
}

export function isCompUpcoming(): boolean {
  return new Date() < COMP_START
}

export function isCompFinished(): boolean {
  return new Date() >= COMP_END
}
