import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Mention Markets - Browse & Trade Live Prediction Markets',
  description: 'Browse all mention markets on Mentioned. Trade YES or NO positions on what words get mentioned in speeches, podcasts, earnings calls, and live events. Decentralized on Solana.',
  keywords: [
    'mention markets',
    'mention trading',
    'prediction markets',
    'speech prediction markets',
    'podcast prediction markets',
    'mention markets platform',
    'trade mentions',
    'word prediction markets',
    'live mention markets',
    'solana prediction markets',
  ],
  openGraph: {
    title: 'Mention Markets - Browse & Trade Live Predictions | Mentioned',
    description: 'Browse all mention markets. Trade predictions on what words get mentioned in speeches, podcasts, earnings calls, and live events.',
    url: 'https://mentioned.market/markets',
  },
  alternates: {
    canonical: 'https://mentioned.market/markets',
  },
}

export default function MarketsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
