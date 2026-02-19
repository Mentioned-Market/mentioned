import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Join Waitlist - Mentioned Markets | Early Access to Mention Trading',
  description: 'Join the Mentioned waitlist for early access to mention markets. Be the first to trade predictions on what gets mentioned in speeches, podcasts, and events. Join Mentioned markets now.',
  keywords: [
    'mentioned waitlist',
    'mention markets signup',
    'mentioned early access',
    'join mentioned',
    'mentioned platform access',
    'mention markets beta',
    'mentioned markets waitlist',
    'prediction markets signup',
    'mentioned registration',
    'get mentioned access'
  ],
  openGraph: {
    title: 'Join the Mentioned Waitlist - Early Access to Mention Markets',
    description: 'Get early access to Mentioned, the premier mention markets platform. Join our waitlist to trade predictions on mentions.',
    url: 'https://mentioned.market/waitlist',
    siteName: 'Mentioned - Mention Markets',
    images: [
      {
        url: '/src/img/White Icon.svg',
        width: 1200,
        height: 630,
        alt: 'Join Mentioned - Mention Markets Waitlist',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Join the Mentioned Waitlist - Early Access to Mention Markets',
    description: 'Get early access to Mentioned, the premier mention markets platform.',
    images: ['/src/img/White Icon.svg'],
  },
  alternates: {
    canonical: 'https://mentioned.market/waitlist',
  },
}

export default function WaitlistLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}

