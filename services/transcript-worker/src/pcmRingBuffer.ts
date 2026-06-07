// Bounded rolling buffer of raw PCM, kept so a short audio clip can be cut
// around a detected word mention for admin review.
//
// Each chunk is stored with a capture timestamp in the *same clock* the worker
// uses for mention segment offsets: ms since the worker started capturing
// (Date.now() - startedAtMs). Extraction then selects chunks whose timestamp
// falls in the requested window — no separate byte clock, no offset math.
//
// Why wall-clock per chunk rather than a cumulative byte count: the ffmpeg
// recycle briefly runs two pipes in parallel (~2s overlap), feeding the buffer
// duplicate PCM. A cumulative byte clock would treat those duplicates as extra
// elapsed audio and drift permanently (~2s per recycle). Timestamping each
// chunk keeps the buffer aligned to real time regardless — duplicate chunks
// just share a timestamp, so at worst a single clip that coincides with a
// recycle contains ~2s of doubled audio; there is no accumulating drift.
//
// Memory is bounded to ~`maxSeconds` of audio. Old chunks are dropped in a
// batch once the newest is more than `maxSeconds` ahead of the oldest.

import { log } from './log'

// 16000 Hz * 2 bytes/sample (s16le) * 1 channel. Matches the ffmpeg output
// (`-f s16le -ac 1 -ar 16000` in streamUrl.ts) and the Deepgram schema
// (linear16 / sample_rate 16000 / channels 1 in deepgram.ts). Keep in sync if
// the audio format ever changes.
export const PCM_SAMPLE_RATE = 16000
export const PCM_BYTES_PER_SAMPLE = 2
export const PCM_CHANNELS = 1
export const BYTES_PER_SEC = PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE * PCM_CHANNELS

interface StoredChunk {
  /** Capture time, ms since capture start (Date.now() - startedAtMs). */
  captureMs: number
  data: Buffer
}

export class PcmRingBuffer {
  private chunks: StoredChunk[] = []
  private readonly maxMs: number

  constructor(maxSeconds: number) {
    this.maxMs = Math.max(1, Math.floor(maxSeconds)) * 1000
  }

  append(chunk: Buffer, captureMs: number): void {
    if (chunk.length === 0) return
    this.chunks.push({ captureMs, data: chunk })
    // Drop everything older than maxMs behind the newest sample. Batched —
    // the common path appends within the window and does no shifting.
    const cutoff = captureMs - this.maxMs
    if (this.chunks[0].captureMs < cutoff) {
      let drop = 0
      while (drop < this.chunks.length && this.chunks[drop].captureMs < cutoff) drop++
      this.chunks.splice(0, drop)
    }
  }

  /**
   * Extract all PCM whose capture timestamp falls in `[startMs, endMs]`, in
   * order, and wrap it in a WAV container. Returns null if no retained audio
   * overlaps the window (e.g. it was already pruned).
   */
  extractWav(startMs: number, endMs: number): Buffer | null {
    if (endMs <= startMs) return null
    const parts: Buffer[] = []
    for (const c of this.chunks) {
      if (c.captureMs < startMs) continue
      if (c.captureMs > endMs) break
      parts.push(c.data)
    }
    if (parts.length === 0) {
      log.debug('clip window outside retained audio', {
        startMs,
        endMs,
        oldestMs: this.chunks[0]?.captureMs,
        newestMs: this.chunks[this.chunks.length - 1]?.captureMs,
      })
      return null
    }
    let pcm = Buffer.concat(parts)
    // Guard against a chunk boundary that split a 16-bit sample; WAV data must
    // be a whole number of samples.
    if (pcm.length % PCM_BYTES_PER_SAMPLE !== 0) {
      pcm = pcm.subarray(0, pcm.length - (pcm.length % PCM_BYTES_PER_SAMPLE))
    }
    return wrapWav(pcm)
  }
}

/**
 * Prepend a 44-byte canonical WAV/PCM header to a raw s16le buffer. No
 * re-encoding — the PCM bytes are copied verbatim after the header.
 */
export function wrapWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44)
  const byteRate = BYTES_PER_SEC
  const blockAlign = PCM_BYTES_PER_SAMPLE * PCM_CHANNELS
  const dataLen = pcm.length

  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataLen, 4) // ChunkSize
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // Subchunk1Size (PCM)
  header.writeUInt16LE(1, 20) // AudioFormat = PCM
  header.writeUInt16LE(PCM_CHANNELS, 22)
  header.writeUInt32LE(PCM_SAMPLE_RATE, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(PCM_BYTES_PER_SAMPLE * 8, 34) // BitsPerSample
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataLen, 40)

  return Buffer.concat([header, pcm])
}
