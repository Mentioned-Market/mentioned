import { notFound } from 'next/navigation'
import { getPaidMarketMetadataBySlug } from '@/lib/db'
import OnchainMarketClient from '@/app/market/[id]/OnchainMarketClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: { slug: string }
}

export default async function PaidMarketSlugPage({ params }: Props) {
  const meta = await getPaidMarketMetadataBySlug(params.slug)
  if (!meta) return notFound()
  return <OnchainMarketClient marketId={meta.market_id} />
}
