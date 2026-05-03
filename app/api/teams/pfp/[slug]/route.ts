import { NextRequest, NextResponse } from 'next/server'
import { getTeamPfpData, getTeamBySlug, setTeamPfp, getTeamMembers } from '@/lib/db'

const MAX_BYTES = 1024 * 1024 // 1 MB raw

// Allowed MIME types — whitelist only, no user-supplied type trusted
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

// Validate slug: alphanumeric + hyphens only, prevent path traversal
function isValidSlug(s: string): boolean {
  return /^[a-z0-9-]{1,80}$/.test(s)
}

// Validate Solana wallet: base58 characters, 32–44 chars
function isValidWallet(w: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w)
}

// Detect actual image magic bytes regardless of claimed MIME type
function detectMime(buf: Buffer): string | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp'
  return null
}

// ── GET /api/teams/pfp/[slug] — serve the image ────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  if (!isValidSlug(params.slug)) return new NextResponse(null, { status: 400 })

  const data = await getTeamPfpData(params.slug)
  if (!data) return new NextResponse(null, { status: 404 })

  // data is stored as a base64 data URL: "data:<mime>;base64,<data>"
  const commaIdx = data.indexOf(',')
  if (commaIdx === -1) return new NextResponse(null, { status: 500 })

  const b64 = data.slice(commaIdx + 1)
  const buffer = Buffer.from(b64, 'base64')

  // Trust the stored bytes, not the stored MIME header — re-detect from magic bytes
  const detectedMime = detectMime(buffer)
  if (!detectedMime) return new NextResponse(null, { status: 500 })

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': detectedMime,
      'Content-Disposition': 'inline',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

// ── POST /api/teams/pfp/[slug] — upload a new PFP ─────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  if (!isValidSlug(params.slug)) {
    return NextResponse.json({ error: 'Invalid team slug' }, { status: 400 })
  }

  try {
    const formData = await req.formData()
    const wallet = formData.get('wallet')
    const file = formData.get('file')

    if (typeof wallet !== 'string' || !wallet) {
      return NextResponse.json({ error: 'wallet is required' }, { status: 400 })
    }
    if (!isValidWallet(wallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 })
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 })
    }

    // Validate file size before reading bytes
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Image must be under 1 MB' }, { status: 400 })
    }

    // Read bytes and detect actual type from magic bytes — don't trust file.type
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const detectedMime = detectMime(buffer)

    if (!detectedMime || !ALLOWED_MIME.has(detectedMime)) {
      return NextResponse.json({ error: 'File must be a valid image (JPEG, PNG, GIF, or WebP)' }, { status: 400 })
    }

    // Load the team and verify the uploader is the captain
    const team = await getTeamBySlug(params.slug)
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

    const members = await getTeamMembers(team.id)
    const me = members.find(m => m.wallet === wallet)
    if (!me || me.role !== 'captain') {
      return NextResponse.json({ error: 'Only the team captain can update the profile picture' }, { status: 403 })
    }

    // Store with detected MIME, not user-supplied
    const base64 = buffer.toString('base64')
    const dataUrl = `data:${detectedMime};base64,${base64}`

    await setTeamPfp(team.id, dataUrl)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Team PFP upload error:', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
