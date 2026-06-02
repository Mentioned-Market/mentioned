import { NextRequest, NextResponse } from 'next/server'
import { cancelPriceAlert } from '@/lib/db'
import { getVerifiedWallet } from '@/lib/walletAuth'

// Cancel one of the authenticated wallet's active price alerts.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; alertId: string }> },
) {
  const { alertId } = await params
  const id = parseInt(alertId, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid alert ID' }, { status: 400 })
  }

  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const canceled = await cancelPriceAlert(id, wallet)
  if (!canceled) {
    return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
