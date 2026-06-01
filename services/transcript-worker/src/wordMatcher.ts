// Sliding-window phrase matcher with position-based dedupe.
//
// Two requirements drive the design:
//
//   1. Phrases must match across Deepgram segment boundaries (Deepgram
//      finalizes at endpointing pauses, which can fall mid-phrase).
//   2. Counts matter — repeated mentions in one segment must each be logged,
//      and counts must not be inflated by re-emission across rotation /
//      recycle boundaries.
//
// The matcher keeps a small trailing buffer of recently-finalized text and
// matches `trailingBuffer + newSegment`. Each hit is keyed by
// `(wordIndex, globalCharOffset)` — same content emitted twice lands at the
// same offset and is skipped. The DB has the same UNIQUE constraint as a
// belt-and-braces backstop.

export interface MatchableWord {
  /** Stable ID used as `word_index` in word_mentions. */
  index: number
  /** Canonical surface form ("Mr Speaker", "clutch"). */
  word: string
  /** Admin-provided morphological / phonetic variants. */
  variants: string[]
  /**
   * Mentions needed to resolve YES. Default 1 (any-mention semantics).
   * The matcher itself ignores this; downstream consumers (StreamWorker's
   * first-mention Discord ping, the admin UI) read it.
   */
  threshold: number
  /**
   * When TRUE, the StreamWorker auto-flips pending_resolution on the first
   * mention whose confidence exceeds AUTO_LOCK_MIN_CONFIDENCE. Default FALSE
   * — admin opts in per-word.
   */
  autoLockEnabled: boolean
}

export interface MatchHit {
  wordIndex: number
  word: string
  matchedText: string
  globalCharOffset: number
  snippet: string
}

const DEFAULT_TRAILING_BUFFER_SIZE = 200
const DEFAULT_DEDUPE_LIMIT = 5000
const SNIPPET_RADIUS = 40

export interface WordMatcherOptions {
  trailingBufferSize?: number
  dedupeLimit?: number
}

export class WordMatcher {
  private readonly patterns: { wordIndex: number; canonical: string; re: RegExp }[]
  private readonly trailingBufferSize: number
  private readonly dedupeLimit: number
  private trailingBuffer = ''
  private globalCharOffset = 0
  // Map<key, globalCharOffset> so we can prune entries that fall out of the
  // trailing-buffer reach. Storing the offset alongside saves re-parsing the
  // composite key string when pruning.
  private readonly logged = new Map<string, number>()

  constructor(words: MatchableWord[], opts: WordMatcherOptions = {}) {
    this.trailingBufferSize = opts.trailingBufferSize ?? DEFAULT_TRAILING_BUFFER_SIZE
    this.dedupeLimit = opts.dedupeLimit ?? DEFAULT_DEDUPE_LIMIT
    this.patterns = []
    for (const w of words) {
      const variants = [w.word, ...w.variants].filter((v) => v && v.trim().length > 0)
      const seen = new Set<string>()
      for (const variant of variants) {
        const norm = variant.trim()
        if (seen.has(norm.toLowerCase())) continue
        seen.add(norm.toLowerCase())
        this.patterns.push({
          wordIndex: w.index,
          canonical: w.word,
          re: new RegExp(buildPattern(norm), 'gi'),
        })
      }
    }
  }

  /**
   * Push a finalized transcript segment, get back any new matches.
   * Idempotent in the sense that re-pushing the same content produces no new
   * hits because dedupe is offset-based — but the offset advances on every
   * call, so callers should only push once per finalized segment.
   */
  ingest(segmentText: string): MatchHit[] {
    if (!segmentText) return []
    const matchText = this.trailingBuffer + segmentText
    const baseOffset = this.globalCharOffset - this.trailingBuffer.length
    const hits: MatchHit[] = []

    for (const p of this.patterns) {
      p.re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = p.re.exec(matchText)) !== null) {
        const localIndex = m.index
        const matched = m[0]
        // Defend against a zero-width match (shouldn't happen given \b
        // anchors, but a malformed regex could produce one and would loop
        // forever otherwise).
        if (matched.length === 0) {
          p.re.lastIndex = localIndex + 1
          continue
        }
        const globalOffset = baseOffset + localIndex
        const key = `${p.wordIndex}:${globalOffset}`
        if (this.logged.has(key)) continue
        this.logged.set(key, globalOffset)
        hits.push({
          wordIndex: p.wordIndex,
          word: p.canonical,
          matchedText: matched,
          globalCharOffset: globalOffset,
          snippet: extractSnippet(matchText, localIndex, matched.length),
        })
      }
    }

    this.globalCharOffset += segmentText.length
    const combined = this.trailingBuffer + segmentText
    this.trailingBuffer = combined.length > this.trailingBufferSize
      ? combined.slice(combined.length - this.trailingBufferSize)
      : combined
    this.pruneLogged()
    return hits
  }

  /** Prune entries that fall outside the trailing-buffer reach. */
  private pruneLogged(): void {
    const cutoff = this.globalCharOffset - this.trailingBufferSize
    if (this.logged.size <= this.dedupeLimit) {
      // Even under the cap, drop entries that can no longer reappear.
      for (const [k, off] of this.logged) {
        if (off < cutoff) this.logged.delete(k)
      }
      return
    }
    // Over-cap fallback: drop everything we know is unreachable, then if still
    // over cap, drop oldest by insertion order until we're back under.
    for (const [k, off] of this.logged) {
      if (off < cutoff) this.logged.delete(k)
    }
    while (this.logged.size > this.dedupeLimit) {
      const next = this.logged.keys().next()
      if (next.done) break
      this.logged.delete(next.value)
    }
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function buildPattern(text: string): string {
  // Tokenize on whitespace, escape each token, allow optional trailing
  // periods on each token (Deepgram's smart_format may abbreviate "Mr." vs
  // "Mr"), and allow flexible whitespace between tokens.
  const tokens = text.trim().split(/\s+/).map(escapeRegex)
  if (tokens.length === 0) return ''
  const middle = tokens.map((t) => `${t}\\.?`).join('\\s+')
  // Strip the trailing optional period before the closing word boundary so
  // \b lines up against a word character. Without this, "Mr Speaker\.?\b"
  // never matches because \b requires a word/non-word transition right at
  // the boundary and \. is a non-word char.
  const withoutTrailingDot = middle.replace(/\\\.\\\?$/, '')
  return `\\b${withoutTrailingDot}\\b`
}

function extractSnippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS)
  const end = Math.min(text.length, index + length + SNIPPET_RADIUS)
  let snippet = text.slice(start, end).replace(/\s+/g, ' ').trim()
  if (start > 0) snippet = '…' + snippet
  if (end < text.length) snippet = snippet + '…'
  return snippet
}
