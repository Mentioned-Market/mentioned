import { NextRequest, NextResponse } from 'next/server'

const RPC_URL =
  process.env.HELIUS_RPC_URL ||
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ||
  'https://api.mainnet-beta.solana.com'

export async function POST(req: NextRequest) {
  try {
    const { transaction } = await req.json()
    if (!transaction || typeof transaction !== 'string') {
      return NextResponse.json({ error: 'Missing transaction' }, { status: 400 })
    }

    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: [
          transaction,
          {
            encoding: 'base64',
            skipPreflight: true,
            preflightCommitment: 'confirmed',
          },
        ],
      }),
    })

    const json = await res.json()
    if (json.error) {
      return NextResponse.json(
        { error: json.error.message || JSON.stringify(json.error) },
        { status: 400 }
      )
    }

    return NextResponse.json({ signature: json.result })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
