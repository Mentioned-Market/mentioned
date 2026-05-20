import { notFound } from 'next/navigation'
import OnchainMarketClient from './OnchainMarketClient'

interface Props {
  params: { id: string }
}

export default function OnchainMarketPage({ params }: Props) {
  if (!/^\d+$/.test(params.id)) return notFound()
  return <OnchainMarketClient marketId={params.id} />
}
