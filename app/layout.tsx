import type { Metadata } from 'next'
import { Space_Grotesk, VT323 } from 'next/font/google'
import './globals.css'
import WalletProviderWrapper from '@/components/WalletProviderWrapper'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-display',
})

const vt323 = VT323({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-mono',
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
      </head>
      <body className={`${spaceGrotesk.variable} ${vt323.variable} bg-background-light dark:bg-background-dark font-display text-white`}>
        <WalletProviderWrapper>
          {children}
        </WalletProviderWrapper>
      </body>
    </html>
  )
}

