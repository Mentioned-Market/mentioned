// Builds + posts the per-stream Discord summary at end of stream.
//
// v1 supports free markets only (event_id 'custom_<id>'). Other event_id
// shapes get a minimal summary without per-word breakdown.

import { pool } from './db'
import { log } from './log'
import { postWebhook, isWebhookConfigured } from './discord'
import type { EndReason } from './streamWorker'

export function appBaseUrl(): string {
  return APP_BASE_URL
}

interface FirstMentionPingInput {
  streamId: number
  eventId: string
  word: string
  matchedText: string
  snippet: string
  streamOffsetMs: number
  confidence: number | null
}

/**
 * Post a one-line Discord ping for the first non-superseded mention of a
 * word whose threshold is 1. Fire-and-forget — the surrounding insert is the
 * source of truth.
 */
export async function postFirstMentionPing(input: FirstMentionPingInput): Promise<void> {
  if (!isWebhookConfigured()) {
    log.debug('first-mention ping skipped: discord not configured', {
      streamId: input.streamId,
      eventId: input.eventId,
    })
    return
  }
  const time = formatHms(input.streamOffsetMs)
  const conf = input.confidence != null ? ` · conf ${input.confidence.toFixed(2)}` : ''
  const content =
    `🔔 **First mention** — "${input.word}" (${input.eventId})\n` +
    `${time}${conf}: ${quoteSnippet(input.snippet)}\n` +
    `Threshold is 1 — admin can resolve YES on this word now.\n` +
    `Resolve: ${APP_BASE_URL}/customadmin`
  await postWebhook(content)
}

function formatHms(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

function quoteSnippet(s: string): string {
  return `> ${s.replace(/\n/g, ' ')}`
}

interface SummaryInput {
  streamId: number
  eventId: string
  reason: EndReason
  errorMessage: string | null
  minutes: number
  costCents: number
}

interface MarketRow {
  title: string | null
  stream_url: string
}

interface WordRow {
  word_index: number
  word: string
  mention_threshold: number
  active_count: number
  dismissed_count: number
  avg_conf: number | null
}

// Pick the public URL the Discord summary should link back to. Explicit
// APP_BASE_URL wins; otherwise infer from the Railway-style ENVIRONMENT
// value the rest of the app uses ('staging' / unset = production).
const APP_BASE_URL = resolveAppBaseUrl()

function resolveAppBaseUrl(): string {
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL.replace(/\/$/, '')
  }
  if (process.env.ENVIRONMENT === 'staging') {
    return 'https://mentioned-staging.up.railway.app'
  }
  return 'https://mentioned.market'
}

export async function postStreamEndSummary(input: SummaryInput): Promise<void> {
  if (!isWebhookConfigured()) {
    log.debug('stream end summary: discord not configured', { streamId: input.streamId })
    return
  }
  let content: string
  try {
    content = await buildSummary(input)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn('build stream end summary failed', { streamId: input.streamId, err: msg })
    return
  }
  await postWebhook(content)
}

async function buildSummary(input: SummaryInput): Promise<string> {
  const { eventId, reason, errorMessage, minutes, costCents } = input

  const market = await loadMarket(eventId, input.streamId)
  const words = eventId.startsWith('custom_')
    ? await loadWordSummaries(eventId, parseInt(eventId.slice('custom_'.length), 10))
    : []

  const lines: string[] = []
  const headerEmoji = reason === 'manual_cancel' || reason === 'silence_watchdog' || reason === 'hard_cap'
    ? '🟢'
    : '🔴'
  const headerText = reason === 'manual_cancel' || reason === 'silence_watchdog' || reason === 'hard_cap'
    ? 'Stream ended — ready for resolution'
    : 'Stream ended with error'

  lines.push(`${headerEmoji} **${headerText}**`)
  lines.push('')
  lines.push(`Market: ${quoteOrFallback(market?.title)} (${eventId})`)
  if (market?.stream_url) {
    lines.push(`Stream: ${market.stream_url} (${formatDuration(minutes)} monitored, ${formatCost(costCents)})`)
  } else {
    lines.push(`Duration: ${formatDuration(minutes)} (${formatCost(costCents)})`)
  }
  lines.push(`Reason: ${humanReason(reason)}`)
  if (errorMessage) {
    lines.push(`Error: ${truncate(errorMessage, 300)}`)
  }
  lines.push('')

  if (words.length > 0) {
    const dismissedTotal = words.reduce((s, w) => s + w.dismissed_count, 0)
    const dismissedSuffix = dismissedTotal > 0 ? ` (excluding ${dismissedTotal} dismissed)` : ''
    lines.push(`**Mention summary**${dismissedSuffix}:`)
    for (const w of words) {
      lines.push(formatWordLine(w))
    }
    lines.push('')
  } else if (eventId.startsWith('custom_')) {
    lines.push('_No words configured for this market._')
    lines.push('')
  }

  lines.push(`Resolve: ${APP_BASE_URL}/customadmin`)
  return lines.join('\n')
}

async function loadMarket(eventId: string, streamId: number): Promise<MarketRow | null> {
  // Pull title from custom_markets when applicable, plus stream_url from
  // monitored_streams (always available).
  if (eventId.startsWith('custom_')) {
    const marketId = parseInt(eventId.slice('custom_'.length), 10)
    if (Number.isFinite(marketId)) {
      const res = await pool.query<MarketRow>(
        `SELECT cm.title AS title, ms.stream_url AS stream_url
           FROM monitored_streams ms
           LEFT JOIN custom_markets cm ON cm.id = $2
          WHERE ms.id = $1`,
        [streamId, marketId],
      )
      return res.rows[0] ?? null
    }
  }
  const res = await pool.query<MarketRow>(
    `SELECT NULL::TEXT AS title, stream_url
       FROM monitored_streams
      WHERE id = $1`,
    [streamId],
  )
  return res.rows[0] ?? null
}

async function loadWordSummaries(eventId: string, marketId: number): Promise<WordRow[]> {
  if (!Number.isFinite(marketId)) return []
  const res = await pool.query<WordRow>(
    `SELECT
       w.id AS word_index,
       w.word,
       w.mention_threshold,
       COALESCE(m.active_count, 0)::INT     AS active_count,
       COALESCE(m.dismissed_count, 0)::INT  AS dismissed_count,
       m.avg_conf
     FROM custom_market_words w
     LEFT JOIN (
       SELECT
         word_index,
         COUNT(*) FILTER (WHERE superseded = FALSE) AS active_count,
         COUNT(*) FILTER (WHERE superseded = TRUE)  AS dismissed_count,
         AVG(confidence) FILTER (WHERE superseded = FALSE) AS avg_conf
       FROM word_mentions
       WHERE event_id = $1
       GROUP BY word_index
     ) m ON m.word_index = w.id
     WHERE w.market_id = $2
     ORDER BY w.id`,
    [eventId, marketId],
  )
  return res.rows
}

function formatWordLine(w: WordRow): string {
  const meets = w.active_count >= w.mention_threshold
  const verdict = meets
    ? '✅ YES likely'
    : w.active_count > 0
      ? '⚠️ Below threshold'
      : '❌ NO likely'
  const confSuffix = w.active_count > 0 && w.avg_conf != null
    ? `  (avg conf ${w.avg_conf.toFixed(2)})`
    : ''
  return `• "${w.word}" → ${w.active_count} / threshold ${w.mention_threshold}  ${verdict}${confSuffix}`
}

function formatDuration(minutes: number): string {
  const totalMinutes = Math.max(0, Math.round(minutes))
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m}m`
  return `${h}h ${m.toString().padStart(2, '0')}m`
}

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function humanReason(reason: EndReason): string {
  switch (reason) {
    case 'manual_cancel': return 'manually ended by admin'
    case 'silence_watchdog': return 'silence watchdog (no audio for the configured window)'
    case 'hard_cap': return 'hit MAX_HOURS_PER_STREAM cap'
    case 'fetcher_failed': return 'audio source failed (fetcher exhausted retries)'
    case 'pipeline_error': return 'pipeline error'
    case 'shutdown': return 'worker shutdown'
  }
}

function quoteOrFallback(s: string | null | undefined): string {
  if (!s) return '_(untitled)_'
  return `"${s}"`
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}
