// Lightweight liveness probes for Twitch and YouTube URLs. Used by the
// per-worker end-detection tick to confirm a stream is still live when
// audio has been quiet for a while.
//
// The principle: only positive "definitely offline" results count. Probe
// errors (network blips, bot challenges, transient extraction failures)
// return 'unknown' so we don't falsely end a live stream because the probe
// itself was flaky.

import { spawn } from 'node:child_process'
import { log } from './log'
import type { StreamSource } from './streamUrl'

export type ProbeResult = 'live' | 'offline' | 'unknown'

const PROBE_TIMEOUT_MS = 15_000

/**
 * Best-effort probe: returns 'offline' only when the platform unambiguously
 * tells us the broadcast isn't currently live. Network issues, bot challenges,
 * and timeouts all return 'unknown' so the caller doesn't end a stream on a
 * flaky probe.
 *
 * Caller is expected to require 2+ consecutive 'offline' results before
 * declaring a stream ended.
 */
export async function probeStreamLive(
  url: string,
  source: StreamSource,
): Promise<ProbeResult> {
  if (source === 'twitch') return probeTwitch(url)
  if (source === 'youtube') return probeYoutube(url)
  // local-audio has no remote platform to probe.
  return 'unknown'
}

/**
 * `streamlink --json <url>` exits 0 with a JSON object when the channel is
 * live, and exits non-zero with "No playable streams found" when it isn't.
 * Fast (~100ms typical) and doesn't need an API key.
 */
async function probeTwitch(url: string): Promise<ProbeResult> {
  const out = await runWithTimeout('streamlink', ['--json', url], PROBE_TIMEOUT_MS)
  if (out.timedOut) return 'unknown'
  if (out.code === 0) return 'live'
  // streamlink uses code 1 for "no playable streams." Any non-zero is a
  // negative signal, but only the canonical "no streams" message lets us
  // safely call it offline — other errors (network, plugin) could be
  // transient.
  const stderr = (out.stderr || '').toLowerCase()
  if (stderr.includes('no playable streams') || stderr.includes('not found')) {
    return 'offline'
  }
  return 'unknown'
}

/**
 * `yt-dlp --simulate --print is_live <url>` writes "True"/"False"/"None"
 * to stdout. Heavier than the Twitch probe (~2-5s) because yt-dlp resolves
 * the YouTube player config, so the caller's gating on "skip if recently
 * had audio" is important to keep cost bounded.
 */
async function probeYoutube(url: string): Promise<ProbeResult> {
  const out = await runWithTimeout(
    'yt-dlp',
    [
      '-q',
      '--simulate',
      '--no-warnings',
      '--js-runtimes', 'node',
      '--extractor-args', 'youtube:player_client=tv,web_safari',
      '--print', 'is_live',
      url,
    ],
    PROBE_TIMEOUT_MS,
  )
  if (out.timedOut || out.code !== 0) return 'unknown'
  const text = (out.stdout || '').trim().toLowerCase()
  if (text === 'true') return 'live'
  if (text === 'false') return 'offline'
  // "None" or empty: yt-dlp couldn't determine. Treat as unknown rather
  // than risk a false offline.
  return 'unknown'
}

interface ProcessResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

function runWithTimeout(cmd: string, args: string[], timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGKILL') } catch {}
    }, timeoutMs)
    timer.unref()

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    }

    child.on('exit', (code) => finish(code))
    child.on('error', (err) => {
      log.warn('probe spawn error', { cmd, err: err.message })
      finish(null)
    })
  })
}
