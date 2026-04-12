import { NextRequest, NextResponse } from 'next/server'
import { signDiscordState, getVerifiedWallet } from '@/lib/walletAuth'

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID!
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'https://www.mentioned.market/api/discord/callback'

export async function GET(req: NextRequest) {
  // Prefer session cookie; fall back to ?wallet= query param for clients without a session
  const wallet = getVerifiedWallet(req) ?? req.nextUrl.searchParams.get('wallet')
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const state = signDiscordState(wallet)
  const redirectUri = DISCORD_REDIRECT_URI

  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify guilds.join',
    state,
  })

  return NextResponse.redirect(`https://discord.com/api/oauth2/authorize?${params}`)
}
