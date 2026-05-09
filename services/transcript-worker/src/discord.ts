// Thin wrapper over the Discord webhook API. We use the same webhook URL as
// the Next.js bug-report flow (DISCORD_WEBHOOK_URL env). Two callers:
//
//   - Stream-end summary (per stream)
//   - Cost guard alerts (daily)
//
// Failures are logged and swallowed — Discord delivery is never on the
// critical path of a stream's lifecycle.

import { log } from './log'

const DISCORD_CONTENT_LIMIT = 2000  // hard limit per message

export function isWebhookConfigured(): boolean {
  return !!process.env.DISCORD_WEBHOOK_URL
}

/**
 * Post `content` to the configured Discord webhook. Truncates to Discord's
 * 2000-char message limit. Returns true on success, false otherwise.
 */
export async function postWebhook(content: string): Promise<boolean> {
  const url = process.env.DISCORD_WEBHOOK_URL
  if (!url) {
    log.debug('discord post skipped: webhook not configured')
    return false
  }
  const truncated = content.length > DISCORD_CONTENT_LIMIT
    ? content.slice(0, DISCORD_CONTENT_LIMIT - 20) + '\n…(truncated)'
    : content
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: truncated }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '<no body>')
      log.warn('discord webhook returned non-2xx', {
        status: res.status,
        body: text.slice(0, 500),
      })
      return false
    }
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn('discord webhook request failed', { err: msg })
    return false
  }
}
