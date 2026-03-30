import { Metadata } from 'next'
import { getWalletByReferralCode, getProfile } from '@/lib/db'
import ReferralRedirect from './ReferralRedirect'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.mentioned.market'

interface Props {
  params: { code: string }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = params
  let username = code

  const wallet = await getWalletByReferralCode(code)
  if (wallet) {
    const profile = await getProfile(wallet)
    if (profile?.username && profile.username !== wallet) {
      username = profile.username
    }
  }

  const ogImageUrl = `${BASE_URL}/api/og/referral?code=${encodeURIComponent(code)}`

  return {
    title: `Join ${username} on Mentioned`,
    description: 'Predict. Trade. Compete. You both earn 10% bonus points when you sign up with this referral link.',
    openGraph: {
      title: `Join ${username} on Mentioned`,
      description: 'Predict. Trade. Compete. You both earn 10% bonus points.',
      images: [{ url: ogImageUrl, width: 1200, height: 630 }],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `Join ${username} on Mentioned`,
      description: 'Predict. Trade. Compete. You both earn 10% bonus points.',
      images: [ogImageUrl],
    },
  }
}

export default async function ReferralPage({ params }: Props) {
  const { code } = params
  const valid = !!(await getWalletByReferralCode(code))

  return <ReferralRedirect code={code} valid={valid} />
}
