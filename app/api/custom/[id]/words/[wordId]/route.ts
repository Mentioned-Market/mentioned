import { NextRequest, NextResponse } from 'next/server'
import { updateCustomMarketWord } from '@/lib/db'
import { isAdmin } from '@/lib/adminAuth'
import { getVerifiedWallet } from '@/lib/walletAuth'

const MAX_VARIANTS = 16
const MAX_VARIANT_LENGTH = 64

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; wordId: string }> },
): Promise<NextResponse> {
  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!isAdmin(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { id, wordId } = await params
  const marketId = parseInt(id, 10)
  const wordIdNum = parseInt(wordId, 10)
  if (!Number.isFinite(marketId) || !Number.isFinite(wordIdNum)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body: {
    mentionThreshold?: unknown
    matchVariants?: unknown
    pendingResolution?: unknown
    autoLockEnabled?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const patch: {
    mentionThreshold?: number
    matchVariants?: string[]
    pendingResolution?: boolean
    autoLockEnabled?: boolean
  } = {}

  if (body.mentionThreshold !== undefined) {
    const t = Number(body.mentionThreshold)
    if (!Number.isInteger(t) || t < 1 || t > 1000) {
      return NextResponse.json(
        { error: 'mentionThreshold must be an integer between 1 and 1000' },
        { status: 400 },
      )
    }
    patch.mentionThreshold = t
  }

  if (body.matchVariants !== undefined) {
    if (!Array.isArray(body.matchVariants)) {
      return NextResponse.json({ error: 'matchVariants must be an array' }, { status: 400 })
    }
    if (body.matchVariants.length > MAX_VARIANTS) {
      return NextResponse.json(
        { error: `matchVariants may hold at most ${MAX_VARIANTS} entries` },
        { status: 400 },
      )
    }
    const cleaned: string[] = []
    for (const v of body.matchVariants) {
      if (typeof v !== 'string') {
        return NextResponse.json({ error: 'matchVariants entries must be strings' }, { status: 400 })
      }
      const trimmed = v.trim()
      if (!trimmed) continue
      if (trimmed.length > MAX_VARIANT_LENGTH) {
        return NextResponse.json(
          { error: `Variant too long (max ${MAX_VARIANT_LENGTH} chars)` },
          { status: 400 },
        )
      }
      cleaned.push(trimmed)
    }
    patch.matchVariants = cleaned
  }

  if (body.pendingResolution !== undefined) {
    if (typeof body.pendingResolution !== 'boolean') {
      return NextResponse.json({ error: 'pendingResolution must be a boolean' }, { status: 400 })
    }
    patch.pendingResolution = body.pendingResolution
  }

  if (body.autoLockEnabled !== undefined) {
    if (typeof body.autoLockEnabled !== 'boolean') {
      return NextResponse.json({ error: 'autoLockEnabled must be a boolean' }, { status: 400 })
    }
    patch.autoLockEnabled = body.autoLockEnabled
  }

  if (
    patch.mentionThreshold === undefined &&
    patch.matchVariants === undefined &&
    patch.pendingResolution === undefined &&
    patch.autoLockEnabled === undefined
  ) {
    return NextResponse.json(
      { error: 'No editable fields provided' },
      { status: 400 },
    )
  }

  let row
  try {
    row = await updateCustomMarketWord(marketId, wordIdNum, patch)
  } catch (err) {
    if (err instanceof Error && err.message === 'WORD_ALREADY_RESOLVED') {
      return NextResponse.json(
        { error: "Can't mark a resolved word as pending — resolution is final." },
        { status: 409 },
      )
    }
    throw err
  }
  if (!row) {
    return NextResponse.json({ error: 'Word not found' }, { status: 404 })
  }
  return NextResponse.json({ word: row })
}
