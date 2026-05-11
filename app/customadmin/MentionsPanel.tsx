'use client'

import { useEffect, useRef, useState } from 'react'

interface MentionRow {
  id: number
  stream_id: number
  word_index: number
  word: string
  matched_text: string
  segment_id: number | null
  stream_offset_ms: number
  snippet: string
  confidence: number | null
  superseded: boolean
  created_at: string
}

interface WordSummary {
  word_index: number
  word: string
  mention_threshold: number
  match_variants: string[]
  pending_resolution: boolean
  auto_lock_enabled: boolean
  resolved_outcome: boolean | null
  count: number
  avg_confidence: number | null
  recent: MentionRow[]
}

interface MentionEvent {
  type: 'mention' | 'dismiss' | 'auto_lock'
  streamId: number
  /** Absent on 'auto_lock' (no specific mention id). */
  mentionId?: number
  wordIndex: number
  word?: string
  matchedText?: string
  streamOffsetMs?: number
  snippet?: string
  confidence?: number | null
  createdAt?: string
}

const RECENT_LIMIT = 5
// Periodic resync to truth while SSE is active. SSE delivers low-latency
// updates, but EventSource doesn't replay missed events on reconnect, and
// the local running-average math is approximate when null confidences mix
// in. This refetch is the safety net.
const REFETCH_INTERVAL_MS = 20_000

function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '00:00'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function confidenceColor(conf: number | null): string {
  if (conf == null) return 'text-neutral-500'
  if (conf >= 0.8) return 'text-apple-green'
  if (conf >= 0.6) return 'text-yellow-400'
  return 'text-apple-red'
}

function verdictPill(count: number, threshold: number): { label: string; cls: string } {
  if (count === 0) return { label: 'NO likely', cls: 'bg-white/5 text-neutral-400' }
  if (count >= threshold) return { label: 'YES likely', cls: 'bg-apple-green/20 text-apple-green' }
  return { label: 'Below threshold', cls: 'bg-yellow-500/20 text-yellow-300' }
}

interface Props {
  streamId: number
  marketId: number
  isActive: boolean
  streamUrl: string
  kind: 'live' | 'vod'
  onError?: (msg: string) => void
  /** Notify parent when a word's pending state changes so the cached
   *  market list (powering WordEditorRow) stays in sync without a full refetch. */
  onWordPatched?: (wordId: number, patch: { pendingResolution?: boolean; autoLockEnabled?: boolean }) => void
}

export default function MentionsPanel({ streamId, marketId, isActive, streamUrl, kind, onError, onWordPatched }: Props) {
  const [words, setWords] = useState<WordSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [dismissingId, setDismissingId] = useState<number | null>(null)
  const [pendingBusy, setPendingBusy] = useState<number | null>(null)
  const [autoLockBusy, setAutoLockBusy] = useState<number | null>(null)
  const sseRef = useRef<EventSource | null>(null)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const onWordPatchedRef = useRef(onWordPatched)
  onWordPatchedRef.current = onWordPatched

  // Initial load + periodic resync. The interval runs only while the
  // stream is active; terminal runs load once and stop.
  useEffect(() => {
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    const load = async (showSpinner: boolean) => {
      if (showSpinner) setLoading(true)
      try {
        const res = await fetch(`/api/admin/mentions?streamId=${streamId}`)
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          throw new Error(json.error ?? 'Failed to load mentions')
        }
        const json = await res.json()
        if (cancelled) return
        setWords(json.words ?? [])
      } catch (err) {
        if (cancelled) return
        // Only surface initial-load errors; periodic refetch failures are
        // routine network blips and would spam toasts.
        if (showSpinner) {
          onErrorRef.current?.(err instanceof Error ? err.message : 'Failed to load mentions')
        }
      } finally {
        if (!cancelled && showSpinner) setLoading(false)
      }
    }

    void load(true)
    if (isActive) {
      intervalId = setInterval(() => { void load(false) }, REFETCH_INTERVAL_MS)
    }

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [streamId, isActive])

  // SSE subscription only while the stream is active. Terminal runs are
  // static — no events will arrive, no point holding the connection open.
  useEffect(() => {
    if (!isActive) return
    const es = new EventSource(`/api/admin/mentions/stream?streamId=${streamId}`)
    sseRef.current = es

    es.onmessage = (ev) => {
      let data: MentionEvent
      try { data = JSON.parse(ev.data) as MentionEvent } catch { return }
      if (data.type === 'mention') {
        if (data.mentionId == null) return
        const mentionId = data.mentionId
        setWords((prev) => prev.map((w) => {
          if (w.word_index !== data.wordIndex) return w
          // Skip duplicate (e.g. SSE replay or initial load race).
          if (w.recent.some((r) => r.id === mentionId)) return w
          const newRow: MentionRow = {
            id: mentionId,
            stream_id: data.streamId,
            word_index: data.wordIndex,
            word: data.word ?? w.word,
            matched_text: data.matchedText ?? '',
            segment_id: null,
            stream_offset_ms: data.streamOffsetMs ?? 0,
            snippet: data.snippet ?? '',
            confidence: data.confidence ?? null,
            superseded: false,
            created_at: data.createdAt ?? new Date().toISOString(),
          }
          const newCount = w.count + 1
          // Recompute running average; null confidences excluded.
          const sumPrev = (w.avg_confidence ?? 0) * w.count
          const newConf = newRow.confidence
          const includeNew = newConf != null
          const newAvg = includeNew && newCount > 0
            ? (sumPrev + (newConf ?? 0)) / (w.count + 1)
            : w.avg_confidence
          return {
            ...w,
            count: newCount,
            avg_confidence: newAvg,
            recent: [newRow, ...w.recent].slice(0, RECENT_LIMIT),
          }
        }))
      } else if (data.type === 'dismiss') {
        if (data.mentionId == null) return
        const mentionId = data.mentionId
        setWords((prev) => prev.map((w) => {
          if (w.word_index !== data.wordIndex) return w
          const dismissed = w.recent.find((r) => r.id === mentionId)
          const recent = w.recent.filter((r) => r.id !== mentionId)
          if (!dismissed && w.count === 0) return w
          const newCount = Math.max(0, w.count - 1)
          // Re-derive avg from remaining recent rows; lossy but bounded
          // (we only track the tail). The next initial-load refetch
          // recomputes from the full table.
          const confs = recent.map((r) => r.confidence).filter((c): c is number => c != null)
          const newAvg = confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : null
          return { ...w, count: newCount, avg_confidence: newAvg, recent }
        }))
      } else if (data.type === 'auto_lock') {
        // Worker flipped pending_resolution. Mirror locally so the "Pending"
        // pill shows up immediately; parent's cache (powering WordEditorRow)
        // also needs the update.
        setWords((prev) => prev.map((w) =>
          w.word_index === data.wordIndex ? { ...w, pending_resolution: true } : w,
        ))
        onWordPatchedRef.current?.(data.wordIndex, { pendingResolution: true })
      }
    }

    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do but log.
      // Avoid spamming onError for routine network blips.
    }

    return () => {
      es.close()
      sseRef.current = null
    }
  }, [streamId, isActive])

  async function handleDismiss(mentionId: number) {
    setDismissingId(mentionId)
    try {
      const res = await fetch(`/api/admin/mentions/${mentionId}/dismiss`, { method: 'POST' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'Failed to dismiss mention')
      }
      // SSE will deliver the dismiss event; UI updates there. Optimistic
      // update is unnecessary because the round-trip is fast and the SSE
      // path is the same code we'd duplicate locally.
    } catch (err) {
      onErrorRef.current?.(err instanceof Error ? err.message : 'Failed to dismiss mention')
    } finally {
      setDismissingId(null)
    }
  }

  async function handleTogglePending(wordIndex: number, next: boolean) {
    setPendingBusy(wordIndex)
    try {
      const res = await fetch(`/api/custom/${marketId}/words/${wordIndex}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingResolution: next }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Failed to update pending state')
      // Optimistic local update — periodic refetch will reconcile if anything drifts.
      setWords((prev) => prev.map((w) =>
        w.word_index === wordIndex ? { ...w, pending_resolution: next } : w,
      ))
      onWordPatched?.(wordIndex, { pendingResolution: next })
    } catch (err) {
      onErrorRef.current?.(err instanceof Error ? err.message : 'Failed to update pending state')
    } finally {
      setPendingBusy(null)
    }
  }

  async function handleToggleAutoLock(wordIndex: number, next: boolean) {
    setAutoLockBusy(wordIndex)
    try {
      const res = await fetch(`/api/custom/${marketId}/words/${wordIndex}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoLockEnabled: next }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Failed to update auto-lock')
      setWords((prev) => prev.map((w) =>
        w.word_index === wordIndex ? { ...w, auto_lock_enabled: next } : w,
      ))
      onWordPatched?.(wordIndex, { autoLockEnabled: next })
    } catch (err) {
      onErrorRef.current?.(err instanceof Error ? err.message : 'Failed to update auto-lock')
    } finally {
      setAutoLockBusy(null)
    }
  }

  function jumpUrl(offsetMs: number): string | null {
    if (!streamUrl) return null
    const seconds = Math.max(0, Math.floor(offsetMs / 1000))
    try {
      const u = new URL(streamUrl)
      // YouTube watch / VOD: ?t=Ns. Twitch VOD: ?t=NhNmNs. Live channels
      // (twitch.tv/<channel>) don't support time params at all — those
      // get a click-through that just opens the stream.
      if (/(^|\.)youtube\.com$/.test(u.hostname) || u.hostname === 'youtu.be') {
        u.searchParams.set('t', `${seconds}s`)
        return u.toString()
      }
      if (/(^|\.)twitch\.tv$/.test(u.hostname) && /^\/videos\/\d+/.test(u.pathname)) {
        const h = Math.floor(seconds / 3600)
        const m = Math.floor((seconds % 3600) / 60)
        const s = seconds % 60
        u.searchParams.set('t', `${h}h${m}m${s}s`)
        return u.toString()
      }
      return u.toString()
    } catch {
      return null
    }
  }

  if (loading) {
    return <div className="text-xs text-neutral-500">Loading mentions…</div>
  }
  if (words.length === 0) {
    return <div className="text-xs text-neutral-500">No words configured for this market.</div>
  }

  return (
    <div className="space-y-3">
      {words.map((w) => {
        const pill = verdictPill(w.count, w.mention_threshold)
        const isResolved = w.resolved_outcome !== null
        const cardCls = w.pending_resolution
          ? 'rounded-lg border border-yellow-500/30 bg-yellow-500/[0.04] p-3'
          : 'rounded-lg border border-white/5 bg-black/20 p-3'
        return (
          <div key={w.word_index} className={cardCls}>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-sm font-semibold text-neutral-100 truncate" title={w.word}>{w.word}</span>
              <span className="text-lg font-mono tabular-nums text-neutral-200">
                {w.count}
                <span className="text-neutral-500 text-xs"> / {w.mention_threshold}</span>
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${pill.cls}`}>
                {pill.label}
              </span>
              {w.pending_resolution && (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-yellow-500/20 text-yellow-300">
                  Pending
                </span>
              )}
              {!isResolved && (
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    onClick={() => handleToggleAutoLock(w.word_index, !w.auto_lock_enabled)}
                    disabled={autoLockBusy === w.word_index}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded disabled:opacity-50 transition-colors ${
                      w.auto_lock_enabled
                        ? 'bg-purple-500/25 text-purple-300 hover:bg-purple-500/35'
                        : 'bg-white/5 text-neutral-300 hover:bg-white/10'
                    }`}
                    title={
                      w.auto_lock_enabled
                        ? 'Auto-lock ON — worker will mark this word pending on a high-confidence (>90%) mention'
                        : 'Auto-lock OFF — only an admin can mark this word pending'
                    }
                  >
                    {autoLockBusy === w.word_index
                      ? '…'
                      : w.auto_lock_enabled ? 'Auto-Lock: On' : 'Auto-Lock: Off'}
                  </button>
                  <button
                    onClick={() => handleTogglePending(w.word_index, !w.pending_resolution)}
                    disabled={pendingBusy === w.word_index}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded disabled:opacity-50 transition-colors ${
                      w.pending_resolution
                        ? 'bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30'
                        : 'bg-white/5 text-neutral-300 hover:bg-white/10'
                    }`}
                    title={w.pending_resolution
                      ? 'Reverse: word becomes tradeable again'
                      : 'Pause trading on this word until you verify the outcome'}
                  >
                    {pendingBusy === w.word_index
                      ? '…'
                      : w.pending_resolution ? 'Unmark Pending' : 'Mark Pending'}
                  </button>
                </div>
              )}
              {w.avg_confidence != null && (
                <span className={`${isResolved ? 'ml-auto' : ''} text-xs ${confidenceColor(w.avg_confidence)}`}>
                  avg conf {(w.avg_confidence * 100).toFixed(0)}%
                </span>
              )}
            </div>
            {w.recent.length > 0 ? (
              <ul className="space-y-1.5">
                {w.recent.map((m) => {
                  const ts = formatTimestamp(m.stream_offset_ms)
                  const url = jumpUrl(m.stream_offset_ms)
                  return (
                    <li key={m.id} className="flex items-start gap-2 text-xs">
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-apple-blue hover:underline shrink-0"
                          title={kind === 'vod' ? 'Jump to this moment in the VOD' : 'Open stream'}
                        >
                          {ts}
                        </a>
                      ) : (
                        <span className="font-mono text-neutral-500 shrink-0">{ts}</span>
                      )}
                      <span className="text-neutral-300 flex-1">{m.snippet}</span>
                      {m.confidence != null && (
                        <span className={`shrink-0 ${confidenceColor(m.confidence)}`}>
                          {(m.confidence * 100).toFixed(0)}%
                        </span>
                      )}
                      <button
                        onClick={() => handleDismiss(m.id)}
                        disabled={dismissingId === m.id}
                        className="shrink-0 text-neutral-500 hover:text-apple-red disabled:opacity-50"
                        title="Mark false positive"
                      >
                        ✗
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="text-[11px] text-neutral-600">No mentions yet.</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
