'use client'

import { useEffect, useRef } from 'react'

interface DataPoint {
  timestamp: number
  price: number
}

interface TradingChartProps {
  word: string
  data: DataPoint[]
  currentPrice: number
}

export default function TradingChart({ word, data, currentPrice }: TradingChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * window.devicePixelRatio
    canvas.height = rect.height * window.devicePixelRatio
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio)

    const width = rect.width
    const height = rect.height
    const padding = 40

    // Clear canvas
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, width, height)

    // Draw grid
    ctx.strokeStyle = '#333333'
    ctx.lineWidth = 1
    
    // Horizontal lines
    for (let i = 0; i <= 10; i++) {
      const y = padding + (height - 2 * padding) * (i / 10)
      ctx.beginPath()
      ctx.moveTo(padding, y)
      ctx.lineTo(width - padding, y)
      ctx.stroke()
    }

    // Vertical lines
    for (let i = 0; i <= 10; i++) {
      const x = padding + (width - 2 * padding) * (i / 10)
      ctx.beginPath()
      ctx.moveTo(x, padding)
      ctx.lineTo(x, height - padding)
      ctx.stroke()
    }

    // Find min and max values
    const prices = data.map(d => d.price)
    const minPrice = Math.min(...prices)
    const maxPrice = Math.max(...prices)
    const priceRange = maxPrice - minPrice || 0.1

    // Draw price labels
    ctx.fillStyle = '#FFFFFF'
    ctx.font = '12px monospace'
    ctx.textAlign = 'right'
    
    for (let i = 0; i <= 4; i++) {
      const price = maxPrice - (priceRange * i / 4)
      const y = padding + (height - 2 * padding) * (i / 4)
      ctx.fillText(price.toFixed(2), padding - 5, y + 4)
    }

    // Draw time labels (simplified)
    ctx.textAlign = 'center'
    const timeLabels = ['24h ago', '18h', '12h', '6h', 'Now']
    for (let i = 0; i < timeLabels.length; i++) {
      const x = padding + (width - 2 * padding) * (i / 4)
      ctx.fillText(timeLabels[i], x, height - padding + 20)
    }

    // Draw line
    if (data.length > 1) {
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 3
      ctx.beginPath()

      data.forEach((point, i) => {
        const x = padding + (width - 2 * padding) * (i / (data.length - 1))
        const y = height - padding - ((point.price - minPrice) / priceRange) * (height - 2 * padding)
        
        if (i === 0) {
          ctx.moveTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }
      })

      ctx.stroke()

      // Draw points
      ctx.fillStyle = '#FFFFFF'
      data.forEach((point, i) => {
        const x = padding + (width - 2 * padding) * (i / (data.length - 1))
        const y = height - padding - ((point.price - minPrice) / priceRange) * (height - 2 * padding)
        
        ctx.beginPath()
        ctx.arc(x, y, 4, 0, Math.PI * 2)
        ctx.fill()
      })
    }

    // Draw current price indicator
    const currentY = height - padding - ((currentPrice - minPrice) / priceRange) * (height - 2 * padding)
    ctx.strokeStyle = '#00FF00'
    ctx.lineWidth = 2
    ctx.setLineDash([5, 5])
    ctx.beginPath()
    ctx.moveTo(padding, currentY)
    ctx.lineTo(width - padding, currentY)
    ctx.stroke()
    ctx.setLineDash([])

    // Current price label
    ctx.fillStyle = '#00FF00'
    ctx.font = 'bold 14px monospace'
    ctx.textAlign = 'left'
    ctx.fillText(`$${currentPrice.toFixed(2)}`, width - padding + 5, currentY + 4)

  }, [data, currentPrice])

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}

