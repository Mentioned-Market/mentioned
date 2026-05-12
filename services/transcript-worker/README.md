# transcript-worker

Live stream transcription and word-mention detection service for Mentioned. A long-running Node process deployed alongside the Next.js app on Railway. Reads stream URLs from Postgres, transcribes the audio through Deepgram, matches configured words and phrases as they're spoken, and writes mentions back for the admin tooling to act on.

## What it does

- Subscribes to Postgres `LISTEN/NOTIFY` channels to claim new monitored streams the moment an admin starts one
- Per-stream pipeline: `streamlink` (Twitch) or `yt-dlp` (YouTube) → `ffmpeg` (16 kHz mono PCM) → Deepgram Nova-3 streaming with keyterm prompting → finalized segments → `live_transcript_segments` + `word_mentions` → `NOTIFY word_mention` for live admin UI
- Sliding-window phrase matcher with position-based dedupe across segment boundaries — repeated mentions all logged, no double-counting across Deepgram WS rotations or ffmpeg recycles
- Long-stream maintenance: Deepgram WS rotation every 90 min, ffmpeg recycle every 4 h, fetcher restart-on-exit with 5/15/45 s backoff
- VOD post-pass: standalone transcription of uploaded YouTube/Twitch VODs via Deepgram's pre-recorded API
- Cost protection: per-stream hard hour cap, silence watchdog that ends streams when audio stalls, daily cost cap that refuses new spawns when the budget is hit
- End-of-stream Discord summary with per-word verdicts and confidence
- First-mention Discord ping for threshold-1 words so admins can resolve immediately
- Heartbeat logs every 60 s; graceful shutdown on `SIGTERM` / `SIGINT`
- Boot recovery: re-spawns workers for any streams left in `pending` or `live` state from a prior process

The worker has no HTTP surface to the Next.js app — they share a Postgres database and communicate exclusively through `LISTEN/NOTIFY` channels and shared tables. Schema lives in `scripts/migrate.ts` at the repo root.

## Run locally

```bash
cd services/transcript-worker
cp .env.example .env       # fill in DATABASE_URL, DEEPGRAM_API_KEY
npm install
npm run dev
```

`.env` is gitignored. Every env var has a comment in `.env.example` explaining what it does and when to set it. The worker auto-loads `.env` via `dotenv` on startup.

Health check:

```bash
curl http://localhost:3001/health
# => {"ok":true,"ready":true,"uptimeSeconds":12,"activeStreams":0}
```

Smoke-test the listener by simulating a NOTIFY:

```bash
psql "$DATABASE_URL" -c "NOTIFY stream_added, '{\"streamId\":1}'"
# Worker logs: notification {"channel":"stream_added","payload":"{\"streamId\":1}"}
```

## Build

```bash
npm run build      # tsc → dist/
npm run typecheck  # tsc --noEmit
```

## Deploy (Railway)

Add a new service in the Mentioned Railway project pointing at the same repo with **root directory** `services/transcript-worker`. Railway auto-detects the Dockerfile.

### Required environment variables

| Var | Source |
|---|---|
| `DATABASE_URL` | Reference the Postgres service |
| `PGSSL` | `require` for Railway-hosted Postgres |
| `DEEPGRAM_API_KEY` | Deepgram dashboard |
| `DISCORD_WEBHOOK_URL` | Same Discord webhook the Next.js app uses |
| `LOG_LEVEL` | `info` (default), `debug` for noisier output |
| `PORT` | Railway sets this automatically |
| `MAX_CONCURRENT_STREAMS` | default 20 |
| `MAX_HOURS_PER_STREAM` | default 12 |
| `MAX_SILENT_MINUTES` | default 20 |
| `DEEPGRAM_ROTATE_MINUTES` | default 90 |
| `FFMPEG_RECYCLE_MINUTES` | default 240 |

End-of-stream is detected via fetcher exit and the silence watchdog. No Twitch or YouTube API credentials required.

### Networking

Internal-only. Don't assign a public domain. The health probe is internal.

### Observability

Logs are JSON Lines on stdout/stderr. Railway captures them. Things worth alerting on:

- `level: error` lines
- Heartbeat gaps > 90 s (process wedged or crashed)
- `listener disconnected` followed by no `listener connected` within 60 s

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
            |   - monitored_streams            |
            |   - live_transcript_segments     |
            |   - word_mentions                |
            |   - custom_market_words (+cols)  |
            +----------------------------------+
```
