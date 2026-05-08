// Helpers for resolving a user-facing stream URL into a fetcher command
// (streamlink for Twitch, yt-dlp for YouTube). The fetcher's stdout is the
// raw TS/HLS byte stream; ffmpeg consumes it via pipe.

export type StreamSource = 'twitch' | 'youtube'

export interface FetcherSpec {
  source: StreamSource
  cmd: string
  args: string[]
}

const TWITCH_HOSTS = /(^|\.)twitch\.tv$/i
const YT_HOSTS = /(^|\.)(youtube\.com|youtu\.be)$/i

export function detectSource(url: string): StreamSource | null {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return null
  }
  if (TWITCH_HOSTS.test(host)) return 'twitch'
  if (YT_HOSTS.test(host)) return 'youtube'
  return null
}

export function buildFetcher(url: string): FetcherSpec {
  const source = detectSource(url)
  if (source === 'twitch') {
    // streamlink writes TS to stdout. 'best' picks the highest available
    // quality; we throw away video downstream so quality only affects audio
    // codec selection — leave it to streamlink defaults.
    return {
      source,
      cmd: 'streamlink',
      args: ['--stdout', '--retry-streams', '5', '--retry-max', '3', url, 'best'],
    }
  }
  if (source === 'youtube') {
    // yt-dlp: prefer audio-only formats to reduce bandwidth, fall back to best.
    return {
      source,
      cmd: 'yt-dlp',
      args: ['-q', '-o', '-', '-f', 'bestaudio/best', url],
    }
  }
  throw new Error(`unsupported stream URL (not twitch/youtube): ${url}`)
}

export function ffmpegArgs(): string[] {
  // Read TS/audio container from stdin, decode, downmix to 16 kHz mono PCM
  // s16le, apply a light noise floor cleanup. Output to stdout for the
  // Deepgram WS to consume.
  return [
    '-loglevel', 'error',
    '-i', 'pipe:0',
    '-vn',
    '-af', 'highpass=f=80,lowpass=f=8000,afftdn=nf=-25',
    '-f', 's16le',
    '-ac', '1',
    '-ar', '16000',
    'pipe:1',
  ]
}
