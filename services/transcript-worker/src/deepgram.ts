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
const KEEPALIVE_IDLE_MS = 4_000
const DRAIN_DELAY_MS = 2_000

export class DeepgramConnection {
  private readonly client: DeepgramClient
  private conn: ListenLiveClient | null = null
  private keepaliveTimer: NodeJS.Timeout | null = null
  private lastSentAt = 0
  private closed = false
  private opened = false

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
        this.lastSentAt = Date.now()
        this.startKeepalive()
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
      this.lastSentAt = Date.now()
    } catch (err) {
      log.warn('deepgram send threw', { err: asString(err) })
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

  private startKeepalive(): void {
    this.keepaliveTimer = setInterval(() => {
      if (!this.conn || this.closed) return
      if (Date.now() - this.lastSentAt > KEEPALIVE_IDLE_MS) {
        try {
          this.conn.keepAlive()
        } catch (err) {
          log.warn('deepgram keepAlive threw', { err: asString(err) })
        }
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

  private handleResults(data: LiveTranscriptionEvent): void {
    if (data.type !== 'Results') return
    if (!data.is_final) return
    const alt = data.channel?.alternatives?.[0]
    if (!alt) return
    const text = (alt.transcript ?? '').trim()
    if (!text) return
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
