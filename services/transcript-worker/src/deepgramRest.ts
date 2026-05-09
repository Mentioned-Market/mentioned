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

/**
 * POST to /v1/listen with the URL form. Throws on any non-2xx, on network
 * error, or on abort. Times out after 15 minutes by default — long enough
 * for ~10-12hr files, short enough that a hung request doesn't pin the
 * worker forever.
 */
export async function transcribePrerecorded(
  apiKey: string,
  req: PrerecordedRequest,
  opts: { timeoutMs?: number } = {},
): Promise<PrerecordedResult> {
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY is required')
  const timeoutMs = opts.timeoutMs ?? 15 * 60_000

  const params = new URLSearchParams()
  params.set('model', req.model ?? 'nova-3')
  params.set('language', req.language ?? 'en')
  params.set('smart_format', 'true')
  params.set('punctuate', 'true')
  params.set('utterances', 'true') // critical — gives us natural segments
  for (const kt of req.keyterms) {
    if (kt) params.append('keyterm', kt)
  }

  const url = `${API_BASE}?${params.toString()}`
  const localAbort = new AbortController()
  const timeoutHandle = setTimeout(() => localAbort.abort(new Error('deepgram pre-recorded timeout')), timeoutMs)

  // Combine the caller's abort signal with our timeout signal.
  const externalAbort = req.signal
  const onExternalAbort = () => localAbort.abort(externalAbort?.reason ?? new Error('aborted'))
  if (externalAbort) {
    if (externalAbort.aborted) localAbort.abort(externalAbort.reason)
    else externalAbort.addEventListener('abort', onExternalAbort, { once: true })
  }

  log.info('deepgram pre-recorded: submitting', {
    audioUrl: maskUrl(req.audioUrl),
    keyterms: req.keyterms.length,
  })

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: req.audioUrl }),
      signal: localAbort.signal,
    })
  } finally {
    clearTimeout(timeoutHandle)
    if (externalAbort) externalAbort.removeEventListener('abort', onExternalAbort)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>')
    throw new Error(
      `deepgram pre-recorded HTTP ${res.status}: ${text.slice(0, 500)}`,
    )
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
