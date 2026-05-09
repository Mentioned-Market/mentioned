// Pre-recorded transcription via Deepgram's REST API. Used by VodJob.
//
// Why fetch instead of the SDK: we want a tight AbortController for cancel
// support, an explicit timeout, and a fully-typed response we can pattern-
// match against. Plain fetch gives all three with no SDK quirks, and the
// SDK's prerecorded surface is currently a simple JSON wrapper anyway.

import { log } from './log'

const API_BASE = 'https://api.deepgram.com/v1/listen'

export interface PrerecordedRequest {
  /** Direct media URL (HLS m3u8 from yt-dlp -g, or any audio file URL). */
  audioUrl: string
  /** Words / phrases to bias the model toward. Same role as in streaming. */
  keyterms: string[]
  language?: string
  model?: string
  /** Optional cancellation. */
  signal?: AbortSignal
}

/**
 * One utterance from Deepgram's pre-recorded response. Each utterance is a
 * natural speech segment (bounded by pauses) — exactly the shape we want
 * for `live_transcript_segments` rows.
 */
export interface DeepgramUtterance {
  start: number
  end: number
  confidence: number
  transcript: string
  words: { word: string; start: number; end: number; confidence: number }[]
}

export interface PrerecordedResult {
  /** request_id from Deepgram metadata, useful for support tickets. */
  requestId: string | null
  /** Total audio duration Deepgram billed (seconds). */
  durationSec: number
  utterances: DeepgramUtterance[]
}

interface CommonOptions {
  keyterms: string[]
  language?: string
  model?: string
  signal?: AbortSignal
}

export interface PrerecordedBytesRequest extends CommonOptions {
  /** Audio bytes — any format Deepgram supports (mp3, m4a, ts, etc.). */
  audio: Buffer
  /** Optional MIME hint. Defaults to audio/* if not specified. */
  contentType?: string
}

/**
 * POST to /v1/listen with the URL form. Deepgram fetches the URL itself.
 * Works for publicly-fetchable URLs (Twitch HLS m3u8) but NOT for URLs
 * bound to the requesting client (YouTube audio URLs return 403 to anyone
 * but yt-dlp's request). For YouTube, use transcribePrerecordedBytes.
 */
export async function transcribePrerecorded(
  apiKey: string,
  req: PrerecordedRequest,
  opts: { timeoutMs?: number } = {},
): Promise<PrerecordedResult> {
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY is required')

  log.info('deepgram pre-recorded: submitting (URL form)', {
    audioUrl: maskUrl(req.audioUrl),
    keyterms: req.keyterms.length,
  })

  return submit(apiKey, {
    body: JSON.stringify({ url: req.audioUrl }),
    contentType: 'application/json',
    common: req,
    timeoutMs: opts.timeoutMs ?? 15 * 60_000,
  })
}

/**
 * POST to /v1/listen with raw audio bytes. Use this when the audio source
 * isn't directly fetchable by Deepgram (e.g., YouTube). The caller is
 * responsible for downloading the audio first — typically via yt-dlp's
 * `-o -` to stdout, collected into a Buffer.
 */
export async function transcribePrerecordedBytes(
  apiKey: string,
  req: PrerecordedBytesRequest,
  opts: { timeoutMs?: number } = {},
): Promise<PrerecordedResult> {
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY is required')

  log.info('deepgram pre-recorded: submitting (bytes form)', {
    bytes: req.audio.length,
    keyterms: req.keyterms.length,
  })

  return submit(apiKey, {
    // Cast to Uint8Array to satisfy fetch BodyInit typing without a copy.
    body: new Uint8Array(req.audio.buffer, req.audio.byteOffset, req.audio.byteLength),
    contentType: req.contentType ?? 'audio/*',
    common: req,
    timeoutMs: opts.timeoutMs ?? 15 * 60_000,
  })
}

interface SubmitArgs {
  body: string | Uint8Array
  contentType: string
  common: CommonOptions
  timeoutMs: number
}

async function submit(apiKey: string, args: SubmitArgs): Promise<PrerecordedResult> {
  const params = new URLSearchParams()
  params.set('model', args.common.model ?? 'nova-3')
  params.set('language', args.common.language ?? 'en')
  params.set('smart_format', 'true')
  params.set('punctuate', 'true')
  params.set('utterances', 'true') // critical — gives us natural segments
  for (const kt of args.common.keyterms) {
    if (kt) params.append('keyterm', kt)
  }

  const url = `${API_BASE}?${params.toString()}`
  const localAbort = new AbortController()
  const timeoutHandle = setTimeout(
    () => localAbort.abort(new Error('deepgram pre-recorded timeout')),
    args.timeoutMs,
  )

  // Combine the caller's abort signal with our timeout signal.
  const externalAbort = args.common.signal
  const onExternalAbort = () => localAbort.abort(externalAbort?.reason ?? new Error('aborted'))
  if (externalAbort) {
    if (externalAbort.aborted) localAbort.abort(externalAbort.reason)
    else externalAbort.addEventListener('abort', onExternalAbort, { once: true })
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': args.contentType,
      },
      body: args.body,
      signal: localAbort.signal,
    })
  } finally {
    clearTimeout(timeoutHandle)
    if (externalAbort) externalAbort.removeEventListener('abort', onExternalAbort)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>')
    throw new Error(`deepgram pre-recorded HTTP ${res.status}: ${text.slice(0, 500)}`)
  }

  const json = (await res.json()) as DeepgramPrerecordedResponse
  return parseResult(json)
}

interface DeepgramPrerecordedResponse {
  metadata?: {
    request_id?: string
    duration?: number
  }
  results?: {
    utterances?: DeepgramUtterance[]
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string
        confidence?: number
        words?: Array<{ word: string; start: number; end: number; confidence: number }>
      }>
    }>
  }
}

function parseResult(json: DeepgramPrerecordedResponse): PrerecordedResult {
  const requestId = json.metadata?.request_id ?? null
  const durationSec = json.metadata?.duration ?? 0
  const utterances = json.results?.utterances ?? []
  if (utterances.length === 0) {
    log.warn('deepgram pre-recorded: response had no utterances', { requestId })
  }
  return {
    requestId,
    durationSec,
    utterances: utterances.map((u) => ({
      start: u.start,
      end: u.end,
      confidence: u.confidence,
      transcript: u.transcript ?? '',
      words: u.words ?? [],
    })),
  }
}

/**
 * Strip query strings from media URLs before logging — they often contain
 * time-limited signing tokens we don't want in cloud logs.
 */
function maskUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}${u.search ? '?…' : ''}`
  } catch {
    return url.slice(0, 80)
  }
}
