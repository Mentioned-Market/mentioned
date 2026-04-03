import { NextRequest, NextResponse } from 'next/server'

export const JUP_API_KEY = process.env.JUPITER_API_KEY ?? ''
export const JUP_BASE = 'https://api.jup.ag/prediction/v1'

/** Returns empty headers — do not forward client IP to Jupiter, requests must appear to originate from the server */
export function getForwardHeaders(_req: NextRequest): Record<string, string> {
  return {}
}

export async function jupFetch(path: string, init?: RequestInit, forwardHeaders?: Record<string, string>) {
  const res = await fetch(`${JUP_BASE}${path}`, {
    cache: 'no-store',
    ...init,
    headers: {
      'x-api-key': JUP_API_KEY,
      ...forwardHeaders,
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return NextResponse.json(
      { error: text || 'Jupiter API error' },
      { status: res.status }
    )
  }
  const data = await res.json()
  return NextResponse.json(data)
}
