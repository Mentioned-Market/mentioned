import { NextRequest, NextResponse } from 'next/server'
import {
  ensureReferralCode,
  getReferralStats,
  getReferredUsers,
  getWalletByReferralCode,
  applyReferral,
  getReferrer,
} from '@/lib/db'

/**
 * GET /api/referral?wallet=xxx — Get referral stats + ensure code exists
 */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet')
  if (!wallet) {
    return NextResponse.json({ error: 'wallet is required' }, { status: 400 })
  }

  const [code, stats, referredUsers] = await Promise.all([
    ensureReferralCode(wallet),
    getReferralStats(wallet),
    getReferredUsers(wallet),
  ])

  return NextResponse.json({
    referralCode: code,
    referralCount: stats.referralCount,
    referredBy: stats.referredBy,
    bonusPointsEarned: stats.bonusPointsEarned,
    referredUsers,
  })
}

/**
 * POST /api/referral — Apply a referral code to a wallet (one-time)
 * Body: { wallet: string, code: string }
 */
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { wallet, code } = body as { wallet?: string; code?: string }

  if (!wallet || !code) {
    return NextResponse.json({ error: 'wallet and code are required' }, { status: 400 })
  }

  // Check if already referred
  const existingReferrer = await getReferrer(wallet)
  if (existingReferrer) {
    return NextResponse.json({ error: 'You have already used a referral code' }, { status: 409 })
  }

  // Look up the referrer
  const referrerWallet = await getWalletByReferralCode(code)
  if (!referrerWallet) {
    return NextResponse.json({ error: 'Invalid referral code' }, { status: 404 })
  }

  if (referrerWallet === wallet) {
    return NextResponse.json({ error: 'You cannot refer yourself' }, { status: 400 })
  }

  // Prevent circular referrals (they already referred you)
  const referrerReferrer = await getReferrer(referrerWallet)
  if (referrerReferrer === wallet) {
    return NextResponse.json({ error: 'You cannot refer someone who already referred you' }, { status: 400 })
  }

  const applied = await applyReferral(wallet, referrerWallet)
  if (!applied) {
    return NextResponse.json({ error: 'Failed to apply referral' }, { status: 409 })
  }

  return NextResponse.json({ success: true, referredBy: referrerWallet })
}
