export interface PnLCardData {
  wordLabel: string
  marketLabel: string
  marketId: string
  side: 'YES' | 'NO'
  statusLabel: string
  payout: number
  costBasis: number
  pnl: number
  shares: number
  isClaimed: boolean
  currency: string
  decimals: number
}

export interface MarketSummaryData {
  marketLabel: string
  marketId: string
  words: { label: string; won: boolean; side: 'YES' | 'NO' }[]
  totalCost: number
  totalPayout: number
  totalPnl: number
  currency: string
  decimals: number
}

const GREEN = '#34C759'
const RED = '#FF3B30'
const WHITE = '#ffffff'
const GRAY = '#999999'
const DARK_GRAY = '#666666'
const BG = '#000000'
const BORDER = 'rgba(255,255,255,0.12)'

const W = 600
const H = 320

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}


function drawBadge(
  ctx: CanvasRenderingContext2D,
  text: string, x: number, y: number,
  bgColor: string, textColor: string,
): number {
  ctx.font = 'bold 13px -apple-system, "Helvetica Neue", sans-serif'
  const m = ctx.measureText(text)
  const pw = 10, ph = 4
  const bw = m.width + pw * 2
  const bh = 20

  // bg
  ctx.globalAlpha = 0.18
  ctx.fillStyle = textColor
  drawRoundedRect(ctx, x, y, bw, bh, 5)
  ctx.fill()
  ctx.globalAlpha = 1

  // text
  ctx.fillStyle = textColor
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + pw, y + bh / 2)

  return bw
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

export async function generatePnLImage(data: PnLCardData): Promise<HTMLCanvasElement> {
  const dpr = 2
  const canvas = document.createElement('canvas')
  canvas.width = W * dpr
  canvas.height = H * dpr
  canvas.style.width = `${W}px`
  canvas.style.height = `${H}px`

  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)

  // Background
  ctx.fillStyle = BG
  drawRoundedRect(ctx, 0, 0, W, H, 16)
  ctx.fill()

  // Border
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1.5
  drawRoundedRect(ctx, 0.75, 0.75, W - 1.5, H - 1.5, 16)
  ctx.stroke()

  // Winning positions get a subtle green border
  if (data.statusLabel === 'Won' || data.statusLabel === 'Claimed') {
    ctx.strokeStyle = 'rgba(52,199,89,0.25)'
    ctx.lineWidth = 1.5
    drawRoundedRect(ctx, 0.75, 0.75, W - 1.5, H - 1.5, 16)
    ctx.stroke()
  }

  const pad = 32

  // Logo (top-left)
  try {
    const logo = await loadImage('/src/img/White Logo.svg')
    const logoH = 22
    const logoW = (logo.naturalWidth / logo.naturalHeight) * logoH
    ctx.drawImage(logo, pad, pad, logoW, logoH)
  } catch {
    // fallback text if logo fails to load
    ctx.font = 'bold 18px -apple-system, "Helvetica Neue", sans-serif'
    ctx.fillStyle = WHITE
    ctx.textBaseline = 'top'
    ctx.fillText('MENTIONED', pad, pad)
  }

  // Market info (top-right)
  ctx.font = '12px -apple-system, "Helvetica Neue", sans-serif'
  ctx.fillStyle = DARK_GRAY
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  const marketText = `Market #${data.marketId} · ${data.marketLabel}`
  ctx.fillText(marketText, W - pad, pad + 4)
  ctx.textAlign = 'left'

  // Word label
  let y = 80
  ctx.font = 'bold 32px -apple-system, "Helvetica Neue", sans-serif'
  ctx.fillStyle = WHITE
  ctx.textBaseline = 'top'
  ctx.fillText(data.wordLabel, pad, y)

  // Badges next to word
  const wordW = ctx.measureText(data.wordLabel).width
  let bx = pad + wordW + 12

  const sideColor = data.side === 'YES' ? GREEN : RED
  const bw1 = drawBadge(ctx, data.side, bx, y + 6, '', sideColor)
  bx += bw1 + 8

  const statusColor =
    data.statusLabel === 'Won' || data.statusLabel === 'Claimed' ? GREEN
    : data.statusLabel === 'Lost' ? RED
    : GRAY
  drawBadge(ctx, data.statusLabel, bx, y + 6, '', statusColor)

  // P&L (big number)
  y = 140
  const pnlSign = data.pnl >= 0 ? '+' : ''
  const pnlText = `${pnlSign}${data.pnl.toFixed(data.decimals)} ${data.currency}`
  ctx.font = 'bold 36px -apple-system, "Helvetica Neue", sans-serif'
  ctx.fillStyle = data.pnl >= 0 ? GREEN : RED
  ctx.textBaseline = 'top'
  ctx.fillText(pnlText, pad, y)

  // P&L label
  ctx.font = '13px -apple-system, "Helvetica Neue", sans-serif'
  ctx.fillStyle = GRAY
  ctx.fillText('Profit / Loss', pad, y + 46)

  // Divider
  y = 210
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(pad, y)
  ctx.lineTo(W - pad, y)
  ctx.stroke()

  // Stats row
  y = 228
  const colW = (W - pad * 2) / 2
  const stats = [
    { label: 'Cost Basis', value: `${data.costBasis.toFixed(data.decimals)} ${data.currency}` },
    { label: 'Payout', value: `${data.payout.toFixed(data.decimals)} ${data.currency}`, color: data.payout > 0 ? GREEN : WHITE },
  ]

  stats.forEach((stat, i) => {
    const sx = pad + colW * i
    ctx.font = '12px -apple-system, "Helvetica Neue", sans-serif'
    ctx.fillStyle = GRAY
    ctx.textBaseline = 'top'
    ctx.fillText(stat.label, sx, y)

    ctx.font = 'bold 16px -apple-system, "Helvetica Neue", sans-serif'
    ctx.fillStyle = stat.color ?? WHITE
    ctx.fillText(stat.value, sx, y + 20)
  })

  // Footer watermark
  ctx.font = '12px -apple-system, "Helvetica Neue", sans-serif'
  ctx.fillStyle = DARK_GRAY
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText('mentioned.market', W / 2, H - 20)
  ctx.textAlign = 'left'

  return canvas
}

export async function generateMarketSummaryImage(data: MarketSummaryData): Promise<HTMLCanvasElement> {
  const dpr = 2
  const pad = 32
  const chipH = 32
  const chipGap = 8
  const availW = W - pad * 2
  const titleFont = 'bold 24px -apple-system, "Helvetica Neue", sans-serif'
  const chipFont = 'bold 12px -apple-system, "Helvetica Neue", sans-serif'
  const titleLineH = 30

  // Pre-measure everything in a temp canvas so height can be computed before creation
  const tempCanvas = document.createElement('canvas')
  const tempCtx = tempCanvas.getContext('2d')!

  tempCtx.font = titleFont
  const titleLines = wrapText(tempCtx, data.marketLabel, availW)
  const titleLineCount = titleLines.length

  // Pick wordsPerRow so no chip text overflows (with 20px horizontal padding)
  tempCtx.font = chipFont
  const maxWordW = data.words.length > 0
    ? Math.max(...data.words.map((w) => tempCtx.measureText(w.label).width))
    : 0
  let wordsPerRow = 4
  for (const n of [4, 3, 2, 1]) {
    const chipW = (availW - chipGap * (n - 1)) / n
    if (maxWordW + 24 <= chipW) { wordsPerRow = n; break }
  }
  const rowCount = Math.ceil(data.words.length / wordsPerRow)
  const chipW = (availW - chipGap * (wordsPerRow - 1)) / wordsPerRow

  // Flow-based layout — all positions derived from the section above
  const titleY = 72
  const correctY = titleY + titleLineCount * titleLineH + 10
  const pnlY = correctY + 14 + 16           // 14px font + 16px gap
  const statsY = pnlY + 40 + 18             // ~40px for 32px text + 18px gap
  const dividerY = statsY + 46              // 12px label + 18px gap + ~16px value
  const chipsY = dividerY + 22
  const chipsEndY = chipsY + rowCount * (chipH + chipGap) - chipGap
  const h = chipsEndY + 44                  // 44px footer area

  const canvas = document.createElement('canvas')
  canvas.width = W * dpr
  canvas.height = h * dpr
  canvas.style.width = `${W}px`
  canvas.style.height = `${h}px`

  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)

  // Background
  ctx.fillStyle = BG
  drawRoundedRect(ctx, 0, 0, W, h, 16)
  ctx.fill()

  // Border
  ctx.strokeStyle = data.totalPnl >= 0 ? 'rgba(52,199,89,0.25)' : BORDER
  ctx.lineWidth = 1.5
  drawRoundedRect(ctx, 0.75, 0.75, W - 1.5, h - 1.5, 16)
  ctx.stroke()

  // Logo (top-left)
  try {
    const logo = await loadImage('/src/img/White Logo.svg')
    const logoH = 22
    const logoW = (logo.naturalWidth / logo.naturalHeight) * logoH
    ctx.drawImage(logo, pad, pad, logoW, logoH)
  } catch {
    ctx.font = 'bold 18px -apple-system, "Helvetica Neue", sans-serif'
    ctx.fillStyle = WHITE
    ctx.textBaseline = 'top'
    ctx.fillText('MENTIONED', pad, pad)
  }

  // Market# (top-right)
  ctx.font = '12px -apple-system, "Helvetica Neue", sans-serif'
  ctx.fillStyle = DARK_GRAY
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillText(`Market #${data.marketId}`, W - pad, pad + 4)
  ctx.textAlign = 'left'

  // Title (wrapped)
  ctx.font = titleFont
  ctx.fillStyle = WHITE
  ctx.textBaseline = 'top'
  titleLines.forEach((line, i) => ctx.fillText(line, pad, titleY + i * titleLineH))

  // X/Y correct
  const correct = data.words.filter((w) => w.won).length
  const total = data.words.length
  ctx.font = '14px -apple-system, "Helvetica Neue", sans-serif'
  ctx.fillStyle = GRAY
  ctx.fillText(`${correct}/${total} correct`, pad, correctY)

  // P&L (big number)
  const pnlSign = data.totalPnl >= 0 ? '+' : ''
  ctx.font = 'bold 32px -apple-system, "Helvetica Neue", sans-serif'
  ctx.fillStyle = data.totalPnl >= 0 ? GREEN : RED
  ctx.textBaseline = 'top'
  ctx.fillText(`${pnlSign}${data.totalPnl.toFixed(data.decimals)} ${data.currency}`, pad, pnlY)

  // Stats row
  const colW = availW / 2
  const stats = [
    { label: 'Total Cost', value: `${data.totalCost.toFixed(data.decimals)} ${data.currency}` },
    { label: 'Total Payout', value: `${data.totalPayout.toFixed(data.decimals)} ${data.currency}`, color: data.totalPayout > 0 ? GREEN : WHITE },
  ]
  stats.forEach((stat, i) => {
    const sx = pad + colW * i
    ctx.font = '12px -apple-system, "Helvetica Neue", sans-serif'
    ctx.fillStyle = GRAY
    ctx.textBaseline = 'top'
    ctx.fillText(stat.label, sx, statsY)
    ctx.font = 'bold 15px -apple-system, "Helvetica Neue", sans-serif'
    ctx.fillStyle = stat.color ?? WHITE
    ctx.fillText(stat.value, sx, statsY + 18)
  })

  // Divider
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(pad, dividerY)
  ctx.lineTo(W - pad, dividerY)
  ctx.stroke()

  // Word chips — text truncated with ellipsis if still too wide
  const chipTextMaxW = chipW - 24
  tempCtx.font = chipFont
  const truncate = (text: string): string => {
    if (tempCtx.measureText(text).width <= chipTextMaxW) return text
    let t = text
    while (t.length > 0 && tempCtx.measureText(t + '…').width > chipTextMaxW) t = t.slice(0, -1)
    return t + '…'
  }

  data.words.forEach((word, i) => {
    const col = i % wordsPerRow
    const row = Math.floor(i / wordsPerRow)
    const cx = pad + col * (chipW + chipGap)
    const cy = chipsY + row * (chipH + chipGap)

    const color = word.won ? GREEN : RED
    ctx.globalAlpha = 0.15
    ctx.fillStyle = color
    drawRoundedRect(ctx, cx, cy, chipW, chipH, 7)
    ctx.fill()
    ctx.globalAlpha = 1

    ctx.font = chipFont
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(truncate(word.label), cx + chipW / 2, cy + chipH / 2)
  })
  ctx.textAlign = 'left'

  // Footer watermark
  ctx.font = '12px -apple-system, "Helvetica Neue", sans-serif'
  ctx.fillStyle = DARK_GRAY
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText('mentioned.market', W / 2, h - 18)
  ctx.textAlign = 'left'

  return canvas
}

export async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to create blob'))),
      'image/png',
    )
  })
}
