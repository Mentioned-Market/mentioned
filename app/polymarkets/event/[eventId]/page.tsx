import { Metadata } from 'next'
import PolymarketEventClient from './PolymarketEventClient'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.mentioned.market'
const JUP_API_KEY = process.env.JUPITER_API_KEY ?? ''
const JUP_BASE = 'https://api.jup.ag/prediction/v1'

interface Props {
  params: { eventId: string }
}

async function fetchEventMeta(eventId: string): Promise<{ title: string; imageUrl: string; description?: string } | null> {
  try {
    const res = await fetch(
      `${JUP_BASE}/events/${encodeURIComponent(eventId)}?includeMarkets=false`,
      {
        headers: { 'x-api-key': JUP_API_KEY },
        next: { revalidate: 60 },
      }
    )
    if (!res.ok) return null
    const data = await res.json()
    return {
      title: data.metadata?.title ?? data.title ?? null,
      imageUrl: data.metadata?.imageUrl ?? null,
    }
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const event = await fetchEventMeta(params.eventId)

  if (!event?.title) {
    return { title: 'Event | Mentioned' }
  }

  const imageUrl = event.imageUrl || `${BASE_URL}/opengraph-image`
  const description = `Trade predictions on ${event.title} — Mentioned Markets`
  const url = `${BASE_URL}/polymarkets/event/${params.eventId}`

  return {
    title: `${event.title} | Mentioned`,
    description,
    openGraph: {
      title: event.title,
      description,
      images: [{ url: imageUrl, width: 1200, height: 630 }],
      type: 'website',
      url,
    },
    twitter: {
      card: 'summary_large_image',
      title: event.title,
      description,
      images: [imageUrl],
    },
  }
}

export default function PolymarketEventPage() {
  return <PolymarketEventClient />
}
