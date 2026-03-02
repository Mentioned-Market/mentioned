import { NextResponse } from 'next/server'

export const JUP_API_KEY = 'JUPITER_API_KEY_REMOVED'
export const JUP_BASE = 'https://api.jup.ag/prediction/v1'

export async function jupFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${JUP_BASE}${path}`, {
    ...init,
    headers: {
      'x-api-key': JUP_API_KEY,
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
