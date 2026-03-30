import type { Metadata } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'
import WalletProviderWrapper from '@/components/WalletProviderWrapper'
import GlobalChat from '@/components/GlobalChat'
import BugReportButton from '@/components/BugReportButton'
import TradeTicker from '@/components/TradeTicker'
import { faqSchema, webApplicationSchema } from '@/lib/seo-schemas'

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL('https://mentioned.market'),
  title: {
    default: 'Mention Markets | Mentioned - Trade Predictions on What Gets Said',
    template: '%s | Mentioned'
  },
  description: 'Mentioned is the premier mention markets platform. Trade predictions on what words get mentioned in speeches, podcasts, events & more. Join Mentioned markets today - the future of prediction markets.',
  keywords: [
    'mentioned',
    'mention markets',
    'mentioned markets',
    'mentioned platform',
    'prediction markets',
    'mentioned.market',
    'mention trading',
    'speech prediction markets',
    'word prediction platform',
    'mentioned crypto',
    'solana prediction markets',
    'decentralized prediction markets',
    'bet on mentions',
    'trade mentions',
    'event prediction trading',
    'speech betting markets',
    'podcast prediction markets',
    'earnings call predictions',
    'political speech markets',
    'mention betting',
    'word occurrence markets',
    'mentioned app',
    'mentioned protocol',
    'mention speculation',
    'predictive mention trading'
  ],
  authors: [{ name: 'Mentioned Markets' }],
  creator: 'Mentioned',
  publisher: 'Mentioned Markets',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  icons: {
    icon: '/src/img/White Icon.svg',
    shortcut: '/src/img/White Icon.svg',
    apple: '/src/img/White Icon.svg',
  },
  manifest: '/manifest.json',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://mentioned.market',
    siteName: 'Mentioned - Mention Markets',
    title: 'Mention Markets | Mentioned - Trade Predictions on What Gets Said',
    description: 'Mentioned is the premier mention markets platform. Trade predictions on what words get mentioned in speeches, podcasts, events & more. Join Mentioned markets today.',
    images: [
      {
        url: '/src/img/White Icon.svg',
        width: 1200,
        height: 630,
        alt: 'Mention Markets Platform - Mentioned',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@mentionedmarket',
    creator: '@mentionedmarket',
    title: 'Mention Markets | Mentioned - Trade Predictions on What Gets Said',
    description: 'Mentioned is the premier mention markets platform. Trade predictions on what words get mentioned in speeches, podcasts, events & more.',
    images: ['/src/img/White Icon.svg'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
    google: 'your-google-verification-code',
    yandex: 'your-yandex-verification-code',
  },
  alternates: {
    canonical: 'https://mentioned.market',
  },
  category: 'finance',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Mentioned',
    alternateName: ['Mentioned Markets', 'Mention Markets'],
    url: 'https://mentioned.market',
    logo: 'https://mentioned.market/src/img/White%20Icon.svg',
    description: 'Mentioned is the premier mention markets platform for trading predictions on what gets mentioned in speeches, podcasts, and events.',
    sameAs: [
      'https://x.com/mentionedmarket',
      'https://discord.gg/gsD7vf6YRx',
    ],
    founder: {
      '@type': 'Organization',
      name: 'Mentioned Markets',
    },
    potentialAction: {
      '@type': 'SearchAction',
      target: 'https://mentioned.market/?s={search_term_string}',
      'query-input': 'required name=search_term_string',
    },
  }

  const websiteJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Mentioned - Mention Markets',
    alternateName: ['Mentioned', 'Mention Markets', 'Mentioned Markets'],
    url: 'https://mentioned.market',
    description: 'Trade predictions on mention markets. Mentioned is the leading platform for predicting what gets mentioned in speeches, podcasts, events, and more.',
    keywords: 'mentioned, mention markets, mentioned markets, prediction markets, mentioned platform, speech predictions, mention trading',
  }

  return (
    <html lang="en" className="dark">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webApplicationSchema) }}
        />
        <meta name="theme-color" content="#000000" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black" />
        <meta name="apple-mobile-web-app-title" content="Mentioned" />
        {/* Additional SEO Meta Tags */}
        <meta name="classification" content="Finance, Trading, Prediction Markets" />
        <meta name="coverage" content="Worldwide" />
        <meta name="distribution" content="Global" />
        <meta name="rating" content="General" />
        <meta name="target" content="traders, investors, prediction market users, crypto enthusiasts" />
        <meta name="HandheldFriendly" content="True" />
        <meta name="MobileOptimized" content="320" />
        {/* Geo Tags */}
        <meta name="geo.region" content="US" />
        <meta name="geo.placename" content="United States" />
        {/* Dublin Core Metadata */}
        <meta name="DC.title" content="Mentioned - Mention Markets Platform" />
        <meta name="DC.description" content="Trade predictions on what gets mentioned. Premier mention markets platform." />
        <meta name="DC.subject" content="prediction markets, mention trading, speech predictions, mentioned" />
        <meta name="DC.creator" content="Mentioned Markets" />
        <meta name="DC.language" content="en" />
        {/* Open Directory Project */}
        <meta name="dmoz" content="Business/Financial Services/Trading" />
        {/* Canonical Link */}
        <link rel="canonical" href="https://mentioned.market" />
        <link rel="alternate" href="https://mentioned.market" hrefLang="en" />
        {/* Preconnect for Performance */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://fonts.googleapis.com" />
      </head>
      <body className={`${plusJakartaSans.variable} bg-black text-white font-display antialiased`}>
        <TradeTicker />
        <WalletProviderWrapper>
          {children}
          <GlobalChat />
          <BugReportButton />
        </WalletProviderWrapper>
      </body>
    </html>
  )
}
