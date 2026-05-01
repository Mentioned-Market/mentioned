import { NextRequest, NextResponse } from 'next/server'
import { getTeamBySlug, getTeamMembers, getTeamMemberPointTotals, updateTeamName, updateTeamBio, updateTeamXUrl } from '@/lib/db'
import { COMP_START, COMP_END } from '@/lib/teamComp'

// Validate Solana wallet: base58 characters, 32–44 chars
function isValidWallet(w: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w)
}

// Strip null bytes and non-printable control characters
function sanitizeText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim()
}

export async function GET(
  req: NextRequest,
  { params }: { params: { name: string } },
) {
  const slug = params.name
  if (!slug) return NextResponse.json({ error: 'Invalid team name' }, { status: 400 })

  const requesterWallet = req.nextUrl.searchParams.get('wallet') ?? ''

  try {
    const team = await getTeamBySlug(slug)
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

    const [members, memberPoints] = await Promise.all([
      getTeamMembers(team.id),
      getTeamMemberPointTotals(team.id, COMP_START, COMP_END),
    ])

    const pointMap = new Map(memberPoints.map(m => [m.wallet, m]))

    const membersWithPoints = members.map(m => ({
      ...m,
      weekly_points: pointMap.get(m.wallet)?.weekly ?? 0,
      all_time_points: pointMap.get(m.wallet)?.all_time ?? 0,
    }))

    const weeklyTotal = membersWithPoints.reduce((s, m) => s + m.weekly_points, 0)
    const allTimeTotal = membersWithPoints.reduce((s, m) => s + m.all_time_points, 0)

    // Only expose the join code to the team captain
    const requesterIsCaptain = members.some(m => m.wallet === requesterWallet && m.role === 'captain')
    const { join_code, ...teamPublic } = team
    const teamData = requesterIsCaptain ? team : teamPublic

    return NextResponse.json({
      team: teamData,
      members: membersWithPoints,
      weeklyTotal,
      allTimeTotal,
      compStart: COMP_START.toISOString(),
      compEnd: COMP_END.toISOString(),
    })
  } catch (err) {
    console.error('Team profile error:', err)
    return NextResponse.json({ error: 'Failed to fetch team' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { name: string } },
) {
  const slug = params.name
  if (!slug) return NextResponse.json({ error: 'Invalid team name' }, { status: 400 })

  try {
    const body = await req.json()

    // Validate all fields are the expected types before touching them
    const { wallet, name, bio, x_url } = body

    if (typeof wallet !== 'string' || !wallet) {
      return NextResponse.json({ error: 'wallet is required' }, { status: 400 })
    }
    if (!isValidWallet(wallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 })
    }

    const team = await getTeamBySlug(slug)
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

    const members = await getTeamMembers(team.id)
    const me = members.find(m => m.wallet === wallet)
    if (!me || me.role !== 'captain') {
      return NextResponse.json({ error: 'Only the team captain can edit team details' }, { status: 403 })
    }

    if (name !== undefined) {
      if (typeof name !== 'string') {
        return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
      }
      const sanitized = sanitizeText(name)
      if (sanitized.length < 2 || sanitized.length > 30) {
        return NextResponse.json({ error: 'Name must be 2–30 characters' }, { status: 400 })
      }
      await updateTeamName(team.id, sanitized)
    }

    if (bio !== undefined) {
      if (typeof bio !== 'string') {
        return NextResponse.json({ error: 'Invalid bio' }, { status: 400 })
      }
      const sanitized = sanitizeText(bio)
      if (sanitized.length > 300) {
        return NextResponse.json({ error: 'Bio must be 300 characters or less' }, { status: 400 })
      }
      await updateTeamBio(team.id, sanitized)
    }

    if (x_url !== undefined) {
      if (x_url !== null && typeof x_url !== 'string') {
        return NextResponse.json({ error: 'Invalid X URL' }, { status: 400 })
      }
      if (x_url) {
        // Accept handle (@username) or full URL, normalise to handle only
        const handle = x_url.trim().replace(/^https?:\/\/(www\.)?x\.com\//i, '').replace(/^https?:\/\/(www\.)?twitter\.com\//i, '').replace(/^@/, '').split('/')[0].split('?')[0]
        if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
          return NextResponse.json({ error: 'Invalid X username' }, { status: 400 })
        }
        await updateTeamXUrl(team.id, handle)
      } else {
        await updateTeamXUrl(team.id, null)
      }
    }


    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Team update error:', err)
    return NextResponse.json({ error: 'Failed to update team' }, { status: 500 })
  }
}
