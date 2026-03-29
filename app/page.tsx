'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

/* ───────────────────────────────────────────────
   Helpers
   ─────────────────────────────────────────────── */
function lerp(a: number, b: number, t: number) { return a + (b - a) * t }
function clamp01(v: number) { return Math.max(0, Math.min(1, v)) }
function sub(progress: number, start: number, end: number) {
  return clamp01((progress - start) / (end - start))
}
function ease(t: number) { return 1 - Math.pow(1 - t, 3) }

/* ───────────────────────────────────────────────
   Single global scroll hook
   One tall div drives everything. Returns 0→1.
   ─────────────────────────────────────────────── */
function useGlobalScroll(heroVh: number, contentVh: number, contentSlideCount: number) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollY, setScrollY] = useState(0)
  const [vh, setVh] = useState(800)

  useEffect(() => {
    setVh(window.innerHeight)
    const onResize = () => setVh(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const onScroll = () => {
      const el = containerRef.current
      if (!el) return
      setScrollY(Math.max(0, -el.getBoundingClientRect().top))
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const heroH = (heroVh / 100) * vh
  const slideH = (contentVh / 100) * vh
  const totalHeight = heroH + contentSlideCount * slideH + vh

  let currentSlide: number
  let slideProgress: number

  if (scrollY < heroH) {
    currentSlide = 0
    slideProgress = scrollY / heroH
  } else {
    const afterHero = scrollY - heroH
    currentSlide = 1 + Math.floor(afterHero / slideH)
    slideProgress = (afterHero / slideH) - Math.floor(afterHero / slideH)
  }

  return { containerRef, totalHeight, currentSlide, slideProgress }
}

function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => { entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add('revealed') }) },
      { threshold: 0.15 }
    )
    el.querySelectorAll('.reveal').forEach((c) => obs.observe(c))
    return () => obs.disconnect()
  }, [])
  return ref
}

/* ───────────────────────────────────────────────
   Hook: auto-play animation when `play` becomes true.
   Returns 0→1 over `duration` ms, stays at 1 after.
   ─────────────────────────────────────────────── */
function useAutoPlay(play: boolean, duration: number) {
  const [progress, setProgress] = useState(0)
  const rafRef = useRef<number>()

  useEffect(() => {
    if (!play) { setProgress(0); return }
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      setProgress(t)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [play, duration])

  return progress
}

/* ───────────────────────────────────────────────
   Animated mini chart (canvas) — timer-driven
   ─────────────────────────────────────────────── */
function AnimatedChart({ play }: { play: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const progress = useAutoPlay(play, 3000)
  const prices = [0.32, 0.34, 0.37, 0.35, 0.40, 0.43, 0.41, 0.46, 0.50, 0.48, 0.53, 0.57, 0.55, 0.60, 0.64, 0.68, 0.72, 0.76, 0.80, 0.85]

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth, h = canvas.clientHeight
    canvas.width = w * dpr; canvas.height = h * dpr
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h)

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1
    for (let i = 1; i < 4; i++) { const y = (h / 4) * i; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }

    if (progress <= 0) return

    const count = prices.length
    const drawTo = progress * (count - 1) // fractional index to draw to
    const stepX = w / (count - 1)
    const minP = 0.25, maxP = 0.95
    const toY = (p: number) => h - ((p - minP) / (maxP - minP)) * h

    // Build path up to fractional point
    const points: [number, number][] = [[0, toY(prices[0])]]
    for (let i = 1; i <= Math.min(Math.floor(drawTo), count - 1); i++) {
      points.push([i * stepX, toY(prices[i])])
    }
    // Fractional last point
    const floorIdx = Math.floor(drawTo)
    const frac = drawTo - floorIdx
    if (frac > 0 && floorIdx < count - 1) {
      const interpPrice = prices[floorIdx] + (prices[floorIdx + 1] - prices[floorIdx]) * frac
      points.push([drawTo * stepX, toY(interpPrice)])
    }

    if (points.length < 2) return
    const lastPt = points[points.length - 1]

    // Gradient fill
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, 'rgba(52,199,89,0.15)'); grad.addColorStop(1, 'rgba(52,199,89,0)')
    ctx.beginPath()
    points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y))
    ctx.lineTo(lastPt[0], h); ctx.lineTo(0, h); ctx.closePath()
    ctx.fillStyle = grad; ctx.fill()

    // Line
    ctx.beginPath()
    points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y))
    ctx.strokeStyle = '#34C759'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke()

    // Dot
    ctx.beginPath(); ctx.arc(lastPt[0], lastPt[1], 4, 0, Math.PI * 2); ctx.fillStyle = '#34C759'; ctx.fill()
    ctx.beginPath(); ctx.arc(lastPt[0], lastPt[1], 8, 0, Math.PI * 2); ctx.fillStyle = 'rgba(52,199,89,0.25)'; ctx.fill()
  }, [progress, prices])

  return <canvas ref={canvasRef} className="w-full h-full" style={{ display: 'block' }} />
}

/* ───────────────────────────────────────────────
   Mock Market Card
   ─────────────────────────────────────────────── */
function MockMarketCard({ play, delay, title, emoji, words, selected }: {
  play: boolean; delay: number; title: string; emoji: string;
  words: { word: string; price: number }[]; selected?: boolean
}) {
  const p = useAutoPlay(play, 3000)
  const enterP = ease(sub(p, delay, delay + 0.4))
  const selectP = ease(sub(p, delay + 0.5, delay + 0.8))
  const isSelected = selected && selectP > 0
  return (
    <div className="glass rounded-2xl p-5 text-left cursor-pointer relative overflow-hidden" style={{
      opacity: enterP,
      transform: `translateY(${lerp(40, 0, enterP)}px) scale(${lerp(0.95, 1, enterP)})`,
      border: `1px solid rgba(52, 199, 89, ${selectP * 0.5})`,
      boxShadow: `0 0 ${selectP * 40}px rgba(52, 199, 89, ${selectP * 0.1}), inset 0 0 ${selectP * 30}px rgba(52,199,89,${selectP * 0.03})`,
    }}>
      {isSelected && <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(135deg, transparent 40%, rgba(52,199,89,0.06) 50%, transparent 60%)', animation: 'shimmerSlide 2s ease-in-out infinite' }} />}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-xl">{emoji}</div>
        <div>
          <h4 className="text-white text-sm font-semibold">{title}</h4>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">Open</span>
        </div>
      </div>
      <div className="space-y-2">
        {words.map((w, i) => { const bump = isSelected ? Math.sin(i * 1.5) * 0.03 : 0; const yesP = w.price + bump; return (
          <div key={w.word} className="flex items-center justify-between text-xs">
            <span className="text-neutral-300">{w.word}</span>
            <div className="flex gap-2"><span className="text-green-400 font-mono">{(yesP * 100).toFixed(0)}¢</span><span className="text-red-400 font-mono">{((1 - yesP) * 100).toFixed(0)}¢</span></div>
          </div>
        )})}
      </div>
      <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-[10px] text-neutral-500">
        <span>12 traders</span><span>{words.length} words</span>
      </div>
      {selected && <div className="absolute w-5 h-5 pointer-events-none" style={{ opacity: clamp01(sub(p, delay + 0.25, delay + 0.4)), bottom: '35%', right: '20%', transform: `translate(${lerp(30, 0, sub(p, delay + 0.25, delay + 0.4))}px, ${lerp(20, 0, sub(p, delay + 0.25, delay + 0.4))}px)` }}>
        <svg viewBox="0 0 320 512" fill="white" width="14" height="22"><path d="M0 55.2V426c0 12.2 9.9 22 22 22 6.3 0 12-2.6 16.2-6.8l81.8-86.8 61.8 144.2c2.8 6.6 10.5 9.6 17.1 6.8l40.8-17.2c6.6-2.8 9.6-10.5 6.8-17.1L184.9 327l113.8-3.2c12.2-.3 21.9-10.5 21.3-22.7-.3-6.3-3.2-11.9-7.8-15.8L32.9 37.5C19.4 26.7 0 36.2 0 55.2z" /></svg>
      </div>}
    </div>
  )
}

/* ───────────────────────────────────────────────
   Mock Word List
   ─────────────────────────────────────────────── */
function MockWordList({ play }: { play: boolean }) {
  const progress = useAutoPlay(play, 3500)
  const words = [
    { word: 'GG', yes: 0.42, no: 0.58, vol: '2.1k' },
    { word: 'nerf', yes: 0.35, no: 0.65, vol: '1.8k' },
    { word: 'clutch', yes: 0.61, no: 0.39, vol: '3.2k' },
    { word: 'ace', yes: 0.28, no: 0.72, vol: '890' },
  ]
  const hoverT = ease(sub(progress, 0.15, 0.8))
  const hoveredIdx = hoverT <= 0 ? -1 : hoverT < 0.3 ? 1 : hoverT < 0.6 ? 2 : 0
  const selectT = ease(sub(progress, 0.6, 0.85))
  const selectedIdx = selectT > 0 ? 0 : -1
  const priceT = ease(sub(progress, 0.75, 0.95))
  return (
    <div className="glass rounded-2xl p-5 w-full max-w-md mx-auto relative">
      <div className="flex items-center justify-between mb-3">
        <p className="text-neutral-500 text-[10px] uppercase tracking-wider font-semibold">Words in this market</p>
        <p className="text-neutral-600 text-[10px]">Click to trade</p>
      </div>
      <div className="space-y-1">
        <div className="flex items-center px-3 py-1.5 text-[10px] text-neutral-600 uppercase tracking-wider">
          <span className="flex-1">Word</span><span className="w-16 text-right">YES</span><span className="w-16 text-right">NO</span><span className="w-16 text-right">Volume</span>
        </div>
        {words.map((w, i) => {
          const rowEnter = ease(sub(progress, i * 0.1, 0.15 + i * 0.1))
          const isHovered = i === hoveredIdx, isSelected = i === selectedIdx
          const yesPrice = i === 0 ? lerp(w.yes, 0.45, priceT) : w.yes
          return (
            <div key={w.word} className="flex items-center px-3 py-2.5 rounded-lg cursor-pointer" style={{
              opacity: rowEnter, transform: `translateX(${lerp(-20, 0, rowEnter)}px)`,
              background: isSelected ? `rgba(52,199,89,${selectT * 0.1})` : isHovered ? 'rgba(255,255,255,0.04)' : 'transparent',
              border: isSelected ? `1px solid rgba(52,199,89,${selectT * 0.25})` : '1px solid transparent',
              transition: 'background 0.4s ease-out, border 0.4s ease-out',
            }}>
              <span className="flex-1 text-white text-sm font-medium">{w.word}</span>
              <span className="w-16 text-right text-sm font-mono" style={{ color: i === 0 && priceT > 0 ? `rgba(52,199,89,${0.8 + priceT * 0.2})` : 'rgba(52,199,89,0.8)', textShadow: i === 0 && priceT > 0 ? `0 0 ${priceT * 10}px rgba(52,199,89,${priceT * 0.5})` : 'none' }}>
                {(yesPrice * 100).toFixed(0)}¢
              </span>
              <span className="w-16 text-right text-red-400 text-sm font-mono">{((1 - yesPrice) * 100).toFixed(0)}¢</span>
              <span className="w-16 text-right text-neutral-500 text-xs font-mono">{w.vol}</span>
            </div>
          )
        })}
      </div>
      <div className="absolute w-5 h-5 pointer-events-none" style={{ opacity: sub(progress, 0.15, 0.25), right: '15%', top: `${lerp(55, 35, sub(progress, 0.2, 0.75))}%`, transition: 'top 0.6s ease-out' }}>
        <svg viewBox="0 0 320 512" fill="white" width="14" height="22"><path d="M0 55.2V426c0 12.2 9.9 22 22 22 6.3 0 12-2.6 16.2-6.8l81.8-86.8 61.8 144.2c2.8 6.6 10.5 9.6 17.1 6.8l40.8-17.2c6.6-2.8 9.6-10.5 6.8-17.1L184.9 327l113.8-3.2c12.2-.3 21.9-10.5 21.3-22.7-.3-6.3-3.2-11.9-7.8-15.8L32.9 37.5C19.4 26.7 0 36.2 0 55.2z" /></svg>
      </div>
    </div>
  )
}

/* ───────────────────────────────────────────────
   Mock Trading Panel
   ─────────────────────────────────────────────── */
function MockTradingPanel({ play }: { play: boolean }) {
  const progress = useAutoPlay(play, 4000)
  const yesT = ease(sub(progress, 0.05, 0.2))
  const amountT = ease(sub(progress, 0.2, 0.5))
  const amount = amountT > 0 ? Math.round(lerp(0, 50, amountT)) : 0
  const breakdownT = ease(sub(progress, 0.4, 0.6))
  const pressT = ease(sub(progress, 0.65, 0.75))
  const buttonPress = pressT > 0 && pressT < 1
  const confirmT = ease(sub(progress, 0.75, 0.95))
  const confirmed = confirmT > 0.5
  const avgPrice = 0.43
  const shares = amount > 0 ? +(amount / avgPrice).toFixed(1) : 0
  const profit = amount > 0 ? +(shares - amount).toFixed(1) : 0
  return (
    <div className="glass rounded-2xl p-5 w-full max-w-xs mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div><p className="text-neutral-500 text-[10px] uppercase tracking-wider mb-1">Selected word</p><p className="text-white font-semibold">&quot;GG&quot;</p></div>
        <div className="text-right"><p className="text-neutral-500 text-[10px]">Current price</p><p className="text-green-400 font-mono text-sm">42¢</p></div>
      </div>
      <div className="flex gap-1 mb-4 p-1 bg-white/5 rounded-lg">
        <div className="flex-1 text-center py-1.5 text-xs font-semibold rounded-md bg-white/10 text-white">Buy</div>
        <div className="flex-1 text-center py-1.5 text-xs font-semibold rounded-md text-neutral-500">Sell</div>
      </div>
      <div className="flex gap-2 mb-4">
        <button className="flex-1 py-2.5 rounded-lg text-xs font-semibold" style={{ background: `rgba(52,199,89,${yesT * 0.2})`, border: `1px solid rgba(52,199,89,${yesT * 0.5})`, color: yesT > 0.5 ? '#34C759' : '#a3a3a3', transform: `scale(${lerp(1, 1.05, yesT < 0.5 ? yesT * 2 : (1 - yesT) * 2)})` }}>YES 42¢</button>
        <button className="flex-1 py-2.5 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-neutral-500">NO 58¢</button>
      </div>
      <div className="mb-4">
        <p className="text-neutral-500 text-[10px] uppercase tracking-wider mb-1.5">Amount (tokens)</p>
        <div className="flex items-center bg-white/5 border rounded-lg px-3 py-2.5" style={{ borderColor: amount > 0 ? 'rgba(52,199,89,0.3)' : 'rgba(255,255,255,0.1)', transition: 'border-color 0.3s' }}>
          <span className="text-sm font-mono" style={{ color: amount > 0 ? 'white' : '#525252' }}>{amount || '0'}</span>
          {amountT > 0 && amountT < 1 && <span className="text-white ml-0.5" style={{ animation: 'blink 0.8s step-end infinite' }}>|</span>}
          <span className="ml-auto text-[10px] text-neutral-500">Play Tokens</span>
        </div>
      </div>
      <div className="space-y-1.5 mb-4 overflow-hidden" style={{ maxHeight: `${breakdownT * 120}px`, opacity: breakdownT }}>
        <div className="flex justify-between text-[11px]"><span className="text-neutral-500">Avg price</span><span className="text-neutral-300 font-mono">{avgPrice.toFixed(2)}</span></div>
        <div className="flex justify-between text-[11px]"><span className="text-neutral-500">Shares</span><span className="text-neutral-300 font-mono">{shares}</span></div>
        <div className="flex justify-between text-[11px]"><span className="text-neutral-500">Payout if correct</span><span className="text-green-400 font-mono">{shares} tokens</span></div>
        <div className="flex justify-between text-[11px]"><span className="text-neutral-500">Profit</span><span className="text-green-400 font-mono">+{profit} tokens</span></div>
      </div>
      <button className="w-full py-3 rounded-lg text-sm font-semibold" style={{ background: confirmed ? '#34C759' : amount > 0 ? 'white' : 'rgba(255,255,255,0.1)', color: confirmed ? 'white' : amount > 0 ? 'black' : '#525252', transform: `scale(${buttonPress ? lerp(1, 0.96, pressT) : 1})` }}>
        {confirmed ? '✓ Trade Placed!' : amount > 0 ? 'Place Trade' : 'Enter amount'}
      </button>
      <div className="mt-3 text-center" style={{ opacity: confirmT, transform: `translateY(${lerp(10, 0, confirmT)}px)` }}>
        <p className="text-green-400 text-xs font-medium">Bought {shares} YES shares of &quot;GG&quot;</p>
      </div>
    </div>
  )
}

/* ───────────────────────────────────────────────
   Mock Claim Panel
   ─────────────────────────────────────────────── */
function MockClaimPanel({ play }: { play: boolean }) {
  const progress = useAutoPlay(play, 4000)
  const resolveT = ease(sub(progress, 0.05, 0.3))
  const resolved = resolveT > 0.5
  const payoutT = ease(sub(progress, 0.25, 0.5))
  const claimT = ease(sub(progress, 0.45, 0.65))
  const claimReady = claimT > 0.5
  const claimedT = ease(sub(progress, 0.65, 0.9))
  const claimed = claimedT > 0.5
  return (
    <div className="glass rounded-2xl p-5 w-full max-w-sm mx-auto">
      <div className="mb-4">
        <p className="text-neutral-500 text-[10px] uppercase tracking-wider mb-3">Your position</p>
        <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
          <div><p className="text-white text-sm font-semibold">&quot;GG&quot;</p><p className="text-neutral-400 text-xs">116.2 YES shares</p></div>
          <div className="text-right"><p className="text-neutral-400 text-[10px]">Avg price</p><p className="text-white text-sm font-mono">0.43</p></div>
        </div>
      </div>
      <div className="mb-4 p-3 rounded-xl" style={{ background: `rgba(52,199,89,${resolveT * 0.08})`, border: `1px solid rgba(52,199,89,${resolveT * 0.2})` }}>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ background: `rgb(${lerp(82, 52, resolveT)},${lerp(82, 199, resolveT)},${lerp(82, 89, resolveT)})` }} />
          <p className="text-xs font-semibold" style={{ color: resolved ? '#34C759' : '#a3a3a3' }}>{resolved ? 'Resolved — YES ✓' : 'Awaiting resolution...'}</p>
        </div>
        <p className="text-neutral-500 text-[10px] ml-4">{resolved ? '"GG" was said during the broadcast' : 'Transcript will be checked after the event'}</p>
      </div>
      <div className="mb-4 space-y-1.5 overflow-hidden" style={{ maxHeight: `${payoutT * 120}px`, opacity: payoutT }}>
        <div className="flex justify-between text-[11px]"><span className="text-neutral-500">Your shares</span><span className="text-neutral-300 font-mono">116.2</span></div>
        <div className="flex justify-between text-[11px]"><span className="text-neutral-500">Cost basis</span><span className="text-neutral-300 font-mono">$50.00</span></div>
        <div className="flex justify-between text-[11px]"><span className="text-neutral-500">Payout</span><span className="text-green-400 font-mono">$116.20</span></div>
        <div className="flex justify-between text-[11px] pt-1 border-t border-white/5"><span className="text-neutral-400 font-medium">Profit</span><span className="text-green-400 font-semibold font-mono">+$66.20 (+132%)</span></div>
      </div>
      <button className="w-full py-3 rounded-lg text-sm font-semibold" style={{ background: claimed ? '#34C759' : claimReady ? 'linear-gradient(135deg, #34C759, #30d158)' : `rgba(255,255,255,${0.1 + claimT * 0.1})`, color: claimT > 0.3 ? 'white' : '#525252', transform: `scale(${lerp(1, 1.02, claimedT)})`, boxShadow: `0 0 ${claimT * 25}px rgba(52,199,89,${claimT * 0.2})` }}>
        {claimed ? '✓ Winnings Claimed!' : claimReady ? 'Claim Winnings' : 'Waiting for result...'}
      </button>
      <div className="mt-3 text-center" style={{ opacity: claimedT, transform: `translateY(${lerp(15, 0, claimedT)}px) scale(${lerp(0.95, 1, claimedT)})` }}>
        <p className="text-green-400 text-sm font-semibold">+$66.20 earned!</p>
        <p className="text-neutral-500 text-[10px] mt-0.5">33 points added to your score</p>
      </div>
    </div>
  )
}

/* ───────────────────────────────────────────────
   Mock Chart Section — self-contained auto-play
   ─────────────────────────────────────────────── */
function MockChartSection({ play }: { play: boolean }) {
  const p = useAutoPlay(play, 3500)
  const tipOpacity = ease(sub(p, 0.75, 0.95))
  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="glass rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div><p className="text-white text-sm font-semibold">&quot;GG&quot; — YES price</p><p className="text-neutral-500 text-xs">VCT Masters — Grand Final</p></div>
          <div className="flex items-center gap-1"><span className="text-green-400 text-lg font-mono font-bold">{Math.round(lerp(32, 85, ease(p)))}¢</span><span className="text-green-400 text-[10px]">▲</span></div>
        </div>
        <div className="h-48 md:h-56"><AnimatedChart play={play} /></div>
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
          <div className="flex gap-4 text-[10px] text-neutral-600"><span>1D</span><span className="text-white">1W</span><span>1M</span><span>All</span></div>
          <p className="text-neutral-600 text-[10px]">Updated live</p>
        </div>
      </div>
      <div className="mt-4 glass rounded-xl p-4 flex items-start gap-3" style={{ opacity: tipOpacity, transform: `translateY(${lerp(20, 0, tipOpacity)}px)` }}>
        <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0A84FF" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg></div>
        <div><p className="text-white text-xs font-semibold mb-0.5">Pro tip: You can sell early</p><p className="text-neutral-400 text-[11px]">If the price has gone up since you bought, sell your shares for a profit without waiting for the event to end.</p></div>
      </div>
    </div>
  )
}

/* ───────────────────────────────────────────────
   Social section mocks (unchanged)
   ─────────────────────────────────────────────── */
function MockLeaderboard() {
  const rows = [
    { rank: 1, name: 'degen_dave', emoji: '🏆', points: 14280, trades: 312 },
    { rank: 2, name: 'alpha_andy', emoji: '🥈', points: 11450, trades: 245 },
    { rank: 3, name: 'clutch_queen', emoji: '🥉', points: 9870, trades: 198 },
    { rank: 4, name: 'based_trader', emoji: '🎯', points: 8340, trades: 167 },
    { rank: 5, name: 'you', emoji: '👀', points: 7120, trades: 89 },
  ]
  return (
    <div className="glass rounded-2xl p-5 w-full">
      <div className="flex items-center justify-between mb-4"><h4 className="text-white text-sm font-semibold">Weekly Leaderboard</h4><span className="text-[10px] text-neutral-500 bg-white/5 px-2 py-1 rounded-md">This week</span></div>
      <div className="space-y-1">
        {rows.map((r) => { const isYou = r.name === 'you'; return (
          <div key={r.rank} className="flex items-center px-3 py-2.5 rounded-lg" style={{ background: isYou ? 'rgba(10,132,255,0.08)' : 'transparent', border: isYou ? '1px solid rgba(10,132,255,0.2)' : '1px solid transparent' }}>
            <span className="w-6 text-sm">{r.emoji}</span>
            <span className={`flex-1 text-sm font-medium ${isYou ? 'text-blue-400' : 'text-white'}`}>{r.name} {isYou && <span className="text-[10px] text-blue-400/60 ml-1">(you)</span>}</span>
            <span className="text-neutral-400 text-xs font-mono mr-4">{r.trades} trades</span>
            <span className="text-white text-sm font-mono font-semibold">{r.points.toLocaleString()}</span>
          </div>
        )})}
      </div>
    </div>
  )
}
function MockAchievements() {
  const achievements = [
    { icon: '🎯', name: 'First Shot', desc: 'Place your first trade', points: 150, unlocked: true },
    { icon: '🔥', name: 'On Fire', desc: 'Place 50 trades', points: 250, unlocked: true },
    { icon: '🎰', name: 'Hat Trick', desc: 'Win 3 trades', points: 150, unlocked: true },
    { icon: '👑', name: 'King of the Hill', desc: 'Win 10 trades', points: 400, unlocked: false },
    { icon: '💯', name: 'Centurion', desc: 'Place 100 trades', points: 500, unlocked: false },
    { icon: '💬', name: 'Say Something', desc: 'Send your first message', points: 50, unlocked: true },
  ]
  return (
    <div className="glass rounded-2xl p-5 w-full">
      <div className="flex items-center justify-between mb-4"><h4 className="text-white text-sm font-semibold">Achievements</h4><span className="text-[10px] text-green-400 font-mono">4/6 unlocked</span></div>
      <div className="grid grid-cols-2 gap-2">
        {achievements.map((a) => (
          <div key={a.name} className="p-3 rounded-xl relative overflow-hidden" style={{ background: a.unlocked ? 'rgba(52,199,89,0.06)' : 'rgba(255,255,255,0.03)', border: a.unlocked ? '1px solid rgba(52,199,89,0.15)' : '1px solid rgba(255,255,255,0.05)' }}>
            {!a.unlocked && <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px] flex items-center justify-center z-10"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#525252" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg></div>}
            <div className="text-lg mb-1">{a.icon}</div><p className="text-white text-xs font-semibold">{a.name}</p><p className="text-neutral-500 text-[10px]">{a.desc}</p><p className="text-green-400/70 text-[10px] font-mono mt-1">+{a.points} pts</p>
          </div>
        ))}
      </div>
    </div>
  )
}
function MockChat() {
  const messages = [
    { user: 'alpha_andy', emoji: '🥈', text: 'no way they say GG this early', time: '2m ago' },
    { user: 'clutch_queen', emoji: '🥉', text: 'buying YES on clutch rn', time: '1m ago' },
    { user: 'degen_dave', emoji: '🏆', text: 'prices are moving!!', time: '45s ago' },
    { user: 'you', emoji: '👀', text: 'just loaded up on GG YES', time: 'just now' },
  ]
  return (
    <div className="glass rounded-2xl p-5 w-full">
      <div className="flex items-center justify-between mb-4"><h4 className="text-white text-sm font-semibold">Market Chat</h4><div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-green-400" style={{ animation: 'pulse 2s infinite' }} /><span className="text-[10px] text-neutral-500">24 online</span></div></div>
      <div className="space-y-3">
        {messages.map((m, i) => { const isYou = m.user === 'you'; return (
          <div key={i} className="flex items-start gap-2">
            <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs shrink-0">{m.emoji}</div>
            <div className="flex-1 min-w-0"><div className="flex items-center gap-2"><span className={`text-xs font-semibold ${isYou ? 'text-blue-400' : 'text-white'}`}>{m.user}</span><span className="text-[10px] text-neutral-600">{m.time}</span></div><p className="text-neutral-300 text-xs">{m.text}</p></div>
          </div>
        )})}
      </div>
    </div>
  )
}
function MockPointsBreakdown() {
  const items = [
    { action: 'Trade placed', points: '+10', icon: '📈', count: '×89' },
    { action: 'First trade bonus', points: '+100', icon: '🎯', count: '×1' },
    { action: 'Position held 24h', points: '+30', icon: '💎', count: '×12' },
    { action: 'Won a market', points: '+50', icon: '🏆', count: '×8' },
    { action: 'Chat messages', points: '+2', icon: '💬', count: '×47' },
    { action: 'Achievement unlocks', points: 'varies', icon: '⭐', count: '×4' },
  ]
  return (
    <div className="glass rounded-2xl p-5 w-full">
      <h4 className="text-white text-sm font-semibold mb-4">How Points Work</h4>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.action} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.02]">
            <span className="text-sm">{item.icon}</span><span className="flex-1 text-neutral-300 text-xs">{item.action}</span><span className="text-neutral-500 text-[10px] font-mono">{item.count}</span><span className="text-green-400 text-xs font-mono font-semibold">{item.points}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between"><span className="text-neutral-400 text-xs font-semibold">Your total</span><span className="text-white text-lg font-mono font-bold">7,120 pts</span></div>
    </div>
  )
}


/* ═══════════════════════════════════════════════
   SLIDE DEFINITIONS
   ═══════════════════════════════════════════════ */
const SLIDES = [
  { step: 1, label: 'The trade flow', title: 'Pick a market', desc: 'Every market is tied to a live event — a stream, a podcast, a tournament. Each one has a set of words you can trade on.' },
  { step: 2, label: 'The trade flow', title: 'Browse the words', desc: 'Each market has a list of words with live prices. YES means you think it\'ll be said. Prices move with the crowd.' },
  { step: 3, label: 'The trade flow', title: 'Place your trade', desc: 'Pick YES or NO, enter your amount, and see exactly what you\'ll win before you confirm.' },
  { step: 4, label: 'The trade flow', title: 'Watch prices move', desc: 'Prices update in real time as the event unfolds. Sell anytime to lock in profit — or hold until resolution.' },
  { step: 5, label: 'The trade flow', title: 'Collect your winnings', desc: 'Event ends, transcript is checked. If your word was said and you held YES — you win. One click to claim.' },
]

const TOTAL_SLIDES = SLIDES.length + 1 // +1 for hero
const VH_PER_SLIDE = 130 // scroll distance per content slide
const HERO_VH = 60 // hero scrolls away faster


/* ═══════════════════════════════════════════════
   HOMEPAGE
   ═══════════════════════════════════════════════ */
export default function Home() {
  const revealRef = useScrollReveal()
  const { containerRef, totalHeight, currentSlide, slideProgress } = useGlobalScroll(HERO_VH, VH_PER_SLIDE, SLIDES.length)

  // Slide transition: outgoing slides left, incoming slides from right
  // 25% of scroll for crossfade = longer, smoother transition
  function slideStyle(slideIdx: number): { opacity: number; translateX: number } {
    if (slideIdx === currentSlide) {
      const exitT = ease(sub(slideProgress, 0.75, 1.0))
      return { opacity: 1 - exitT, translateX: lerp(0, -60, exitT) }
    }
    if (slideIdx === currentSlide + 1) {
      const enterT = ease(sub(slideProgress, 0.75, 1.0))
      return { opacity: enterT, translateX: lerp(60, 0, enterT) }
    }
    return { opacity: 0, translateX: 0 }
  }

  const heroStyle = slideStyle(0)

  return (
    <div className="relative min-h-screen w-full bg-black" style={{ overflowX: 'clip' }}>
      {/* Header — normal flow, same as every other page */}
      <div className="relative z-50 px-4 md:px-10 lg:px-20 flex justify-center">
        <div className="w-full max-w-7xl"><Header /></div>
      </div>

      {/* Scroll runway — this is the only thing that has height */}
      <div ref={containerRef} style={{ height: totalHeight }}>

        {/* Fixed viewport — always centered on screen */}
        <div className="fixed inset-0 z-10 flex items-center justify-center pointer-events-none px-4 md:px-10 py-16 md:py-20">
          <div className="w-full max-w-5xl mx-auto pointer-events-auto max-h-full overflow-y-auto overflow-x-hidden scrollbar-hide">

            {/* HERO */}
            {heroStyle.opacity > 0 && (
              <div className="absolute inset-0 flex items-center justify-center px-4 md:px-10" style={{ opacity: heroStyle.opacity, transform: `translateX(${heroStyle.translateX}px)` }}>
                <div>
                  <section className="flex flex-col items-center justify-center text-center">
                    <Image src="/src/img/White Icon.svg" alt="Mentioned" width={56} height={56} className="h-10 md:h-14 w-auto mb-6 md:mb-8" style={{ animation: 'fadeSlideUp 0.8s ease-out both' }} priority />
                    <h1 className="text-3xl md:text-6xl lg:text-7xl font-bold text-white leading-[1.1] tracking-tight hero-title">Trade on what gets said.</h1>
                    <p className="mt-4 md:mt-6 text-neutral-400 text-base md:text-xl max-w-lg hero-subtitle">Prediction markets for live broadcasts.<br />Pick words. Trade against friends. Win.</p>
                    <div className="mt-8 md:mt-10 flex items-center gap-3 hero-cta">
                      <Link href="/markets" className="h-10 md:h-12 px-6 md:px-8 bg-white text-black text-sm font-semibold rounded-lg hover:bg-neutral-100 transition-all duration-200 shadow-button inline-flex items-center">Browse Markets</Link>
                      <Link href="/leaderboard" className="h-10 md:h-12 px-6 md:px-8 glass text-white text-sm font-semibold rounded-lg hover:bg-white/10 transition-all duration-200 inline-flex items-center">Leaderboard</Link>
                    </div>
                    <div className="mt-12 flex flex-col items-center gap-2">
                      <p className="text-neutral-600 text-xs tracking-wide">Scroll to see how it works</p>
                      <div className="scroll-bounce"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-neutral-600"><path d="M12 5v14M5 12l7 7 7-7" /></svg></div>
                    </div>
                  </section>
                </div>
              </div>
            )}

            {/* SLIDES 1-5 */}
            {SLIDES.map((slide, i) => {
              const idx = i + 1 // slide 0 is hero
              const { opacity, translateX } = slideStyle(idx)
              const isPlaying = currentSlide === idx || currentSlide > idx
              if (opacity <= 0) return null
              return (
                <div key={idx} className="absolute inset-0 flex items-center justify-center px-4 md:px-10 py-16 md:py-20" style={{ opacity, transform: `translateX(${translateX}px)` }}>
                  <div className="w-full max-w-5xl mx-auto max-h-full overflow-y-auto overflow-x-hidden scrollbar-hide">
                    <div className="text-center mb-4 md:mb-6">
                      <div className="inline-flex items-center gap-2 mb-1 md:mb-2">
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">{slide.label}</span>
                        <span className="text-neutral-700 text-[10px]">{slide.step} / 5</span>
                      </div>
                      <h2 className="text-xl md:text-4xl font-bold text-white mb-1.5 md:mb-2">{slide.title}</h2>
                      <p className="text-neutral-400 text-xs md:text-base max-w-xl mx-auto">{slide.desc}</p>
                    </div>

                    {/* Slide content — animations auto-play on enter */}
                    {idx === 1 && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-4xl mx-auto">
                        <MockMarketCard play={isPlaying} delay={0.05} selected title="VCT Masters — Grand Final" emoji="🎮" words={[{ word: 'GG', price: 0.42 }, { word: 'nerf', price: 0.35 }, { word: 'clutch', price: 0.61 }, { word: 'ace', price: 0.28 }]} />
                        <div className="hidden md:block"><MockMarketCard play={isPlaying} delay={0.15} title="Joe Rogan #2189" emoji="🎙️" words={[{ word: 'simulation', price: 0.55 }, { word: 'DMT', price: 0.72 }, { word: 'aliens', price: 0.38 }]} /></div>
                        <div className="hidden md:block"><MockMarketCard play={isPlaying} delay={0.25} title="League Worlds — Semifinals" emoji="⚔️" words={[{ word: 'pentakill', price: 0.15 }, { word: 'baron', price: 0.82 }, { word: 'backdoor', price: 0.22 }]} /></div>
                      </div>
                    )}
                    {idx === 2 && <div className="flex justify-center"><MockWordList play={isPlaying} /></div>}
                    {idx === 3 && <div className="flex justify-center"><MockTradingPanel play={isPlaying} /></div>}
                    {idx === 4 && <MockChartSection play={isPlaying} />}
                    {idx === 5 && <div className="flex justify-center"><MockClaimPanel play={isPlaying} /></div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Normal-flow content after the scroll-driven section */}
      <div ref={revealRef} className="relative z-20 px-4 md:px-10 lg:px-20 flex justify-center">
        <div className="w-full max-w-7xl">
          <section className="py-16 md:py-32 border-t border-white/10">
            <div className="flex flex-col items-center text-center gap-10 md:gap-16">
              <div className="reveal reveal-up">
                <p className="text-neutral-500 text-xs font-semibold uppercase tracking-widest mb-4">More than trading</p>
                <h2 className="text-xl md:text-4xl font-bold text-white mb-3">Compete. Climb. Flex.</h2>
                <p className="text-neutral-400 text-base md:text-lg max-w-xl mx-auto">Every trade earns you points. Rack up achievements, climb the weekly leaderboard, and talk trash in market chat.<br />Trading is just the start.</p>
              </div>
              <div className="reveal reveal-up stagger-1 grid grid-cols-1 md:grid-cols-2 gap-5 w-full max-w-4xl"><MockPointsBreakdown /><MockLeaderboard /></div>
              <div className="reveal reveal-up stagger-2 grid grid-cols-1 md:grid-cols-2 gap-5 w-full max-w-4xl"><MockAchievements /><MockChat /></div>
              <div className="reveal reveal-up stagger-3 grid grid-cols-2 md:grid-cols-4 gap-3 w-full max-w-4xl">
                {[{ icon: '📊', stat: '10+', label: 'Points per trade' }, { icon: '🏅', stat: '15+', label: 'Achievements' }, { icon: '📈', stat: 'Weekly', label: 'Leaderboard resets' }, { icon: '💬', stat: 'Live', label: 'Market chat' }].map((s) => (
                  <div key={s.label} className="glass rounded-xl p-5 text-center"><div className="text-2xl mb-2">{s.icon}</div><p className="text-white text-lg font-bold font-mono">{s.stat}</p><p className="text-neutral-500 text-[10px] uppercase tracking-wider mt-1">{s.label}</p></div>
                ))}
              </div>
            </div>
          </section>
          <section className="py-24 md:py-32 border-t border-white/10">
            <div className="flex flex-col items-center text-center gap-16">
              <div className="reveal reveal-up">
                <p className="text-neutral-500 text-xs font-semibold uppercase tracking-widest mb-4">Two ways to play</p>
                <h2 className="text-2xl md:text-4xl font-bold text-white">Pick your style.</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 w-full max-w-3xl">
                <div className="reveal reveal-left glass rounded-2xl p-7 text-left">
                  <div className="flex items-center gap-2 mb-3"><div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center"><span className="text-base">⛓️</span></div><h3 className="text-white text-base font-semibold">On-chain markets</h3></div>
                  <p className="text-neutral-400 text-sm mb-3">Real SOL. Every trade is on Solana. Connect your Phantom wallet and trade with real stakes.</p>
                  <div className="flex gap-2"><span className="text-[10px] bg-white/5 text-neutral-400 px-2 py-1 rounded-md">Solana</span><span className="text-[10px] bg-white/5 text-neutral-400 px-2 py-1 rounded-md">Real SOL</span><span className="text-[10px] bg-white/5 text-neutral-400 px-2 py-1 rounded-md">Verifiable</span></div>
                </div>
                <div className="reveal reveal-right glass rounded-2xl p-7 text-left">
                  <div className="flex items-center gap-2 mb-3"><div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center"><span className="text-base">🎮</span></div><h3 className="text-white text-base font-semibold">Free markets</h3></div>
                  <p className="text-neutral-400 text-sm mb-3">Play tokens, no money needed. Same trading mechanics. Profit converts to platform points and leaderboard rank.</p>
                  <div className="flex gap-2"><span className="text-[10px] bg-white/5 text-neutral-400 px-2 py-1 rounded-md">Free</span><span className="text-[10px] bg-white/5 text-neutral-400 px-2 py-1 rounded-md">Play tokens</span><span className="text-[10px] bg-white/5 text-neutral-400 px-2 py-1 rounded-md">Points</span></div>
                </div>
              </div>
            </div>
          </section>
          <section className="py-24 md:py-32 border-t border-white/10">
            <div className="reveal reveal-scale flex flex-col items-center text-center">
              <h2 className="text-2xl md:text-4xl font-bold text-white mb-3">Markets are live.</h2>
              <p className="text-neutral-400 text-base mb-8">Now you know how it works. Jump in.</p>
              <div className="flex items-center gap-3">
                <Link href="/markets" className="h-12 px-8 bg-white text-black text-sm font-semibold rounded-lg hover:bg-neutral-100 transition-all duration-200 shadow-button inline-flex items-center">Start Trading</Link>
                <Link href="/leaderboard" className="h-12 px-8 glass text-white text-sm font-semibold rounded-lg hover:bg-white/10 transition-all duration-200 inline-flex items-center">View Leaderboard</Link>
              </div>
            </div>
          </section>
          <Footer />
        </div>
      </div>

      <style jsx>{`
        .hero-title { animation: fadeSlideUp 0.8s ease-out 0.15s both; }
        .hero-subtitle { animation: fadeSlideUp 0.8s ease-out 0.35s both; }
        .hero-cta { animation: fadeSlideUp 0.8s ease-out 0.55s both; }
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
        .scroll-bounce { animation: bounce 2s ease-in-out infinite; }
        @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(8px); } }
        @keyframes blink { 50% { opacity: 0; } }
        @keyframes shimmerSlide { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .reveal { opacity: 0; transition: opacity 0.7s ease-out, transform 0.7s ease-out; }
        .reveal.reveal-up { transform: translateY(50px); }
        .reveal.reveal-left { transform: translateX(-50px); }
        .reveal.reveal-right { transform: translateX(50px); }
        .reveal.reveal-scale { transform: scale(0.9); }
        .reveal.revealed { opacity: 1; transform: translateY(0) translateX(0) scale(1); }
        .stagger-1 { transition-delay: 0.12s; }
        .stagger-2 { transition-delay: 0.24s; }
        .stagger-3 { transition-delay: 0.36s; }
      `}</style>
    </div>
  )
}
