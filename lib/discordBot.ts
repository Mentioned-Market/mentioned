// Server-only Discord bot helper for sending direct messages.
//
// Reuses the existing DISCORD_BOT_TOKEN (the same bot that adds users to the guild
// during linking). A bot can DM any user it shares a server with; sending is a plain
// REST call — open a DM channel, then post a message — needing no gateway connection
// or privileged intents. Errors are swallowed (logged, returns false) so callers in
// fire-and-forget paths never throw: a user who blocks DMs (403) or an unset token
// must not break the surrounding request.

const DISCORD_API = 'https://discord.com/api/v10'

/**
 * Send a direct message to a Discord user. Returns true on success, false on any
 * failure (missing token, user blocks DMs, network error). Never throws.
 */
export async function sendDiscordDM(discordId: string, content: string): Promise<boolean> {
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) {
    console.warn('sendDiscordDM: DISCORD_BOT_TOKEN not set')
    return false
  }
  if (!discordId) return false

  const authHeaders = {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
  }

  try {
    // 1. Open (or fetch existing) DM channel with the recipient.
    const channelRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
      method: 'POST',
      headers: authHeaders,
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ recipient_id: discordId }),
    })
    if (!channelRes.ok) {
      console.warn(`sendDiscordDM: open channel failed (${channelRes.status}) for ${discordId}`)
      return false
    }
    const channel = await channelRes.json()
    if (!channel?.id) return false

    // 2. Post the message to that DM channel.
    const msgRes = await fetch(`${DISCORD_API}/channels/${channel.id}/messages`, {
      method: 'POST',
      headers: authHeaders,
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ content }),
    })
    if (!msgRes.ok) {
      // 403 here typically means the user disabled DMs from server members.
      console.warn(`sendDiscordDM: send message failed (${msgRes.status}) for ${discordId}`)
      return false
    }
    return true
  } catch (err) {
    console.error('sendDiscordDM error:', err)
    return false
  }
}
