import { NextRequest, NextResponse } from 'next/server'

export const JUP_API_KEY = 'JUPITER_API_KEY_REMOVED'
export const JUP_BASE = 'https://api.jup.ag/prediction/v1'

/** Extract client IP forwarding headers from the incoming request */
export function getForwardHeaders(req: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {}
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    req.ip ||
    ''
  if (ip) {
    headers['x-forwarded-for'] = ip
    headers['x-real-ip'] = ip
  }
  return headers
}

export async function jupFetch(path: string, init?: RequestInit, forwardHeaders?: Record<string, string>) {
  const res = await fetch(`${JUP_BASE}${path}`, {
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
