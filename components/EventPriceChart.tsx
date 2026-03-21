'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface PricePoint {
  t: number
  p: number
}

interface MarketSeries {
  marketId: string
  title: string
  currentPrice: number
  data: PricePoint[]
}

interface EventPriceChartProps {
  eventId: string
  markets: { marketId: string; title: string; currentPrice: number }[]
  selectedMarketId: string
}

const MAX_VISIBLE = 5

const TIMEFRAMES = [
  { label: '1D', interval: '1d', fidelity: 1 },
  { label: '1W', interval: '1w', fidelity: 10 },
  { label: '1M', interval: '1m', fidelity: 30 },
  { label: '3M', interval: '3m', fidelity: 60 },
  { label: 'All', interval: 'max', fidelity: 60 },
] as const

const COLORS = [
  '#34D399', // green
  '#F87171', // red
  '#60A5FA', // blue
  '#FBBF24', // yellow
  '#A78BFA', // purple
  '#FB923C', // orange
  '#2DD4BF', // teal
  '#F472B6', // pink
  '#818CF8', // indigo
  '#4ADE80', // lime
]

export default function EventPriceChart({
  eventId,
  markets,
  selectedMarketId,
}: EventPriceChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [series, setSeries] = useState<MarketSeries[]>([])
  const [loading, setLoading] = useState(true)
  const [hoveredSeries, setHoveredSeries] = useState<string | null>(null)
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set())
  const [timeframe, setTimeframe] = useState<typeof TIMEFRAMES[number]>(TIMEFRAMES[4]) // default All

  // Initialize visible set with first 5 markets (sorted by price desc)
  useEffect(() => {
    if (markets.length === 0) return
    const sorted = [...markets].sort((a, b) => b.currentPrice - a.currentPrice)
    const initial = new Set(sorted.slice(0, MAX_VISIBLE).map((m) => m.marketId))
    // Always include the selected market
    if (!initial.has(selectedMarketId) && selectedMarketId) {
      initial.add(selectedMarketId)
      // Remove the lowest-priced one if over limit
      if (initial.size > MAX_VISIBLE) {
        const ids = [...initial]
        const lowest = ids
          .map((id) => markets.find((m) => m.marketId === id)!)
          .filter(Boolean)
          .sort((a, b) => a.currentPrice - b.currentPrice)[0]
        if (lowest && lowest.marketId !== selectedMarketId) {
          initial.delete(lowest.marketId)
        }
      }
    }
    setVisibleIds(initial)
  }, [markets.length]) // Only on initial load

  // When the selected market changes (from outcomes table), ensure it's on the chart (FIFO eviction)
  useEffect(() => {
    if (!selectedMarketId) return
    setVisibleIds((prev) => {
      if (prev.has(selectedMarketId)) return prev
      const next = new Set(prev)
      if (next.size >= MAX_VISIBLE) {
        // Remove the first (oldest added) entry
        const first = next.values().next().value
        if (first !== undefined) next.delete(first)
      }
      next.add(selectedMarketId)
      return next
    })
  }, [selectedMarketId])

  const toggleVisible = useCallback(
    (marketId: string) => {
      setVisibleIds((prev) => {
        const next = new Set(prev)
        if (next.has(marketId)) {
          // Don't allow removing the last one
          if (next.size <= 1) return prev
          next.delete(marketId)
        } else {
          if (next.size >= MAX_VISIBLE) return prev // At limit
          next.add(marketId)
        }
        return next
      })
    },
    [],
  )

  // Fetch price history for all markets
  useEffect(() => {
    if (markets.length === 0) return
    if (series.length === 0) setLoading(true)

    Promise.all(
      markets.map(async (m) => {
        try {
          const res = await fetch(
            `/api/polymarket/prices?marketId=${encodeURIComponent(m.marketId)}&interval=${timeframe.interval}&fidelity=${timeframe.fidelity}`
          )
          if (!res.ok) return { ...m, data: [] }
          const json = await res.json()
          return { ...m, data: json.history || [] }
        } catch {
          return { ...m, data: [] }
        }
      })
    ).then((results) => {
      setSeries(results.filter((s) => s.data.length > 0))
      setLoading(false)
    })
  }, [markets, eventId, timeframe])

  // Only draw visible series
  const visibleSeries = series.filter((s) => visibleIds.has(s.marketId))

  // Draw chart
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || visibleSeries.length === 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    const W = rect.width
    const H = rect.height
    const padL = 45
    const padR = 15
    const padT = 15
    const padB = 30
    const chartW = W - padL - padR
    const chartH = H - padT - padB

    // Clear
    ctx.clearRect(0, 0, W, H)

    // Find global time range from visible series
    let minT = Infinity
    let maxT = -Infinity
    for (const s of visibleSeries) {
      for (const p of s.data) {
        if (p.t < minT) minT = p.t
        if (p.t > maxT) maxT = p.t
      }
    }
    if (minT === maxT) maxT = minT + 3600
    const tRange = maxT - minT

    const minP = 0
    const maxP = 1

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = padT + chartH * (1 - i / 4)
      ctx.beginPath()
      ctx.moveTo(padL, y)
      ctx.lineTo(W - padR, y)
      ctx.stroke()

      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.font = '10px -apple-system, sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(`${i * 25}%`, padL - 6, y + 3)
    }

    // Time labels
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    const timeSteps = 5
    for (let i = 0; i <= timeSteps; i++) {
      const t = minT + tRange * (i / timeSteps)
      const x = padL + chartW * (i / timeSteps)
      const d = new Date(t * 1000)
      const label =
        timeframe.interval === '1d'
          ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : timeframe.interval === '1w' || timeframe.interval === '1m'
            ? d.toLocaleDateString([], { month: 'short', day: 'numeric' })
            : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' })
      ctx.fillText(label, x, H - padB + 16)
    }

    const toX = (t: number) => padL + chartW * ((t - minT) / tRange)
    const toY = (p: number) => padT + chartH * (1 - (p - minP) / (maxP - minP))

    // Assign colors based on position in the full series list (stable colors)
    const colorMap = new Map<string, string>()
    series.forEach((s, idx) => {
      colorMap.set(s.marketId, COLORS[idx % COLORS.length])
    })

    // Draw each visible series
    visibleSeries.forEach((s) => {
      if (s.data.length < 2) return
      const color = colorMap.get(s.marketId) || COLORS[0]
      const isSelected = s.marketId === selectedMarketId
      const isHovered = s.marketId === hoveredSeries
      const isDimmed = (hoveredSeries || selectedMarketId) && !isSelected && !isHovered

      ctx.strokeStyle = isDimmed ? `${color}33` : color
      ctx.lineWidth = isSelected || isHovered ? 2.5 : 1.5
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'

      ctx.beginPath()
      s.data.forEach((p, i) => {
        const x = toX(p.t)
        const y = toY(p.p)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()

      // Draw endpoint dot for selected/hovered
      if (isSelected || isHovered) {
        const last = s.data[s.data.length - 1]
        const x = toX(last.t)
        const y = toY(last.p)
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(x, y, 4, 0, Math.PI * 2)
        ctx.fill()

        ctx.fillStyle = color
        ctx.font = 'bold 11px -apple-system, sans-serif'
        ctx.textAlign = 'left'
        ctx.fillText(`${(last.p * 100).toFixed(0)}%`, x + 8, y + 4)
      }
    })
  }, [visibleSeries, series, selectedMarketId, hoveredSeries, timeframe])

  useEffect(() => {
    draw()
    const handleResize = () => draw()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [draw])

  if (loading) {
    return (
      <div className="w-full h-[200px] rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-neutral-600 border-t-white rounded-full animate-spin" />
      </div>
    )
  }

  if (series.length === 0) return null

  // Assign stable colors
  const colorMap = new Map<string, string>()
  series.forEach((s, idx) => {
    colorMap.set(s.marketId, COLORS[idx % COLORS.length])
  })

  const atLimit = visibleIds.size >= MAX_VISIBLE

  return (
    <div className="w-full">
      {/* Chart + timeframe controls */}
      <div className="relative">
        <div className="absolute top-2 right-3 z-10 flex gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.label}
              onClick={() => setTimeframe(tf)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                timeframe.label === tf.label
                  ? 'bg-white/15 text-white'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
        <div ref={containerRef} className="w-full h-[200px] rounded-xl bg-white/[0.02] border border-white/5">
          <canvas ref={canvasRef} className="w-full h-full" />
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-1.5 gap-y-1 mt-2">
        {series.map((s) => {
          const color = colorMap.get(s.marketId) || COLORS[0]
          const isVisible = visibleIds.has(s.marketId)
          const canToggleOn = !isVisible && !atLimit

          return (
            <button
              key={s.marketId}
              onClick={() => toggleVisible(s.marketId)}
              onMouseEnter={() => isVisible && setHoveredSeries(s.marketId)}
              onMouseLeave={() => setHoveredSeries(null)}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] transition-all duration-150 ${
                isVisible
                  ? 'text-neutral-300 hover:text-white'
                  : canToggleOn
                    ? 'text-neutral-600 hover:text-neutral-400'
                    : 'text-neutral-700 cursor-not-allowed'
              }`}
              title={
                !isVisible && atLimit
                  ? `Max ${MAX_VISIBLE} lines — click another to remove it first`
                  : isVisible
                    ? 'Click to hide from chart'
                    : 'Click to show on chart'
              }
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: isVisible ? color : 'rgba(255,255,255,0.15)' }}
              />
              <span className="truncate max-w-[100px]">{s.title}</span>
              <span className="tabular-nums" style={{ color: isVisible ? color : 'inherit' }}>
                {(s.currentPrice * 100).toFixed(0)}%
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
