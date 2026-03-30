'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  ColorType,
  CrosshairMode,
  LineStyle,
} from 'lightweight-charts'

// ── Types ──────────────────────────────────────────────────

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
  selectedMarketId: string | null
  preloadedSeries?: { marketId: string; title: string; currentPrice: number; data: PricePoint[] }[]
}

// ── Constants ──────────────────────────────────────────────

const MAX_VISIBLE = 5
const DEFAULT_VISIBLE = 3

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

// Make a translucent version of a hex color
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// ── Component ──────────────────────────────────────────────

export default function EventPriceChart({
  eventId,
  markets,
  selectedMarketId,
  preloadedSeries,
}: EventPriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesMapRef = useRef<Map<string, ISeriesApi<SeriesType>>>(new Map())
  const tooltipRef = useRef<HTMLDivElement>(null)

  const [series, setSeries] = useState<MarketSeries[]>([])
  const [loading, setLoading] = useState(true)
  const [hoveredSeries, setHoveredSeries] = useState<string | null>(null)
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set())

  // Tooltip state
  const [tooltipData, setTooltipData] = useState<{
    prices: { marketId: string; title: string; color: string; price: number }[]
    time: string
    x: number
    y: number
  } | null>(null)

  // ── Stable color map ─────────────────────────────────────

  const colorMap = useMemo(() => {
    const map = new Map<string, string>()
    series.forEach((s, idx) => {
      map.set(s.marketId, COLORS[idx % COLORS.length])
    })
    return map
  }, [series])

  // ── Visibility management ────────────────────────────────

  useEffect(() => {
    if (markets.length === 0) return
    const sorted = [...markets].sort((a, b) => b.currentPrice - a.currentPrice)
    const initial = new Set(sorted.slice(0, DEFAULT_VISIBLE).map(m => m.marketId))
    if (selectedMarketId && !initial.has(selectedMarketId)) {
      initial.add(selectedMarketId)
      if (initial.size > MAX_VISIBLE) {
        const ids = [...initial]
        const lowest = ids
          .map(id => markets.find(m => m.marketId === id)!)
          .filter(Boolean)
          .sort((a, b) => a.currentPrice - b.currentPrice)[0]
        if (lowest && lowest.marketId !== selectedMarketId) {
          initial.delete(lowest.marketId)
        }
      }
    }
    setVisibleIds(initial)
  }, [markets.length])

  useEffect(() => {
    if (!selectedMarketId) return
    setVisibleIds(prev => {
      if (prev.has(selectedMarketId)) return prev
      const next = new Set(prev)
      if (next.size >= MAX_VISIBLE) {
        const first = next.values().next().value
        if (first !== undefined) next.delete(first)
      }
      next.add(selectedMarketId)
      return next
    })
  }, [selectedMarketId])

  const toggleVisible = useCallback((marketId: string) => {
    setVisibleIds(prev => {
      const next = new Set(prev)
      if (next.has(marketId)) {
        if (next.size <= 1) return prev
        next.delete(marketId)
      } else {
        if (next.size >= MAX_VISIBLE) return prev
        next.add(marketId)
      }
      return next
    })
  }, [])

  // ── Fetch data ───────────────────────────────────────────

  useEffect(() => {
    if (preloadedSeries) {
      setSeries(preloadedSeries.filter(s => s.data.length > 0))
      setLoading(false)
      return
    }

    if (markets.length === 0) return
    if (series.length === 0) setLoading(true)

    Promise.all(
      markets.map(async m => {
        try {
          const res = await fetch(
            `/api/polymarket/prices?marketId=${encodeURIComponent(m.marketId)}&interval=max&fidelity=60`
          )
          if (!res.ok) return { ...m, data: [] }
          const json = await res.json()
          return { ...m, data: json.history || [] }
        } catch {
          return { ...m, data: [] }
        }
      })
    ).then(results => {
      setSeries(results.filter(s => s.data.length > 0))
      setLoading(false)
    })
  }, [markets, eventId, preloadedSeries])

  // ── Visible series ───────────────────────────────────────

  const visibleSeries = useMemo(
    () => series.filter(s => visibleIds.has(s.marketId)),
    [series, visibleIds]
  )

  // ── Create / update chart ────────────────────────────────

  useEffect(() => {
    if (!chartContainerRef.current || visibleSeries.length === 0) return

    // Destroy previous chart
    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
      seriesMapRef.current.clear()
    }

    const container = chartContainerRef.current
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 280,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'rgba(255,255,255,0.4)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(255,255,255,0.2)',
          style: LineStyle.Dashed,
          width: 1,
          labelBackgroundColor: 'rgba(30,30,30,0.9)',
        },
        horzLine: {
          color: 'rgba(255,255,255,0.2)',
          style: LineStyle.Dashed,
          width: 1,
          labelBackgroundColor: 'rgba(30,30,30,0.9)',
        },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      handleScroll: false,
      handleScale: false,
    })

    chartRef.current = chart

    // Determine if only one series visible — use area chart for single, lines for multi
    const isSingle = visibleSeries.length === 1

    visibleSeries.forEach(s => {
      const color = colorMap.get(s.marketId) || COLORS[0]
      const isSelected = s.marketId === selectedMarketId

      const data = s.data
        .map(p => ({
          time: p.t as any,
          value: p.p * 100, // show as percentage
        }))
        .sort((a: any, b: any) => a.time - b.time)

      if (data.length < 2) return

      if (isSingle) {
        // Area chart for single series — gradient fill like Jupiter/Kalshi
        const area = chart.addAreaSeries({
          lineColor: color,
          lineWidth: 2,
          topColor: hexToRgba(color, 0.28),
          bottomColor: hexToRgba(color, 0.0),
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 5,
          crosshairMarkerBorderColor: color,
          crosshairMarkerBackgroundColor: '#000',
          crosshairMarkerBorderWidth: 2,
          priceFormat: {
            type: 'custom',
            formatter: (price: number) => `${price.toFixed(1)}%`,
          },
        })
        area.setData(data)
        seriesMapRef.current.set(s.marketId, area)
      } else {
        // Line series for multi-series
        const line = chart.addLineSeries({
          color,
          lineWidth: isSelected ? 3 : 2,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 4,
          crosshairMarkerBorderColor: color,
          crosshairMarkerBackgroundColor: '#000',
          crosshairMarkerBorderWidth: 2,
          priceFormat: {
            type: 'custom',
            formatter: (price: number) => `${price.toFixed(1)}%`,
          },
        })
        line.setData(data)
        seriesMapRef.current.set(s.marketId, line)
      }
    })

    // Fit content
    chart.timeScale().fitContent()

    // ── Crosshair tooltip ──────────────────────────────────

    chart.subscribeCrosshairMove(param => {
      if (!param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
        setTooltipData(null)
        return
      }

      const prices: { marketId: string; title: string; color: string; price: number }[] = []

      visibleSeries.forEach(s => {
        const seriesApi = seriesMapRef.current.get(s.marketId)
        if (!seriesApi) return
        const data = param.seriesData.get(seriesApi)
        if (!data) return
        const val = (data as any).value
        if (val !== undefined) {
          prices.push({
            marketId: s.marketId,
            title: s.title,
            color: colorMap.get(s.marketId) || COLORS[0],
            price: val,
          })
        }
      })

      if (prices.length === 0) {
        setTooltipData(null)
        return
      }

      // Format the time
      const ts = param.time as number
      const date = new Date(ts * 1000)
      const timeStr = date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })

      setTooltipData({
        prices: prices.sort((a, b) => b.price - a.price),
        time: timeStr,
        x: param.point.x,
        y: param.point.y,
      })
    })

    // ── Resize observer ────────────────────────────────────

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width } = entry.contentRect
        chart.applyOptions({ width })
      }
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      seriesMapRef.current.clear()
    }
  }, [visibleSeries, colorMap, selectedMarketId])

  // ── Highlight selected / hovered series ──────────────────

  useEffect(() => {
    if (!chartRef.current) return
    const activeId = hoveredSeries || selectedMarketId
    const hasActive = !!activeId

    visibleSeries.forEach(s => {
      const seriesApi = seriesMapRef.current.get(s.marketId)
      if (!seriesApi) return
      const color = colorMap.get(s.marketId) || COLORS[0]
      const isActive = s.marketId === activeId

      if (visibleSeries.length === 1) {
        // Single series — area, always full opacity
        seriesApi.applyOptions({
          lineColor: color,
          topColor: hexToRgba(color, 0.28),
          bottomColor: hexToRgba(color, 0.0),
        } as any)
      } else {
        // Multi-series lines
        if (hasActive) {
          seriesApi.applyOptions({
            color: isActive ? color : hexToRgba(color, 0.15),
            lineWidth: isActive ? 3 : 1,
          } as any)
        } else {
          seriesApi.applyOptions({
            color,
            lineWidth: 2,
          } as any)
        }
      }
    })
  }, [hoveredSeries, selectedMarketId, visibleSeries, colorMap])

  // ── Loading state ────────────────────────────────────────

  if (loading) {
    return (
      <div className="w-full h-[280px] rounded-2xl bg-white/[0.02] border border-white/5 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-neutral-600 border-t-white rounded-full animate-spin" />
      </div>
    )
  }

  if (series.length === 0) return null

  const atLimit = visibleIds.size >= MAX_VISIBLE

  return (
    <div className="w-full">
      {/* Chart container */}
      <div className="relative rounded-2xl bg-white/[0.02] border border-white/5 overflow-hidden">
        {/* Chart */}
        <div ref={chartContainerRef} className="w-full h-[280px]" />

        {/* Custom tooltip */}
        {tooltipData && (
          <div
            ref={tooltipRef}
            className="absolute z-20 pointer-events-none"
            style={{
              left: Math.min(tooltipData.x + 16, (chartContainerRef.current?.clientWidth || 400) - 200),
              top: Math.max(tooltipData.y - 12, 8),
            }}
          >
            <div className="bg-neutral-900/95 backdrop-blur-md border border-white/10 rounded-xl px-3 py-2.5 shadow-2xl min-w-[140px]">
              <div className="text-[10px] text-neutral-500 font-medium mb-1.5">{tooltipData.time}</div>
              {tooltipData.prices.map(p => (
                <div key={p.marketId} className="flex items-center gap-2 py-0.5">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: p.color }}
                  />
                  <span className="text-[11px] text-neutral-400 truncate max-w-[100px]">{p.title}</span>
                  <span
                    className="text-[11px] font-semibold ml-auto tabular-nums"
                    style={{ color: p.color }}
                  >
                    {p.price.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-1.5 gap-y-1 mt-2.5">
        {series.map(s => {
          const color = colorMap.get(s.marketId) || COLORS[0]
          const isVisible = visibleIds.has(s.marketId)
          const canToggleOn = !isVisible && !atLimit

          return (
            <button
              key={s.marketId}
              onClick={() => toggleVisible(s.marketId)}
              onMouseEnter={() => isVisible && setHoveredSeries(s.marketId)}
              onMouseLeave={() => setHoveredSeries(null)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] transition-all duration-150 ${
                isVisible
                  ? 'bg-white/[0.04] text-neutral-300 hover:text-white hover:bg-white/[0.07]'
                  : canToggleOn
                    ? 'text-neutral-600 hover:text-neutral-400 hover:bg-white/[0.03]'
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
                className="w-2 h-2 rounded-full flex-shrink-0 transition-colors"
                style={{ backgroundColor: isVisible ? color : 'rgba(255,255,255,0.15)' }}
              />
              <span className="truncate max-w-[100px]">{s.title}</span>
              <span className="font-semibold tabular-nums" style={{ color: isVisible ? color : 'inherit' }}>
                {(s.currentPrice * 100).toFixed(0)}%
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
