'use client'

import { useEffect, useState } from 'react'
import type { CustomMarketWordRow } from '@/lib/db'

interface Props {
  word: CustomMarketWordRow
  canRemove: boolean
  onRemove: () => void
  onSave: (patch: { mentionThreshold?: number; matchVariants?: string[]; pendingResolution?: boolean }) => Promise<void> | void
}

function variantsToString(arr: string[] | null | undefined): string {
  if (!arr || arr.length === 0) return ''
  return arr.join(', ')
}

function stringToVariants(s: string): string[] {
  return s.split(/[,\n]+/).map(x => x.trim()).filter(Boolean)
}

export default function WordEditorRow({ word, canRemove, onRemove, onSave }: Props) {
  const [threshold, setThreshold] = useState(String(word.mention_threshold ?? 1))
  const [variants, setVariants] = useState(variantsToString(word.match_variants))
  const [saving, setSaving] = useState(false)

  // Sync local state if the canonical row changes (e.g. another tab saved).
  useEffect(() => {
    setThreshold(String(word.mention_threshold ?? 1))
    setVariants(variantsToString(word.match_variants))
  }, [word.mention_threshold, word.match_variants])

  const thresholdNum = parseInt(threshold, 10)
  const thresholdValid = Number.isInteger(thresholdNum) && thresholdNum >= 1 && thresholdNum <= 1000
  const dirty =
    (thresholdValid && thresholdNum !== word.mention_threshold) ||
    variants.trim() !== variantsToString(word.match_variants)

  async function handleSave() {
    if (!dirty || !thresholdValid || saving) return
    const patch: { mentionThreshold?: number; matchVariants?: string[] } = {}
    if (thresholdNum !== word.mention_threshold) patch.mentionThreshold = thresholdNum
    const newVariants = stringToVariants(variants)
    const sameVariants =
      newVariants.length === (word.match_variants?.length ?? 0) &&
      newVariants.every((v, i) => v === word.match_variants?.[i])
    if (!sameVariants) patch.matchVariants = newVariants
    setSaving(true)
    try {
      await onSave(patch)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-2 border-b border-white/5 last:border-b-0">
      <div className="flex items-center gap-2 min-w-[160px]">
        <span className="text-sm font-medium text-neutral-200 truncate" title={word.word}>{word.word}</span>
        {word.resolved_outcome !== null && (
          <span className={`text-[10px] font-semibold ${word.resolved_outcome ? 'text-apple-green' : 'text-apple-red'}`}>
            {word.resolved_outcome ? 'YES' : 'NO'}
          </span>
        )}
        {word.pending_resolution && word.resolved_outcome === null && (
          <span className="px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-300 text-[10px] font-bold uppercase tracking-wide">
            Pending
          </span>
        )}
      </div>
      <label className="flex items-center gap-1.5 text-[11px] text-neutral-500">
        threshold
        <input
          type="number"
          min={1}
          max={1000}
          step={1}
          value={threshold}
          onChange={e => setThreshold(e.target.value)}
          className={`w-16 bg-black/40 border rounded px-2 py-1 text-xs text-neutral-100 ${thresholdValid ? 'border-white/10' : 'border-apple-red/60'}`}
        />
      </label>
      <label className="flex items-center gap-1.5 text-[11px] text-neutral-500 flex-1 min-w-[200px]">
        variants
        <input
          type="text"
          value={variants}
          onChange={e => setVariants(e.target.value)}
          placeholder="e.g. clutches, clutched, clutching"
          className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-600"
        />
      </label>
      <button
        onClick={handleSave}
        disabled={!dirty || !thresholdValid || saving}
        className="px-3 py-1 bg-apple-blue/20 text-apple-blue text-[11px] font-semibold rounded disabled:opacity-30 disabled:cursor-not-allowed hover:bg-apple-blue/30 transition-colors"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      {word.resolved_outcome === null && (
        <button
          onClick={() => onSave({ pendingResolution: !word.pending_resolution })}
          className={`px-3 py-1 text-[11px] font-semibold rounded transition-colors ${
            word.pending_resolution
              ? 'bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30'
              : 'bg-white/5 text-neutral-400 hover:bg-white/10'
          }`}
          title={word.pending_resolution ? 'Reverse: word becomes tradeable again' : 'Pause trading on this word until you verify the outcome'}
        >
          {word.pending_resolution ? 'Unmark Pending' : 'Mark Pending'}
        </button>
      )}
      {canRemove && (
        <button
          onClick={onRemove}
          className="text-neutral-500 hover:text-apple-red px-1"
          title="Remove word"
        >
          ×
        </button>
      )}
    </div>
  )
}
