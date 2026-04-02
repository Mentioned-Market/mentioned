import { NextRequest, NextResponse } from 'next/server'
import { getWalletFreeMarketPositions, getWalletFreeMarketTrades } from '@/lib/db'

export const dynamic = 'force-dynamic'

const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet')
  if (!wallet || !WALLET_RE.test(wallet)) {
    return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
  }

  const [positions, trades] = await Promise.all([
    getWalletFreeMarketPositions(wallet),
    getWalletFreeMarketTrades(wallet, 100),
  ])

  return NextResponse.json({ positions, trades })
}
