'use client'

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from 'react'

export interface AchievementToastData {
  id: string
  emoji: string
  title: string
  points: number
}

interface AchievementContextType {
  showAchievementToast: (achievement: AchievementToastData) => void
}

const AchievementContext = createContext<AchievementContextType>({
  showAchievementToast: () => {},
})

export function useAchievements() {
  return useContext(AchievementContext)
}

// ── Confetti ─────────────────────────────────────────────

const COLORS = [
  '#007AFF', '#34C759', '#FF9500', '#FF375F',
  '#FFD60A', '#5E5CE6', '#ffffff', '#FF6B6B',
  '#4ECDC4', '#FF9F0A', '#30D158', '#64D2FF',
]
const COUNT = 120

interface Piece {
  id: number
  x: number
  delay: number
  duration: number
  color: string
  size: number
  drift: number
  rise: number
  rot: number
  shape: 'rect' | 'circle' | 'ribbon'
}

function makeConfetti(): Piece[] {
  return Array.from({ length: COUNT }, (_, i) => {
    // Fan out from bottom-center
    const spread = ((i / COUNT) * 2 - 1) * 55   // -55vw to +55vw from center
    const centerX = 50 + spread + (Math.sin(i * 1.9) * 8)
    return {
      id: i,
      x: Math.max(2, Math.min(98, centerX)),
      delay: Math.floor(i * 12 + Math.sin(i * 0.8) * 60),
      duration: 1400 + Math.floor(Math.abs(Math.sin(i * 0.5)) * 700 + i * 8),
      color: COLORS[i % COLORS.length],
      size: 6 + (i % 5) * 2,
      drift: (i % 2 === 0 ? 1 : -1) * (10 + (i % 50)),
      rise: 55 + Math.abs(Math.sin(i * 0.6)) * 55 + (i % 40),   // 55–150 vh upward
      rot: 180 + (i % 3) * 180,
      shape: i % 5 === 0 ? 'circle' : i % 8 === 0 ? 'ribbon' : 'rect',
    }
  })
}

function Confetti({ visible }: { visible: boolean }) {
  const pieces = useRef(makeConfetti())

  if (!visible) return null

  return (
    <div className="fixed inset-0 pointer-events-none z-[9998] overflow-hidden">
      {pieces.current.map(p => (
        <div
          key={p.id}
          style={{
            position: 'absolute',
            left: `${p.x}%`,
            bottom: '-12px',
            width: p.shape === 'ribbon' ? p.size * 0.35 : p.size,
            height: p.shape === 'ribbon' ? p.size * 3 : p.shape === 'circle' ? p.size : p.size * 0.55,
            backgroundColor: p.color,
            borderRadius: p.shape === 'circle' ? '50%' : p.shape === 'ribbon' ? '2px' : '1px',
            opacity: 0,
            animation: `confettiUp ${p.duration}ms cubic-bezier(0.2, 0.8, 0.4, 1) ${p.delay}ms forwards`,
            '--rise': `-${p.rise}vh`,
            '--drift': `${p.drift}px`,
            '--rot': `${p.rot}deg`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  )
}

// ── Global style injection ────────────────────────────────

const STYLE = `
@keyframes confettiUp {
  0%   { transform: translateY(0) translateX(0) rotate(0deg); opacity: 1; }
  65%  { opacity: 1; }
  100% { transform: translateY(var(--rise)) translateX(var(--drift)) rotate(var(--rot)); opacity: 0; }
}
@keyframes achCardIn {
  0%   { opacity: 0; transform: scale(0.8) translateY(40px); }
  60%  { opacity: 1; transform: scale(1.03) translateY(-4px); }
  80%  { transform: scale(0.99) translateY(1px); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes achEmojiIn {
  0%   { transform: scale(0.4) rotate(-15deg); opacity: 0; }
  55%  { transform: scale(1.25) rotate(8deg); opacity: 1; }
  75%  { transform: scale(0.95) rotate(-3deg); }
  100% { transform: scale(1) rotate(0deg); opacity: 1; }
}
@keyframes achPulse {
  0%, 100% { opacity: 0.25; transform: scale(1); }
  50%       { opacity: 0.45; transform: scale(1.08); }
}
@keyframes achShimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(200%); }
}
`

function GlobalStyle() {
  useEffect(() => {
    const id = 'achievement-styles'
    if (!document.getElementById(id)) {
      const el = document.createElement('style')
      el.id = id
      el.textContent = STYLE
      document.head.appendChild(el)
    }
  }, [])
  return null
}

// ── Provider ─────────────────────────────────────────────

export function AchievementProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<AchievementToastData | null>(null)
  const [visible, setVisible] = useState(false)
  const queueRef = useRef<AchievementToastData[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismiss = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    setVisible(false)
    setTimeout(() => {
      const next = queueRef.current.shift()
      if (next) {
        setCurrent(next)
        setVisible(true)
        timerRef.current = setTimeout(dismiss, 4500)
      } else {
        setCurrent(null)
      }
    }, 350)
  }, [])

  const showAchievementToast = useCallback(
    (achievement: AchievementToastData) => {
      if (current) {
        queueRef.current.push(achievement)
      } else {
        setCurrent(achievement)
        setVisible(true)
        timerRef.current = setTimeout(dismiss, 4500)
      }
    },
    [current, dismiss],
  )

  return (
    <AchievementContext.Provider value={{ showAchievementToast }}>
      <GlobalStyle />
      {children}
      <Confetti visible={visible} />
      {current && (
        <div
          onClick={dismiss}
          className={`fixed inset-0 z-[9999] flex items-center justify-center cursor-pointer transition-opacity duration-300 ${
            visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          {/* Card */}
          <div
            className="relative w-full max-w-xs mx-4 overflow-hidden rounded-2xl shadow-2xl"
            style={{
              animation: visible ? 'achCardIn 0.55s cubic-bezier(0.34, 1.4, 0.64, 1) both' : undefined,
              background: 'linear-gradient(160deg, #1c1c1e 0%, #111113 100%)',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.05), 0 24px 48px rgba(0,0,0,0.6), 0 0 60px rgba(52,199,89,0.12)',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Top accent bar */}
            <div
              className="h-1 w-full"
              style={{ background: 'linear-gradient(90deg, #007AFF, #34C759, #FFD60A)' }}
            />

            {/* Shimmer sweep */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ overflow: 'hidden' }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '40%',
                  height: '100%',
                  background: 'linear-gradient(105deg, transparent 20%, rgba(255,255,255,0.055) 50%, transparent 80%)',
                  animation: 'achShimmer 1.8s ease-in-out 0.3s both',
                }}
              />
            </div>

            {/* Main content */}
            <div className="flex flex-col items-center px-8 pt-7 pb-6 gap-4">

              {/* Emoji with glow ring */}
              <div className="relative flex items-center justify-center w-24 h-24">
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: 'radial-gradient(circle, rgba(52,199,89,0.2) 0%, transparent 70%)',
                    animation: 'achPulse 2s ease-in-out infinite',
                  }}
                />
                <div
                  className="absolute inset-2 rounded-full"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                />
                <span
                  className="relative text-5xl select-none"
                  style={{ animation: 'achEmojiIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both' }}
                >
                  {current.emoji}
                </span>
              </div>

              {/* Text */}
              <div className="text-center">
                <p
                  className="text-[10px] font-bold uppercase tracking-[0.2em] mb-2"
                  style={{ color: '#34C759' }}
                >
                  Achievement Unlocked
                </p>
                <p className="text-xl font-bold text-white leading-tight">{current.title}</p>
                <p
                  className="text-sm font-bold mt-2 tabular-nums"
                  style={{ color: '#007AFF' }}
                >
                  +{current.points} pts
                </p>
              </div>
            </div>

            {/* Dismiss hint */}
            <div className="pb-4 text-center">
              <span className="text-[10px] text-neutral-700">tap anywhere to dismiss</span>
            </div>
          </div>
        </div>
      )}
    </AchievementContext.Provider>
  )
}
