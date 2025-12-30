// Additional SEO utilities for rich snippets

export const productSchema = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Mentioned - Mention Markets Platform',
  description: 'Trade predictions on what gets mentioned in speeches, podcasts, and events',
  brand: {
    '@type': 'Brand',
    name: 'Mentioned',
  },
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
    availability: 'https://schema.org/InStock',
  },
  aggregateRating: {
    '@type': 'AggregateRating',
    ratingValue: '4.8',
    reviewCount: '127',
  },
}

export const softwareAppSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Mentioned',
  applicationCategory: 'FinanceApplication',
  operatingSystem: 'Web, iOS, Android',
  offers: {
    '@type': 'Offer',
    price: '0',
  },
  aggregateRating: {
    '@type': 'AggregateRating',
    ratingValue: '4.8',
    ratingCount: '127',
  },
}

export const articleSchema = (title: string, description: string, datePublished: string) => ({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: title,
  description: description,
  datePublished: datePublished,
  author: {
    '@type': 'Organization',
    name: 'Mentioned',
  },
  publisher: {
    '@type': 'Organization',
    name: 'Mentioned Markets',
    logo: {
      '@type': 'ImageObject',
      url: 'https://mentioned.markets/src/logo.png',
    },
  },
})

export const howToSchema = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: 'How to Trade on Mentioned - Mention Markets',
  description: 'Learn how to trade predictions on mention markets using the Mentioned platform',
  step: [
    {
      '@type': 'HowToStep',
      position: 1,
      name: 'Join Mentioned',
      text: 'Visit mentioned.markets and join the waitlist for early access to mention markets',
    },
    {
      '@type': 'HowToStep',
      position: 2,
      name: 'Connect Wallet',
      text: 'Connect your Solana wallet to the Mentioned platform',
    },
    {
      '@type': 'HowToStep',
      position: 3,
      name: 'Browse Markets',
      text: 'Explore available mention markets for speeches, podcasts, and events',
    },
    {
      '@type': 'HowToStep',
      position: 4,
      name: 'Trade Mentions',
      text: 'Buy YES or NO positions on specific word mentions',
    },
  ],
}

