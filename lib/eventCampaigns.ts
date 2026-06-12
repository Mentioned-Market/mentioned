// ── Event funding campaigns (real-funds giveaways) ──────────────────────────
//
// A campaign hands out pre-generated single-use codes (see event_claim_codes)
// that credit a fresh wallet with real USDC + a little SOL so a new user can
// place a trade at an event. The cluster (mainnet/devnet), USDC mint, RPC and
// decimals all follow lib/solanaConfig, so funded balances always match the
// paid markets the user trades on — nothing here is cluster-specific.
//
// SECURITY: amounts and the recipient are decided server-side from this config
// and the authenticated session. They are NEVER taken from client input.
//
// OPERATING SWITCHES (no redeploy needed for the dates):
//   - `enabled`  : master kill switch. Flip to false to disable instantly.
//   - start/end  : the only window in which codes can be redeemed.
// The budget cap is the number of codes generated for the campaign, not a field
// here: N codes = at most N funded wallets.

export interface EventCampaign {
  /** URL slug, e.g. "berlinsummit" → /promo/berlinsummit (and the /berlinsummit vanity rewrite). */
  slug: string
  /** Event name shown on the landing page. */
  title: string
  /** Human-readable amount for landing copy, e.g. "$2 + a little SOL". */
  displayAmount: string
  /** Master on/off switch. */
  enabled: boolean
  /** ISO timestamps bounding when codes can be redeemed. */
  startsAt: string
  endsAt: string
  /** USDC sent per claim, in base units (6 decimals). 2_000_000n = 2 USDC. */
  usdcBaseUnits: bigint
  /**
   * SOL sent per claim, in lamports. Each NEW word a user trades creates a token
   * account costing ~0.00204 SOL of rent (TOKEN_ACCOUNT_RENT_LAMPORTS), on top of
   * tx + priority fees. 0.02 SOL covers ~6-8 word-trades with congestion margin;
   * bump to 30_000_000n (0.03) for heavy multi-word trading.
   */
  lamports: bigint
  /** Where to send the user after a successful claim. */
  redirectPath: string
}

const CAMPAIGNS: EventCampaign[] = [
  {
    slug: 'berlinsummit',
    title: 'Berlin Summit',
    displayAmount: '$2 + a little SOL',
    enabled: true,
    // Window covers testing now through the event weekend. Adjust as needed;
    // `enabled` is the instant kill switch if anything looks wrong on-site.
    startsAt: '2026-06-12T00:00:00Z',
    endsAt: '2026-06-16T00:00:00Z',
    usdcBaseUnits: 2_000_000n, // 2 USDC
    lamports: 20_000_000n, // 0.02 SOL — rent for several word token accounts + fees
    redirectPath: '/markets',
  },
]

export function getCampaign(slug: string): EventCampaign | null {
  return CAMPAIGNS.find((c) => c.slug === slug) ?? null
}

/** True only when the campaign is enabled AND inside its redemption window. */
export function isCampaignActive(c: EventCampaign): boolean {
  if (!c.enabled) return false
  const now = Date.now()
  const start = Date.parse(c.startsAt)
  const end = Date.parse(c.endsAt)
  return now >= start && now < end
}
