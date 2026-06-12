import { NextRequest, NextResponse } from 'next/server'
import { getVerifiedWallet } from '@/lib/walletAuth'
import { getCampaign, isCampaignActive } from '@/lib/eventCampaigns'
import {
  getWalletEventClaim,
  reserveEventCode,
  markEventCodeFunded,
  releaseEventCode,
} from '@/lib/db'
import { fundEventWallet } from '@/lib/eventFunding'
import { ConfirmationTimeoutError } from '@/lib/rpcSend'

/**
 * POST /api/promo/[campaign]/claim — redeem a single-use code to fund the
 * authenticated wallet with USDC + SOL.
 *
 * Auth: session cookie (Privy or Phantom). The recipient is ALWAYS the verified
 * session wallet and the amounts ALWAYS come from server-side campaign config —
 * never from the request body. The body carries only the code.
 *
 * Body: { code: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { campaign: string } },
) {
  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const campaign = getCampaign(params.campaign)
  if (!campaign) {
    return NextResponse.json({ error: 'Unknown event' }, { status: 404 })
  }
  if (!isCampaignActive(campaign)) {
    return NextResponse.json({ status: 'closed' }, { status: 403 })
  }

  let code: string | undefined
  try {
    const body = await req.json()
    code = (body?.code as string | undefined)?.trim().toUpperCase()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  if (!code) {
    return NextResponse.json({ error: 'A code is required' }, { status: 400 })
  }

  // Already has a claim in this campaign?
  const existing = await getWalletEventClaim(campaign.slug, wallet)
  if (existing) {
    if (existing.status === 'funded') {
      return NextResponse.json({ status: 'already_funded', signature: existing.signature })
    }
    // Reserved: a prior funding attempt is in flight or its confirmation timed
    // out (ambiguous). Never re-send for a reserved row — that risks
    // double-funding real money. Tell the client to wait.
    return NextResponse.json({ status: 'processing' }, { status: 202 })
  }

  // Atomically reserve the requested code.
  const reservation = await reserveEventCode(campaign.slug, code, wallet)
  switch (reservation.state) {
    case 'invalid':
      return NextResponse.json({ error: 'That code is not valid' }, { status: 404 })
    case 'taken':
      return NextResponse.json({ error: 'That code has already been used' }, { status: 409 })
    case 'conflict':
      return NextResponse.json({ status: 'processing' }, { status: 202 })
    case 'already_funded':
      return NextResponse.json({ status: 'already_funded', signature: reservation.signature })
    case 'reserved':
      break
  }

  // Send the funds.
  try {
    const { signature } = await fundEventWallet(
      wallet,
      campaign.usdcBaseUnits,
      campaign.lamports,
    )
    await markEventCodeFunded(
      reservation.id,
      signature,
      campaign.usdcBaseUnits,
      campaign.lamports,
    )
    return NextResponse.json({ status: 'funded', signature })
  } catch (err) {
    if (err instanceof ConfirmationTimeoutError) {
      // The transaction MAY still land. Keep the reservation (it blocks a
      // re-grab and is recoverable by the operator) and do NOT re-send.
      console.error(`Event claim confirmation timed out for ${wallet}:`, err.signature)
      return NextResponse.json({ status: 'processing' }, { status: 202 })
    }
    // Definite failure — release the code so the holder can retry.
    await releaseEventCode(reservation.id)
    console.error(`Event claim funding failed for ${wallet}:`, err)
    return NextResponse.json(
      { error: 'Funding failed, please try again in a moment' },
      { status: 502 },
    )
  }
}
