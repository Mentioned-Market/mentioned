import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Mentioned - Mention Markets | Trade Predictions on What Gets Said',
  description: 'Mentioned is the premier mention markets platform. Trade predictions on what words get mentioned in speeches, podcasts, earnings calls, and events. Join Mentioned markets today.',
  keywords: [
    'mentioned',
    'mention markets',
    'mentioned markets',
    'mentioned platform',
    'prediction markets',
    'speech prediction markets',
    'mention trading',
    'mentioned.markets',
    'bet on mentions',
    'prediction trading platform',
    'event prediction markets',
    'speech betting',
    'podcast predictions',
    'earnings call predictions'
  ],
  openGraph: {
    title: 'Mentioned - The Premier Mention Markets Platform',
    description: 'Trade predictions on what gets mentioned. Mentioned is the leading mention markets platform for speeches, podcasts, and events.',
    url: 'https://mentioned.markets',
  },
  alternates: {
    canonical: 'https://mentioned.markets',
  },
}

export default function HomeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}

