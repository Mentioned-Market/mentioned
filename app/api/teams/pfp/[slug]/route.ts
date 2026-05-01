import { NextRequest, NextResponse } from 'next/server'
import { getTeamPfpData, getTeamBySlug, setTeamPfp, getTeamMembers } from '@/lib/db'

const MAX_BYTES = 1024 * 1024 // 1 MB raw

// ── GET /api/teams/pfp/[slug] — serve the image ────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const data = await getTeamPfpData(params.slug)
  if (!data) return new NextResponse(null, { status: 404 })

  // data is stored as a base64 data URL: "data:<mime>;base64,<data>"
  const commaIdx = data.indexOf(',')
  if (commaIdx === -1) return new NextResponse(null, { status: 500 })

  const header = data.slice(0, commaIdx)          // e.g. "data:image/png;base64"
  const mime = header.split(':')[1]?.split(';')[0] // e.g. "image/png"
  const b64 = data.slice(commaIdx + 1)
  const buffer = Buffer.from(b64, 'base64')

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': mime ?? 'image/png',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  })
}

// ── POST /api/teams/pfp/[slug] — upload a new PFP ─────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  try {
    const formData = await req.formData()
    const wallet = formData.get('wallet') as string | null
    const file = formData.get('file') as File | null

    if (!wallet || !file) {
      return NextResponse.json({ error: 'wallet and file are required' }, { status: 400 })
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'File must be an image' }, { status: 400 })
    }

    // Validate file size
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Image must be under 1 MB' }, { status: 400 })
    }

    // Load the team and verify the uploader is the captain
    const team = await getTeamBySlug(params.slug)
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

    const members = await getTeamMembers(team.id)
    const me = members.find(m => m.wallet === wallet)
    if (!me || me.role !== 'captain') {
      return NextResponse.json({ error: 'Only the team captain can update the profile picture' }, { status: 403 })
    }

    // Convert to base64 data URL
    const arrayBuffer = await file.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')
    const dataUrl = `data:${file.type};base64,${base64}`

    await setTeamPfp(team.id, dataUrl)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Team PFP upload error:', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
