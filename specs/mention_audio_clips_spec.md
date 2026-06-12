# Mention Audio Clips — Spec

Capture a short audio clip of each detected word mention so admins can listen and
verify the call before resolving a market (resolution freezes trading, so a wrong
call is costly). Additive to the existing live-transcription pipeline — no change
to detection, matching, or the live mention SSE.

## Goal

When the transcript worker logs a `word_mentions` row, also save a ~6–7 s WAV clip
of the audio around the spoken word to a private object-storage bucket, and surface
a play control next to that mention in the `/customadmin` MentionsPanel.

## Why this is safe to bolt on

The raw 16 kHz mono `s16le` PCM (32000 bytes/s) already flows through
`StreamWorker.dispatchAudio` on its way to Deepgram. We keep a short rolling buffer
of it in memory and cut a window when a mention fires. The clip work is entirely
downstream of and decoupled from mention detection.

## Key design decisions

### 1. Deferred extraction (generous padding for safety)
A finalized segment's end ≈ "now", but the word was spoken ~1–2 s earlier (Deepgram
latency). The trailing pad is therefore future audio at mention time. So we schedule
extraction ~3.5 s **after** the mention (`CLIP_TRAILING_DELAY_MS`), by which point the
trailing context has been buffered. Window = `[startMs − PAD, startMs + durationMs + PAD]`
with `PAD = CLIP_PAD_SECONDS` (default 3 s). Generous padding means the word is always
comfortably inside the clip; we never need frame-accurate alignment.

### 2. Byte clock, not wall clock
The ring buffer tags chunks with an absolute byte offset. `bytesPerSec = 32000`
(16000 Hz × 2 bytes × 1 channel) — derived from the same sample-rate the ffmpeg/Deepgram
pipeline is configured with, so it can't drift. The mention's capture-relative ms window
is converted to an absolute byte range (aligned down to a 2-byte sample boundary) and
sliced. This survives Deepgram WS rotation and ffmpeg recycle, which is exactly why the
existing code uses capture-relative offsets rather than Deepgram's connection-relative ones.

### 3. Off the hot path
The mention INSERT + `NOTIFY word_mention` is unchanged and fires immediately. The clip
is added afterward, fire-and-forget (same contract as `maybeAutoLock`):
`deferred extract → WAV wrap → S3 putObject → UPDATE word_mentions SET clip_key → NOTIFY clip_ready`.
A clip failure can never delay or break detection. The clip appears in the UI a few
seconds after the mention (live via `clip_ready`, or on the 20 s refetch).

### 4. WAV, no re-encode
PCM slice + 44-byte WAV header. No per-mention ffmpeg process. ~7 s ≈ 220 KB.

### 5. Feature-flagged, zero overhead when off
If `CLIP_CAPTURE_ENABLED !== 'true'` or S3 isn't configured, the ring buffer is never
allocated and `dispatchAudio` is untouched. Local dev needs no bucket.

## Performance

- Memory: 60 s × 32 KB/s ≈ 1.9 MB/stream × 20 concurrent ≈ 38 MB. Bounded.
- Ring buffer pruned by **batched byte count** (drop whole oldest chunks once total
  exceeds the cap) — not per-chunk `Array.shift()`.
- CPU: one `Buffer.concat` (~220 KB) per mention, on a timer, off the detection path.
- No change to detection latency or the live admin SSE.

## Security

- Bucket is **private**. Worker holds write creds; Next.js holds presign creds. The
  browser never sees credentials.
- Clip route `GET /api/admin/mentions/[id]/clip` is gated by `getVerifiedWallet` +
  `isAdmin` (mirrors the existing mentions routes). It takes a **mention id**, looks up
  that row's `clip_key` server-side, and 302-redirects to a **short-lived presigned GET**
  (5 min). The key is never user-supplied → no path traversal, no arbitrary-object access.
- Presign redirect serves straight from the bucket → free bucket egress, no Next.js
  egress. No CORS needed (no browser-side PUT; `<audio>` follows the 302 for playback,
  carrying the same-origin session cookie to the route).

## Scalability / retention

- Deterministic key `clips/{streamId}/{mentionId}.wav`.
- Bucket **lifecycle rule** expires objects after 30 days (review-only data) — no cron.
  `word_mentions` rows already CASCADE on stream delete; orphaned objects clear on expiry.

## Data model

`word_mentions` gains:

```sql
ALTER TABLE word_mentions ADD COLUMN IF NOT EXISTS clip_key TEXT;
```

`NULL` until the deferred upload completes (or permanently if clips are disabled /
the upload failed / the mention landed in the stream-end edge window).

## NOTIFY

New discriminator on the existing `word_mention` channel:

```json
{ "type": "clip_ready", "streamId": <id>, "mentionId": <id>, "wordIndex": <id> }
```

Consumers already tolerate unknown types; UI maps it to "this mention now has a clip".

## File changes

### Worker (`services/transcript-worker/`)
- `package.json` — add `@aws-sdk/client-s3`.
- `src/pcmRingBuffer.ts` (new) — byte-clocked ring buffer: `append(chunk)`,
  `byteToMs`/`msToByte`, `extractWav(byteStart, byteEnd)` → `Buffer | null`.
- `src/clipStore.ts` (new) — env-gated S3 client, `isClipStoreEnabled()`,
  `putClip(key, wav)`. No-op/lazy when unconfigured.
- `src/streamWorker.ts` — allocate ring buffer when enabled; feed it in
  `dispatchAudio`; on a **new** mention (insert rowCount > 0) schedule the deferred
  extract+upload+`UPDATE clip_key`+`clip_ready` NOTIFY; track timers and clear on stop.
- `src/index.ts` — parse `CLIP_*` env into `StreamWorkerConfig`.
- `.env.example` — document new vars.

### Next.js (root)
- `scripts/migrate.ts` — `clip_key` column.
- `lib/db.ts` — add `clip_key` to `WordMentionRow` + the recent-mentions SELECT in
  `getMentionsForStream`.
- `lib/clipStore.ts` (new) — server-side presign GET.
- `app/api/admin/mentions/[id]/clip/route.ts` (new) — admin-gated 302 to presigned URL.
- `app/customadmin/MentionsPanel.tsx` — `clip_key` on `MentionRow`; per-mention play
  control; handle `clip_ready` SSE event.
- `lib/mentionStream.ts` — add `'clip_ready'` to the discriminator union.
- root `package.json` — add `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`.

## Env vars

Worker:
- `CLIP_CAPTURE_ENABLED` (default `false`)
- `CLIP_PAD_SECONDS` (default `3`)
- `CLIP_BUFFER_SECONDS` (default `60`)
- `CLIP_TRAILING_DELAY_MS` (default `3500`)
- `S3_BUCKET`, `S3_ENDPOINT` (`https://storage.railway.app`), `S3_REGION`,
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`

Next.js: same S3 vars (read/presign).

## Railway deploy (after merge)
1. Create a storage bucket in the project.
2. Worker env: S3 creds + `CLIP_*`. Deploy (auto Docker rebuild for the new dep;
   ffmpeg already in image).
3. Next.js env: S3 creds. Deploy.
4. Run `npm run db:migrate`.
5. Set bucket lifecycle/retention rule (30 days).

## Known limitations (v1)
- Mentions in the last ~`CLIP_TRAILING_DELAY_MS` before a clean stream end may not get
  a clip (buffer torn down before the deferred timer fires). Best-effort; a
  synchronous flush-on-shutdown can be added later.
- VOD jobs (`vodJob.ts`) are out of scope — this covers the live `StreamWorker` path.
