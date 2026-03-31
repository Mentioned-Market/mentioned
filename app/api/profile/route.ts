import { NextRequest, NextResponse } from 'next/server'
import { getProfile, upsertProfile, updatePfpEmoji, getUnlockedAchievements, ensureReferralCode, getReferralStats } from '@/lib/db'
import { tryUnlockAchievement, ACHIEVEMENT_MAP } from '@/lib/achievements'
import { checkSlurs } from '@/lib/chatFilter'

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet')
  if (!wallet) {
    return NextResponse.json({ error: 'wallet is required' }, { status: 400 })
  }

  const profile = await getProfile(wallet)

  // Ensure referral code exists and fetch stats
  let referralCode: string | null = null
  let referralStats = { referralCount: 0, referredBy: null as string | null, bonusPointsEarned: 0 }
  if (profile) {
    try {
      [referralCode, referralStats] = await Promise.all([
        ensureReferralCode(wallet),
        getReferralStats(wallet),
      ])
    } catch (err) {
      console.error('Referral code/stats error:', err)
    }
  }

  return NextResponse.json({
    username: profile?.username ?? null,
    pfpEmoji: profile?.pfp_emoji ?? null,
    discordId: profile?.discord_id ?? null,
    discordUsername: profile?.discord_username ?? null,
    referralCode,
    referralCount: referralStats.referralCount,
    referredBy: referralStats.referredBy,
    bonusPointsEarned: referralStats.bonusPointsEarned,
  })
}

export async function PUT(req: NextRequest) {
  const body = await req.json()
  const { wallet, username } = body as { wallet?: string; username?: string }

  if (!wallet || !username) {
    return NextResponse.json({ error: 'wallet and username are required' }, { status: 400 })
  }

  const trimmed = username.trim()

  if (!USERNAME_RE.test(trimmed)) {
    return NextResponse.json(
      { error: 'Username must be 3-20 characters, letters/numbers/underscores only' },
      { status: 400 },
    )
  }

  if (checkSlurs(trimmed)) {
    return NextResponse.json({ error: 'Username contains prohibited language' }, { status: 400 })
  }

  try {
    await upsertProfile(wallet, trimmed)

    // Fire-and-forget achievement — but collect result for toast
    const newAchievements: { id: string; emoji: string; title: string; points: number }[] = []
    try {
      const ach = await tryUnlockAchievement(wallet, 'set_profile')
      if (ach) newAchievements.push({ id: ach.id, emoji: ach.emoji, title: ach.title, points: ach.points })
    } catch (err) {
      console.error('Achievement error (nickname):', err)
    }

    return NextResponse.json({ success: true, newAchievements })
  } catch (err: unknown) {
    const msg = (err as Error).message || ''
    if (msg.includes('user_profiles_username_key')) {
      return NextResponse.json({ error: 'Username is already taken' }, { status: 409 })
    }
    console.error('Profile upsert error:', err)
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { wallet, pfpEmoji } = body as { wallet?: string; pfpEmoji?: string | null }

  if (!wallet) {
    return NextResponse.json({ error: 'wallet is required' }, { status: 400 })
  }

  // Validate: pfpEmoji must be null (clear) or an emoji from an unlocked achievement
  if (pfpEmoji !== null && pfpEmoji !== undefined) {
    const unlocked = await getUnlockedAchievements(wallet)
    const unlockedIds = new Set(unlocked.map(u => u.achievement_id))
    const matchingAch = Object.values(ACHIEVEMENT_MAP).find(a => a.emoji === pfpEmoji)
    if (!matchingAch || !unlockedIds.has(matchingAch.id)) {
      return NextResponse.json({ error: 'You must unlock this achievement first' }, { status: 403 })
    }
  }

  try {
    await updatePfpEmoji(wallet, pfpEmoji ?? null)

    const newAchievements: { id: string; emoji: string; title: string; points: number }[] = []

    return NextResponse.json({ success: true, pfpEmoji: pfpEmoji ?? null, newAchievements })
  } catch (err) {
    console.error('PFP update error:', err)
    return NextResponse.json({ error: 'Failed to update profile picture' }, { status: 500 })
  }
}
