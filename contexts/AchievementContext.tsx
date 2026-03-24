'use client'

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
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

export function AchievementProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<AchievementToastData | null>(null)
  const [visible, setVisible] = useState(false)
  const queueRef = useRef<AchievementToastData[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismiss = useCallback(() => {
    // Clear auto-dismiss timer
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }

    setVisible(false)
    // After fade-out, show next or clear
    setTimeout(() => {
      const next = queueRef.current.shift()
      if (next) {
        setCurrent(next)
        setVisible(true)
        timerRef.current = setTimeout(dismiss, 3500)
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
        timerRef.current = setTimeout(dismiss, 3500)
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
            visible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

          {/* Toast card */}
          <div
            className={`relative flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-neutral-900/95 px-8 py-6 shadow-2xl transition-transform duration-500 ${
              visible ? 'scale-100 animate-achievement-in' : 'scale-75'
            }`}
          >
            <span className="text-5xl animate-achievement-emoji">{current.emoji}</span>
            <div className="text-center">
              <p className="text-xs font-bold uppercase tracking-widest text-apple-green mb-1">
                Achievement Unlocked
              </p>
              <p className="text-lg font-bold text-white">{current.title}</p>
              <p className="text-sm text-neutral-400 mt-1">+{current.points} pts</p>
            </div>
          </div>
        </div>
      )}
    </AchievementContext.Provider>
  )
}
