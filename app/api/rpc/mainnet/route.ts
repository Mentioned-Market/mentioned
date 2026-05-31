import { NextRequest, NextResponse } from 'next/server'

// Same-origin passthrough to the mainnet RPC. The browser talks to this route so the
// Helius API key stays server-side (read from HELIUS_RPC_URL) instead of being inlined
// into the client bundle via a NEXT_PUBLIC_* var.
const RPC_URL =
  process.env.HELIUS_RPC_URL ||
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ||
  'https://api.mainnet-beta.solana.com'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'RPC proxy error' } },
      { status: 502 }
    )
  }
}
