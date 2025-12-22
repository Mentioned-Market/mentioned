'use client'

import { useWallet } from '@/contexts/WalletContext'
import { PublicKey } from '@solana/web3.js'

export default function Header() {
  const { connect, disconnect, connected, balance, publicKey } = useWallet()

  const formatBalance = (bal: number | null) => {
    if (bal === null) return '0.00'
    return bal.toFixed(2)
  }

  const formatAddress = (pubKey: PublicKey | null) => {
    if (!pubKey) return ''
    const address = pubKey.toString()
    return `${address.slice(0, 4)}...${address.slice(-4)}`
  }

  return (
    <header className="flex flex-col md:flex-row items-center justify-between border-b border-white py-4">
      <div className="flex items-center gap-4 text-white">
        <h1 className="text-white text-2xl md:text-3xl font-bold uppercase tracking-widest">
          MENTIONED
        </h1>
      </div>
      <div className="flex w-full md:w-auto flex-1 justify-end items-center gap-4 md:gap-6 mt-4 md:mt-0">
        {connected && balance !== null && (
          <div className="flex items-center gap-3 font-mono text-sm md:text-base">
            <span className="text-white uppercase">{formatBalance(balance)} SOL</span>
            <span className="text-white/50">|</span>
            <span className="text-white/70 text-xs">{formatAddress(publicKey)}</span>
          </div>
        )}
        <button
          onClick={connected ? disconnect : connect}
          className="flex min-w-[84px] cursor-pointer items-center justify-center h-10 px-4 bg-white text-black text-sm font-bold leading-normal tracking-wider uppercase hover:bg-black hover:text-white border border-white"
        >
          <span>{connected ? 'DISCONNECT' : 'CONNECT WALLET'}</span>
        </button>
      </div>
    </header>
  )
}

