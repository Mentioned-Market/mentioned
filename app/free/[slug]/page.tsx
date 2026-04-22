import { Metadata } from 'next'
import { getCustomMarketBySlug } from '@/lib/db'
import FreeMarketClient from './FreeMarketClient'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.mentioned.market'

interface Props {
  params: { slug: string }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const market = await getCustomMarketBySlug(params.slug)

  if (!market) {
    return { title: 'Market Not Found | Mentioned' }
  }

  const imageUrl = market.cover_image_url || `${BASE_URL}/opengraph-image`
  const description = market.description || 'Trade predictions on what gets mentioned.'
  const url = `${BASE_URL}/free/${params.slug}`

  return {
    title: `${market.title} | Mentioned`,
    description,
    openGraph: {
      title: market.title,
      description,
      images: [{ url: imageUrl, width: 1200, height: 630 }],
      type: 'website',
      url,
    },
    twitter: {
      card: 'summary_large_image',
      title: market.title,
      description,
      images: [imageUrl],
    },
  }
}

export default async function FreeMarketPage({ params }: Props) {
  const market = await getCustomMarketBySlug(params.slug)
  return <FreeMarketClient initialMarketId={market?.id ?? null} />
}
