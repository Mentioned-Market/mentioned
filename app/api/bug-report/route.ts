import { NextRequest, NextResponse } from 'next/server'

const WEBHOOK_URL = process.env.DISCORD_BUG_REPORT_WEBHOOK_URL

// In-memory rate limit: IP → timestamps of recent submissions
const rateLimitMap = new Map<string, number[]>()
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const RATE_LIMIT_MAX = 3

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const timestamps = rateLimitMap.get(ip) ?? []
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  rateLimitMap.set(ip, recent)
  return recent.length >= RATE_LIMIT_MAX
}

function recordRequest(ip: string) {
  const now = Date.now()
  const timestamps = rateLimitMap.get(ip) ?? []
  timestamps.push(now)
  rateLimitMap.set(ip, timestamps)
}

// Periodic cleanup to prevent memory leak
setInterval(() => {
  const now = Date.now()
  for (const [ip, timestamps] of rateLimitMap) {
    const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
    if (recent.length === 0) {
      rateLimitMap.delete(ip)
    } else {
      rateLimitMap.set(ip, recent)
    }
  }
}, 10 * 60 * 1000) // every 10 min

const MAX_CHARS = 300

function sanitize(text: string): string {
  // Strip Discord markdown exploits and @mentions
  return text
    .replace(/@(everyone|here)/gi, '[at-$1]')
    .replace(/<@[!&]?\d+>/g, '[mention]')
    .slice(0, MAX_CHARS)
}

export async function POST(request: NextRequest) {
  if (!WEBHOOK_URL) {
    return NextResponse.json(
      { error: 'Bug reporting is not configured' },
      { status: 503 }
    )
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: 'Too many reports. Please try again later.' },
      { status: 429 }
    )
  }

  let body: { message?: string; debugInfo?: Record<string, string> }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { message, debugInfo } = body

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  }

  if (message.length > MAX_CHARS) {
    return NextResponse.json(
      { error: `Message must be ${MAX_CHARS} characters or fewer` },
      { status: 400 }
    )
  }

  const sanitizedMessage = sanitize(message.trim())

  // Build Discord embed
  const embed = {
    title: '🐛 Bug Report',
    color: 0xff4444,
    fields: [
      {
        name: 'Report',
        value: sanitizedMessage,
      },
    ],
    timestamp: new Date().toISOString(),
  }

  if (debugInfo && typeof debugInfo === 'object') {
    const debugLines = Object.entries(debugInfo)
      .filter(([, v]) => typeof v === 'string' && v.length > 0)
      .map(([k, v]) => `**${sanitize(k)}:** ${sanitize(v as string)}`)
      .slice(0, 10) // cap number of fields
      .join('\n')

    if (debugLines) {
      embed.fields.push({
        name: 'Debug Info',
        value: debugLines.slice(0, 1024), // Discord field value limit
      })
    }
  }

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [embed],
      }),
    })

    if (!res.ok) {
      console.error('Discord webhook failed:', res.status, await res.text())
      return NextResponse.json(
        { error: 'Failed to submit report' },
        { status: 502 }
      )
    }
  } catch (err) {
    console.error('Discord webhook error:', err)
    return NextResponse.json(
      { error: 'Failed to submit report' },
      { status: 502 }
    )
  }

  recordRequest(ip)

  return NextResponse.json({ success: true })
}
