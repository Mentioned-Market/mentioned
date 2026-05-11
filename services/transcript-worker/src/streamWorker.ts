// Per-stream lifecycle. One instance per row in `monitored_streams` with
// status='live'. Owns:
//
//   audio source ──▶ ffmpeg ──pcm──▶ DeepgramConnection
//                                            │
//                                            ▼
//                                  finalized segments → DB writes →
//                                  NOTIFY word_mention → admin SSE
//
// The "audio source" is one of:
//   - piped: streamlink|yt-dlp child writing TS to stdout, ffmpeg consuming
//     it on stdin (cloud worker, twitch:// + youtube:// URLs).
//   - direct: ffmpeg reading from a local audio device (laptop worker,
//     local-audio:// URLs with WORKER_POOL=local).
//
// Periodic Deepgram WS rotation (every DEEPGRAM_ROTATE_MINUTES) and ffmpeg
// recycle (every FFMPEG_RECYCLE_MINUTES) keep long streams healthy. Silence
// watchdog and hard-cap timer protect against runaway cost.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { pool } from './db'
import { log } from './log'
import { DeepgramConnection, type FinalizedTranscript } from './deepgram'
import { postFirstMentionPing, postStreamEndSummary } from './streamSummary'
import {
  buildPipeline,
  type DirectPipeline,
  type LocalAudioConfig,
  type Pipeline,
  type PipedPipeline,
  type StreamSource,
} from './streamUrl'
import { WordMatcher, type MatchableWord, type MatchHit } from './wordMatcher'

// Cost rate: Nova-3 monolingual streaming is $0.0048/min → 0.48 cents/min.
const COST_CENTS_PER_MINUTE = 0.48

const FETCHER_RESTART_DELAYS_MS = [5_000, 15_000, 45_000] as const

// Backoff for unscheduled Deepgram WS drops. Spec calls for 1/3/9s, abandon
// after 3 fast-consecutive failures.
const DEEPGRAM_REPLACE_DELAYS_MS = [1_000, 3_000, 9_000] as const

// If the last connection lasted at least this long, treat it as "stable" and
// reset the rapid-fail counter. Otherwise the close event is part of a
// burst and we count toward the abandon threshold.
const DEEPGRAM_STABLE_MS = 2 * 60_000

// Minimum Deepgram per-mention confidence required to auto-lock a word into
// pending_resolution. Words must also be admin-opted-in (auto_lock_enabled).
const AUTO_LOCK_MIN_CONFIDENCE = 0.95

export type EndReason =
  | 'manual_cancel'
  | 'silence_watchdog'
  | 'hard_cap'
  | 'fetcher_failed'
  | 'pipeline_error'
  | 'shutdown'

export interface StreamWorkerConfig {
  streamId: number
  eventId: string
  streamUrl: string
  source: StreamSource
  /** UTC timestamp when the stream first transitioned to 'live'. */
  startedAt: Date
  deepgramApiKey: string
  /** Words+variants to match. Empty array is allowed; transcripts still persist. */
  words: MatchableWord[]
  maxHours: number
  maxSilentMinutes: number
  deepgramRotateMinutes: number
  ffmpegRecycleMinutes: number
  /**
   * Required for `source === 'local-audio'`. Resolved from env (LOCAL_AUDIO_*)
   * by the manager so a single laptop can be retargeted between streams
   * without changing DB rows.
   */
  localAudio?: LocalAudioConfig
}

export interface StreamWorkerCallbacks {
  /** Invoked exactly once when the worker has fully shut down. */
  onEnded: (reason: EndReason, errorMessage?: string) => void
}

export class StreamWorker {
  private pipe: AudioPipe | null = null
  private nextPipe: AudioPipe | null = null
  private activeDg: DeepgramConnection | null = null
  private drainingDgs: DeepgramConnection[] = []
  private matcher: WordMatcher

  private rotationTimer: NodeJS.Timeout | null = null
  private recycleTimer: NodeJS.Timeout | null = null
  private hardCapTimer: NodeJS.Timeout | null = null
  private silenceTimer: NodeJS.Timeout | null = null
  private minutesTimer: NodeJS.Timeout | null = null

  private lastFinalizedAt = Date.now()
  private startedAtMs: number
  private shutdownPromise: Promise<void> | null = null

  /** Per-word threshold lookup, populated from cfg.words at construction. */
  private readonly thresholdByWordIndex: Map<number, number>
  /** Per-word auto-lock opt-in lookup, populated from cfg.words at construction. */
  private readonly autoLockByWordIndex: Map<number, boolean>
  /** Words for which we've already fired a first-mention Discord ping this run. */
  private readonly pingedWordIndices = new Set<number>()
  /** Words for which we've already auto-flipped pending_resolution this run. */
  private readonly autoLockedWordIndices = new Set<number>()

  // Deepgram replacement backoff state.
  private deepgramReplaceAttempts = 0
  private deepgramReplaceTimer: NodeJS.Timeout | null = null
  private lastDeepgramOpenedAtMs = 0

  constructor(
    private readonly cfg: StreamWorkerConfig,
    private readonly cb: StreamWorkerCallbacks,
  ) {
    this.startedAtMs = cfg.startedAt.getTime()
    this.matcher = new WordMatcher(cfg.words)
    this.thresholdByWordIndex = new Map(cfg.words.map((w) => [w.index, w.threshold]))
    this.autoLockByWordIndex = new Map(cfg.words.map((w) => [w.index, w.autoLockEnabled]))
  }

  async start(): Promise<void> {
    log.info('stream worker starting', {
      streamId: this.cfg.streamId,
      eventId: this.cfg.eventId,
      source: this.cfg.source,
      words: this.cfg.words.length,
    })

    // Open Deepgram first. If it fails we don't bother spawning ffmpeg.
    const dg = await this.openDeepgram()
    this.activeDg = dg

    // Spawn the audio pipe. Audio chunks route to `activeDg` which may swap
    // during rotation; the pipe just calls into the dispatcher below.
    this.pipe = await this.spawnPipe()

    // Background timers for long-stream maintenance + cost protection.
    this.scheduleTimers()
    this.lastFinalizedAt = Date.now()
  }

  /**
   * Stop the worker. Idempotent. The `onEnded` callback fires exactly once
   * regardless of how many times this is called.
   */
  async stop(reason: EndReason, errorMessage?: string): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    this.shutdownPromise = this.shutdownInternal(reason, errorMessage)
    return this.shutdownPromise
  }

  // ---------------------------------------------------------------------------
  // Audio pipe lifecycle
  // ---------------------------------------------------------------------------

  private async spawnPipe(): Promise<AudioPipe> {
    // Re-build the pipeline spec on every (re)spawn so URL re-resolution and
    // local-device re-acquisition happen fresh.
    const factory = () => buildPipeline(this.cfg.streamUrl, this.cfg.localAudio)
    const pipe = new AudioPipe(factory, {
      onPcm: (chunk) => this.dispatchAudio(chunk),
      onUnrecoverable: (err) => {
        log.error('audio pipe unrecoverable', {
          streamId: this.cfg.streamId,
          err: err.message,
        })
        void this.stop('fetcher_failed', err.message)
      },
    })
    await pipe.start()
    return pipe
  }

  private dispatchAudio(chunk: Buffer): void {
    const dg = this.activeDg
    if (!dg) return
    dg.send(chunk)
  }

  // ---------------------------------------------------------------------------
  // Deepgram lifecycle
  // ---------------------------------------------------------------------------

  private openDeepgram(): Promise<DeepgramConnection> {
    const keyterms = collectKeyterms(this.cfg.words)
    const dg = new DeepgramConnection(
      {
        apiKey: this.cfg.deepgramApiKey,
        keyterms,
      },
      {
        onFinalized: (t) => this.onFinalized(dg, t),
        onError: (err) => {
          log.warn('deepgram error', {
            streamId: this.cfg.streamId,
            err: err.message,
          })
        },
        onClose: (info) => {
          log.info('deepgram closed', {
            streamId: this.cfg.streamId,
            code: info.code,
            reason: info.reason,
            wasActive: dg === this.activeDg,
          })
          // If the active conn closes unexpectedly (not during rotation/stop),
          // schedule a replacement with backoff. scheduleDeepgramReplace also
          // enforces an abandon threshold against rapid disconnect storms.
          if (dg === this.activeDg && !this.shutdownPromise) {
            this.scheduleDeepgramReplace()
          }
        },
      },
    )
    return dg.open().then(() => {
      this.lastDeepgramOpenedAtMs = Date.now()
      return dg
    })
  }

  /**
   * Replace the active Deepgram connection after an unexpected close.
   * Implements 1/3/9s backoff. If three replacements in a row each die
   * within DEEPGRAM_STABLE_MS, abandon the worker — the upstream is
   * misbehaving and we'd otherwise burn cost reconnecting forever.
   */
  private scheduleDeepgramReplace(): void {
    if (this.shutdownPromise) return
    if (this.deepgramReplaceTimer) return

    // If the last connection lasted long enough, we treat this as a fresh
    // failure and reset the backoff counter.
    const lastConnAgeMs = Date.now() - this.lastDeepgramOpenedAtMs
    if (lastConnAgeMs >= DEEPGRAM_STABLE_MS) {
      this.deepgramReplaceAttempts = 0
    }

    if (this.deepgramReplaceAttempts >= DEEPGRAM_REPLACE_DELAYS_MS.length) {
      log.error('deepgram: exhausted replacement attempts, abandoning stream', {
        streamId: this.cfg.streamId,
        attempts: this.deepgramReplaceAttempts,
      })
      void this.stop('pipeline_error', 'deepgram: too many rapid disconnects')
      return
    }

    const delay = DEEPGRAM_REPLACE_DELAYS_MS[this.deepgramReplaceAttempts]
    this.deepgramReplaceAttempts++
    log.warn('deepgram: scheduling replacement', {
      streamId: this.cfg.streamId,
      attempt: this.deepgramReplaceAttempts,
      delayMs: delay,
      lastConnAgeSec: (lastConnAgeMs / 1000).toFixed(1),
    })

    this.deepgramReplaceTimer = setTimeout(() => {
      this.deepgramReplaceTimer = null
      void this.replaceActiveDeepgram().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err)
        log.warn('deepgram: replacement open failed', {
          streamId: this.cfg.streamId,
          err: msg,
        })
        // Schedule another attempt on the same backoff curve.
        this.scheduleDeepgramReplace()
      })
    }, delay)
    this.deepgramReplaceTimer.unref()
  }

  private async replaceActiveDeepgram(): Promise<void> {
    if (this.shutdownPromise) return
    const next = await this.openDeepgram()
    if (this.shutdownPromise) {
      // Race: shutdown started while we were opening the replacement.
      void next.close()
      return
    }
    this.activeDg = next
  }

  private async rotateDeepgram(): Promise<void> {
    if (this.shutdownPromise) return
    log.info('deepgram rotation', { streamId: this.cfg.streamId })
    let next: DeepgramConnection
    try {
      next = await this.openDeepgram()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('deepgram rotate open failed', { streamId: this.cfg.streamId, err: msg })
      return
    }
    if (this.shutdownPromise) {
      void next.close()
      return
    }
    const prev = this.activeDg
    this.activeDg = next
    if (prev) {
      this.drainingDgs.push(prev)
      // Give the server ~2s to flush in-flight finals before disconnecting.
      void prev
        .close()
        .catch(() => {})
        .finally(() => {
          this.drainingDgs = this.drainingDgs.filter((d) => d !== prev)
        })
    }
  }

  // ---------------------------------------------------------------------------
  // ffmpeg recycle
  // ---------------------------------------------------------------------------

  private async recyclePipe(): Promise<void> {
    if (this.shutdownPromise) return
    if (this.nextPipe) return // already recycling
    log.info('ffmpeg recycle', { streamId: this.cfg.streamId })
    let next: AudioPipe
    try {
      next = await this.spawnPipe()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('ffmpeg recycle spawn failed', { streamId: this.cfg.streamId, err: msg })
      return
    }
    if (this.shutdownPromise) {
      next.stop()
      return
    }
    const prev = this.pipe
    this.nextPipe = next
    // Brief overlap: both pipes feed the same deepgram conn. Dedupe is
    // position-based so the duplicate chunks land at the same offsets and
    // are dropped.
    setTimeout(() => {
      if (prev) prev.stop()
      this.pipe = next
      this.nextPipe = null
    }, 2_000)
  }

  // ---------------------------------------------------------------------------
  // Finalized transcript handling
  // ---------------------------------------------------------------------------

  private onFinalized(source: DeepgramConnection, t: FinalizedTranscript): void {
    if (this.shutdownPromise) return
    // Accept finals from both the active and any draining conn — that's the
    // whole point of the drain window. The matcher's offset-based dedupe
    // discards anything we've already logged.
    void this.persistFinalized(t).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('persist finalized failed', { streamId: this.cfg.streamId, err: msg })
    })
    // Touch silence watchdog only on active-conn finals; draining-conn finals
    // are catching up to past audio.
    if (source === this.activeDg) {
      this.lastFinalizedAt = Date.now()
    }
  }

  private async persistFinalized(t: FinalizedTranscript): Promise<void> {
    // start_ms/end_ms are *capture-relative* wall-clock offsets (ms since the
    // worker started recording this stream). Deepgram's `start` field is
    // connection-relative and resets to 0 on every reconnect, so we can't
    // use it directly without producing wrong jump-to-time links.
    const durationMs = Math.max(0, Math.round((t.durationSec ?? 0) * 1000))
    const endMs = Math.max(0, Date.now() - this.startedAtMs)
    const startMs = Math.max(0, endMs - durationMs)

    // Run hits in the same connection as the segment INSERT so segment_id
    // points at the right row even under concurrent writes.
    const client = await pool.connect()
    let segmentId: number | null = null
    try {
      const segRes = await client.query<{ id: string }>(
        `INSERT INTO live_transcript_segments
           (stream_id, start_ms, end_ms, text, confidence)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [this.cfg.streamId, startMs, endMs, t.text, t.confidence],
      )
      segmentId = segRes.rows[0] ? Number(segRes.rows[0].id) : null
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('insert transcript segment failed', {
        streamId: this.cfg.streamId,
        err: msg,
      })
      client.release()
      return
    }

    const hits = this.matcher.ingest(t.text)
    for (const hit of hits) {
      try {
        await this.persistMention(client, hit, segmentId, t, startMs)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error('insert word mention failed', {
          streamId: this.cfg.streamId,
          wordIndex: hit.wordIndex,
          err: msg,
        })
      }
    }
    client.release()
  }

  private async persistMention(
    client: { query: (text: string, params: unknown[]) => Promise<{ rows: { id: string }[]; rowCount: number | null }> },
    hit: MatchHit,
    segmentId: number | null,
    t: FinalizedTranscript,
    segmentStartMs: number,
  ): Promise<void> {
    const confidence = pickHitConfidence(hit, t)
    const insertRes = await client.query(
      `INSERT INTO word_mentions
         (stream_id, event_id, word_index, word, matched_text,
          segment_id, stream_offset_ms, global_char_offset, snippet, confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (stream_id, word_index, global_char_offset) DO NOTHING
       RETURNING id`,
      [
        this.cfg.streamId,
        this.cfg.eventId,
        hit.wordIndex,
        hit.word,
        hit.matchedText,
        segmentId,
        segmentStartMs,
        hit.globalCharOffset,
        hit.snippet,
        confidence,
      ],
    )
    if ((insertRes.rowCount ?? 0) === 0) return
    const mentionId = Number(insertRes.rows[0].id)
    // Fat NOTIFY: include every field the admin SSE consumer needs so
    // lib/mentionStream.ts can pure-pass-through without an extra SELECT.
    // Postgres NOTIFY payload limit is 8 KB; this stays well under 1 KB.
    const payload = JSON.stringify({
      type: 'mention',
      eventId: this.cfg.eventId,
      streamId: this.cfg.streamId,
      mentionId,
      wordIndex: hit.wordIndex,
      word: hit.word,
      matchedText: hit.matchedText,
      streamOffsetMs: segmentStartMs,
      snippet: hit.snippet,
      confidence,
      createdAt: new Date().toISOString(),
    })
    await client.query('SELECT pg_notify($1, $2)', ['word_mention', payload])

    // For threshold=1 words: ping Discord on the FIRST non-superseded mention
    // so admins can resolve immediately without waiting for the end-of-stream
    // summary. Fire-and-forget; failures must not break the insert path.
    void this.maybeFirstMentionPing(client, hit, segmentStartMs, mentionId, confidence)

    // If the word is admin-opted-in for auto-lock and this mention's confidence
    // clears the bar, flip pending_resolution. Same fire-and-forget contract.
    void this.maybeAutoLock(hit, confidence)
  }

  /**
   * Auto-flip pending_resolution on `custom_market_words` when:
   *   - the word has auto_lock_enabled = TRUE (admin opt-in)
   *   - this mention's confidence >= AUTO_LOCK_MIN_CONFIDENCE
   *   - the word isn't already resolved (resolved_outcome IS NULL)
   *   - we haven't already auto-locked this word in this run
   *
   * The pending_resolution flag freezes trading and lets the admin manually
   * verify the call. We don't touch resolved_outcome — resolution is terminal
   * and stays a human decision.
   *
   * Uses a fresh pool client (not the caller's) so a failure here can't
   * affect the mention-insert path. Idempotent: the WHERE guard on
   * pending_resolution = FALSE + resolved_outcome IS NULL means concurrent
   * mentions or a worker restart can't double-flip.
   */
  private async maybeAutoLock(hit: MatchHit, confidence: number | null): Promise<void> {
    if (this.autoLockedWordIndices.has(hit.wordIndex)) return
    if (!this.autoLockByWordIndex.get(hit.wordIndex)) return
    if (confidence == null || confidence < AUTO_LOCK_MIN_CONFIDENCE) return

    // Optimistic mark to avoid concurrent mentions racing into multiple UPDATEs
    // within the same finalized segment. The DB guard backs this up.
    this.autoLockedWordIndices.add(hit.wordIndex)

    const marketId = parseMarketIdFromEventId(this.cfg.eventId)
    if (marketId == null) {
      log.warn('auto-lock skipped: non-custom event_id', {
        streamId: this.cfg.streamId,
        eventId: this.cfg.eventId,
      })
      return
    }

    try {
      const result = await pool.query<{ id: number }>(
        `UPDATE custom_market_words
            SET pending_resolution = TRUE
          WHERE id = $1
            AND market_id = $2
            AND pending_resolution = FALSE
            AND resolved_outcome IS NULL
          RETURNING id`,
        [hit.wordIndex, marketId],
      )
      if ((result.rowCount ?? 0) > 0) {
        log.info('auto-lock fired', {
          streamId: this.cfg.streamId,
          wordIndex: hit.wordIndex,
          word: hit.word,
          confidence,
        })
        // NOTIFY admin SSE consumers so the "Pending" pill shows up immediately
        // instead of waiting for the 20s periodic refetch. Rides the same
        // word_mention channel as 'mention' and 'dismiss'; lib/mentionStream.ts
        // pass-through fans it out.
        const payload = JSON.stringify({
          type: 'auto_lock',
          eventId: this.cfg.eventId,
          streamId: this.cfg.streamId,
          wordIndex: hit.wordIndex,
          word: hit.word,
          confidence,
        })
        try {
          await pool.query('SELECT pg_notify($1, $2)', ['word_mention', payload])
        } catch (notifyErr) {
          // Non-fatal — UI will catch up via the periodic refetch.
          const msg = notifyErr instanceof Error ? notifyErr.message : String(notifyErr)
          log.warn('auto-lock notify failed', { streamId: this.cfg.streamId, err: msg })
        }
      }
    } catch (err) {
      // Clear the optimistic mark so a later mention can retry.
      this.autoLockedWordIndices.delete(hit.wordIndex)
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('auto-lock update failed', {
        streamId: this.cfg.streamId,
        wordIndex: hit.wordIndex,
        err: msg,
      })
    }
  }

  private async maybeFirstMentionPing(
    client: { query: (text: string, params: unknown[]) => Promise<{ rows: { id: string; n?: string }[]; rowCount: number | null }> },
    hit: MatchHit,
    segmentStartMs: number,
    mentionId: number,
    confidence: number | null,
  ): Promise<void> {
    const threshold = this.thresholdByWordIndex.get(hit.wordIndex) ?? 1
    if (threshold !== 1) return
    if (this.pingedWordIndices.has(hit.wordIndex)) return
    // Mark optimistically so concurrent matches in the same finalized segment
    // don't race into multiple pings.
    this.pingedWordIndices.add(hit.wordIndex)

    try {
      // Confirm this is actually the first non-superseded mention. Worker
      // restarts mid-stream would otherwise re-ping for an already-known word.
      const priorRes = await client.query(
        `SELECT COUNT(*)::TEXT AS n
           FROM word_mentions
          WHERE stream_id = $1 AND word_index = $2 AND id < $3 AND superseded = FALSE`,
        [this.cfg.streamId, hit.wordIndex, mentionId],
      )
      const priorCount = Number(priorRes.rows[0]?.n ?? '0')
      if (priorCount > 0) return
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('first-mention prior-count check failed', {
        streamId: this.cfg.streamId,
        wordIndex: hit.wordIndex,
        err: msg,
      })
      return
    }

    void postFirstMentionPing({
      streamId: this.cfg.streamId,
      eventId: this.cfg.eventId,
      word: hit.word,
      matchedText: hit.matchedText,
      snippet: hit.snippet,
      streamOffsetMs: segmentStartMs,
      confidence,
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('first-mention ping failed', { streamId: this.cfg.streamId, err: msg })
    })
  }

  // ---------------------------------------------------------------------------
  // Timers
  // ---------------------------------------------------------------------------

  private scheduleTimers(): void {
    if (this.cfg.deepgramRotateMinutes > 0) {
      this.rotationTimer = setInterval(() => {
        void this.rotateDeepgram()
      }, this.cfg.deepgramRotateMinutes * 60_000)
      this.rotationTimer.unref()
    }
    if (this.cfg.ffmpegRecycleMinutes > 0) {
      this.recycleTimer = setInterval(() => {
        void this.recyclePipe()
      }, this.cfg.ffmpegRecycleMinutes * 60_000)
      this.recycleTimer.unref()
    }
    if (this.cfg.maxHours > 0) {
      const elapsedMs = Date.now() - this.startedAtMs
      const remaining = Math.max(0, this.cfg.maxHours * 3600_000 - elapsedMs)
      this.hardCapTimer = setTimeout(() => {
        log.warn('stream hit hard cap', { streamId: this.cfg.streamId })
        void this.stop('hard_cap')
      }, remaining)
      this.hardCapTimer.unref()
    }
    if (this.cfg.maxSilentMinutes > 0) {
      // Tick frequently enough to catch silence within ~30s of the threshold.
      this.silenceTimer = setInterval(() => {
        if (this.shutdownPromise) return
        const silentMs = Date.now() - this.lastFinalizedAt
        if (silentMs > this.cfg.maxSilentMinutes * 60_000) {
          log.warn('silence watchdog tripped', {
            streamId: this.cfg.streamId,
            silentMs,
          })
          void this.stop('silence_watchdog')
        }
      }, 30_000)
      this.silenceTimer.unref()
    }
    // Update minutes_used + cost_cents every minute so the daily-cost
    // dashboards stay roughly current even on long-running streams.
    this.minutesTimer = setInterval(() => {
      void this.persistMinutesUsed().catch(() => {})
    }, 60_000)
    this.minutesTimer.unref()
  }

  private async persistMinutesUsed(): Promise<void> {
    const minutes = (Date.now() - this.startedAtMs) / 60_000
    const costCents = Math.round(minutes * COST_CENTS_PER_MINUTE)
    await pool.query(
      `UPDATE monitored_streams
          SET minutes_used = $2,
              cost_cents = $3,
              updated_at = NOW()
        WHERE id = $1 AND status = 'live'`,
      [this.cfg.streamId, minutes, costCents],
    )
  }

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  private async shutdownInternal(reason: EndReason, errorMessage?: string): Promise<void> {
    log.info('stream worker stopping', {
      streamId: this.cfg.streamId,
      reason,
      err: errorMessage,
    })

    this.clearTimers()
    if (this.deepgramReplaceTimer) {
      clearTimeout(this.deepgramReplaceTimer)
      this.deepgramReplaceTimer = null
    }

    if (this.pipe) {
      this.pipe.stop()
      this.pipe = null
    }
    if (this.nextPipe) {
      this.nextPipe.stop()
      this.nextPipe = null
    }

    const dgs: DeepgramConnection[] = []
    if (this.activeDg) dgs.push(this.activeDg)
    dgs.push(...this.drainingDgs)
    this.activeDg = null
    this.drainingDgs = []
    await Promise.allSettled(dgs.map((d) => d.close()))

    const minutes = Math.max(0, (Date.now() - this.startedAtMs) / 60_000)
    const costCents = Math.round(minutes * COST_CENTS_PER_MINUTE)

    // SIGTERM / Railway redeploy: tear down the local pipeline but leave the
    // row in 'live' state so boot recovery picks it up on the next process.
    // No DB transition, no NOTIFY, no Discord summary.
    if (reason === 'shutdown') {
      log.info('stream worker stopped (shutdown — row stays live for boot recovery)', {
        streamId: this.cfg.streamId,
        minutes,
      })
      try {
        this.cb.onEnded(reason, errorMessage)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.warn('onEnded callback threw', { streamId: this.cfg.streamId, err: msg })
      }
      return
    }

    const status =
      reason === 'manual_cancel' || reason === 'silence_watchdog' || reason === 'hard_cap'
        ? 'ended'
        : 'error'

    try {
      await pool.query(
        `UPDATE monitored_streams
            SET status = $2,
                ended_at = NOW(),
                minutes_used = $3,
                cost_cents = $4,
                error_message = $5,
                updated_at = NOW()
          WHERE id = $1 AND status = 'live'`,
        [this.cfg.streamId, status, minutes, costCents, errorMessage ?? null],
      )
      await pool.query(
        'SELECT pg_notify($1, $2)',
        ['stream_ended', JSON.stringify({ streamId: this.cfg.streamId, eventId: this.cfg.eventId, reason })],
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('stream end DB update failed', {
        streamId: this.cfg.streamId,
        err: msg,
      })
    }

    // Fire-and-forget Discord summary. A failure here must not block the
    // shutdown path — the DB transition is the source of truth.
    void postStreamEndSummary({
      streamId: this.cfg.streamId,
      eventId: this.cfg.eventId,
      reason,
      errorMessage: errorMessage ?? null,
      minutes,
      costCents,
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('discord summary post failed', { streamId: this.cfg.streamId, err: msg })
    })

    log.info('stream worker stopped', {
      streamId: this.cfg.streamId,
      reason,
      minutes,
      costCents,
    })
    try {
      this.cb.onEnded(reason, errorMessage)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('onEnded callback threw', { streamId: this.cfg.streamId, err: msg })
    }
  }

  private clearTimers(): void {
    if (this.rotationTimer) clearInterval(this.rotationTimer)
    if (this.recycleTimer) clearInterval(this.recycleTimer)
    if (this.silenceTimer) clearInterval(this.silenceTimer)
    if (this.minutesTimer) clearInterval(this.minutesTimer)
    if (this.hardCapTimer) clearTimeout(this.hardCapTimer)
    this.rotationTimer = null
    this.recycleTimer = null
    this.silenceTimer = null
    this.minutesTimer = null
    this.hardCapTimer = null
  }
}

// =============================================================================
// AudioPipe — runs the audio source pipeline, restarted on unexpected exit
// =============================================================================

interface AudioPipeHandlers {
  onPcm: (chunk: Buffer) => void
  /** Fired when the pipe has exhausted restart attempts. */
  onUnrecoverable: (err: Error) => void
}

const STDERR_TAIL_BYTES = 2048

/**
 * Owns the audio source for a stream. Two shapes:
 *
 *   - 'piped'  → fetcher (streamlink|yt-dlp) → ffmpeg via stdin pipe.
 *   - 'direct' → ffmpeg alone, reading from a local audio device.
 *
 * Restarts on unexpected exit up to a bounded number of attempts. For piped
 * streams, fetcher exits are routine (CDN rotation) on long streams; for
 * direct (local-audio), exits usually mean the device went away or ffmpeg
 * misconfigured — restart is mostly a no-op but harmless.
 */
class AudioPipe {
  private fetcher: ChildProcessWithoutNullStreams | null = null
  private ff: ChildProcessWithoutNullStreams | null = null
  private fetcherStderr = ''
  private ffStderr = ''
  private restartCount = 0
  private restartTimer: NodeJS.Timeout | null = null
  private stopped = false
  private starting = false

  constructor(
    private readonly pipelineFactory: () => Pipeline,
    private readonly handlers: AudioPipeHandlers,
  ) {}

  async start(): Promise<void> {
    if (this.stopped) throw new Error('audio pipe already stopped')
    if (this.starting) throw new Error('audio pipe already starting')
    this.starting = true
    try {
      await this.spawnOnce()
    } finally {
      this.starting = false
    }
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.killChildren()
  }

  private async spawnOnce(): Promise<void> {
    if (this.stopped) return
    const pipeline = this.pipelineFactory()
    log.info('audio pipe spawning', {
      kind: pipeline.kind,
      source: pipeline.source,
      attempt: this.restartCount,
    })

    if (pipeline.kind === 'piped') {
      this.spawnPiped(pipeline)
    } else {
      this.spawnDirect(pipeline)
    }
  }

  private spawnPiped(pipeline: PipedPipeline): void {
    const fetcher = spawn(pipeline.fetcherCmd, pipeline.fetcherArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const ff = spawn('ffmpeg', pipeline.ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] })

    this.fetcherStderr = ''
    this.ffStderr = ''
    fetcher.stderr.on('data', (d: Buffer) => {
      this.fetcherStderr = appendTail(this.fetcherStderr, d.toString())
      log.debug('fetcher stderr', { source: pipeline.source, msg: d.toString().trim() })
    })
    ff.stderr.on('data', (d: Buffer) => {
      this.ffStderr = appendTail(this.ffStderr, d.toString())
      log.debug('ffmpeg stderr', { msg: d.toString().trim() })
    })

    fetcher.stdout.pipe(ff.stdin).on('error', () => {})
    fetcher.stdout.on('error', () => {})

    ff.stdout.on('data', (chunk: Buffer) => {
      if (this.stopped) return
      this.handlers.onPcm(chunk)
    })

    fetcher.on('exit', (code, signal) => {
      const fields: Record<string, unknown> = {
        source: pipeline.source,
        code,
        signal,
      }
      if (code !== 0 && code !== null && this.fetcherStderr) {
        fields.stderr = this.fetcherStderr.trim()
      }
      if (code !== 0 && code !== null) log.warn('fetcher exited non-zero', fields)
      else log.info('fetcher exited', fields)
      this.handleChildExit()
    })
    ff.on('exit', (code, signal) => {
      const fields: Record<string, unknown> = { code, signal }
      if (code !== 0 && code !== null && this.ffStderr) {
        fields.stderr = this.ffStderr.trim()
      }
      if (code !== 0 && code !== null) log.warn('ffmpeg exited non-zero', fields)
      else log.info('ffmpeg exited', fields)
      this.handleChildExit()
    })

    this.fetcher = fetcher
    this.ff = ff
  }

  private spawnDirect(pipeline: DirectPipeline): void {
    // Leave stdin as a pipe (unused) so the type lines up with the piped
    // case. ffmpeg ignores it because its `-i` is the audio device, not pipe:0.
    const ff = spawn('ffmpeg', pipeline.ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] })

    this.ffStderr = ''
    ff.stderr.on('data', (d: Buffer) => {
      this.ffStderr = appendTail(this.ffStderr, d.toString())
      log.debug('ffmpeg stderr', { msg: d.toString().trim() })
    })

    ff.stdout.on('data', (chunk: Buffer) => {
      if (this.stopped) return
      this.handlers.onPcm(chunk)
    })

    ff.on('exit', (code, signal) => {
      const fields: Record<string, unknown> = { code, signal }
      if (code !== 0 && code !== null && this.ffStderr) {
        fields.stderr = this.ffStderr.trim()
      }
      if (code !== 0 && code !== null) log.warn('ffmpeg exited non-zero', fields)
      else log.info('ffmpeg exited', fields)
      this.handleChildExit()
    })

    this.fetcher = null
    this.ff = ff
  }

  private handleChildExit(): void {
    if (this.stopped) return
    // Whichever child exited takes the whole pipe down. Kill the survivor so
    // we don't end up with a zombie process consuming a dead pipe.
    this.killChildren()
    this.scheduleRestart()
  }

  private killChildren(): void {
    if (this.fetcher) {
      try { this.fetcher.kill('SIGTERM') } catch {}
      this.fetcher = null
    }
    if (this.ff) {
      try { this.ff.kill('SIGTERM') } catch {}
      this.ff = null
    }
  }

  private scheduleRestart(): void {
    if (this.stopped) return
    if (this.restartTimer) return
    if (this.restartCount >= FETCHER_RESTART_DELAYS_MS.length) {
      const err = new Error(
        `audio pipe exhausted ${FETCHER_RESTART_DELAYS_MS.length} restart attempts`,
      )
      this.stopped = true
      try {
        this.handlers.onUnrecoverable(err)
      } catch {
        // surface upstream caller errors but don't loop
      }
      return
    }
    const delay = FETCHER_RESTART_DELAYS_MS[this.restartCount]
    this.restartCount++
    log.info('audio pipe scheduling restart', {
      attempt: this.restartCount,
      delayMs: delay,
    })
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.spawnOnce().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err)
        log.warn('audio pipe respawn failed', { err: msg })
        this.scheduleRestart()
      })
    }, delay)
    this.restartTimer.unref()
  }
}

function appendTail(prev: string, next: string): string {
  const combined = prev + next
  if (combined.length <= STDERR_TAIL_BYTES) return combined
  return combined.slice(combined.length - STDERR_TAIL_BYTES)
}

// =============================================================================
// Helpers
// =============================================================================

function collectKeyterms(words: MatchableWord[]): string[] {
  const out: string[] = []
  for (const w of words) {
    if (w.word) out.push(w.word)
    for (const v of w.variants) {
      if (v) out.push(v)
    }
  }
  return out
}

/**
 * Best-effort per-mention confidence: average across the Deepgram word tokens
 * that fall within the matched text range. Falls back to the segment-level
 * confidence if word breakdown is unavailable.
 */
function pickHitConfidence(hit: MatchHit, t: FinalizedTranscript): number | null {
  if (t.words.length === 0) return t.confidence
  // Heuristic: pick word tokens whose punctuated form appears in the matched
  // text. This isn't precise alignment but it's close enough that tightening
  // the snippet's confidence band reflects the real match quality.
  const matchedLower = hit.matchedText.toLowerCase()
  const tokens = t.words.filter((w) => matchedLower.includes(w.word.toLowerCase()))
  if (tokens.length === 0) return t.confidence
  const avg = tokens.reduce((s, w) => s + w.confidence, 0) / tokens.length
  return avg
}

function parseMarketIdFromEventId(eventId: string): number | null {
  if (!eventId.startsWith('custom_')) return null
  const id = parseInt(eventId.slice('custom_'.length), 10)
  return Number.isFinite(id) ? id : null
}
