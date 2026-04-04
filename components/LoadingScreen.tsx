'use client'

import MentionedSpinner from '@/components/MentionedSpinner'

interface Props {
  fading?: boolean
}

export default function LoadingScreen({ fading = false }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black flex items-center justify-center"
      style={{
        opacity: fading ? 0 : 1,
        transition: fading ? 'opacity 0.45s ease' : 'none',
        pointerEvents: fading ? 'none' : 'all',
      }}
    >
      <MentionedSpinner className="" />
    </div>
  )
}
