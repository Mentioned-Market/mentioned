import { NextRequest, NextResponse } from 'next/server'
import { linkDiscord, getWalletByDiscordId, getWalletByReferralCode, applyReferral, getProfile } from '@/lib/db'

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID!
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET!
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.mentioned.market'
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const error = req.nextUrl.searchParams.get('error')

  // User denied the OAuth prompt
  if (error) {
    return NextResponse.redirect(`${BASE_URL}/?discord=cancelled`)
  }

  if (!code || !state) {
    return NextResponse.redirect(`${BASE_URL}/?discord=error`)
  }

  // Decode state to get wallet
  let wallet: string
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString())
    wallet = parsed.wallet
    if (!wallet) throw new Error('missing wallet')
  } catch {
    return NextResponse.redirect(`${BASE_URL}/?discord=error`)
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${BASE_URL}/api/discord/callback`,
      }),
    })

    if (!tokenRes.ok) {
      console.error('Discord token exchange failed:', await tokenRes.text())
      return NextResponse.redirect(`${BASE_URL}/profile/${wallet}?discord=error`)
    }

    const tokenData = await tokenRes.json()
    const accessToken = tokenData.access_token

    // Get Discord user info
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!userRes.ok) {
      console.error('Discord user fetch failed:', await userRes.text())
      return NextResponse.redirect(`${BASE_URL}/profile/${wallet}?discord=error`)
    }

    const discordUser = await userRes.json()
    const discordId = discordUser.id as string
    const discordUsername = discordUser.username as string

    // Check if this Discord account is already linked to another wallet
    const existingWallet = await getWalletByDiscordId(discordId)
    if (existingWallet && existingWallet !== wallet) {
      return NextResponse.redirect(`${BASE_URL}/profile/${wallet}?discord=already_linked`)
    }

    // Link Discord to wallet
    await linkDiscord(wallet, discordId, discordUsername)

    // Assign "verified" role in the Discord server
    if (DISCORD_GUILD_ID && process.env.DISCORD_BOT_TOKEN) {
      const botHeaders = {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      }
      const roleId = process.env.DISCORD_VERIFIED_ROLE_ID

      try {
        // Try to add user to the guild (works if they're not already a member)
        await fetch(`https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members/${discordId}`, {
          method: 'PUT',
          headers: botHeaders,
          body: JSON.stringify({ access_token: accessToken }),
        })

        // Assign the verified role (works whether they were just added or already a member)
        if (roleId) {
          const roleRes = await fetch(`https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members/${discordId}/roles/${roleId}`, {
            method: 'PUT',
            headers: botHeaders,
          })
          if (!roleRes.ok) {
            console.error('Discord role assign failed:', roleRes.status, await roleRes.text())
          }
        }
      } catch (err) {
        console.error('Discord guild/role error:', err)
      }
    }

    // Apply referral code from cookie (if present)
    const refCode = req.cookies.get('ref')?.value
    if (refCode) {
      try {
        const referrerWallet = await getWalletByReferralCode(refCode)
        if (referrerWallet) {
          await applyReferral(wallet, referrerWallet)
        }
      } catch (err) {
        console.error('Referral apply error:', err)
      }
    }

    // Prefer username in redirect URL
    const userProfile = await getProfile(wallet)
    const profileSlug = userProfile?.username && userProfile.username !== wallet ? userProfile.username : wallet

    const response = NextResponse.redirect(`${BASE_URL}/profile/${profileSlug}?discord=linked`)
    // Clear referral cookie after applying
    if (refCode) {
      response.cookies.set('ref', '', { maxAge: 0, path: '/' })
    }
    return response
  } catch (err) {
    console.error('Discord OAuth error:', err)
    return NextResponse.redirect(`${BASE_URL}/profile/${wallet}?discord=error`)
  }
}
