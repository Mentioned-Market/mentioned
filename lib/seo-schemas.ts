// SEO utilities for Mentioned - Mention Markets Platform

export const organizationSchema = {
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
  foundingDate: '2024',
  slogan: 'Trade What Gets Mentioned',
}

export const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What is Mentioned?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Mentioned is the premier mention markets platform that allows users to trade predictions on what words and phrases get mentioned in real-world events like speeches, podcasts, earnings calls, and conferences.',
      },
    },
    {
      '@type': 'Question',
      name: 'What are mention markets?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Mention markets, pioneered by Mentioned, are prediction markets focused specifically on whether certain words or phrases will be mentioned during specific events. Users can buy and sell positions based on their predictions.',
      },
    },
    {
      '@type': 'Question',
      name: 'How does Mentioned work?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Mentioned operates as a decentralized prediction market platform on Solana. Users connect their wallet, browse available mention markets, and trade YES or NO positions on whether specific words will be mentioned. Markets resolve based on verified transcripts.',
      },
    },
    {
      '@type': 'Question',
      name: 'What types of events does Mentioned cover?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Mentioned covers a wide range of events including political speeches, tech company keynotes, podcast episodes, earnings calls, sports broadcasts, gaming patch notes, YouTube videos, TV shows, and Reddit AMAs.',
      },
    },
    {
      '@type': 'Question',
      name: 'Is Mentioned available now?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Mentioned is currently in development. Join our waitlist at mentioned.market/waitlist to get early access when we launch on mainnet.',
      },
    },
  ],
}

export const webApplicationSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'Mentioned',
  alternateName: 'Mention Markets',
  url: 'https://mentioned.market',
  applicationCategory: 'FinanceApplication',
  operatingSystem: 'Web Browser',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  featureList: 'Prediction markets, Mention trading, Speech predictions, Podcast predictions, Event predictions, Decentralized trading',
  screenshot: 'https://mentioned.market/src/img/White%20Icon.svg',
}

export const breadcrumbSchema = (items: { name: string; url: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.name,
    item: item.url,
  })),
})

