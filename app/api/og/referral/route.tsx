import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'
import { getWalletByReferralCode, getProfile } from '@/lib/db'
import { readFile } from 'fs/promises'
import { join } from 'path'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code') ?? ''

  let username = code
  if (code) {
    const wallet = await getWalletByReferralCode(code)
    if (wallet) {
      const profile = await getProfile(wallet)
      if (profile?.username && profile.username !== wallet) {
        username = profile.username
      }
    }
  }

  // Read logo as base64 data URL
  const logoPath = join(process.cwd(), 'public', 'src', 'img', '__White Logo.png')
  const logoBuffer = await readFile(logoPath)
  const logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#000000',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Logo — dominant */}
        <img
          src={logoBase64}
          width={720}
          height={400}
          style={{ objectFit: 'contain', marginBottom: 12 }}
        />

        {/* mentioned.market */}
        <div
          style={{
            fontSize: 32,
            fontWeight: 600,
            color: '#ffffff',
            marginBottom: 16,
            display: 'flex',
          }}
        >
          mentioned.market
        </div>

        {/* Ref code */}
        <div
          style={{
            fontSize: 22,
            fontWeight: 500,
            color: '#a3a3a3',
            letterSpacing: 3,
            marginBottom: 16,
            display: 'flex',
          }}
        >
          {code.toUpperCase()}
        </div>

        {/* Join line + bonus */}
        <div
          style={{
            fontSize: 20,
            color: '#22c55e',
            fontWeight: 500,
            display: 'flex',
          }}
        >
          Join {username} — you both earn 10% bonus points
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  )
}
