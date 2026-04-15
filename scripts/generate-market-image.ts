/**
 * Generate a leaderboard PNG image for a resolved free market.
 *
 * Usage:
 *   npx ts-node -r dotenv/config --project tsconfig.scripts.json scripts/generate-market-image.ts <marketId>
 *
 * Outputs:
 *   - market-<id>-leaderboard.png  (high-res PNG)
 *   - Discord IDs printed to stdout for copy-paste
 */

import 'dotenv/config'
import path from 'path'
import fs from 'fs'
import pg from 'pg'
import { createCanvas, loadImage } from 'canvas'

// ── DB ────────────────────────────────────────────────────────────

const dbUrl = process.env.DATABASE_URL ?? ''
const sslDisabled = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')
  || dbUrl.includes('sslmode=disable') || process.env.DB_SSL === 'false'

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: sslDisabled ? false : { rejectUnauthorized: false },
})

interface TraderRow {
  wallet: string
  username: string | null
  pfp_emoji: string | null
  discord_id: string | null
  discord_username: string | null
  total_spent: number
  net_tokens: number
  pnl_pct: number | null
  points_earned: number
}

async function getMarketData(marketId: number) {
  const marketRes = await pool.query(
    `SELECT title, status FROM custom_markets WHERE id = $1`,
    [marketId],
  )
  if (marketRes.rows.length === 0) throw new Error(`Market ${marketId} not found`)
  const market = marketRes.rows[0] as { title: string; status: string }
  if (market.status !== 'resolved') throw new Error(`Market ${marketId} is not resolved (status: ${market.status})`)

  const tradersRes = await pool.query(
    `SELECT
       r.wallet,
       up.username,
       up.pfp_emoji,
       up.discord_id,
       up.discord_username,
       SUM(r.tokens_spent)::float AS total_spent,
       SUM(r.net_tokens)::float AS net_tokens
     FROM custom_market_results r
     LEFT JOIN user_profiles up ON up.wallet = r.wallet
     WHERE r.market_id = $1
     GROUP BY r.wallet, up.username, up.pfp_emoji, up.discord_id, up.discord_username
     ORDER BY net_tokens DESC
     LIMIT 5`,
    [marketId],
  )

  const traders: TraderRow[] = tradersRes.rows.map((row: any) => ({
    wallet: row.wallet,
    username: row.username ?? null,
    pfp_emoji: row.pfp_emoji ?? null,
    discord_id: row.discord_id ?? null,
    discord_username: row.discord_username ?? null,
    total_spent: parseFloat(row.total_spent),
    net_tokens: parseFloat(row.net_tokens),
    pnl_pct: parseFloat(row.total_spent) > 0
      ? (parseFloat(row.net_tokens) / parseFloat(row.total_spent)) * 100
      : null,
    points_earned: Math.max(0, Math.floor(parseFloat(row.net_tokens) * 0.5)),
  }))

  return { market, traders }
}

// ── Colour palette (matches leaderboard page) ─────────────────────

const ACCENTS = [
  { color: '#F2B71F', glow: 'rgba(242,183,31,0.25)', bg: 'rgba(242,183,31,0.07)', label: '1st', medal: '🥇' },
  { color: '#9ba8b5', glow: 'rgba(155,168,181,0.18)', bg: 'rgba(155,168,181,0.05)', label: '2nd', medal: '🥈' },
  { color: '#c07b3a', glow: 'rgba(192,123,58,0.18)', bg: 'rgba(192,123,58,0.05)', label: '3rd', medal: '🥉' },
  { color: '#6b7280', glow: 'rgba(107,114,128,0.12)', bg: 'rgba(107,114,128,0.03)', label: '4th', medal: null },
  { color: '#6b7280', glow: 'rgba(107,114,128,0.12)', bg: 'rgba(107,114,128,0.03)', label: '5th', medal: null },
]

// ── Canvas helpers ────────────────────────────────────────────────

const SCALE = 2          // retina
const W = 1200
const H = 820
const RW = W * SCALE
const RH = H * SCALE

function roundRect(
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

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1)
  return t + '…'
}

// ── Main render ───────────────────────────────────────────────────

async function render(marketId: number, market: { title: string }, traders: TraderRow[]) {
  const canvas = createCanvas(RW, RH)
  const ctx = canvas.getContext('2d') as any as CanvasRenderingContext2D
  ctx.scale(SCALE, SCALE)

  // Background
  ctx.fillStyle = '#080808'
  ctx.fillRect(0, 0, W, H)

  // Subtle ambient glows
  const glowColors = [
    { x: 160, y: 200, color: 'rgba(242,183,31,0.07)' },
    { x: W - 160, y: H - 180, color: 'rgba(242,183,31,0.05)' },
    { x: W / 2, y: H / 2, color: 'rgba(242,183,31,0.03)' },
  ]
  for (const g of glowColors) {
    const grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, 380)
    grad.addColorStop(0, g.color)
    grad.addColorStop(1, 'transparent')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)
  }

  // Noise texture simulation (very subtle dot pattern)
  ctx.globalAlpha = 0.018
  for (let y = 0; y < H; y += 3) {
    for (let x = 0; x < W; x += 3) {
      const v = Math.floor(Math.random() * 255)
      ctx.fillStyle = `rgb(${v},${v},${v})`
      ctx.fillRect(x, y, 1, 1)
    }
  }
  ctx.globalAlpha = 1

  // ── Logo ──────────────────────────────────────────────────────
  const logoPath = path.join(__dirname, '../public/src/img/__White Logo.png')
  const logo = await loadImage(logoPath)
  // logo is 6813x1109 — draw at ~180px wide
  const logoW = 180
  const logoH = Math.round((logoW / 6813) * 1109)
  ctx.globalAlpha = 0.90
  ctx.drawImage(logo as any, 56, 46, logoW, logoH)
  ctx.globalAlpha = 1

  // ── Header ────────────────────────────────────────────────────
  // "MARKET RESULTS" label
  ctx.font = '700 11px "Plus Jakarta Sans", sans-serif'
  ctx.letterSpacing = '2px'
  ctx.fillStyle = '#F2B71F'
  ctx.textAlign = 'right'
  ctx.fillText('MARKET RESULTS', W - 56, 62)
  ctx.letterSpacing = '0px'

  // Market title
  ctx.font = '700 26px "Plus Jakarta Sans", sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'right'
  const titleText = truncate(ctx, market.title, 520)
  ctx.fillText(titleText, W - 56, 92)

  // Divider
  const divY = 118
  const divGrad = ctx.createLinearGradient(56, divY, W - 56, divY)
  divGrad.addColorStop(0, 'rgba(242,183,31,0.6)')
  divGrad.addColorStop(0.4, 'rgba(242,183,31,0.15)')
  divGrad.addColorStop(1, 'rgba(255,255,255,0.04)')
  ctx.strokeStyle = divGrad
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(56, divY)
  ctx.lineTo(W - 56, divY)
  ctx.stroke()

  // ── Section header ────────────────────────────────────────────
  ctx.font = '600 12px "Plus Jakarta Sans", sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.3)'
  ctx.textAlign = 'left'
  ctx.fillText('TOP TRADERS', 56, 148)

  // Column headers
  ctx.font = '500 11px "Plus Jakarta Sans", sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.25)'
  ctx.textAlign = 'right'
  ctx.fillText('TOKENS WON', W - 56 - 200, 148)
  ctx.fillText('P&L %', W - 56 - 100, 148)
  ctx.fillText('POINTS', W - 56, 148)

  // ── Leaderboard rows ──────────────────────────────────────────
  const ROWS_START = 166
  const ROW_H = 90
  const PAD_X = 56

  for (let i = 0; i < traders.length; i++) {
    const t = traders[i]
    const accent = ACCENTS[i]
    const ry = ROWS_START + i * ROW_H
    const rh = ROW_H - 8
    const rx = PAD_X
    const rw = W - PAD_X * 2

    // Row glow / background
    const rowGrad = ctx.createLinearGradient(rx, ry, rx + rw, ry)
    rowGrad.addColorStop(0, accent.bg)
    rowGrad.addColorStop(1, 'rgba(255,255,255,0.015)')
    roundRect(ctx, rx, ry, rw, rh, 14)
    ctx.fillStyle = rowGrad
    ctx.fill()

    // Left accent bar
    roundRect(ctx, rx, ry, 3, rh, 2)
    ctx.fillStyle = accent.color
    ctx.fill()

    // Left glow behind accent bar
    const barGlow = ctx.createRadialGradient(rx + 2, ry + rh / 2, 0, rx + 2, ry + rh / 2, 80)
    barGlow.addColorStop(0, accent.glow)
    barGlow.addColorStop(1, 'transparent')
    ctx.fillStyle = barGlow
    ctx.fillRect(rx, ry, 90, rh)

    // Row border
    roundRect(ctx, rx, ry, rw, rh, 14)
    ctx.strokeStyle = i === 0
      ? 'rgba(242,183,31,0.18)'
      : 'rgba(255,255,255,0.05)'
    ctx.lineWidth = 1
    ctx.stroke()

    const cy = ry + rh / 2  // vertical center of row

    // Rank / medal
    const rankX = rx + 26
    if (accent.medal) {
      ctx.font = `${i === 0 ? 28 : 22}px sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText(accent.medal, rankX, cy + (i === 0 ? 10 : 8))
    } else {
      ctx.font = '700 16px "Plus Jakarta Sans", sans-serif'
      ctx.fillStyle = accent.color
      ctx.textAlign = 'center'
      ctx.fillText(accent.label, rankX, cy + 6)
    }

    // PFP emoji (if set)
    const nameX = rx + 62
    let textStartX = nameX
    if (t.pfp_emoji) {
      ctx.font = '24px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(t.pfp_emoji, nameX, cy + 9)
      textStartX = nameX + 34
    }

    // Username / wallet
    const displayName = t.username || `${t.wallet.slice(0, 4)}...${t.wallet.slice(-4)}`
    ctx.font = i < 3 ? '700 17px "Plus Jakarta Sans", sans-serif' : '600 16px "Plus Jakarta Sans", sans-serif'
    ctx.fillStyle = i === 0 ? '#F2B71F' : '#ffffff'
    ctx.textAlign = 'left'
    const nameMaxW = rw - (textStartX - rx) - 360
    ctx.fillText(truncate(ctx, displayName, nameMaxW), textStartX, cy + 6)

    // Discord tag underneath name (if linked)
    if (t.discord_username) {
      ctx.font = '400 11px "Plus Jakarta Sans", sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.fillText(`@${t.discord_username}`, textStartX, cy + 22)
    }

    // Tokens won column
    const netPositive = t.net_tokens > 0
    const tokensX = W - PAD_X - 300
    ctx.font = '700 18px "Plus Jakarta Sans", sans-serif'
    ctx.fillStyle = netPositive ? '#34C759' : '#FF3B30'
    ctx.textAlign = 'right'
    const netStr = netPositive ? `+${t.net_tokens.toFixed(1)}` : t.net_tokens.toFixed(1)
    ctx.fillText(netStr, tokensX, cy + 4)
    ctx.font = '400 11px "Plus Jakarta Sans", sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.fillText('tokens', tokensX, cy + 19)

    // P&L % column
    const pnlX = W - PAD_X - 148
    if (t.pnl_pct !== null) {
      ctx.font = '700 18px "Plus Jakarta Sans", sans-serif'
      ctx.fillStyle = t.pnl_pct >= 0 ? '#34C759' : '#FF3B30'
      ctx.textAlign = 'right'
      const pnlStr = t.pnl_pct >= 0 ? `+${t.pnl_pct.toFixed(1)}%` : `${t.pnl_pct.toFixed(1)}%`
      ctx.fillText(pnlStr, pnlX, cy + 4)
      ctx.font = '400 11px "Plus Jakarta Sans", sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.3)'
      ctx.fillText('return', pnlX, cy + 19)
    }

    // Points column
    const ptX = W - PAD_X
    ctx.font = '700 18px "Plus Jakarta Sans", sans-serif'
    ctx.fillStyle = t.points_earned > 0 ? '#F2B71F' : 'rgba(255,255,255,0.3)'
    ctx.textAlign = 'right'
    ctx.fillText(t.points_earned > 0 ? `+${t.points_earned}` : '0', ptX, cy + 4)
    ctx.font = '400 11px "Plus Jakarta Sans", sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.fillText('points', ptX, cy + 19)
  }

  // ── Footer ────────────────────────────────────────────────────
  const footY = ROWS_START + traders.length * ROW_H + 22
  const footGrad = ctx.createLinearGradient(56, footY, W - 56, footY)
  footGrad.addColorStop(0, 'rgba(242,183,31,0.2)')
  footGrad.addColorStop(1, 'rgba(255,255,255,0.04)')
  ctx.strokeStyle = footGrad
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(56, footY)
  ctx.lineTo(W - 56, footY)
  ctx.stroke()

  ctx.font = '500 12px "Plus Jakarta Sans", sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.2)'
  ctx.textAlign = 'left'
  ctx.fillText('mentioned.market', 56, footY + 24)
  ctx.textAlign = 'right'
  ctx.fillText('Free Play Markets', W - 56, footY + 24)

  return canvas
}

// ── Entry point ───────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2]
  if (!arg || isNaN(parseInt(arg, 10))) {
    console.error('Usage: ts-node scripts/generate-market-image.ts <marketId>')
    process.exit(1)
  }
  const marketId = parseInt(arg, 10)

  console.log(`Fetching data for market ${marketId}...`)
  const { market, traders } = await getMarketData(marketId)
  await pool.end()

  if (traders.length === 0) {
    console.error('No results found for this market — has it been resolved and scored?')
    process.exit(1)
  }

  console.log(`\nMarket: "${market.title}"`)
  console.log(`Traders with results: ${traders.length}\n`)

  // Print Discord IDs for posting
  console.log('── Discord mentions ──────────────────────────')
  traders.forEach((t, i) => {
    const name = t.username || `${t.wallet.slice(0, 4)}...${t.wallet.slice(-4)}`
    const discord = t.discord_id ? `<@${t.discord_id}>` : t.discord_username ? `@${t.discord_username}` : '(no Discord linked)'
    const net = t.net_tokens >= 0 ? `+${t.net_tokens.toFixed(1)}` : t.net_tokens.toFixed(1)
    console.log(`${ACCENTS[i]?.medal ?? `#${i + 1}`} ${name.padEnd(20)} ${net.padStart(10)} tokens  |  ${t.points_earned} pts  |  ${discord}`)
  })
  console.log('──────────────────────────────────────────────\n')

  // Render image
  console.log('Rendering image...')
  const canvas = await render(marketId, market, traders)

  const outPath = path.join(process.cwd(), `market-${marketId}-leaderboard.png`)
  const buffer = canvas.toBuffer('image/png')
  fs.writeFileSync(outPath, buffer)
  console.log(`Saved: ${outPath}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
