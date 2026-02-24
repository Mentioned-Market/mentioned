'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  generatePnLImage,
  generateMarketSummaryImage,
  canvasToBlob,
  type PnLCardData,
  type MarketSummaryData,
} from '@/lib/generatePnLImage'

type ShareData =
  | { type: 'word'; data: PnLCardData }
  | { type: 'market'; data: MarketSummaryData }

interface SharePnLModalProps {
  shareData: ShareData | null
  onClose: () => void
}

export default function SharePnLModal({ shareData, onClose }: SharePnLModalProps) {
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [generating, setGenerating] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  const generate = useCallback(async () => {
    if (!shareData) return
    setGenerating(true)
    setCopied(false)
    try {
      const canvas = shareData.type === 'word'
        ? await generatePnLImage(shareData.data)
        : await generateMarketSummaryImage(shareData.data)
      canvasRef.current = canvas
      const blob = await canvasToBlob(canvas)
      const url = URL.createObjectURL(blob)
      setImgSrc((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return url
      })
    } finally {
      setGenerating(false)
    }
  }, [shareData])

  useEffect(() => {
    if (shareData) generate()
    return () => {
      setImgSrc((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
    }
  }, [shareData, generate])

  // Close on Escape
  useEffect(() => {
    if (!shareData) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [shareData, onClose])

  if (!shareData) return null

  const handleCopy = async () => {
    if (!canvasRef.current) return
    try {
      const blob = await canvasToBlob(canvasRef.current)
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ])
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: some browsers don't support clipboard.write for images
    }
  }

  const downloadName = shareData.type === 'word'
    ? `mentioned-${shareData.data.wordLabel.toLowerCase()}-pnl.png`
    : `mentioned-market-${shareData.data.marketId}-pnl.png`

  const handleDownload = async () => {
    if (!canvasRef.current) return
    const blob = await canvasToBlob(canvasRef.current)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = downloadName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose()
      }}
    >
      <div className="w-full max-w-lg mx-4 bg-neutral-900 border border-white/10 rounded-2xl shadow-card-hover animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-white text-lg font-semibold">Share Result</h2>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Image preview */}
        <div className="px-5 pb-4">
          <div className="rounded-xl overflow-hidden border border-white/5">
            {generating || !imgSrc ? (
              <div className="w-full aspect-[600/320] bg-white/5 flex items-center justify-center">
                <span className="text-neutral-500 text-sm">Generating...</span>
              </div>
            ) : (
              <img
                src={imgSrc}
                alt="P&L Card"
                className="w-full"
                draggable={false}
              />
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 flex gap-3">
          <button
            onClick={handleCopy}
            disabled={generating}
            className="flex-1 h-11 bg-white text-black text-sm font-semibold rounded-xl hover:bg-neutral-100 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {copied ? 'Copied!' : 'Copy Image'}
          </button>
          <button
            onClick={handleDownload}
            disabled={generating}
            className="flex-1 h-11 glass border border-white/10 text-white text-sm font-semibold rounded-xl hover:bg-white/10 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Download
          </button>
        </div>
      </div>
    </div>
  )
}
