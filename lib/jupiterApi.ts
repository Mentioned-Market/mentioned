import { NextRequest, NextResponse } from 'next/server'

export const JUP_API_KEY = process.env.JUPITER_API_KEY ?? ''
export const JUP_BASE = 'https://api.jup.ag/prediction/v1'

/** Returns empty headers — do not forward client IP to Jupiter, requests must appear to originate from the server */
export function getForwardHeaders(_req: NextRequest): Record<string, string> {
  return {}
}

export async function jupFetch(path: string, init?: RequestInit, forwardHeaders?: Record<string, string>, timeoutMs = 8000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${JUP_BASE}${path}`, {
      cache: 'no-store',
      ...init,
      signal: controller.signal,
      headers: {
        'x-api-key': JUP_API_KEY,
        ...forwardHeaders,
        ...init?.headers,
      },
    })
  } catch (err: unknown) {
    clearTimeout(timeout)
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json({ error: 'Jupiter API timeout' }, { status: 504 })
    }
    throw err
  }
  clearTimeout(timeout)
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
