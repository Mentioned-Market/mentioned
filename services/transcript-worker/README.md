# transcript-worker

Live stream transcription + word mention detection service for Mentioned. Long-running Node process. Deployed to Railway as a separate service in the same project as the Next.js app.

Full design: [`specs/live_transcription_spec.md`](../../specs/live_transcription_spec.md).

## Status

**Phases 1–3.** The service:

- Connects to the existing Mentioned Postgres
- Opens a health server on `PORT` (default 3001)
- Subscribes to `LISTEN stream_added` / `stream_canceled` and CAS-claims
  pending streams (the worker that flips `pending → live` owns them)
- Boot recovery: re-spawns workers for any rows left in `pending` or `live`
  state from a prior process (no API re-verify in Phase 3 — see spec for
  Phase 4+ enhancement)
- Per-stream pipeline: `streamlink|yt-dlp` → `ffmpeg` (16 kHz mono PCM) →
  Deepgram Nova-3 streaming with keyterm prompting → finalized segments →
  `live_transcript_segments` + `word_mentions` rows + `NOTIFY word_mention`
- Sliding-window phrase matcher with position-based dedupe across segment
  boundaries
- Long-stream maintenance: Deepgram WS rotation (every 90 min), ffmpeg
  recycle (every 4 h), fetcher restart-on-exit (5/15/45 s backoff)
- Cost protection: `MAX_HOURS_PER_STREAM` hard cap, `MAX_SILENT_MINUTES`
  watchdog
- Heartbeats to logs every 60 s; graceful shutdown on `SIGTERM` / `SIGINT`

Phase 3 does **not** yet:
- Post a Discord summary on stream end (Phase 4)
- Run a VOD post-pass (Phase 6, optional)
- Re-verify live streams against Twitch/YouTube APIs on boot (deferred per spec)

See `specs/live_transcription_spec.md` for the full phasing.

## Local development

The worker auto-loads a `.env` file in this directory via `dotenv` on
startup, so you only need to set env vars in the shell if you don't want to
use a file.

```bash
cd services/transcript-worker
cp .env.example .env
# edit .env — fill in DATABASE_URL, DEEPGRAM_API_KEY, etc.
npm install
npm run dev
```

`.env` is gitignored. `.env.example` is the documented template — every var
has a comment explaining what it does and when to set it.

For the laptop (Windows) capture mode, set `WORKER_POOL=local` plus
`LOCAL_AUDIO_FORMAT` / `LOCAL_AUDIO_DEVICE` in `.env`. See the example file
for OS-specific values.

Health check + smoke test:

```bash
curl http://localhost:3001/health
# => {"ok":true,"ready":true,"uptimeSeconds":12,"activeStreams":0}

psql "$DATABASE_URL" -c "NOTIFY stream_added, '{\"streamId\":1}'"
# Worker logs: notification {"channel":"stream_added","payload":"{\"streamId\":1}"}
```

## Build

```bash
npm run build      # tsc → dist/
npm run typecheck  # tsc --noEmit
```

## Deploy (Railway)

Add a new service in the Mentioned Railway project pointing to the same repo with **root directory** `services/transcript-worker`. Railway auto-detects the Dockerfile.

### Required environment variables

| Var | Source | Phase needed |
|---|---|---|
| `DATABASE_URL` | Reference the Postgres service | Phase 1 |
| `PGSSL` | `require` for Railway-hosted Postgres | Phase 1 |
| `LOG_LEVEL` | `info` (default), `debug` for noisy local | any |
| `PORT` | `3001` (Railway sets automatically) | Phase 1 |
| `DEEPGRAM_API_KEY` | Deepgram dashboard | Phase 3 |
| `DISCORD_WEBHOOK_URL` | Same as the Next.js bug-report flow | Phase 4 |
| `MAX_CONCURRENT_STREAMS` | default 20 | Phase 3 |
| `MAX_HOURS_PER_STREAM` | default 12 | Phase 3 |
| `MAX_SILENT_MINUTES` | default 20 | Phase 3 |
| `DEEPGRAM_ROTATE_MINUTES` | default 90 | Phase 3 |
| `FFMPEG_RECYCLE_MINUTES` | default 240 | Phase 3 |

v1 deliberately does **not** require Twitch or YouTube API credentials — end-of-stream is detected via fetcher exit + silence watchdog, not by polling platform APIs. See the spec's "Future enhancements" section if/when API confirmation is reintroduced.

### Networking

Internal-only. Do **not** assign a public domain. The health probe is internal.

### Observability

Logs are JSON Lines on stdout/stderr. Railway captures these. Notable events to alert on:
- `level: error` lines
- Heartbeat gaps > 90s (process wedged or crashed)
- `listener disconnected` followed by no `listener connected` within 60s

## Architecture

```
+----------------------+      LISTEN/NOTIFY      +---------------------+
|  Next.js (existing)  | <---------------------> |  transcript-worker  |
|                      |                         |                     |
|  /api/admin/streams  |  insert pending row     |  StreamListener     |
|  /api/admin/mentions |                         |  StreamWorker(s)    |
+----------------------+                         +---------------------+
            \                                     /
             \                                   /
              v                                 v
            +----------------------------------+
            |   Postgres (shared)              |
            |   - monitored_streams (new)      |
            |   - live_transcript_segments     |
            |   - word_mentions                |
            |   - custom_market_words (+cols)  |
            +----------------------------------+
```
