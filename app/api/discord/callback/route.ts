import { NextRequest } from 'next/server'
import { linkDiscord, getWalletByDiscordId, getWalletByReferralCode, applyReferral, backfillAchievementPoints } from '@/lib/db'
import { verifyDiscordState } from '@/lib/walletAuth'
import { tryUnlockAchievement } from '@/lib/achievements'

/** Minimum Discord account age (days) required for a referral to count toward achievements. */
const REFERRAL_MIN_DISCORD_AGE_DAYS = 30

/** Extract account creation date from a Discord snowflake ID. */
function discordAccountAge(discordId: string): number {
  const createdAt = new Date(Number(BigInt(discordId) >> 22n) + 1420070400000)
  return (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24) // days
}

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID!
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET!
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID

function popupResponse(status: 'linked' | 'error' | 'cancelled' | 'already_linked') {
  const messages: Record<string, { emoji: string; title: string; sub: string }> = {
    linked: { emoji: '✅', title: 'Discord linked!', sub: 'You can close this tab.' },
    error: { emoji: '❌', title: 'Something went wrong', sub: 'Please close this tab and try again.' },
    cancelled: { emoji: '↩️', title: 'Linking cancelled', sub: 'You can close this tab.' },
    already_linked: { emoji: '⚠️', title: 'Already linked', sub: 'This Discord account is linked to another wallet.' },
  }
  const { emoji, title, sub } = messages[status]
  const html = `<!DOCTYPE html><html><head><title>Discord</title>
<style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0a0a0a;font-family:-apple-system,sans-serif;color:#fff;}
.box{text-align:center;padding:2rem;}.emoji{font-size:3rem;margin-bottom:1rem;}.title{font-size:1.1rem;font-weight:600;margin-bottom:.5rem;}.sub{font-size:.85rem;color:#737373;}</style>
</head><body><div class="box"><div class="emoji">${emoji}</div><div class="title">${title}</div><div class="sub">${sub}</div></div>
<script>
  try { window.opener && window.opener.postMessage({ type: 'discord_callback', status: '${status}' }, '*'); } catch(e) {}
  setTimeout(function(){ window.close(); }, 1500);
</script></body></html>`
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const error = req.nextUrl.searchParams.get('error')

  // User denied the OAuth prompt
  if (error) {
    return popupResponse('cancelled')
  }

  if (!code || !state) {
    return popupResponse('error')
  }

  // Verify signed state to get wallet
  const wallet = verifyDiscordState(state)
  if (!wallet) {
    return popupResponse('error')
  }

  // Derive the redirect_uri from the actual request URL so it always matches
  // what was sent to Discord during authorization, regardless of env config.
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'www.mentioned.market'
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  const selfRedirectUri = `${proto}://${host}/api/discord/callback`

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(5000),
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: selfRedirectUri,
      }),
    })

    if (!tokenRes.ok) {
      console.error('Discord token exchange failed:', await tokenRes.text())
      return popupResponse('error')
    }

    const tokenData = await tokenRes.json()
    const accessToken = tokenData.access_token

    // Get Discord user info
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5000),
    })

    if (!userRes.ok) {
      console.error('Discord user fetch failed:', await userRes.text())
      return popupResponse('error')
    }

    const discordUser = await userRes.json()
    const discordId = discordUser.id as string
    const discordUsername = discordUser.username as string

    // Check if this Discord account is already linked to another wallet
    const existingWallet = await getWalletByDiscordId(discordId)
    if (existingWallet && existingWallet !== wallet) {
      return popupResponse('already_linked')
    }

    // Link Discord to wallet
    await linkDiscord(wallet, discordId, discordUsername)

    // Retroactively award points for any achievements earned this week before Discord was linked
    backfillAchievementPoints(wallet).catch(err => console.error('Achievement backfill error:', err))

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
          signal: AbortSignal.timeout(5000),
          body: JSON.stringify({ access_token: accessToken }),
        })

        // Assign the verified role (works whether they were just added or already a member)
        if (roleId) {
          const roleRes = await fetch(`https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members/${discordId}/roles/${roleId}`, {
            method: 'PUT',
            headers: botHeaders,
            signal: AbortSignal.timeout(5000),
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
          const applied = await applyReferral(wallet, referrerWallet)
          // Only award the achievement if the referee's Discord account is old enough
          // (prevents sybil attacks with freshly-created Discord accounts)
          if (applied) {
            const ageDays = discordAccountAge(discordId)
            if (ageDays >= REFERRAL_MIN_DISCORD_AGE_DAYS) {
              tryUnlockAchievement(referrerWallet, 'refer_friend').catch(err =>
                console.error('Achievement error (referral via Discord):', err)
              )
            } else {
              console.log(`Referral applied for ${wallet} but Discord account too new (${ageDays.toFixed(1)} days) — skipping achievement for referrer ${referrerWallet}`)
            }
          }
        }
      } catch (err) {
        console.error('Referral apply error:', err)
      }
    }

    const response = popupResponse('linked')
    // Clear referral cookie after applying
    if (refCode) {
      response.headers.append('Set-Cookie', 'ref=; Max-Age=0; Path=/')
    }
    return response
  } catch (err) {
    console.error('Discord OAuth error:', err)
    return popupResponse('error')
  }
}
