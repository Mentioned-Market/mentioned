'use client'

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from 'react'
import Link from 'next/link'

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

const CONFETTI_COLORS = [
  '#007AFF', // apple-blue
  '#34C759', // apple-green
  '#FF9500', // apple-orange
  '#FF375F', // pink
  '#FFD60A', // yellow
  '#5E5CE6', // purple
  '#ffffff',
]

const CONFETTI_COUNT = 36

interface ConfettiPiece {
  id: number
  color: string
  left: number   // %
  size: number   // px
  duration: number // s
  delay: number    // s
  shape: 'rect' | 'circle'
}

function useConfettiPieces() {
  return useMemo<ConfettiPiece[]>(() => {
    return Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
      id: i,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      left: 5 + (i / CONFETTI_COUNT) * 90 + (Math.sin(i * 2.4) * 5),
      size: 6 + (i % 4) * 2,
      duration: 1.1 + (i % 5) * 0.15,
      delay: (i % 8) * 0.06,
      shape: i % 3 === 0 ? 'circle' : 'rect',
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

function Confetti() {
  const pieces = useConfettiPieces()
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-2xl">
      {pieces.map(p => (
        <div
          key={p.id}
          className="absolute top-0 animate-confetti-fall"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.shape === 'circle' ? p.size : p.size * 0.5,
            backgroundColor: p.color,
            borderRadius: p.shape === 'circle' ? '50%' : '2px',
            '--confetti-duration': `${p.duration}s`,
            '--confetti-delay': `${p.delay}s`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  )
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
        timerRef.current = setTimeout(dismiss, 4000)
      } else {
        setCurrent(null)
      }
    }, 400)
  }, [])

  const showAchievementToast = useCallback(
    (achievement: AchievementToastData) => {
      if (current) {
        queueRef.current.push(achievement)
      } else {
        setCurrent(achievement)
        setVisible(true)
        timerRef.current = setTimeout(dismiss, 4000)
      }
    },
    [current, dismiss],
  )

  return (
    <AchievementContext.Provider value={{ showAchievementToast }}>
      {children}
      {current && (
        <div
          onClick={dismiss}
          className={`fixed inset-0 z-[9999] flex items-center justify-center cursor-pointer transition-opacity duration-400 ${
            visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

          {/* Toast card */}
          <div
            className={`relative flex flex-col items-center gap-4 rounded-2xl border border-white/15 bg-neutral-900/98 px-10 py-7 shadow-2xl transition-transform duration-500 overflow-hidden max-w-xs w-full mx-4 ${
              visible ? 'scale-100 animate-achievement-in' : 'scale-75'
            }`}
          >
            <Confetti />

            <span className="text-6xl animate-achievement-emoji relative z-10 drop-shadow-lg">
              {current.emoji}
            </span>

            <div className="text-center relative z-10">
              <p className="text-xs font-bold uppercase tracking-widest text-apple-green mb-1.5">
                Achievement Unlocked
              </p>
              <p className="text-xl font-bold text-white">{current.title}</p>
              <p className="text-sm font-semibold text-apple-blue mt-1">+{current.points} pts</p>
            </div>

            <div className="relative z-10 w-full border-t border-white/10 pt-3 text-center" onClick={e => e.stopPropagation()}>
              <Link
                href="/profile"
                onClick={dismiss}
                className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                View all achievements on your profile
              </Link>
            </div>
          </div>
        </div>
      )}
    </AchievementContext.Provider>
  )
}
