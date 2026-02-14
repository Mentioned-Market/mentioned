'use client'

import { useEffect, useRef } from 'react'

interface ChartSeries {
  label: string
  color: string
  data: { timestamp: number; price: number }[]
  currentPrice: number
}

interface MarketChartProps {
  series: ChartSeries[]
}

export default function MarketChart({ series }: MarketChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || series.length === 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * window.devicePixelRatio
    canvas.height = rect.height * window.devicePixelRatio
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio)

    const width = rect.width
    const height = rect.height
    const paddingLeft = 45
    const paddingRight = 20
    const paddingTop = 15
    const paddingBottom = 30

    // Clear
    ctx.clearRect(0, 0, width, height)

    // Find global min/max across all series
    let globalMin = 1
    let globalMax = 0
    series.forEach(s => {
      s.data.forEach(d => {
        if (d.price < globalMin) globalMin = d.price
        if (d.price > globalMax) globalMax = d.price
      })
    })

    // Add some padding to the range
    const range = globalMax - globalMin || 0.1
    globalMin = Math.max(0, globalMin - range * 0.15)
    globalMax = Math.min(1, globalMax + range * 0.15)
    const priceRange = globalMax - globalMin

    // Round to nice percentage values for grid
    const minPct = Math.floor(globalMin * 100 / 5) * 5
    const maxPct = Math.ceil(globalMax * 100 / 5) * 5

    // Draw horizontal grid lines and labels
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
    ctx.lineWidth = 1
    ctx.setLineDash([2, 4])

    for (let pct = minPct; pct <= maxPct; pct += 5) {
      const price = pct / 100
      const y = paddingTop + (1 - (price - globalMin) / priceRange) * (height - paddingTop - paddingBottom)

      if (y >= paddingTop && y <= height - paddingBottom) {
        ctx.beginPath()
        ctx.moveTo(paddingLeft, y)
        ctx.lineTo(width - paddingRight, y)
        ctx.stroke()

        // Label
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
        ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif'
        ctx.textAlign = 'right'
        ctx.fillText(`${pct}%`, paddingLeft - 8, y + 4)
      }
    }
    ctx.setLineDash([])

    // Draw time labels along bottom
    if (series[0]?.data.length > 0) {
      const data = series[0].data
      const labelCount = 5
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
      ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif'
      ctx.textAlign = 'center'

      for (let i = 0; i < labelCount; i++) {
        const idx = Math.floor(i * (data.length - 1) / (labelCount - 1))
        const x = paddingLeft + (idx / (data.length - 1)) * (width - paddingLeft - paddingRight)
        const d = new Date(data[idx].timestamp)
        const label = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
        ctx.fillText(label, x, height - 8)
      }
    }

    // Draw each series line
    series.forEach(s => {
      if (s.data.length < 2) return

      ctx.strokeStyle = s.color
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()

      s.data.forEach((point, i) => {
        const x = paddingLeft + (i / (s.data.length - 1)) * (width - paddingLeft - paddingRight)
        const y = paddingTop + (1 - (point.price - globalMin) / priceRange) * (height - paddingTop - paddingBottom)

        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()

      // Draw endpoint dot
      const lastPoint = s.data[s.data.length - 1]
      const lastX = width - paddingRight
      const lastY = paddingTop + (1 - (lastPoint.price - globalMin) / priceRange) * (height - paddingTop - paddingBottom)

      ctx.fillStyle = s.color
      ctx.beginPath()
      ctx.arc(lastX, lastY, 4, 0, Math.PI * 2)
      ctx.fill()
    })
  }, [series])

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ width: '100%', height: '100%' }}
    />
  )
}
