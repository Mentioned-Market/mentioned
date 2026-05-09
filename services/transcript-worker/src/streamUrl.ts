// Pipeline specs for the audio source. Two shapes:
//
//   - 'piped'  → fetcher (streamlink|yt-dlp) writes TS to stdout, ffmpeg
//                consumes that on stdin. Used for twitch:// and youtube://.
//   - 'direct' → ffmpeg reads directly from a local audio device (dshow on
//                Windows, avfoundation on macOS, pulse on Linux). No fetcher.
//                Used for local-audio:// URLs on a laptop running with
//                WORKER_POOL=local.

export type StreamSource = 'twitch' | 'youtube' | 'local-audio'

export interface PipedPipeline {
  kind: 'piped'
  source: 'twitch' | 'youtube'
  fetcherCmd: string
  fetcherArgs: string[]
  ffmpegArgs: string[]
}

export interface DirectPipeline {
  kind: 'direct'
  source: 'local-audio'
  ffmpegArgs: string[]
}

export type Pipeline = PipedPipeline | DirectPipeline

export interface LocalAudioConfig {
  /** ffmpeg input format, e.g. 'dshow', 'avfoundation', 'pulse'. */
  format: string
  /** Device name as ffmpeg expects it for the chosen format. */
  device: string
}

const TWITCH_HOSTS = /(^|\.)twitch\.tv$/i
const YT_HOSTS = /(^|\.)(youtube\.com|youtu\.be)$/i

export function detectSource(url: string): StreamSource | null {
  if (url.startsWith('local-audio://')) return 'local-audio'
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

/**
 * Build the pipeline spec for a stream URL.
 *
 * For local-audio URLs, the device config comes from env (LOCAL_AUDIO_FORMAT
 * and LOCAL_AUDIO_DEVICE) — the URL itself is just a friendly identifier.
 * Pass the resolved config in via `localAudio`.
 */
export function buildPipeline(
  url: string,
  localAudio?: LocalAudioConfig,
): Pipeline {
  const source = detectSource(url)
  if (source === 'twitch') {
    return {
      kind: 'piped',
      source,
      fetcherCmd: 'streamlink',
      fetcherArgs: ['--stdout', '--retry-streams', '5', '--retry-max', '3', url, 'best'],
      ffmpegArgs: pipedFfmpegArgs(),
    }
  }
  if (source === 'youtube') {
    return {
      kind: 'piped',
      source,
      fetcherCmd: 'yt-dlp',
      fetcherArgs: ['-q', '-o', '-', '-f', 'bestaudio/best', url],
      ffmpegArgs: pipedFfmpegArgs(),
    }
  }
  if (source === 'local-audio') {
    if (!localAudio) {
      throw new Error(
        'local-audio URL but LOCAL_AUDIO_FORMAT / LOCAL_AUDIO_DEVICE not configured',
      )
    }
    return {
      kind: 'direct',
      source,
      ffmpegArgs: directFfmpegArgs(localAudio),
    }
  }
  throw new Error(`unsupported stream URL: ${url}`)
}

/** ffmpeg args for the piped case: read TS/audio container from stdin. */
function pipedFfmpegArgs(): string[] {
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

/**
 * ffmpeg args for the direct case: read from a local audio device. The input
 * format determines how the device is addressed:
 *
 *   dshow         (Windows)  → -f dshow -i audio="<device>"
 *   avfoundation  (macOS)    → -f avfoundation -i ":<device>"
 *   pulse         (Linux)    → -f pulse -i <device>
 */
function directFfmpegArgs(cfg: LocalAudioConfig): string[] {
  const inputArgs = inputArgsForFormat(cfg)
  return [
    '-loglevel', 'error',
    '-thread_queue_size', '1024',
    ...inputArgs,
    '-vn',
    '-af', 'highpass=f=80,lowpass=f=8000,afftdn=nf=-25',
    '-f', 's16le',
    '-ac', '1',
    '-ar', '16000',
    'pipe:1',
  ]
}

function inputArgsForFormat(cfg: LocalAudioConfig): string[] {
  switch (cfg.format) {
    case 'dshow':
      // Windows DirectShow: device name lives in the -i arg, prefixed audio=.
      // Quoting is handled by the spawn argv (no shell interpolation).
      return ['-f', 'dshow', '-audio_buffer_size', '50', '-i', `audio=${cfg.device}`]
    case 'avfoundation':
      // macOS: input is "<video>:<audio>". For audio-only, leading colon.
      return ['-f', 'avfoundation', '-i', `:${cfg.device}`]
    case 'pulse':
      return ['-f', 'pulse', '-i', cfg.device]
    case 'alsa':
      return ['-f', 'alsa', '-i', cfg.device]
    default:
      throw new Error(
        `unsupported LOCAL_AUDIO_FORMAT: ${cfg.format} ` +
        `(expected one of: dshow, avfoundation, pulse, alsa)`,
      )
  }
}
