import { NextRequest, NextResponse } from 'next/server'
import { getVerifiedWallet } from '@/lib/walletAuth'
import { insertFeedback, hasFeedbackSubmitted } from '@/lib/db'
import { insertPointEvent } from '@/lib/db'

const MAX_LENGTH = 1000

function sanitize(text: string): string {
  return text.replace(/@(everyone|here)/gi, '[at-$1]').slice(0, MAX_LENGTH)
}

export async function GET(req: NextRequest) {
  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ submitted: false })
  }
  const submitted = await hasFeedbackSubmitted(wallet)
  return NextResponse.json({ submitted })
}

export async function POST(req: NextRequest) {
  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { honestThoughts, sadIfGone, improvements, realMoney, extra } = body as Record<string, string>

  if (!honestThoughts?.trim() || honestThoughts.trim().length < 20) {
    return NextResponse.json({ error: 'Your thoughts must be at least 20 characters' }, { status: 400 })
  }
  if (!sadIfGone?.trim()) {
    return NextResponse.json({ error: 'Please answer the product satisfaction question' }, { status: 400 })
  }
  if (!improvements?.trim() || improvements.trim().length < 20) {
    return NextResponse.json({ error: 'Your improvements must be at least 20 characters' }, { status: 400 })
  }
  if (!realMoney?.trim()) {
    return NextResponse.json({ error: 'Please answer the real money question' }, { status: 400 })
  }

  const VALID_SAD_IF_GONE = ['very_disappointed', 'somewhat_disappointed', 'not_disappointed']
  const VALID_REAL_MONEY = ['definitely', 'maybe', 'not_likely']

  if (!VALID_SAD_IF_GONE.includes(sadIfGone)) {
    return NextResponse.json({ error: 'Invalid option selected' }, { status: 400 })
  }
  if (!VALID_REAL_MONEY.includes(realMoney)) {
    return NextResponse.json({ error: 'Invalid option selected' }, { status: 400 })
  }

  const inserted = await insertFeedback(wallet, {
    honestThoughts: sanitize(honestThoughts.trim()),
    sadIfGone,
    improvements: sanitize(improvements.trim()),
    realMoney,
    extra: extra?.trim() ? sanitize(extra.trim()) : undefined,
  })

  if (!inserted) {
    // ON CONFLICT returned nothing — already submitted
    return NextResponse.json({ error: 'You have already submitted feedback', alreadySubmitted: true }, { status: 409 })
  }

  // Award 50 points — deduped by ref_id so safe to call even on retry
  let pointsAwarded = 0
  try {
    const awarded = await insertPointEvent(wallet, 'feedback_submitted', 100, 'feedback_v1')
    if (awarded) pointsAwarded = awarded
  } catch (err) {
    console.error('Points award error (feedback):', err)
  }

  return NextResponse.json({ success: true, pointsAwarded })
}
