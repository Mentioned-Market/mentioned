// Float-based LMSR math for virtual (off-chain) prediction markets.
// Same underlying math as the on-chain LMSR in mentionMarket.ts,
// operating on plain numbers instead of bigint fixed-point values.

function logSumExp(a: number, b: number): number {
  const m = Math.max(a, b)
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m))
}

function lmsrCostFn(qYes: number, qNo: number, b: number): number {
  return b * logSumExp(qYes / b, qNo / b)
}

export function virtualImpliedPrice(
  yesQty: number, noQty: number, b: number,
): { yes: number; no: number } {
  if (b === 0) return { yes: 0.5, no: 0.5 }
  const diff = (noQty - yesQty) / b
  const yes = 1 / (1 + Math.exp(diff))
  return { yes, no: 1 - yes }
}

export function virtualBuyCost(
  yesQty: number, noQty: number, side: 'YES' | 'NO', shares: number, b: number,
): number {
  if (shares <= 0) return 0
  const before = lmsrCostFn(yesQty, noQty, b)
  const after = side === 'YES'
    ? lmsrCostFn(yesQty + shares, noQty, b)
    : lmsrCostFn(yesQty, noQty + shares, b)
  return Math.max(0, after - before)
}

export function virtualSellReturn(
  yesQty: number, noQty: number, side: 'YES' | 'NO', shares: number, b: number,
): number {
  if (shares <= 0) return 0
  const before = lmsrCostFn(yesQty, noQty, b)
  const after = side === 'YES'
    ? lmsrCostFn(yesQty - shares, noQty, b)
    : lmsrCostFn(yesQty, noQty - shares, b)
  return Math.max(0, before - after)
}

/**
 * Given a token budget, calculate the maximum shares purchasable via binary search.
 * Uses current implied price to set a reasonable upper bound.
 */
export function sharesForTokens(
  yesQty: number, noQty: number, side: 'YES' | 'NO', tokens: number, b: number,
): number {
  if (tokens <= 0) return 0
  const price = virtualImpliedPrice(yesQty, noQty, b)
  const currentPrice = side === 'YES' ? price.yes : price.no
  const hi = tokens / Math.max(0.01, currentPrice * 0.5)
  let lo = 0
  let upper = hi
  for (let i = 0; i < 60; i++) {
    const mid = (lo + upper) / 2
    virtualBuyCost(yesQty, noQty, side, mid, b) <= tokens ? (lo = mid) : (upper = mid)
  }
  return lo
}
