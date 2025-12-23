import type { Metadata } from 'next'
import { Space_Grotesk } from 'next/font/google'
import './globals.css'
import WalletProviderWrapper from '@/components/WalletProviderWrapper'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-display',
})

export const metadata: Metadata = {
  title: 'Mentioned - Markets',
  description: 'Prediction markets platform',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
        <link
          rel="icon"
          type="image/svg+xml"
          href="/src/mentioned_logo_top_left.svg"
        />
      </head>
      <body className={`${spaceGrotesk.variable} bg-black text-white font-display`}>
        <WalletProviderWrapper>
          {children}
        </WalletProviderWrapper>
      </body>
    </html>
  )
}
