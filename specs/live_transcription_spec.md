# Live Transcription & Word Detection — Implementation Spec

This document describes how Mentioned will automatically transcribe live YouTube and Twitch streams, detect mentions of market words in real time, and surface those mentions to admins to assist (not replace) manual market resolution. Written for engineers and AI models implementing or modifying this system.

Scope: detection of stream end, real-time transcript generation, word matching, and admin notification. Out of scope: automated market resolution from transcripts (transcript is *evidence*, not source of truth — see "Why we don't auto-resolve" below).

---

## Goal

Mention markets resolve based on whether specific words are said during a live event. Today, an admin watches the stream and resolves manually. Two problems:

1. **Stream end is not signaled.** Admins have no way to know a 4-hour podcast ended 20 minutes ago other than checking the page. Resolution can be delayed for hours.
2. **Words are missed.** A 3-hour stream might have 30 word mentions to count. Tracking by ear across hundreds of words and dozens of markets simultaneously is unreliable.

The goal is a service that, for each currently-live stream linked to a market:

- Continuously transcribes the audio
- Matches transcript text against the market's words and phrases
- Counts every distinct mention (some markets resolve on threshold counts, e.g. "said 10+ times")
- Notifies admins per-mention and signals when threshold is met (live UI counter + Discord alert on stream end)
- Stores the full transcript and per-mention evidence for audit and dispute resolution

One stream maps to one market. Each market has 1..N words, where each "word" may be a single token ("clutch") or a multi-word phrase ("Mr Speaker"), and each carries a `mention_threshold` (default 1 for any-mention semantics, higher for count-based resolution).

The admin still clicks "resolve" — the service makes that click well-informed instead of guesswork.

---

## Non-Goals

- **No automated resolution.** Speech-to-text is 90–95% accurate at best, hallucinates short common words, and is gameable ("blue cheese" to trigger "blue"). The system pre-fills evidence; a human decides.
- **No coverage of non-stream resolutions.** Markets resolved on tweets, news events, etc. are unaffected by this work.
- **No live captions for end users.** Transcripts are admin-only. They may eventually become public archive, but not as part of this rollout.
- **No replacement of `event_chat_messages`** or any existing live-event feature. This is additive.

---

## Why We Don't Auto-Resolve

This is a deliberate product choice, not a technical limitation. Documented here because it shapes every other decision.

1. **Accuracy ceiling.** Even Deepgram Nova-3 (current best-in-class for English streaming) is 92–95% on clean studio audio and noticeably worse on game streams, sports, and noisy environments. A single missed mention or a single false positive on a market with $1k+ TVL is more damaging than the time saved.
2. **Adversarial environments.** Bots and bored users will try to manipulate STT. "Blue" is detectable in "blueberry pie" or "Blu-ray". Phonetic confusion ("clutch" / "crutch", "bear" / "bare") is exploitable.
3. **Authority of resolution.** Mentioned's reputation depends on resolutions being correct. A human in the loop is the cheapest insurance for that.

The system is designed to make a human's job take 30 seconds instead of 30 minutes. That's the win.

---

## High-Level Architecture

```
┌──────────────┐       NOTIFY stream_added       ┌─────────────────────────┐
│   Next.js    │ ──────────────────────────────► │  transcript-worker      │
│   (existing) │                                  │  (new Railway service)  │
│              │ ◄────── NOTIFY word_mention ──── │                         │
└──────┬───────┘                                  └──────────┬──────────────┘
       │                                                     │
       │  SSE                                                │  manages 1..N
       │  /api/admin/mentions/stream                         │  StreamWorker instances
       ▼                                                     │
┌──────────────┐                                             ▼
│ Admin pages  │                            ┌────────────────────────────┐
│ /paidcustom  │                            │  StreamWorker (per stream) │
│ admin,       │                            │                            │
│ /customadmin │                            │  streamlink/yt-dlp         │
└──────────────┘                            │       ↓ pipe               │
                                            │  ffmpeg (PCM 16kHz mono)   │
                                            │       ↓ ws                 │
                                            │  Deepgram Nova-3           │
                                            │       ↓ events             │
                                            │  word matcher → DB writes  │
                                            └────────────────────────────┘

      Postgres (existing) ─────────────── shared by both services
      via internal Railway network
```

Two services, one repo, one database. The new `transcript-worker` is a long-lived Node process. It learns about new streams via Postgres `LISTEN`, spawns one in-process worker per stream, and writes transcript segments and word mentions back to the same database that Next.js reads from.

Admins see live updates via SSE (same pattern as the existing chat) and a Discord webhook on stream end (same pattern as the existing bug-report flow).

---

## Components

### 1. The transcript-worker service

A new directory at `services/transcript-worker/` with its own `package.json`, `tsconfig.json`, and `Dockerfile`. Sibling to the Next.js app. Same monorepo, separate Railway service.

Responsibilities:
- Maintain a `LISTEN` connection on the `stream_added` and `stream_canceled` Postgres channels.
- On boot, recover any rows in `monitored_streams` with status `pending` or `live`. For `live` rows, re-verify with the platform's API before resuming (the stream may have ended while the worker was down).
- Maintain an in-memory map of `streamId → StreamWorker` instances. Cap at `MAX_CONCURRENT_STREAMS` (default 20).
- Run a 60s end-detection tick across all live streams (parallel signal to ffmpeg-exit detection).
- Run a 5s health tick that kills any stream worker exceeding `MAX_HOURS_PER_STREAM` or with no transcript activity for `MAX_SILENT_MINUTES`.

This service holds no UI. It is internal-only on Railway (no public domain).

### 2. StreamWorker (per stream)

One instance per row in `monitored_streams` with status `live`. Holds:
- A child `streamlink` or `yt-dlp` process producing a TS/HLS byte stream
- A child `ffmpeg` process consuming that stream and producing 16 kHz mono PCM
- A Deepgram WebSocket consuming the PCM
- A keepalive timer (sends `{"type":"KeepAlive"}` every 4s if no audio chunk has been sent in the last 4s — Deepgram closes the WS after 10s of silence)
- A `WordMatcher` configured with the union of all words across markets attached to this stream

On finalized transcript events, it writes one row to `live_transcript_segments` and zero or more rows to `word_mentions`. After each `word_mentions` insert, it issues `NOTIFY word_mention, '<json>'`.

On exit (any reason), it transitions the `monitored_streams` row to `ended` (or `error`), records `minutes_used` and `ended_at`, and posts a Discord summary.

### 3. Audio pipeline

Two reasons we don't resolve the HLS URL once and hand it to ffmpeg directly:
- HLS URLs from Twitch and YouTube expire (typically 24h Twitch, faster YT), and a multi-hour show can outlive a single resolution.
- Auth tokens (sub-only Twitch streams, age-gated YouTube) need refresh.

Both are handled by piping streamlink/yt-dlp's stdout into ffmpeg's stdin:

```ts
const isTwitch = /twitch\.tv/.test(url)
const fetcher = isTwitch
  ? spawn('streamlink', ['--stdout', url, 'best'])
  : spawn('yt-dlp', ['-o', '-', '-f', 'best', url])

const ff = spawn('ffmpeg', [
  '-i', 'pipe:0',
  '-vn',                                        // no video
  '-af', 'highpass=f=80,lowpass=f=8000,afftdn=nf=-25',  // noise floor cleanup
  '-f', 's16le', '-ac', '1', '-ar', '16000',
  '-loglevel', 'error',
  'pipe:1',
])

fetcher.stdout.pipe(ff.stdin)
ff.stderr.on('data', d => log.warn('ffmpeg', d.toString()))
fetcher.stderr.on('data', d => log.warn('fetcher', d.toString()))
```

Reconnection: streamlink and yt-dlp handle their own segment-level reconnects. If the fetcher process dies, the worker retries with exponential backoff (3 attempts, 5s/15s/45s) before declaring the stream errored.

### 4. Deepgram integration

SDK: `@deepgram/sdk` (v4 or later). Connection options:

```ts
const conn = await client.listen.v1.connect({
  model: 'nova-3',
  language: 'en',                       // or 'multi' for Nova-3 multilingual
  encoding: 'linear16',
  sample_rate: 16000,
  channels: 1,
  smart_format: true,
  punctuate: true,
  interim_results: false,               // we only persist finals
  endpointing: 400,
  vad_events: true,
  keyterm: words,                       // Nova-3 keyterm prompting (NOT 'keywords')
})

conn.on('message', (data) => {
  if (data.type !== 'Results') return
  const alt = data.channel.alternatives[0]
  if (!alt?.transcript || !data.is_final) return
  void onFinalTranscript(alt, data.start, data.duration)
})

conn.connect()
await conn.waitForOpen()
ff.stdout.on('data', chunk => { conn.socket.send(chunk); lastSentAt = Date.now() })

const ka = setInterval(() => {
  if (Date.now() - lastSentAt > 4000) {
    conn.socket.send(JSON.stringify({ type: 'KeepAlive' }))
  }
}, 5000)
```

**Why Nova-3 over Nova-2:** Nova-3 has materially better accuracy on proper nouns and less common vocabulary, which is the bulk of market words. Its `keyterm` prompting (replaces `keywords` for Nova-3) bias the model toward your specified terms without the brittle weight tuning Nova-2 required. Aggregate keyterm token budget is 500, well above any realistic market's word list.

**Why not Nova-3 Multilingual:** Costs ~21% more (~$0.348/hr vs $0.288/hr) and is meaningfully less accurate on English. Use it only if a stream is known to be non-English.

**Why not AssemblyAI Universal-Streaming:** ~63% more expensive ($0.47/hr vs $0.288/hr) for marginal accuracy difference on this task. AssemblyAI's diarization and post-processing features (LeMUR) are not used here. Revisit if Deepgram quality regresses.

**Why not Whisper streaming or self-hosted:** Whisper has no first-class streaming mode; "whisper-streaming" projects exist but are rough. Self-hosting requires GPU infra that doesn't exist on Railway. Switch only if scale forces it.

### 5. Word matcher

Two requirements drive this design:

1. **Phrases.** Markets reference both single words ("clutch") and multi-word phrases ("Mr Speaker", "ego death"). The matcher must treat these uniformly.
2. **Counts matter.** Some markets resolve on threshold counts ("was 'Mr Speaker' said 10+ times"). Every distinct utterance must be logged — we cannot dedupe aggressively or counts will be wrong.

The combination forces phrase matching to span Deepgram segment boundaries (Deepgram finalizes at endpointing pauses, which can fall in the middle of a phrase) and forces the dedupe strategy to be position-based, not time-based.

#### Algorithm: sliding-window match by global character offset

The worker maintains a small trailing buffer of recently-finalized text. Every new finalized segment is matched against `trailingBuffer + newSegment`, with each match identified by its position in the conceptual "global" stream text. Already-logged positions are skipped.

```ts
const TRAILING_BUFFER_SIZE = 200            // chars of overlap to span phrase boundaries
const CROSS_SEGMENT_DEDUPE_LIMIT = 5000     // max position keys held in memory
let trailingBuffer = ''
let globalCharOffset = 0
const loggedKeys = new Set<string>()        // pruned periodically

function onFinalSegment(segmentText: string, segmentId: number) {
  const matchText = trailingBuffer + segmentText
  const baseOffset = globalCharOffset - trailingBuffer.length
  const hits: Hit[] = []

  for (const w of words) {
    for (const variant of [w.word, ...w.variants]) {
      const pattern = buildPattern(variant)        // `\bMr\.?\s+Speaker\b` for phrases
      const re = new RegExp(pattern, 'gi')
      let m: RegExpExecArray | null
      while ((m = re.exec(matchText)) !== null) {
        const globalOffset = baseOffset + m.index
        const key = `${w.index}:${globalOffset}`
        if (loggedKeys.has(key)) continue
        loggedKeys.add(key)
        hits.push({
          wordIndex: w.index,
          word: w.word,
          matched: m[0],
          globalOffset,
          snippet: extractSnippet(matchText, m.index, m[0].length, 40),
        })
      }
    }
  }

  globalCharOffset += segmentText.length
  trailingBuffer = (trailingBuffer + segmentText).slice(-TRAILING_BUFFER_SIZE)
  pruneLoggedKeys(globalCharOffset - TRAILING_BUFFER_SIZE)  // drop entries older than buffer reach
  return hits
}

function buildPattern(text: string): string {
  // Tokenize on whitespace, escape each, and allow flexible whitespace + optional periods
  // between tokens. So "Mr Speaker" matches "Mr Speaker", "Mr. Speaker", "mr  speaker".
  const tokens = text.trim().split(/\s+/).map(escapeRegex)
  const middle = tokens.map(t => t.replace(/$/, '\\.?')).join('\\s+')
  return `\\b${middle.replace(/\\\.\\\?$/, '')}\\b`
}
```

Why this works:

- **Cross-segment phrase matches.** If Deepgram emits `"...he said Mr"` then `"Speaker today..."` as two finals, the second segment's match window is `"...he said Mr" + "Speaker today..."`, which contains the full phrase. Logged once at its global offset.
- **No false dedupe of repeated mentions.** A streamer saying "Mr Speaker, Mr Speaker, Mr Speaker!" within one final segment produces three matches at three distinct offsets, all logged. Counts are correct.
- **No double-log across segment boundaries.** When the next segment arrives, its trailing buffer overlaps the prior one, so the same phrase match would appear at the same `globalOffset` and be skipped via `loggedKeys`.
- **Memory bounded.** `loggedKeys` prunes entries that are no longer reachable through the trailing buffer window. At ~5,000 entries max it's well under 1 MB.

#### Decisions

- **Word boundaries (`\b`).** Prevents "go" matching inside "going". Non-negotiable.
- **Case-insensitive.** Matches admin expectation.
- **Phrases supported as first-class.** Stored as a single string in `custom_market_words.word`, e.g. `"Mr Speaker"`. Matcher tokenizes and builds a flexible-whitespace pattern. Admin doesn't think about it differently from single words.
- **Optional periods between phrase tokens.** "Mr Speaker" matches both "Mr Speaker" and "Mr. Speaker" — Deepgram's smart formatting may or may not emit the period.
- **Variants stored, not derived.** Admin enters "clutch", "clutches", "clutched" explicitly. No automatic stemming (too easy to match unintended words). For phrases, admin can enter alternates: `word="Mr Speaker"`, `match_variants=["Mister Speaker"]`. Stored on `custom_market_words.match_variants TEXT[]` and equivalent for paid markets.
- **Position-based dedupe, not time-based.** A 0.5-second time cooldown is kept only as a defensive backstop for any pathological case where Deepgram emits content with overlapping `start` times; the primary dedupe is `(wordIndex, globalCharOffset)`. This is critical for count-based markets.
- **All matches in a segment are emitted.** `re.exec` in a `while` loop. A 30-second monologue saying "fed" 12 times → 12 mentions. This is the correct behavior; the resolution rule (threshold) decides whether 12 is enough.

### 6. End detector

v1 does **not** integrate with Twitch Helix or YouTube Data API. Three signals are used, all passive (no external API calls, no extra credentials):

1. **Fetcher process exit.** When `streamlink` or `yt-dlp` exits cleanly, the source playlist is gone. Treated as ended after a short cool-down (3 fast-restart attempts at 5/15/45s — Twitch occasionally drops mid-show; if all three restarts fail, mark ended).
2. **Silence watchdog.** No finalized transcript segment in `MAX_SILENT_MINUTES` (default 20). Hard kill. Primarily cost protection — long silences during halftime / ad pods / tech difficulties are tolerated up to this threshold.
3. **Hard cap.** `MAX_HOURS_PER_STREAM` (default 12). Forced end regardless of any other signal. Runaway protection.
4. **Admin manual end.** An admin can flip `monitored_streams.status` to `ended` via the admin UI. Triggers a `stream_canceled` NOTIFY; the worker cleans up.

When end is decided (any cause):
- Close Deepgram WS, kill ffmpeg + fetcher.
- `UPDATE monitored_streams SET status='ended', ended_at=NOW(), minutes_used=?` (CAS on `status='live'` to avoid double-end).
- `NOTIFY stream_ended, '{"streamId":..., "eventId":...}'`
- Post Discord webhook with mention summary.
- Optionally: kick off a VOD post-pass (see "VOD post-pass" below).

**Trade-off accepted in v1:** without API confirmation, end-of-stream is detected reactively (within a few minutes of fetcher exit, or up to 20 min for silence). Adding API polling is straightforward later if the latency becomes a problem — see "Future enhancements" at the end of this spec.

---

## Database Schema

### Same database, not a new one

This system uses the existing Mentioned Postgres database. New tables, not a new instance. Reasoning:

- **The worker joins against existing market data.** It loads `custom_market_words`, indexed on-chain word lists, admin permission checks (`isAdmin` via wallet). Cross-database joins are clunky (requires `postgres_fdw` or app-side stitching) and lose query simplicity.
- **`LISTEN/NOTIFY` is intra-database only.** The architecture relies on it for spawn triggers and SSE fanout (mirroring existing chat). Splitting the database means inventing a separate message bus (Redis, NATS) — strictly more infra for no real gain at this volume.
- **Volume doesn't justify isolation.** Peak write rate at 20 concurrent streams is ~3 writes/sec across both new tables. A free-tier Postgres can handle 1000+ writes/sec. User-facing query latency won't notice.
- **Operational consistency.** Backups, pooling, secrets, monitoring already exist. A second Postgres doubles the surface area for a non-problem.

**Blast-radius mitigation that's worth doing now:** create a dedicated Postgres role for the worker with `INSERT/UPDATE/SELECT` only on `monitored_streams`, `live_transcript_segments`, `word_mentions`, and `SELECT` on the few existing tables it reads (`custom_markets`, `custom_market_words`, paid market words once indexed). A compromised worker key cannot `DELETE FROM user_profiles`. Same DB, different role.

**When you'd revisit and split** — useful to know the future trigger:
- Transcripts grow past ~50 GB (years away — current trajectory <1 GB/year).
- Compliance requires different retention or PITR for transcript data than user data.
- A regulator requires the transcript store be physically isolated.

None apply now.

### What we add

We add three new tables and do not modify the existing `event_streams` or `custom_markets` tables. The existing tables continue to store stream URLs as before; the new `monitored_streams` table is the worker's source of truth and references whichever existing table holds the URL.

### `monitored_streams` (new)

The worker's queue. One row per stream-monitoring intent. Created when an admin chooses to enable monitoring for a market+stream combination.

```sql
CREATE TABLE IF NOT EXISTS monitored_streams (
  id              SERIAL PRIMARY KEY,
  event_id        TEXT NOT NULL UNIQUE,         -- 'custom_42' (v1 free), future: 'paid_<id>', 'POLY-123'
  stream_url      TEXT NOT NULL,                -- the user-facing URL (twitch.tv/foo, youtube.com/...)
  status          TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'live' | 'ended' | 'error'
  source          TEXT,                         -- 'twitch' | 'youtube' (derived, cached)
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  minutes_used    NUMERIC DEFAULT 0,
  cost_cents      INTEGER DEFAULT 0,
  error_message   TEXT,
  created_by      TEXT NOT NULL,                -- admin wallet
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ms_status ON monitored_streams(status) WHERE status IN ('pending','live');
```

`event_id` follows the existing `event_chat_messages` convention (`'custom_<id>'` for free markets, `'POLY-<id>'` for Polymarket events). v1 only inserts `'custom_<id>'`. The `UNIQUE` constraint enforces one active stream per market without needing a composite key.

**Why a separate table instead of adding columns to `event_streams` / `custom_markets`?**
- The monitoring intent is orthogonal to the URL itself. A market may have a stream URL but admin chooses not to monitor (e.g., known to be quiet stretch, or non-English).
- The status state machine doesn't belong on the market row; it belongs to the monitoring instance.
- Markets currently store stream URLs in different places (`custom_markets.stream_url` for free, no standardized place for on-chain). `monitored_streams` unifies them via `event_id`.

**1 stream per market.** One `monitored_streams` row per market at a time, enforced by `UNIQUE (event_id)`. To change the stream URL mid-event, admin updates the row.

### `live_transcript_segments` (new)

Finalized transcript output. One row per Deepgram `is_final: true` event.

```sql
CREATE TABLE IF NOT EXISTS live_transcript_segments (
  id           BIGSERIAL PRIMARY KEY,
  stream_id    INTEGER NOT NULL REFERENCES monitored_streams(id) ON DELETE CASCADE,
  start_ms     INTEGER NOT NULL,        -- offset from stream start
  end_ms       INTEGER NOT NULL,
  text         TEXT NOT NULL,
  confidence   REAL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lts_stream_time ON live_transcript_segments(stream_id, start_ms);
```

Per-stream: ~3-5 segments per minute → ~1k segments per 4-hour stream. Storage trivial.

### `word_mentions` (new)

A detected match. The admin-facing artifact.

```sql
CREATE TABLE IF NOT EXISTS word_mentions (
  id                BIGSERIAL PRIMARY KEY,
  stream_id         INTEGER NOT NULL REFERENCES monitored_streams(id) ON DELETE CASCADE,
  event_id          TEXT NOT NULL,             -- denormalized from monitored_streams for fast filter
  word_index        INTEGER NOT NULL,
  word              TEXT NOT NULL,             -- canonical word from the market
  matched_text      TEXT NOT NULL,             -- the actual variant that matched
  segment_id        BIGINT REFERENCES live_transcript_segments(id) ON DELETE SET NULL,
  stream_offset_ms  INTEGER NOT NULL,          -- jump-to-time link
  global_char_offset INTEGER NOT NULL,         -- position in transcript stream (used for dedupe)
  snippet           TEXT NOT NULL,             -- ±40 chars around the hit
  confidence        REAL,
  superseded        BOOLEAN NOT NULL DEFAULT FALSE,  -- admin-flagged false positive
  superseded_by     TEXT,                       -- admin wallet
  superseded_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stream_id, word_index, global_char_offset)  -- enforces position-based dedupe at DB level
);

CREATE INDEX IF NOT EXISTS idx_wm_event_active
  ON word_mentions(event_id, word_index) WHERE superseded = FALSE;
CREATE INDEX IF NOT EXISTS idx_wm_stream ON word_mentions(stream_id, created_at);
```

The `UNIQUE (stream_id, word_index, global_char_offset)` constraint is a belt-and-braces dedupe — the worker's in-memory `loggedKeys` set is the primary dedupe, but if a worker restart re-processes a segment, the DB rejects the duplicate.

`superseded` is a soft-delete that preserves the mention as audit evidence while excluding it from counts. The "active mentions count" is `COUNT(*) WHERE superseded=FALSE`.

### Word-level resolution rules (additions to existing tables)

Markets resolve YES/NO per word. Two rule shapes exist:

- **Any-mention.** Default. Word resolves YES if at least 1 active mention exists.
- **Threshold count.** Word resolves YES if active mention count meets a minimum (e.g., "Mr Speaker said 10+ times").

A `mention_threshold` column is added to existing word tables. Default `1` means any-mention semantics, no behavioral change to current markets.

```sql
ALTER TABLE custom_market_words
  ADD COLUMN IF NOT EXISTS mention_threshold INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS match_variants    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Equivalent additions for the paid market words table once it exists.
-- If on-chain market words are indexed into a paid_market_words table,
-- the same two columns apply there.
```

The matcher reads `match_variants` to expand the patterns it tries. The threshold is only consumed by the admin UI and resolution flow — the worker doesn't care about thresholds, it just counts. Keeping that separation means we can change resolution rules without touching the worker.

### Migration

All additions go into `scripts/migrate.ts` using `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`. No data migration needed; existing words inherit `mention_threshold = 1` and empty `match_variants`.

---

## Service ↔ Database Interaction

This section is concrete: every read and write the worker does, in order.

### On worker boot

```sql
-- 1. Recover any in-flight streams. Re-verify each via platform API before resuming.
SELECT id, event_id, stream_url, source, started_at
  FROM monitored_streams
 WHERE status IN ('pending', 'live')
 ORDER BY created_at;
```

For each row in `live` state: hit Twitch/YT API. If actually ended: `UPDATE ... SET status='ended', ended_at=NOW()`. Otherwise: spawn StreamWorker.

```sql
-- 2. Open the LISTEN connection (long-lived).
LISTEN stream_added;
LISTEN stream_canceled;
```

### On `stream_added` notification

Payload: `{"streamId": 123}`.

```sql
-- CAS spawn gate. Only the caller that flips pending→live spawns the worker.
UPDATE monitored_streams
   SET status = 'live',
       started_at = NOW(),
       source = $2,
       updated_at = NOW()
 WHERE id = $1 AND status = 'pending'
 RETURNING *;
```

If 0 rows returned: another worker (or the same worker on reconnect) already grabbed it. Abort.

### Per StreamWorker startup

```sql
-- Load the words this stream should match.
-- v1 supports free markets only. event_id is 'custom_<custom_markets.id>'.
-- Strip the 'custom_' prefix to query custom_market_words.
SELECT id, idx, word, mention_threshold,
       COALESCE(match_variants, ARRAY[]::TEXT[]) AS variants
  FROM custom_market_words
 WHERE market_id = $1;     -- $1 = parseInt(event_id.replace('custom_', ''))
```

### Per finalized transcript segment

```sql
-- 1. Persist the segment.
INSERT INTO live_transcript_segments (stream_id, start_ms, end_ms, text, confidence)
VALUES ($1, $2, $3, $4, $5)
RETURNING id;

-- 2. For each word match, persist the mention.
-- The (stream_id, word_index, global_char_offset) UNIQUE constraint dedupes.
INSERT INTO word_mentions (
  stream_id, event_id, word_index, word, matched_text,
  segment_id, stream_offset_ms, global_char_offset, snippet, confidence
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (stream_id, word_index, global_char_offset) DO NOTHING;

-- 3. Fanout to admin SSE clients.
SELECT pg_notify('word_mention', $1::TEXT);   -- payload: {eventId, wordIndex, mentionId}
```

### On stream end (any cause)

```sql
UPDATE monitored_streams
   SET status = $2,                           -- 'ended' | 'error'
       ended_at = NOW(),
       minutes_used = $3,
       cost_cents = ROUND($3 * 0.48),         -- Nova-3 monolingual rate
       error_message = $4,
       updated_at = NOW()
 WHERE id = $1 AND status = 'live';

SELECT pg_notify('stream_ended', $1::TEXT);
```

Then post Discord webhook (out-of-band, fire-and-forget, same pattern as `app/api/bug-report`).

### Reads from Next.js (admin pages)

```sql
-- Live mention counter for a market, joined with each word's threshold and
-- pre-computed "would_resolve_yes" boolean for the admin UI.
SELECT
  w.idx                                  AS word_index,
  w.word,
  w.mention_threshold,
  COALESCE(m.active_count, 0)            AS active_count,
  COALESCE(m.active_count, 0) >= w.mention_threshold AS would_resolve_yes
FROM custom_market_words w
LEFT JOIN (
  SELECT word_index, COUNT(*) AS active_count
    FROM word_mentions
   WHERE event_id = $1 AND superseded = FALSE
   GROUP BY word_index
) m ON m.word_index = w.idx
WHERE w.market_id = $2                   -- $2 is the bare custom_markets.id
ORDER BY w.idx;

-- Mention list (for the admin's evidence panel).
SELECT m.*, s.text AS segment_text
  FROM word_mentions m
  LEFT JOIN live_transcript_segments s ON s.id = m.segment_id
 WHERE m.event_id = $1
 ORDER BY m.created_at DESC
 LIMIT 50;

-- Admin dismisses a false positive.
UPDATE word_mentions
   SET superseded = TRUE, superseded_by = $2, superseded_at = NOW()
 WHERE id = $1;
```

---

## Admin Notification Flow

Three layers, each appropriate to a different urgency.

### 1. Live SSE counter (real-time, while admin has the page open)

Pattern mirrors the existing chat: a single Postgres `LISTEN` connection per Next.js process, fanned out to in-memory SSE subscribers. Re-uses `lib/chatStream.ts`'s singleton pattern; create `lib/mentionStream.ts` alongside it.

```
Admin opens /paidcustomadmin?market=42
           │
           ▼
GET /api/admin/mentions/stream?eventId=custom_42
           │  ◄────────────  EventSource()
           │
[Next.js process holds one LISTEN word_mention connection]
           │
worker emits NOTIFY word_mention {"eventId":"custom_42",...}
           │
[Next.js fans out to subscribers filtered by eventId]
           │
           ▼  data: {"wordIndex":3,"snippet":"...","confidence":0.91}
Admin UI increments counter, prepends mention card
```

The admin page shows for each market word:
- The word/phrase, its `mention_threshold`, and the live count rendered as `count / threshold` (large number)
- A "would resolve" pill: `count >= threshold` → green "YES likely", `0 < count < threshold` → amber "Below threshold", `0 mentions` → grey "NO likely"
- Average confidence indicator (green ≥0.8, yellow 0.6–0.8, red <0.6)
- Last 5 mention snippets, each with a "Listen at HH:MM:SS" link (jumps the embedded YouTube/Twitch player to that timestamp via `&t=` for VOD or just shows `±5s` from current playhead for live)
- A "Mark false positive" button per mention — flipping `superseded=true`. The count auto-decrements; the "would resolve" pill recomputes immediately.

For threshold markets specifically: when count reaches `threshold`, push a single "threshold met" toast to the admin (separate from the per-mention SSE updates) so they don't have to watch the counter. Same SSE channel, different event type.

Initial load fetches via REST (`GET /api/admin/mentions?eventId=custom_42`), then SSE pushes deltas.

### 2. Discord webhook on stream end

Reuses `DISCORD_WEBHOOK_URL` from the existing bug-report flow. Fired exactly once per stream end:

```
🟢 Stream ended — ready for resolution

Market: "Joe Rogan #2189" (paid_onchain, paid_42)
Stream: youtube.com/watch?v=xyz (3h 14m monitored, $0.93 cost)

Mention summary (excluding 2 dismissed):
• "simulation"  →   4 / threshold 1   ✅ YES likely  (avg conf 0.88)
• "DMT"         →   1 / threshold 1   ✅ YES likely  (conf 0.94)
• "Mr Speaker"  →  12 / threshold 10  ✅ YES likely  (avg conf 0.91)
• "aliens"      →   0 / threshold 1   ❌ NO likely
• "ego death"   →   0 / threshold 1   ❌ NO likely

Resolve: https://mentioned.market/paidcustomadmin?market=42
```

### 3. Discord alert on operational failures

Same webhook, different channel if you want to split:
- Stream errored before transcription started (yt-dlp/streamlink failed)
- Stream hit `MAX_HOURS_PER_STREAM` (probably needs investigation)
- Daily Deepgram cost exceeded `DAILY_COST_CENTS_ALERT`

These should be rare. If they're not, they expose a bug.

### What admins do NOT get

- No email. Out of scope.
- No mobile push. Out of scope.
- No per-mention Discord ping. Would be too noisy on chatty streams.

---

## Scalability

### Current realistic load

Mentioned currently has dozens of free markets and a handful of on-chain markets. Concurrent live streams are likely ≤5 at peak. The architecture below comfortably handles 20–30 concurrent.

### Per-worker resource cost

| Component | Memory | CPU |
|---|---|---|
| streamlink/yt-dlp child | ~50 MB | low |
| ffmpeg child | ~80 MB | ~5–10% of one core (audio-only is cheap) |
| Node WS + pipe | ~30 MB | negligible |
| Deepgram WS (no local cost) | — | — |
| **Per stream total** | **~160 MB** | **~10% of a core** |

A 4 GB / 4-core Railway container holds ~20 concurrent streams comfortably with headroom. Cost: ~$10–15/mo for the container itself.

### Postgres load

Per stream per minute: ~5 segment INSERTs, ~1–3 mention INSERTs (on chatty streams), ~1 `pg_notify`. Across 20 concurrent streams that's ~200 writes/min — utterly negligible for any Postgres tier.

`pg_notify` payloads stay under 1 KB; well below the 8 KB hard limit.

### Horizontal scaling beyond one container

When we approach `MAX_CONCURRENT_STREAMS`, scale horizontally: deploy a second worker container. They both `LISTEN stream_added` and race for rows via the CAS update. The first to flip `pending→live` owns the stream. No coordinator needed.

The cap is enforced at container level (each container holds at most N workers), not globally — so two containers each at cap give 2N concurrent streams. If we hit that ceiling we'd add a Redis-based or Postgres-based global lock; not needed at any realistic Mentioned scale.

### Bottlenecks to watch

- **Deepgram concurrent connection limit.** Default account limits exist (typically 100 concurrent for pay-as-you-go, more on contracts). Verify before claiming we can run 50.
- **Twitch/YouTube unofficial scrape rate limits.** yt-dlp pulling many YT live streams from one IP can trigger soft blocks. If we hit this, route through a residential proxy or use the YouTube Data API for the `videoId → HLS URL` step where possible.
- **HLS segment latency.** HLS adds 5–15s baseline latency from speech to audio reaching us. Not a scalability issue; a UX honesty issue (covered under "Performance").

---

## Performance

### End-to-end latency: word said → admin sees mention

```
HLS segment buffering        5–15 s   (platform-controlled, can't fix)
streamlink/yt-dlp pull       <1  s
ffmpeg decode + resample     <0.5 s
Deepgram transcription       0.3–1 s  (Nova-3 streaming, finalized result)
Postgres write + notify      <0.05 s
SSE fanout to admin browser  <0.5 s
─────────────────────────────────────
Typical end-to-end:          7–18 s
```

This is *good enough* for the use case (admins use this to assist resolution after streams end, with live UX as a bonus). It is *not* good enough for any feature that needs sub-second latency, which the product doesn't need anyway.

### Throughput

Single worker handles Nova-3's full output rate (transcripts arrive in <1 KB chunks every 1–3 seconds per stream). No throughput concerns.

### DB write hot paths

The `word_mentions` and `live_transcript_segments` indexes are on `(stream_id, time)` and `(event_id, word_index)` (filtered partial index for active mentions). Inserts append-only, no contention. Fast.

### SSE memory footprint

One `LISTEN` connection per Next.js process is shared by all SSE subscribers. Following the existing chat pattern. Per subscriber: ~5 KB of JS state. 100 admins watching simultaneously is 500 KB. Trivial.

---

## Cost

### Per-stream Deepgram cost (Nova-3 monolingual streaming, current PAYG rate)

```
$0.0048/min × 60 min = $0.288 / hour
```

| Stream length | Cost |
|---|---|
| 1 hour podcast | $0.29 |
| 3 hour podcast | $0.86 |
| 6 hour stream | $1.73 |
| 12 hour gaming session | $3.46 |

### Monthly projection (illustrative)

| Streams/day | Avg length | Days/mo | Monthly Deepgram |
|---|---|---|---|
| 2 | 2 h | 30 | $35 |
| 5 | 3 h | 30 | $130 |
| 10 | 4 h | 30 | $345 |

Add Railway container (~$15/mo). Compare against the labor cost saved (admin time × number of resolutions).

### Cost controls in code

| Control | Default | Purpose |
|---|---|---|
| `MAX_HOURS_PER_STREAM` | 12 | Hard cap; runaway protection. Covers 8–9h podcasts/sports broadcasts with margin. |
| `MAX_SILENT_MINUTES` | 20 | Kill if no transcript activity. 20 (not 5) so halftime breaks, tech difficulties, ad pods don't trigger false ends. |
| `DEEPGRAM_ROTATE_MINUTES` | 90 | Proactively reopen the Deepgram WS at this cadence. See "Long stream handling". |
| `FFMPEG_RECYCLE_MINUTES` | 240 | Proactively recycle ffmpeg to avoid memory creep on multi-hour streams. |
| `MAX_CONCURRENT_STREAMS` | 20 | Per-container cap |
| `DAILY_COST_CENTS_ALERT` | 2000 ($20) | Discord alert if exceeded |
| `DAILY_COST_CENTS_HALT` | 5000 ($50) | Stop accepting new streams for the day |

`monitored_streams.minutes_used` is updated every minute by the worker; the daily cost is a `SELECT SUM(cost_cents) WHERE created_at >= today` rolled up per-tick.

### What's deliberately NOT a cost concern

- Postgres storage. A year of transcripts at projected volume is well under 1 GB.
- Network egress on Railway. Internal traffic only between services.
- ffmpeg compute. Audio-only is cheap.

### When to revisit

If monthly Deepgram cost exceeds ~$500, evaluate self-hosted Whisper (or `faster-whisper`) on a GPU. Breakeven is somewhere around 1500 hours/mo of audio. Below that, managed STT is cheaper than running a GPU.

---

## Accuracy

### Baseline expectations (Nova-3 monolingual English streaming)

- Clean studio podcast: 92–95% word accuracy
- Game stream with music: 80–88%
- Sports broadcast with crowd: 70–82%
- Heavily accented or non-English-mixed: 65–80%

These are real-world; vendor benchmarks are higher.

### What `keyterm` actually buys us

For market words specifically — which are the only words we care about — keyterm prompting raises recall from a baseline of ~70–80% (on rare/proper-noun terms) to ~90–95%. The keyterm bias is "soft": Deepgram is more willing to predict that word, but won't predict it from nothing.

This means we will *under-detect, not over-detect* on rare terms by default. False negatives (missed mentions) are more likely than false positives. Admins should know this, and the UI should make it easy to add a mention manually if they hear one the system missed.

**Count-based markets are more sensitive to both error types.** For a "Mr Speaker said 10+ times" market:
- A false positive that pushes count from 9 → 10 flips the resolution. Mitigation: confidence floor on threshold-determining mentions; admin reviews any "just barely met threshold" markets manually before resolving.
- A false negative that drops a true 10 → 9 also flips. Mitigation: VOD post-pass is essentially required for threshold markets — its higher accuracy catches mentions the streaming pass missed.
- Phrase keyterms (e.g., "Mr Speaker") are much more robust than single-word keyterms. Recommend admins frame threshold markets around phrases, not single common words, when possible.

### False positive sources

1. **Phonetic confusion.** "Bear" ↔ "bare", "rugged" ↔ "rugpull". Mitigation: confidence threshold (mark <0.6 as auto-superseded), admin review.
2. **Substring within a longer word.** Mitigated by `\b` word boundary regex.
3. **Repetitions in transcription.** Deepgram occasionally emits overlapping content across finals (especially around rotation/recycle boundaries). Mitigated by position-based dedupe via `(wordIndex, globalCharOffset)` — same content re-emitted lands at the same offset and is skipped.
4. **Adversarial gaming.** Someone in chat or the streamer themselves saying market words intentionally. Not solvable by STT — this is a market design issue (don't list trivially-said words).

### Improving accuracy after the stream

When a stream ends, optionally run a **VOD post-pass** through Deepgram's pre-recorded API on the captured VOD URL (Twitch creates one automatically; YouTube live becomes a VOD). The pre-recorded model has full-context attention, smart formatting, and is consistently 5–10 percentage points more accurate than streaming. Same per-minute price.

The post-pass writes a fresh set of `word_mentions` rows with a `source='vod_pass'` discriminator (add column if we do this). Admin sees both sets and can choose. This is recommended for any market with non-trivial TVL.

### Confidence handling

```
confidence ≥ 0.80   →  shown to admin as "high confidence" (green)
0.60 ≤ conf < 0.80  →  "medium" (yellow)
confidence < 0.60   →  auto-superseded; admin must un-supersede to count
```

Threshold values are constants in the worker, tunable.

### Plurals and morphology

Not handled automatically. The market creator enters all variants:

```
Word: "clutch"
Match variants: ["clutches", "clutched", "clutching"]
```

Stored on `custom_market_words.match_variants` (TEXT[]) and equivalent for paid markets. The matcher tries each variant.

This is a manual step but it's:
- Predictable (admin knows exactly what counts)
- Auditable (no opaque stemming algorithm)
- Cheap (admins already create market words)

---

## Long Stream Handling (8+ hours)

Mentioned-relevant content (live podcasts, esports tournaments, full football matches) routinely runs 8–9 hours. Three things must work proactively, not just reactively, at that length:

### Deepgram WebSocket rotation

A single WS connection lasting 9 hours is exposed to every transient network blip and any provider-side maintenance event in that window. Rotate proactively every `DEEPGRAM_ROTATE_MINUTES` (default 90):

```ts
async function rotateDeepgram() {
  const next = await openDeepgramConnection({ keyterm, ... })
  await next.waitForOpen()
  const prev = active
  active = next                         // new audio chunks now go to next
  setTimeout(() => prev.finish(), 2000) // drain final results from prev
}
setInterval(rotateDeepgram, DEEPGRAM_ROTATE_MINUTES * 60 * 1000)
```

The 2-second overlap drains any in-flight finalized results from the old connection. Audio is never paused — the swap is at the "where do new chunks go" pointer. Worst case, a single segment straddling the rotation may be re-emitted by both connections; the position-based dedupe (`globalCharOffset`) handles it transparently, including for count-based markets where double-counting would corrupt the threshold check.

### ffmpeg recycle

Long-lived ffmpeg processes accumulate memory slowly (several MB/hour). Not a crisis at 2 hours; meaningful at 9. Recycle every `FFMPEG_RECYCLE_MINUTES` (default 240):

```ts
async function recycleFfmpeg() {
  const nextFf = spawn('ffmpeg', [...args])
  const nextSl = spawn('streamlink', ['--stdout', url, 'best'])
  nextSl.stdout.pipe(nextFf.stdin)
  nextFf.stdout.on('data', chunk => active.socket.send(chunk))
  // Cut old pipeline after brief overlap
  setTimeout(() => { prevFf.kill('SIGTERM'); prevSl.kill('SIGTERM') }, 2000)
}
```

Same overlap pattern. Cost: brief audio duplication, dedupe handles it.

### Fetcher restart-on-exit

streamlink and yt-dlp occasionally exit cleanly mid-stream when a CDN endpoint rotates or a TLS session goes stale. For long streams treat exit as routine, not as stream-ended: restart with the same URL up to 3 fast-consecutive failures before declaring stream errored. This is more aggressive than the general fault-recovery pattern (which would mark errored sooner).

### Cost on long streams

| Length | Deepgram cost | Worth noting |
|---|---|---|
| 4 h | $1.15 | Single-WS, no rotation needed |
| 6 h | $1.73 | One rotation cycle |
| 9 h | $2.59 | Six rotation cycles, one ffmpeg recycle |
| 12 h (cap) | $3.46 | At ceiling — should rarely hit |

A 12-hour stream is the rare case (gaming marathons, all-day tournament Day 1). If it's regular content, raise `MAX_HOURS_PER_STREAM` per market with admin opt-in rather than globally — protects against runaway streams while permitting legitimate long-form.

### What we don't bother optimizing for long streams

- **Multi-process parallelism per stream.** A single stream worker on one core handles 9-hour audio fine; splitting into multi-process for one stream gains nothing.
- **Sharded Deepgram connections.** Don't run two Deepgram WS in parallel for the same audio. Doubles cost for no accuracy benefit.

---

## Failure Modes & Recovery

| Failure | Detection | Recovery |
|---|---|---|
| Worker process crashes | Railway restart | Boot recovery re-spawns from `monitored_streams WHERE status='live'` |
| Fetcher (streamlink/yt-dlp) crashes mid-stream | Process exit event | Restart-on-exit (treat as routine for long streams); mark errored only after 3 fast-consecutive restart failures |
| ffmpeg crashes | Process exit event | Same as fetcher |
| Deepgram WS drops unexpectedly | `close` event before scheduled rotation | Reconnect with audio buffered; backoff (1/3/9s); abandon after 3 fails |
| Deepgram WS scheduled rotation | Timer fires every `DEEPGRAM_ROTATE_MINUTES` | Open replacement, swap audio pipe, drain old (see "Long Stream Handling") |
| ffmpeg memory creep on long stream | Timer fires every `FFMPEG_RECYCLE_MINUTES` | Recycle pipeline with 2s overlap |
| Postgres connection drops | `pg` client error | Pool reconnects; LISTEN re-issued automatically |
| Stream paused (no audio) | KeepAlive thread sends pings | Continue; `MAX_SILENT_MINUTES` watchdog kills runaway |
| Stream ended but ffmpeg keeps running | Silence watchdog after `MAX_SILENT_MINUTES` | Force end |
| Broadcaster ended but no clean fetcher exit | Same — silence watchdog catches it | Force end (max ~20 min lag) |
| Two workers race for same stream | CAS update returns 0 rows | Loser aborts |
| Daily cost cap hit | Tick checks `SUM(cost_cents)` | Stop accepting new streams; existing run to completion |
| Deepgram rate limit / outage | WS open fails | Mark stream errored; Discord alert |
| HLS URL expired (multi-day stream) | Fetcher exits | Restart fetcher (re-resolves) |

The principle: every external dependency has a recovery path that doesn't require human intervention except for terminal "this stream is broken" cases, which Discord alert.

---

## Deployment (Railway)

### Service definition

- New Railway service named `transcript-worker`.
- Source: same repo, root directory `services/transcript-worker`.
- Builder: Dockerfile in that directory.
- Start command: from `Dockerfile CMD` (`node dist/index.js`).
- No public networking; internal only.
- Health check: `process.uptime() > 5` exposed on a tiny HTTP server (Railway requires a healthy probe).

### Dockerfile

```dockerfile
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-pip ca-certificates curl \
    && pip3 install --break-system-packages streamlink yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

### Environment variables

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Reference Railway Postgres service |
| `PGSSL` | `require` for Railway-hosted Postgres |
| `DEEPGRAM_API_KEY` | Streaming + pre-recorded API |
| `DISCORD_WEBHOOK_URL` | Reuse from Next.js service |
| `MAX_CONCURRENT_STREAMS` | Default 20 |
| `MAX_HOURS_PER_STREAM` | Default 12 |
| `MAX_SILENT_MINUTES` | Default 20 |
| `DEEPGRAM_ROTATE_MINUTES` | Default 90 |
| `FFMPEG_RECYCLE_MINUTES` | Default 240 |
| `DAILY_COST_CENTS_ALERT` | Default 2000 |
| `DAILY_COST_CENTS_HALT` | Default 5000 |
| `NODE_ENV` | `production` |

v1 deliberately does **not** require Twitch or YouTube API credentials. End-of-stream is detected via fetcher exit + silence watchdog. See "Future enhancements" if/when API confirmation is reintroduced.

### Scheduled rebuild

`yt-dlp` requires regular updates (YouTube changes break it monthly). Add a CI job (GitHub Actions or Railway scheduled deploy) that rebuilds the container weekly. Alternative: `pip install --upgrade yt-dlp` in the Dockerfile entrypoint script (slower start but always current).

---

## Build Phases

Estimated effort: ~4 working days from zero to v1 in production.

### Phase 1 — Skeleton (1 day) ✅
- Create `services/transcript-worker/` with Dockerfile, package.json, tsconfig.
- Boot, health server, DB ping, LISTEN connection, heartbeat, graceful shutdown.

### Phase 2 — Schema + persistence (½ day) ✅
- Migrations: `monitored_streams`, `live_transcript_segments`, `word_mentions`.
- `mention_threshold` and `match_variants` columns on `custom_market_words`.

### Phase 3 — Worker manager + Deepgram pipeline (1.5 days)
- Pool of stream workers, spawn/teardown lifecycle.
- `streamlink|yt-dlp → ffmpeg → Deepgram` pipeline.
- Word matcher with sliding-window phrase support.
- Periodic Deepgram WS rotation (90 min) and ffmpeg recycle (4 h).
- Fetcher restart-on-exit, silence watchdog, hard-cap cost protection.
- LISTEN/NOTIFY for `stream_added` / `stream_canceled`.
- CAS spawn gate + boot recovery (no API re-verification — see Phase 4 note).

### Phase 4 — Discord summary on end (½ day)
- Stream-end detection (fetcher exit + silence watchdog).
- Discord webhook with mention summary including count/threshold.
- Cost cap watchdog (`DAILY_COST_CENTS_*`).
- *Excludes* Twitch/YouTube API polling — deferred to "Future enhancements".

### Phase 5 — Admin UI (1 day)
- `GET /api/admin/mentions?eventId=...` for initial load.
- `GET /api/admin/mentions/stream?eventId=...` SSE following `chatStream.ts` pattern.
- Mention counter (count/threshold + would-resolve pill) + evidence panel + jump-to-time + dismiss-as-FP buttons in `/customadmin`.
- "Force end stream" button writing `status='ended'` and emitting `stream_canceled`.
- Per-word `mention_threshold` and `match_variants` editors.

### Phase 6 — VOD post-pass (½ day, optional v1)
- After stream ends, fetch VOD URL.
- Deepgram pre-recorded API call.
- Insert second-pass mentions tagged `source='vod_pass'`.
- Admin UI shows both passes side-by-side.

### Phase 7 — Hardening (½ day, ongoing)
- Reconnect logic on every external connection.
- Cost dashboard endpoint.
- Operational alerts.
- Load test with 10 concurrent fake streams (file replays via ffmpeg).

---

## Open Decisions

These are real choices the team needs to make before / during implementation. They're not implementation details; they're product/architecture forks.

### 1. Where on-chain market words live (deferred — v1 is free markets only)

Decided: out of scope for v1. When paid markets are added, the recommended path is to have the existing Helius webhook indexer write word lists into a new `paid_market_words` DB table on `CreateMarket` events (mirrors how `trade_events` gets indexed today). No design work needed until then.

### 2. Privacy / TOS considerations

Twitch and YouTube terms permit end-user playback but not necessarily automated scraping/transcription. Mentioned's defense:

- We're transcribing the same audio a human admin would. Net effect is identical.
- We don't redistribute the transcripts (admin-only).

That's defensible but not bulletproof. **If markets resolve on copyrighted broadcasts (sports leagues, network TV), legal review needed before building infra around that use case.** Creator-owned Twitch and YouTube streams: low risk.

---

## Future Enhancements (not v1)

### Twitch Helix + YouTube Data API end-detection

Currently end-of-stream is detected reactively (fetcher exit + silence watchdog), with up to ~20 min of lag for "broadcaster cut feed without clean playlist termination" cases. If that lag becomes a UX problem, add an authoritative end-detector tick:

- 60s tick across `monitored_streams WHERE status='live'`.
- Twitch: `GET https://api.twitch.tv/helix/streams?user_login=<channel>` — empty response = offline. Requires `TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET` (app access token).
- YouTube: `GET https://www.googleapis.com/youtube/v3/videos?id=<id>&part=liveStreamingDetails`. `actualEndTime` set or `liveBroadcastContent === 'none'` = ended. Requires `YOUTUBE_API_KEY`.
- Two consecutive "ended" reads required before flipping (debounces transient API errors).

Estimated effort to add: ½ day. Cost: free at Mentioned scale (Twitch Helix has generous limits, YouTube API has 10k units/day default — `videos.list` is 1 unit each).

The spec was originally written including this; it was descoped from v1 because the lag is acceptable given admins are not blocked on end-detection (they can manually end via the admin UI).

### Per-mention Discord ping for high-confidence rare-word hits

Right now Discord fires once per stream end. For long sports broadcasts where a rare word's first mention is itself notable ("Mr Speaker just resigned!"), per-mention ping might be valuable — but only for words with `mention_threshold = 1` and `confidence > 0.9`. Off by default.

### Public transcript archive

The schema supports it. Out of scope for v1. Decision needed before public exposure: redaction policy (slurs, doxxing, copyrighted song lyrics).

### Multilingual streams

Nova-3 multilingual handles ~15 languages and is materially worse on each than Nova-3 monolingual on its language. Add a per-stream `language` column (default `en`, optionally `multi`) and pass to Deepgram. Trivial extension when needed.

---

## Out of Scope for This Doc

- **Automatic resolution.** Discussed under "Why we don't auto-resolve."
- **Public transcript archive UI.** Schema supports it; UI doesn't.
- **Multi-region deployment.** Single-region (Railway primary) is fine for years.
- **End-user-facing live captions.** Different product feature.
- **Sentiment / topic / chapter extraction.** Deepgram and AssemblyAI both offer; not relevant to the resolution use case.
- **Audio fingerprinting / song detection.** Would require Audible Magic or similar. Unrelated to mention markets.

---

## CLAUDE.md Updates Required After Build

When the worker ships, add to CLAUDE.md:

- New `services/transcript-worker/` service directory and its purpose
- New tables: `monitored_streams`, `live_transcript_segments`, `word_mentions`
- New API routes: `GET /api/admin/mentions`, `GET /api/admin/mentions/stream` (SSE)
- New environment variables (DEEPGRAM_API_KEY, etc.)
- New `lib/mentionStream.ts` Postgres LISTEN singleton (mirrors `lib/chatStream.ts`)
- Operational notes: weekly Dockerfile rebuild for yt-dlp updates, daily cost dashboard

The "Three Market Types" section in CLAUDE.md doesn't need updates (this feature is orthogonal). The "Performance Patterns" section gains an entry for "SSE + Postgres LISTEN" being now used in two places (chat and mentions).
