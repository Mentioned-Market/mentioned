import { NextRequest, NextResponse } from 'next/server'
import {
  ensureReferralCode,
  getReferralStats,
  getReferredUsers,
  getWalletByReferralCode,
  applyReferral,
  getReferrer,
} from '@/lib/db'
import { tryUnlockAchievement } from '@/lib/achievements'
import { getVerifiedWallet } from '@/lib/walletAuth'

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
  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const body = await req.json()
  const { code } = body as { code?: string }

  if (!code) {
    return NextResponse.json({ error: 'code is required' }, { status: 400 })
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

  // Award "refer a friend" achievement to the referrer (fire-and-forget)
  tryUnlockAchievement(referrerWallet, 'refer_friend').catch(err =>
    console.error('Achievement error (referral):', err)
  )

  return NextResponse.json({ success: true, referredBy: referrerWallet })
}
