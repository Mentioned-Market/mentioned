// Standalone VOD transcription. Sister to StreamWorker for the live path —
// same DB shape, same matcher, same Discord summary, different code path.
//
// Lifecycle for a single VOD:
//
//   yt-dlp -g <url>           → direct media URL (HLS or audio file)
//        ↓
//   POST /v1/listen url=...   → Deepgram pre-recorded API (sync, ~1-15min)
//        ↓
//   parse response.utterances → INSERT live_transcript_segments
//        ↓                    → matcher.ingest → INSERT word_mentions (one batch)
//        ↓
//   UPDATE monitored_streams status='ended', minutes_used, cost_cents
//   NOTIFY stream_ended; post Discord summary
//
// Per-mention Discord pings are intentionally skipped — VOD finalization is
// batch, so firing N pings simultaneously when results land would just spam
// the channel without real signal. The end-of-stream summary is enough.

import { spawn } from 'node:child_process'
import { pool } from './db'
import { log } from './log'
import {
  transcribePrerecorded,
  transcribePrerecordedBytes,
  type DeepgramUtterance,
  type PrerecordedResult,
} from './deepgramRest'
import { WordMatcher, type MatchableWord } from './wordMatcher'
import { postStreamEndSummary } from './streamSummary'
import type { EndReason } from './streamWorker'

const COST_CENTS_PER_MINUTE = 0.48
const YTDLP_RESOLVE_TIMEOUT_MS = 60_000
const YTDLP_DOWNLOAD_TIMEOUT_MS = 30 * 60_000
const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024 // 1 GB hard cap on download size

/**
 * True when yt-dlp's resolved URL is directly fetchable by an arbitrary
 * client (Twitch HLS m3u8). False when the URL is bound to the requesting
 * client and a third party fetching it gets 403 (YouTube). Determines
 * whether we hand Deepgram the URL or the bytes.
 */
function canDeepgramFetchDirectly(streamUrl: string): boolean {
  let host: string
  try {
    host = new URL(streamUrl).hostname
  } catch {
    return false
  }
  // Twitch VOD HLS playlists are publicly fetchable until they expire.
  if (/(^|\.)twitch\.tv$/i.test(host)) return true
  // YouTube — and anything we don't explicitly trust — gets the bytes path.
  return false
}

export interface VodJobConfig {
  streamId: number
  eventId: string
  streamUrl: string
  startedAt: Date
  deepgramApiKey: string
  words: MatchableWord[]
}

export interface VodJobCallbacks {
  /** Invoked exactly once when the job has fully shut down. */
  onEnded: (reason: EndReason, errorMessage?: string) => void
}

export class VodJob {
  private readonly matcher: WordMatcher
  private readonly abort = new AbortController()
  private shutdownPromise: Promise<void> | null = null
  private startedAtMs: number

  constructor(
    private readonly cfg: VodJobConfig,
    private readonly cb: VodJobCallbacks,
  ) {
    this.startedAtMs = cfg.startedAt.getTime()
    this.matcher = new WordMatcher(cfg.words)
  }

  /**
   * Run the full VOD pipeline. Resolves when the job is done (success or
   * failure); the promise itself doesn't reject — failures route through
   * `stop('pipeline_error', ...)` so the lifecycle ends cleanly with the
   * right DB transitions.
   */
  async start(): Promise<void> {
    log.info('vod job starting', {
      streamId: this.cfg.streamId,
      eventId: this.cfg.eventId,
      words: this.cfg.words.length,
    })

    const keyterms = this.cfg.words.flatMap((w) => [w.word, ...w.variants]).filter(Boolean)

    // YouTube audio URLs are bound to the requesting client (User-Agent +
    // headers + IP) — handing the URL to Deepgram results in 403 from
    // YouTube's CDN. Twitch HLS m3u8s are publicly fetchable and work fine
    // via the URL form, which is faster (no Railway egress) and supports
    // larger files. Pick per-host.
    const useUrlForm = canDeepgramFetchDirectly(this.cfg.streamUrl)
    let result: PrerecordedResult

    try {
      if (useUrlForm) {
        const mediaUrl = await this.resolveMediaUrl(this.cfg.streamUrl)
        if (this.shutdownPromise) return
        result = await transcribePrerecorded(
          this.cfg.deepgramApiKey,
          { audioUrl: mediaUrl, keyterms, signal: this.abort.signal },
        )
      } else {
        const audio = await this.downloadAudio(this.cfg.streamUrl)
        if (this.shutdownPromise) return
        log.info('vod job: download complete, submitting to deepgram', {
          streamId: this.cfg.streamId,
          bytes: audio.length,
        })
        result = await transcribePrerecordedBytes(
          this.cfg.deepgramApiKey,
          { audio, keyterms, signal: this.abort.signal },
        )
      }
    } catch (err) {
      if (this.abort.signal.aborted) {
        // Caller canceled — stop() has already started; let it finish.
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      const reason: EndReason = msg.startsWith('yt-dlp ') ? 'fetcher_failed' : 'pipeline_error'
      await this.stop(reason, msg)
      return
    }

    if (this.shutdownPromise) return

    log.info('vod job: deepgram complete', {
      streamId: this.cfg.streamId,
      requestId: result.requestId,
      durationSec: result.durationSec,
      utterances: result.utterances.length,
    })

    try {
      await this.persistResult(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await this.stop('pipeline_error', `persist result failed: ${msg}`)
      return
    }

    await this.completeOk(result)
  }

  /**
   * Stop the job. Idempotent. For an in-flight Deepgram request, aborts the
   * fetch — but Deepgram has likely already started transcribing and will
   * still bill us. Cancel is a "wrong URL, abandon" tool, not a refund.
   */
  async stop(reason: EndReason, errorMessage?: string): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    this.shutdownPromise = this.shutdownInternal(reason, errorMessage)
    return this.shutdownPromise
  }

  // ---------------------------------------------------------------------------

  private async resolveMediaUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // -g prints the resolved direct URL. We pick bestaudio/best so we get
      // an audio-only stream when the platform exposes one, falling back to
      // the muxed stream Deepgram will demux server-side either way.
      // --js-runtimes node uses the container's existing Node binary as
      // yt-dlp's JS runtime — required since yt-dlp 2025 for YouTube URL
      // signing. See https://github.com/yt-dlp/yt-dlp/wiki/EJS
      const yt = spawn(
        'yt-dlp',
        [
          '-g',
          '--js-runtimes', 'node',
          '--extractor-args', 'youtube:player_client=tv,web_safari',
          '-f', 'bestaudio/best',
          url,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
      let stdout = ''
      let stderr = ''
      const timeout = setTimeout(() => {
        try { yt.kill('SIGTERM') } catch {}
        reject(new Error(`yt-dlp -g timed out after ${YTDLP_RESOLVE_TIMEOUT_MS}ms`))
      }, YTDLP_RESOLVE_TIMEOUT_MS)
      timeout.unref()

      const onAbort = () => {
        try { yt.kill('SIGTERM') } catch {}
      }
      this.abort.signal.addEventListener('abort', onAbort, { once: true })

      yt.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
      yt.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
      yt.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
      yt.on('exit', (code) => {
        clearTimeout(timeout)
        this.abort.signal.removeEventListener('abort', onAbort)
        if (code !== 0) {
          reject(new Error(`yt-dlp -g failed: exited code ${code}: ${stderr.trim().slice(-500)}`))
          return
        }
        // yt-dlp -g may print multiple lines (video + audio for some sites);
        // we want the audio one. With -f bestaudio/best it prints exactly
        // one URL; fall back to first non-empty line otherwise.
        const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
        if (lines.length === 0) {
          reject(new Error('yt-dlp -g produced no output'))
          return
        }
        resolve(lines[lines.length - 1])
      })
    })
  }

  /**
   * Download the audio stream to a Buffer via yt-dlp's stdout. Used for
   * sources whose URLs Deepgram can't fetch directly (YouTube). Hard cap
   * at MAX_DOWNLOAD_BYTES to prevent a runaway from exhausting container
   * memory.
   */
  private async downloadAudio(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      log.info('vod job: downloading audio via yt-dlp', { streamId: this.cfg.streamId })
      const yt = spawn(
        'yt-dlp',
        [
          '-q',
          '--js-runtimes', 'node',
          '--extractor-args', 'youtube:player_client=tv,web_safari',
          '-o', '-',
          '-f', 'bestaudio/best',
          url,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
      const chunks: Buffer[] = []
      let totalBytes = 0
      let stderr = ''
      let aborted = false

      const timeout = setTimeout(() => {
        aborted = true
        try { yt.kill('SIGTERM') } catch {}
        reject(new Error(`yt-dlp download timed out after ${YTDLP_DOWNLOAD_TIMEOUT_MS / 1000}s`))
      }, YTDLP_DOWNLOAD_TIMEOUT_MS)
      timeout.unref()

      const onAbort = () => {
        aborted = true
        try { yt.kill('SIGTERM') } catch {}
      }
      this.abort.signal.addEventListener('abort', onAbort, { once: true })

      // Periodic progress log so the admin doesn't think it's hung.
      const progressTimer = setInterval(() => {
        log.info('vod job: download progress', {
          streamId: this.cfg.streamId,
          megabytes: (totalBytes / 1_048_576).toFixed(1),
        })
      }, 30_000)
      progressTimer.unref()

      yt.stdout.on('data', (chunk: Buffer) => {
        if (aborted) return
        totalBytes += chunk.length
        if (totalBytes > MAX_DOWNLOAD_BYTES) {
          aborted = true
          try { yt.kill('SIGTERM') } catch {}
          reject(new Error(
            `yt-dlp download exceeded ${MAX_DOWNLOAD_BYTES / 1_048_576}MB cap — refusing to buffer further`,
          ))
          return
        }
        chunks.push(chunk)
      })
      yt.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
      yt.on('error', (err) => {
        clearTimeout(timeout)
        clearInterval(progressTimer)
        reject(err)
      })
      yt.on('exit', (code) => {
        clearTimeout(timeout)
        clearInterval(progressTimer)
        this.abort.signal.removeEventListener('abort', onAbort)
        if (aborted) return // already rejected
        if (code !== 0) {
          reject(new Error(`yt-dlp download failed: exited code ${code}: ${stderr.trim().slice(-500)}`))
          return
        }
        if (totalBytes === 0) {
          reject(new Error('yt-dlp download produced no audio bytes'))
          return
        }
        resolve(Buffer.concat(chunks, totalBytes))
      })
    })
  }

  private async persistResult(result: PrerecordedResult): Promise<void> {
    if (result.utterances.length === 0) {
      log.warn('vod job: no utterances to persist', { streamId: this.cfg.streamId })
      return
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const u of result.utterances) {
        const segmentId = await this.insertSegment(client, u)
        if (segmentId == null) continue
        await this.insertMatchesForUtterance(client, u, segmentId)
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  private async insertSegment(
    client: { query: (text: string, params: unknown[]) => Promise<{ rows: { id: string }[] }> },
    u: DeepgramUtterance,
  ): Promise<number | null> {
    const startMs = Math.max(0, Math.round(u.start * 1000))
    const endMs = Math.max(startMs, Math.round(u.end * 1000))
    const text = (u.transcript ?? '').trim()
    if (!text) return null
    const res = await client.query(
      `INSERT INTO live_transcript_segments
         (stream_id, start_ms, end_ms, text, confidence)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [this.cfg.streamId, startMs, endMs, u.transcript, u.confidence],
    )
    return res.rows[0] ? Number(res.rows[0].id) : null
  }

  private async insertMatchesForUtterance(
    client: { query: (text: string, params: unknown[]) => Promise<{ rowCount: number | null }> },
    u: DeepgramUtterance,
    segmentId: number,
  ): Promise<void> {
    const hits = this.matcher.ingest(u.transcript ?? '')
    if (hits.length === 0) return
    const utteranceStartMs = Math.max(0, Math.round(u.start * 1000))
    for (const hit of hits) {
      try {
        await client.query(
          `INSERT INTO word_mentions
             (stream_id, event_id, word_index, word, matched_text,
              segment_id, stream_offset_ms, global_char_offset, snippet, confidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (stream_id, word_index, global_char_offset) DO NOTHING`,
          [
            this.cfg.streamId,
            this.cfg.eventId,
            hit.wordIndex,
            hit.word,
            hit.matchedText,
            segmentId,
            utteranceStartMs,
            hit.globalCharOffset,
            hit.snippet,
            u.confidence,
          ],
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error('vod job: insert mention failed', {
          streamId: this.cfg.streamId,
          wordIndex: hit.wordIndex,
          err: msg,
        })
      }
    }
  }

  private async completeOk(result: PrerecordedResult): Promise<void> {
    const minutes = result.durationSec / 60
    const costCents = Math.round(minutes * COST_CENTS_PER_MINUTE)
    try {
      await pool.query(
        `UPDATE monitored_streams
            SET status = 'ended',
                ended_at = NOW(),
                minutes_used = $2,
                cost_cents = $3,
                updated_at = NOW()
          WHERE id = $1 AND status = 'live'`,
        [this.cfg.streamId, minutes, costCents],
      )
      await pool.query(
        'SELECT pg_notify($1, $2)',
        [
          'stream_ended',
          JSON.stringify({
            streamId: this.cfg.streamId,
            eventId: this.cfg.eventId,
            reason: 'manual_cancel',
            kind: 'vod',
          }),
        ],
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('vod job: end DB update failed', { streamId: this.cfg.streamId, err: msg })
    }

    void postStreamEndSummary({
      streamId: this.cfg.streamId,
      eventId: this.cfg.eventId,
      // Use 'manual_cancel' as the success reason so the summary header
      // reads as "Stream ended — ready for resolution" instead of
      // "Stream ended with error". Acceptable shorthand until we extend
      // EndReason with a 'vod_complete' variant.
      reason: 'manual_cancel',
      errorMessage: null,
      minutes,
      costCents,
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('vod job: discord summary failed', { streamId: this.cfg.streamId, err: msg })
    })

    log.info('vod job complete', {
      streamId: this.cfg.streamId,
      requestId: result.requestId,
      minutes,
      costCents,
      utterances: result.utterances.length,
    })

    try {
      this.cb.onEnded('manual_cancel')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('vod job: onEnded threw', { streamId: this.cfg.streamId, err: msg })
    }
  }

  private async shutdownInternal(reason: EndReason, errorMessage?: string): Promise<void> {
    log.info('vod job stopping', {
      streamId: this.cfg.streamId,
      reason,
      err: errorMessage,
    })

    try { this.abort.abort(new Error(`vod job stopping: ${reason}`)) } catch {}

    if (reason === 'shutdown') {
      // SIGTERM: leave the row in 'live' so boot recovery resumes / re-submits.
      log.info('vod job stopped (shutdown — row stays live for boot recovery)', {
        streamId: this.cfg.streamId,
      })
      try { this.cb.onEnded(reason, errorMessage) } catch {}
      return
    }

    const status =
      reason === 'manual_cancel' || reason === 'silence_watchdog' || reason === 'hard_cap'
        ? 'ended'
        : 'error'

    const minutes = Math.max(0, (Date.now() - this.startedAtMs) / 60_000)

    try {
      await pool.query(
        `UPDATE monitored_streams
            SET status = $2,
                ended_at = NOW(),
                error_message = $3,
                updated_at = NOW()
          WHERE id = $1 AND status = 'live'`,
        [this.cfg.streamId, status, errorMessage ?? null],
      )
      await pool.query(
        'SELECT pg_notify($1, $2)',
        [
          'stream_ended',
          JSON.stringify({
            streamId: this.cfg.streamId,
            eventId: this.cfg.eventId,
            reason,
            kind: 'vod',
          }),
        ],
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('vod job: shutdown DB update failed', { streamId: this.cfg.streamId, err: msg })
    }

    void postStreamEndSummary({
      streamId: this.cfg.streamId,
      eventId: this.cfg.eventId,
      reason,
      errorMessage: errorMessage ?? null,
      minutes,
      costCents: 0,
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('vod job: discord summary failed', { streamId: this.cfg.streamId, err: msg })
    })

    log.info('vod job stopped', { streamId: this.cfg.streamId, reason })
    try {
      this.cb.onEnded(reason, errorMessage)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('vod job: onEnded threw', { streamId: this.cfg.streamId, err: msg })
    }
  }
}
