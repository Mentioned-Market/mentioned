import 'dotenv/config'
import { pool, ping } from './db'
import { log } from './log'
import { startHealthServer } from './health'
import { StreamListener, type ChannelName } from './listener'

const startedAt = Date.now()
let ready = false

// Phase 1: no real stream workers yet. Phase 3 will populate this map.
const activeStreams = new Map<number, unknown>()

async function main(): Promise<void> {
  log.info('transcript-worker booting', {
    nodeVersion: process.version,
    env: process.env.NODE_ENV ?? 'development',
  })

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required')
  }

  // Verify DB connectivity before signaling ready.
  await ping()
  log.info('database connection ok')

  // Health server first so Railway's probe succeeds even while we set up listeners.
  startHealthServer({
    ready: () => ready,
    startedAt,
    activeStreams: () => activeStreams.size,
  })

  const listener = new StreamListener(
    databaseUrl,
    ['stream_added', 'stream_canceled'],
    handleNotification,
  )

  // Boot recovery: any rows left in 'pending' or 'live' from a previous run.
  // Phase 1: log them only. Phase 3 will spawn workers.
  await recoverInflightStreams()

  // Run the listener loop in background. Reconnects internally on error.
  listener.start().catch((err) => {
    log.error('listener loop terminated', { err: err.message })
  })

  ready = true
  log.info('transcript-worker ready')

  // Periodic heartbeat. Useful in Railway logs to confirm the process is alive
  // and not silently wedged.
  setInterval(() => {
    log.info('heartbeat', {
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      activeStreams: activeStreams.size,
    })
  }, 60_000).unref()

  setupSignalHandlers(listener)
}

async function handleNotification(channel: ChannelName, payload: string): Promise<void> {
  // Phase 1: log. Phase 3 will spawn/cancel StreamWorkers from these.
  log.info('notification', { channel, payload })
}

async function recoverInflightStreams(): Promise<void> {
  // monitored_streams may not exist yet on an unmigrated DB. Tolerate it.
  try {
    const result = await pool.query<{ id: number; event_id: string; status: string }>(
      `SELECT id, event_id, status
         FROM monitored_streams
        WHERE status IN ('pending', 'live')
        ORDER BY created_at`,
    )
    if (result.rowCount && result.rowCount > 0) {
      log.info('boot recovery: found in-flight streams', {
        count: result.rowCount,
        ids: result.rows.map((r) => r.id),
      })
      // Phase 3: re-verify each via platform API and spawn StreamWorkers.
    } else {
      log.info('boot recovery: no in-flight streams')
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('relation "monitored_streams" does not exist')) {
      log.warn('boot recovery skipped: monitored_streams table missing — run migration')
    } else {
      throw err
    }
  }
}

function setupSignalHandlers(listener: StreamListener): void {
  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    log.info('shutdown initiated', { signal })
    ready = false

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
  process.on('SIGINT',  () => { void shutdown('SIGINT')  })
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err)
  log.error('fatal boot error', { err: msg })
  process.exit(1)
})
