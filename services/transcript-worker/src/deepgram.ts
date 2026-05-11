// Thin wrapper over @deepgram/sdk's live listen client. One instance per
// active WebSocket. The StreamWorker creates a replacement instance during
// rotation and switches the audio sink to it; finalize() the old one to
// drain its server-side buffer.
//
// We only persist finalized (is_final=true) results — interim results are
// disabled in the connection options.

import {
  createClient,
  LiveTranscriptionEvents,
  type DeepgramClient,
  type ListenLiveClient,
  type LiveSchema,
  type LiveTranscriptionEvent,
} from '@deepgram/sdk'
import { log } from './log'

export interface FinalizedTranscript {
  /** Plain transcript text from the top alternative. */
  text: string
  /** Confidence score for the alternative (0..1), or null if not present. */
  confidence: number | null
  /** Start offset within the connection, in seconds. */
  startSec: number
  /** Duration of this segment in seconds. */
  durationSec: number
  /** Per-word breakdown — useful for downstream timing/confidence. */
  words: { word: string; start: number; end: number; confidence: number }[]
}

export interface DeepgramConnectionOptions {
  apiKey: string
  keyterms: string[]
  /** Audio sample rate the worker is sending. Must match ffmpeg output. */
  sampleRate?: number
  language?: string
  /** Override Nova-3 default if needed (e.g., for tests). */
  model?: string
}

export interface DeepgramHandlers {
  onFinalized: (t: FinalizedTranscript) => void
  onError: (err: Error) => void
  onClose: (info: { code?: number; reason?: string }) => void
}

const KEEPALIVE_TICK_MS = 5_000
const STATS_TICK_MS = 60_000
const DRAIN_DELAY_MS = 2_000

let nextConnectionId = 1

export class DeepgramConnection {
  private readonly client: DeepgramClient
  private conn: ListenLiveClient | null = null
  private keepaliveTimer: NodeJS.Timeout | null = null
  private statsTimer: NodeJS.Timeout | null = null
  private closed = false
  private opened = false
  private readonly connectionId = nextConnectionId++
  private readonly openedAtMs = Date.now()
  private bytesSent = 0
  private finalizedCount = 0
  // Window counters reset every STATS_TICK_MS so each log line shows
  // throughput for the past minute, not the lifetime of the connection.
  private windowBytesSent = 0
  private windowFinalizedCount = 0

  constructor(
    private readonly opts: DeepgramConnectionOptions,
    private readonly handlers: DeepgramHandlers,
  ) {
    this.client = createClient(opts.apiKey)
  }

  /** Open the WS and wait for the server to acknowledge with `Open`. */
  open(): Promise<void> {
    if (this.conn) {
      return Promise.reject(new Error('connection already opened'))
    }
    const schema: LiveSchema = {
      model: this.opts.model ?? 'nova-3',
      language: this.opts.language ?? 'en',
      encoding: 'linear16',
      sample_rate: this.opts.sampleRate ?? 16000,
      channels: 1,
      smart_format: true,
      punctuate: true,
      interim_results: false,
      endpointing: 400,
      vad_events: true,
    }
    if (this.opts.keyterms.length > 0) {
      // Nova-3 keyterm prompting biases the model toward the supplied terms
      // without the brittle weight tuning that nova-2 keywords required.
      schema.keyterm = this.opts.keyterms
    }
    this.conn = this.client.listen.live(schema)

    return new Promise<void>((resolve, reject) => {
      const conn = this.conn!
      let settled = false
      const onOpen = () => {
        if (settled) return
        settled = true
        this.opened = true
        log.info('deepgram opened', { connectionId: this.connectionId })
        this.startKeepalive()
        this.startStatsTick()
        resolve()
      }
      const onError = (err: unknown) => {
        const e = err instanceof Error ? err : new Error(asString(err))
        if (!settled) {
          settled = true
          reject(e)
          return
        }
        // Post-open errors are surfaced via the handler; the SDK also fires
        // Close after a fatal error, which triggers our cleanup path.
        if (!this.closed) this.handlers.onError(e)
      }
      const onClose = (event: unknown) => {
        const info = parseCloseEvent(event)
        this.opened = false
        this.stopKeepalive()
        this.stopStatsTick()
        // Always log the lifetime stats on close so we can correlate against
        // the 1006 disconnects in production.
        log.info('deepgram closing — lifetime stats', {
          connectionId: this.connectionId,
          code: info.code,
          reason: info.reason,
          ageSec: ((Date.now() - this.openedAtMs) / 1000).toFixed(1),
          bytesSent: this.bytesSent,
          finalizedCount: this.finalizedCount,
        })
        if (!settled) {
          settled = true
          reject(new Error(`deepgram closed before open: code=${info.code ?? '?'}`))
          return
        }
        if (!this.closed) this.handlers.onClose(info)
      }
      const onTranscript = (data: LiveTranscriptionEvent) => {
        try {
          this.handleResults(data)
        } catch (err) {
          log.error('deepgram transcript handler threw', { err: asString(err) })
        }
      }

      conn.on(LiveTranscriptionEvents.Open, onOpen)
      conn.on(LiveTranscriptionEvents.Error, onError)
      conn.on(LiveTranscriptionEvents.Close, onClose)
      conn.on(LiveTranscriptionEvents.Transcript, onTranscript)
    })
  }

  /** Forward a PCM chunk. No-op if the connection is not open. */
  send(chunk: Buffer): void {
    if (!this.conn || !this.opened || this.closed) return
    try {
      // SDK types accept ArrayBufferLike but the underlying `ws` send accepts
      // Buffer at runtime. Cast to keep zero-copy.
      this.conn.send(chunk as unknown as ArrayBuffer)
      this.bytesSent += chunk.length
      this.windowBytesSent += chunk.length
    } catch (err) {
      log.warn('deepgram send threw', { connectionId: this.connectionId, err: asString(err) })
    }
  }

  /**
   * Close gracefully: ask the server to flush + close, give it a brief drain
   * window, then disconnect locally. Safe to call multiple times.
   */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.stopKeepalive()
    this.stopStatsTick()
    const conn = this.conn
    this.conn = null
    if (!conn) return
    try {
      // requestClose tells Deepgram we're done so it flushes any buffered
      // results before the WS shuts. The Close event will fire shortly after.
      conn.requestClose()
    } catch (err) {
      log.debug('deepgram requestClose threw', { err: asString(err) })
    }
    await sleep(DRAIN_DELAY_MS)
    try {
      conn.disconnect()
    } catch (err) {
      log.debug('deepgram disconnect threw', { err: asString(err) })
    }
  }

  /** Connection diagnostics — used by callers for log correlation. */
  stats(): { connectionId: number; ageMs: number; bytesSent: number; finalizedCount: number } {
    return {
      connectionId: this.connectionId,
      ageMs: Date.now() - this.openedAtMs,
      bytesSent: this.bytesSent,
      finalizedCount: this.finalizedCount,
    }
  }

  private startKeepalive(): void {
    // Send a KeepAlive every KEEPALIVE_TICK_MS regardless of whether we're
    // also pushing audio. Belt-and-braces — Deepgram tolerates "extra"
    // keepalives, and it eliminates one variable when debugging spurious
    // 1006 closes (we know for sure activity is reaching the WS).
    this.keepaliveTimer = setInterval(() => {
      if (!this.conn || this.closed || !this.opened) return
      try {
        this.conn.keepAlive()
      } catch (err) {
        log.warn('deepgram keepAlive threw', {
          connectionId: this.connectionId,
          err: asString(err),
        })
      }
    }, KEEPALIVE_TICK_MS)
    this.keepaliveTimer.unref()
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer)
      this.keepaliveTimer = null
    }
  }

  private startStatsTick(): void {
    this.statsTimer = setInterval(() => {
      if (this.closed) return
      log.info('deepgram window stats', {
        connectionId: this.connectionId,
        ageSec: ((Date.now() - this.openedAtMs) / 1000).toFixed(1),
        windowBytesSent: this.windowBytesSent,
        windowFinalized: this.windowFinalizedCount,
        lifetimeBytesSent: this.bytesSent,
        lifetimeFinalized: this.finalizedCount,
      })
      this.windowBytesSent = 0
      this.windowFinalizedCount = 0
    }, STATS_TICK_MS)
    this.statsTimer.unref()
  }

  private stopStatsTick(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer)
      this.statsTimer = null
    }
  }

  private handleResults(data: LiveTranscriptionEvent): void {
    if (data.type !== 'Results') return
    if (!data.is_final) return
    const alt = data.channel?.alternatives?.[0]
    if (!alt) return
    const text = (alt.transcript ?? '').trim()
    if (!text) return
    this.finalizedCount++
    this.windowFinalizedCount++
    this.handlers.onFinalized({
      text: alt.transcript,
      confidence: typeof alt.confidence === 'number' ? alt.confidence : null,
      startSec: data.start,
      durationSec: data.duration,
      words: (alt.words ?? []).map((w) => ({
        word: w.word,
        start: w.start,
        end: w.end,
        confidence: w.confidence,
      })),
    })
  }
}

function parseCloseEvent(event: unknown): { code?: number; reason?: string } {
  if (event && typeof event === 'object') {
    const e = event as { code?: number; reason?: string }
    return { code: e.code, reason: e.reason }
  }
  return {}
}

function asString(v: unknown): string {
  if (v instanceof Error) return v.message
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
