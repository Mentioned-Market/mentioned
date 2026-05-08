import 'dotenv/config'
import { pool, ping } from './db'
import { log } from './log'
import { startHealthServer } from './health'
import { StreamListener, type ChannelName } from './listener'
import { StreamWorker, type EndReason, type StreamWorkerConfig } from './streamWorker'
import { detectSource, type StreamSource } from './streamUrl'
import type { MatchableWord } from './wordMatcher'

const startedAt = Date.now()
let ready = false

const env = {
  deepgramApiKey: process.env.DEEPGRAM_API_KEY ?? '',
  maxConcurrent: numberFromEnv('MAX_CONCURRENT_STREAMS', 20),
  maxHours: numberFromEnv('MAX_HOURS_PER_STREAM', 12),
  maxSilentMinutes: numberFromEnv('MAX_SILENT_MINUTES', 20),
  deepgramRotateMinutes: numberFromEnv('DEEPGRAM_ROTATE_MINUTES', 90),
  ffmpegRecycleMinutes: numberFromEnv('FFMPEG_RECYCLE_MINUTES', 240),
}

const activeStreams = new Map<number, StreamWorker>()

async function main(): Promise<void> {
  log.info('transcript-worker booting', {
    nodeVersion: process.version,
    env: process.env.NODE_ENV ?? 'development',
    maxConcurrent: env.maxConcurrent,
    maxHours: env.maxHours,
    maxSilentMinutes: env.maxSilentMinutes,
    deepgramConfigured: env.deepgramApiKey.length > 0,
  })

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required')
  }
  if (!env.deepgramApiKey) {
    log.warn('DEEPGRAM_API_KEY not set — worker will refuse to spawn stream workers')
  }

  await ping()
  log.info('database connection ok')

  startHealthServer({
    ready: () => ready,
    startedAt,
    activeStreams: () => activeStreams.size,
  })

  const listener = new StreamListener(
    process.env.DATABASE_URL!,
    ['stream_added', 'stream_canceled'],
    handleNotification,
  )

  await recoverInflightStreams()

  listener.start().catch((err) => {
    log.error('listener loop terminated', { err: err.message })
  })

  ready = true
  log.info('transcript-worker ready')

  setInterval(() => {
    log.info('heartbeat', {
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      activeStreams: activeStreams.size,
    })
  }, 60_000).unref()

  setupSignalHandlers(listener)
}

// ---------------------------------------------------------------------------
// Notification handling
// ---------------------------------------------------------------------------

async function handleNotification(channel: ChannelName, payload: string): Promise<void> {
  log.info('notification', { channel, payload })
  let parsed: { streamId?: number } = {}
  try {
    parsed = payload ? JSON.parse(payload) : {}
  } catch {
    log.warn('notification payload not JSON', { channel, payload })
    return
  }
  const streamId = typeof parsed.streamId === 'number' ? parsed.streamId : null
  if (streamId == null) {
    log.warn('notification missing streamId', { channel })
    return
  }

  if (channel === 'stream_added') {
    await onStreamAdded(streamId)
  } else if (channel === 'stream_canceled') {
    await onStreamCanceled(streamId)
  }
}

async function onStreamAdded(streamId: number): Promise<void> {
  if (activeStreams.has(streamId)) {
    log.debug('stream already active, ignoring duplicate add', { streamId })
    return
  }
  if (activeStreams.size >= env.maxConcurrent) {
    log.warn('at max concurrent streams, deferring spawn', {
      streamId,
      activeStreams: activeStreams.size,
      cap: env.maxConcurrent,
    })
    return
  }

  // CAS spawn gate. Only the caller that flips pending→live owns the worker.
  const claim = await pool.query<{
    id: number
    event_id: string
    stream_url: string
    source: string | null
    started_at: Date
  }>(
    `UPDATE monitored_streams
        SET status = 'live',
            started_at = COALESCE(started_at, NOW()),
            source = COALESCE(source, $2),
            updated_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING id, event_id, stream_url, source, started_at`,
    [streamId, null], // source is filled in below if we know it
  )
  if (claim.rowCount === 0) {
    log.info('stream_added: another worker already claimed it', { streamId })
    return
  }
  const row = claim.rows[0]
  await spawnWorker(row)
}

async function onStreamCanceled(streamId: number): Promise<void> {
  const worker = activeStreams.get(streamId)
  if (!worker) {
    log.debug('stream_canceled: no active worker', { streamId })
    return
  }
  await worker.stop('manual_cancel')
}

// ---------------------------------------------------------------------------
// Boot recovery
// ---------------------------------------------------------------------------

interface MonitoredStreamRow {
  id: number
  event_id: string
  stream_url: string
  source: string | null
  started_at: Date | null
}

async function recoverInflightStreams(): Promise<void> {
  let rows: MonitoredStreamRow[]
  try {
    const result = await pool.query<MonitoredStreamRow>(
      `SELECT id, event_id, stream_url, source, started_at
         FROM monitored_streams
        WHERE status IN ('pending', 'live')
        ORDER BY created_at`,
    )
    rows = result.rows
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('relation "monitored_streams" does not exist')) {
      log.warn('boot recovery skipped: monitored_streams table missing — run migration')
      return
    }
    throw err
  }

  if (rows.length === 0) {
    log.info('boot recovery: no in-flight streams')
    return
  }
  log.info('boot recovery: found in-flight streams', { count: rows.length, ids: rows.map((r) => r.id) })

  // Phase 3 note (per spec): no API re-verification — pick up live rows
  // directly. Pending rows go through the same CAS spawn gate as
  // stream_added would.
  for (const row of rows) {
    if (activeStreams.size >= env.maxConcurrent) {
      log.warn('boot recovery: cap reached, leaving remaining streams unstarted', {
        cap: env.maxConcurrent,
      })
      break
    }
    try {
      await resumeOrClaim(row)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('boot recovery: failed to start worker', { streamId: row.id, err: msg })
    }
  }
}

async function resumeOrClaim(row: MonitoredStreamRow): Promise<void> {
  // First try to claim if pending; if already live, claim is a no-op.
  const claim = await pool.query<MonitoredStreamRow>(
    `UPDATE monitored_streams
        SET status = 'live',
            started_at = COALESCE(started_at, NOW()),
            updated_at = NOW()
      WHERE id = $1 AND status IN ('pending', 'live')
      RETURNING id, event_id, stream_url, source, started_at`,
    [row.id],
  )
  if (claim.rowCount === 0) {
    log.info('boot recovery: row no longer claimable', { streamId: row.id })
    return
  }
  await spawnWorker(claim.rows[0])
}

// ---------------------------------------------------------------------------
// Worker spawn
// ---------------------------------------------------------------------------

async function spawnWorker(row: MonitoredStreamRow): Promise<void> {
  if (!env.deepgramApiKey) {
    await markStreamError(row.id, 'DEEPGRAM_API_KEY not configured')
    return
  }

  const source = (row.source as StreamSource | null) ?? detectSource(row.stream_url)
  if (!source) {
    await markStreamError(row.id, `unsupported stream URL: ${row.stream_url}`)
    return
  }

  // Cache the detected source so admins can see it and future runs skip
  // detection. Only update if the row didn't already have one.
  if (!row.source) {
    await pool
      .query('UPDATE monitored_streams SET source = $2, updated_at = NOW() WHERE id = $1', [
        row.id,
        source,
      ])
      .catch(() => {})
  }

  let words: MatchableWord[]
  try {
    words = await loadWordsForEvent(row.event_id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('failed to load words', { streamId: row.id, eventId: row.event_id, err: msg })
    await markStreamError(row.id, `failed to load words: ${msg}`)
    return
  }

  const cfg: StreamWorkerConfig = {
    streamId: row.id,
    eventId: row.event_id,
    streamUrl: row.stream_url,
    source,
    startedAt: row.started_at ?? new Date(),
    deepgramApiKey: env.deepgramApiKey,
    words,
    maxHours: env.maxHours,
    maxSilentMinutes: env.maxSilentMinutes,
    deepgramRotateMinutes: env.deepgramRotateMinutes,
    ffmpegRecycleMinutes: env.ffmpegRecycleMinutes,
  }
  const worker = new StreamWorker(cfg, {
    onEnded: (reason: EndReason) => {
      activeStreams.delete(row.id)
      log.info('stream worker reaped', { streamId: row.id, reason })
    },
  })
  activeStreams.set(row.id, worker)

  try {
    await worker.start()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('stream worker start failed', { streamId: row.id, err: msg })
    activeStreams.delete(row.id)
    await markStreamError(row.id, `start failed: ${msg}`)
  }
}

async function loadWordsForEvent(eventId: string): Promise<MatchableWord[]> {
  // v1: free markets only. event_id format is 'custom_<id>'. Strip and query
  // custom_market_words for that market.
  if (!eventId.startsWith('custom_')) {
    log.warn('loadWordsForEvent: non-custom event_id, returning empty word list', { eventId })
    return []
  }
  const marketId = parseInt(eventId.slice('custom_'.length), 10)
  if (!Number.isFinite(marketId)) {
    throw new Error(`malformed event_id: ${eventId}`)
  }
  const result = await pool.query<{ id: number; word: string; match_variants: string[] | null }>(
    `SELECT id, word, COALESCE(match_variants, ARRAY[]::TEXT[]) AS match_variants
       FROM custom_market_words
      WHERE market_id = $1
      ORDER BY id`,
    [marketId],
  )
  return result.rows.map((r) => ({
    index: r.id,
    word: r.word,
    variants: r.match_variants ?? [],
  }))
}

async function markStreamError(streamId: number, message: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE monitored_streams
          SET status = 'error',
              error_message = $2,
              ended_at = NOW(),
              updated_at = NOW()
        WHERE id = $1 AND status IN ('pending', 'live')`,
      [streamId, message],
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('mark stream error failed', { streamId, err: msg })
  }
}

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

function setupSignalHandlers(listener: StreamListener): void {
  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    log.info('shutdown initiated', { signal, activeStreams: activeStreams.size })
    ready = false

    // Stop workers in parallel; each call is idempotent.
    const workers = Array.from(activeStreams.values())
    await Promise.allSettled(workers.map((w) => w.stop('shutdown')))

    try {
      await listener.stop()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('listener stop failed', { err: msg })
    }

    try {
      await pool.end()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('pool end failed', { err: msg })
    }

    log.info('shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
  process.on('SIGINT', () => { void shutdown('SIGINT') })
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err)
  log.error('fatal boot error', { err: msg })
  process.exit(1)
})
