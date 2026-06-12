import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCampaign } from '@/lib/eventCampaigns'
import EventLanding from './EventLanding'

interface Props {
  params: { campaign: string }
  searchParams: { c?: string }
}

export function generateMetadata({ params }: Props): Metadata {
  const campaign = getCampaign(params.campaign)
  const title = campaign ? `${campaign.title} — Mentioned` : 'Mentioned'
  return {
    title,
    description: 'Claim your starter balance and place your first trade on Mentioned.',
    robots: { index: false, follow: false }, // event landing — keep out of search
  }
}

export default function EventPage({ params, searchParams }: Props) {
  const campaign = getCampaign(params.campaign)
  if (!campaign) redirect('/')

  return (
    <EventLanding
      slug={campaign.slug}
      title={campaign.title}
      displayAmount={campaign.displayAmount}
      redirectPath={campaign.redirectPath}
      code={(searchParams.c ?? '').trim().toUpperCase()}
    />
  )
}
