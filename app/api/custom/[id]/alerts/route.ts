import { NextRequest, NextResponse } from 'next/server'
import {
  getCustomMarket,
  hasDiscordLinked,
  createPriceAlert,
  getActivePriceAlertsForWallet,
  PriceAlertError,
} from '@/lib/db'
import { getVerifiedWallet } from '@/lib/walletAuth'

// List the authenticated wallet's active price alerts for this market.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const marketId = parseInt(id, 10)
  if (isNaN(marketId)) {
    return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
  }

  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const alerts = await getActivePriceAlertsForWallet(wallet, marketId)
  return NextResponse.json({ alerts })
}

// Create a one-shot price alert on a word. Direction is derived server-side from
// the current price; a Discord link is required since the alert is delivered by DM.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const marketId = parseInt(id, 10)
  if (isNaN(marketId)) {
    return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
  }

  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const body = await req.json()
  const { word_id, side, target_price } = body as {
    word_id?: number
    side?: string
    target_price?: number
  }

  if (word_id === undefined || !side || target_price === undefined) {
    return NextResponse.json(
      { error: 'word_id, side, and target_price are required' },
      { status: 400 },
    )
  }
  if (side !== 'YES' && side !== 'NO') {
    return NextResponse.json({ error: 'side must be "YES" or "NO"' }, { status: 400 })
  }
  if (typeof target_price !== 'number' || target_price <= 0 || target_price >= 1) {
    return NextResponse.json(
      { error: 'target_price must be a number between 0 and 1 (exclusive)' },
      { status: 400 },
    )
  }

  // Discord link is mandatory — DM delivery needs a discord_id.
  if (!(await hasDiscordLinked(wallet))) {
    return NextResponse.json(
      { error: 'You must link your Discord account to set price alerts', code: 'DISCORD_REQUIRED' },
      { status: 403 },
    )
  }

  const market = await getCustomMarket(marketId)
  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 })
  }

  try {
    const alert = await createPriceAlert(wallet, marketId, word_id, side, target_price)
    if (!alert) {
      return NextResponse.json(
        { error: 'You already have an identical active alert for this word' },
        { status: 409 },
      )
    }
    return NextResponse.json({ alert })
  } catch (err) {
    if (err instanceof PriceAlertError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    console.error('Create price alert error:', err)
    return NextResponse.json({ error: 'Failed to create alert' }, { status: 500 })
  }
}
