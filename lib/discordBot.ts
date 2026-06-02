// Server-only Discord bot helper for sending direct messages.
//
// Reuses the existing DISCORD_BOT_TOKEN (the same bot that adds users to the guild
// during linking). A bot can DM any user it shares a server with; sending is a plain
// REST call (open a DM channel, then post a message) needing no gateway connection
// or privileged intents. Errors are swallowed (logged, returns false) so callers in
// fire-and-forget paths never throw: a user who blocks DMs (403) or an unset token
// must not break the surrounding request.
//
// Rate limiting: Discord enforces a GLOBAL limit of 50 requests/second per bot,
// shared across every route. A single trade can trip many alerts at once, and each
// DM is two requests (open channel + send message), so a burst could easily blow
// past 50/s and get the bot 429'd or temporarily banned. Every outbound request is
// therefore funnelled through one shared, evenly-spaced scheduler (well under 50/s)
// that also honours Discord's Retry-After on 429s.

const DISCORD_API = 'https://discord.com/api/v10'

// Cap our own outbound rate well under Discord's 50/s global limit. The headroom
// leaves room for the other bot calls (guild join / role assignment during linking)
// and absorbs Discord's own per-route buckets. At 25/s a burst of N DMs (2 requests
// each) drains in ~N*2/25 seconds, which is fine for a price alert.
const MAX_REQUESTS_PER_SEC = 25
const MIN_SPACING_MS = 1000 / MAX_REQUESTS_PER_SEC
const MAX_429_RETRIES = 3

// Persist the limiter across Next.js hot reloads (same pattern as chatStream /
// mentionStream) so dev doesn't spin up competing schedulers.
interface DiscordLimiter { chain: Promise<void>; nextSlotAt: number }
const g = globalThis as unknown as { __discordLimiter?: DiscordLimiter }
const limiter: DiscordLimiter = g.__discordLimiter ?? (g.__discordLimiter = {
  chain: Promise.resolve(),
  nextSlotAt: 0,
})

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Reserve the next evenly-spaced send slot. Serialized through a single promise
// chain so concurrent callers queue in order and fire MIN_SPACING_MS apart, rather
// than all hitting Discord at once.
function reserveSlot(): Promise<void> {
  const run = limiter.chain.then(async () => {
    const now = Date.now()
    const wait = Math.max(0, limiter.nextSlotAt - now)
    if (wait > 0) await sleep(wait)
    limiter.nextSlotAt = Math.max(now, limiter.nextSlotAt) + MIN_SPACING_MS
  })
  // Keep the chain alive even if a slot rejects (it shouldn't — the body can't throw).
  limiter.chain = run.catch(() => {})
  return run
}

// Push every future slot out by `ms` (used after a 429 so all queued sends back off
// together, not just the one that got limited).
function backoff(ms: number): void {
  limiter.nextSlotAt = Math.max(limiter.nextSlotAt, Date.now() + ms)
}

// Rate-limited Discord request with 429 handling. Builds a fresh init per attempt
// (so each retry gets its own abort timeout). Never throws on 429; surfaces the final
// Response for the caller to inspect.
async function discordRequest(
  url: string,
  body: unknown,
  token: string,
  attempt = 0,
): Promise<Response> {
  await reserveSlot()
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  })
  if (res.status === 429 && attempt < MAX_429_RETRIES) {
    // Retry-After is in seconds (may be fractional). Fall back to a small default.
    const hdr = res.headers.get('retry-after')
    const retryMs = hdr ? Math.ceil(parseFloat(hdr) * 1000) : 1000
    backoff(retryMs)
    await sleep(retryMs)
    return discordRequest(url, body, token, attempt + 1)
  }
  return res
}

// DM channel cache: discordId -> channelId. Opening a DM channel is idempotent
// (Discord returns the existing channel) and DM channels are stable per user, so
// caching the id lets repeat alerts to the same user skip "open channel" (api call 1),
// halving requests to one per DM. Persisted on globalThis to survive hot reloads and
// bounded (oldest-evicted) so it can't grow without limit.
const DM_CHANNEL_CACHE_MAX = 5000
const gc = globalThis as unknown as { __discordDmChannels?: Map<string, string> }
const dmChannelCache: Map<string, string> = gc.__discordDmChannels ?? (gc.__discordDmChannels = new Map())

// Resolve the DM channel id for a user, from cache or by opening one. Returns null
// if the channel can't be opened (e.g. user not reachable).
async function getDmChannelId(discordId: string, token: string): Promise<string | null> {
  const cached = dmChannelCache.get(discordId)
  if (cached) return cached

  const res = await discordRequest(`${DISCORD_API}/users/@me/channels`, { recipient_id: discordId }, token)
  if (!res.ok) {
    console.warn(`sendDiscordDM: open channel failed (${res.status}) for ${discordId}`)
    return null
  }
  const channel = await res.json()
  if (!channel?.id) return null

  if (dmChannelCache.size >= DM_CHANNEL_CACHE_MAX) {
    const oldest = dmChannelCache.keys().next().value
    if (oldest !== undefined) dmChannelCache.delete(oldest)
  }
  dmChannelCache.set(discordId, channel.id)
  return channel.id
}

/**
 * Send a direct message to a Discord user. Returns true on success, false on any
 * failure (missing token, user blocks DMs, network error). Never throws. All requests
 * are rate-limited through the shared scheduler above, and the DM channel id is cached
 * per user so repeat sends are a single request.
 */
export async function sendDiscordDM(discordId: string, content: string): Promise<boolean> {
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) {
    console.warn('sendDiscordDM: DISCORD_BOT_TOKEN not set')
    return false
  }
  if (!discordId) return false

  try {
    // 1. Resolve DM channel (cached, or opened on first contact).
    let channelId = await getDmChannelId(discordId, token)
    if (!channelId) return false

    // 2. Post the message to that DM channel.
    let msgRes = await discordRequest(`${DISCORD_API}/channels/${channelId}/messages`, { content }, token)

    // A cached channel can rarely go stale (404 Unknown Channel). Drop it and re-open once.
    if (msgRes.status === 404) {
      dmChannelCache.delete(discordId)
      channelId = await getDmChannelId(discordId, token)
      if (!channelId) return false
      msgRes = await discordRequest(`${DISCORD_API}/channels/${channelId}/messages`, { content }, token)
    }

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
