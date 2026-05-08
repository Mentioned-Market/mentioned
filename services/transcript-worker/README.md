# transcript-worker

Live stream transcription + word mention detection service for Mentioned. Long-running Node process. Deployed to Railway as a separate service in the same project as the Next.js app.

Full design: [`specs/live_transcription_spec.md`](../../specs/live_transcription_spec.md).

## Status

**Phase 1 (foundation).** The service:

- Connects to the existing Mentioned Postgres
- Opens a health server on `PORT` (default 3001)
- Subscribes to `LISTEN stream_added` and `LISTEN stream_canceled`
- Performs boot recovery (logs in-flight streams from `monitored_streams`)
- Heartbeats to logs every 60s
- Handles graceful shutdown on `SIGTERM` / `SIGINT`

Phase 1 does **not** yet:
- Spawn stream workers
- Pull HLS / run ffmpeg
- Talk to Deepgram

Those come in Phase 3 and beyond. See the spec for the build phasing.

## Local development

The worker reads `DATABASE_URL` from the environment. To share the same Postgres as the Next.js app in dev:

```bash
# from repo root
npm run db:start                       # starts local Postgres + runs migrations
cd services/transcript-worker
npm install

# Pick up DATABASE_URL from project root .env.local:
export $(grep -v '^#' ../../.env.local | xargs)
npm run dev
```

Then in another terminal:

```bash
curl http://localhost:3001/health
# => {"ok":true,"ready":true,"uptimeSeconds":12,"activeStreams":0}
```

To verify LISTEN is wired up:

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
