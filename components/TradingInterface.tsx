'use client'

import { useState } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token'
import BN from 'bn.js'
import {
  DEVNET_RPC,
  getEventPDA,
  getYesMintPDA,
  getNoMintPDA,
  getYesVaultPDA,
  getNoVaultPDA,
  createBuyYesInstruction,
  createBuyNoInstruction,
  solToLamports,
} from '@/lib/program'

interface MarketData {
  marketPda: PublicKey
  marketData: any
  word: string
  yesPrice: number
  noPrice: number
  totalLiquidity: number
  yesBalance: number
  noBalance: number
}

interface TradingInterfaceProps {
  marketData: MarketData
  eventId: string
}

export default function TradingInterface({ marketData, eventId }: TradingInterfaceProps) {
  const { publicKey, connected } = useWallet()
  const [side, setSide] = useState<'YES' | 'NO'>('YES')
  const [action, setAction] = useState<'BUY' | 'SELL'>('BUY')
  const [solAmount, setSolAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  const currentPrice = side === 'YES' ? marketData.yesPrice : marketData.noPrice
  const estimatedShares = solAmount ? (parseFloat(solAmount) / currentPrice).toFixed(2) : '0.00'

  const showStatus = (msg: string, isError = false) => {
    setStatus(msg)
    console.log(isError ? `❌ ${msg}` : `✅ ${msg}`)
    setTimeout(() => setStatus(''), 5000)
  }

  const handleTrade = async () => {
    if (!connected || !publicKey || !window.solana) {
      showStatus('Please connect your wallet first!', true)
      return
    }

    if (!solAmount || parseFloat(solAmount) <= 0) {
      showStatus('Enter SOL amount to spend', true)
      return
    }

    // SELL is not implemented yet
    if (action === 'SELL') {
      showStatus('SELL functionality coming soon!', true)
      return
    }

    setLoading(true)
    try {
      const connection = new Connection(DEVNET_RPC, 'confirmed')
      const lamports = solToLamports(parseFloat(solAmount))
      
      // Get admin pubkey from localStorage (needed for event PDA)
      const registryStr = localStorage.getItem('marketRegistry')
      if (!registryStr) {
        throw new Error('Market registry not found')
      }
      const registry = JSON.parse(registryStr)
      const eventData = registry[eventId]
      const adminPubkey = new PublicKey(eventData.admin)

      // Derive all PDAs
      const [eventPda] = getEventPDA(adminPubkey, new BN(eventId))
      const [yesMintPda] = getYesMintPDA(marketData.marketPda)
      const [noMintPda] = getNoMintPDA(marketData.marketPda)
      const [yesVaultPda] = getYesVaultPDA(marketData.marketPda)
      const [noVaultPda] = getNoVaultPDA(marketData.marketPda)

      // Get or create user's token accounts
      const userYesAta = await getAssociatedTokenAddress(yesMintPda, publicKey)
      const userNoAta = await getAssociatedTokenAddress(noMintPda, publicKey)

      console.log('💰 User YES ATA:', userYesAta.toString())
      console.log('💰 User NO ATA:', userNoAta.toString())

      const transaction = new Transaction()

      // Check if ATAs exist, create if needed
      const yesAtaInfo = await connection.getAccountInfo(userYesAta)
      if (!yesAtaInfo) {
        console.log('Creating YES token account...')
        const createYesAtaIx = createAssociatedTokenAccountInstruction(
          publicKey,
          userYesAta,
          publicKey,
          yesMintPda
        )
        transaction.add(createYesAtaIx)
      }

      const noAtaInfo = await connection.getAccountInfo(userNoAta)
      if (!noAtaInfo) {
        console.log('Creating NO token account...')
        const createNoAtaIx = createAssociatedTokenAccountInstruction(
          publicKey,
          userNoAta,
          publicKey,
          noMintPda
        )
        transaction.add(createNoAtaIx)
      }

      // 5% slippage tolerance
      const minOut = lamports.mul(new BN(95)).div(new BN(100))

      // Create buy instruction
      const buyIx = side === 'YES'
        ? createBuyYesInstruction(
            publicKey,
            eventPda,
            marketData.marketPda,
            yesMintPda,
            noMintPda,
            yesVaultPda,
            noVaultPda,
            userYesAta,
            userNoAta,
            lamports,
            minOut
          )
        : createBuyNoInstruction(
            publicKey,
            eventPda,
            marketData.marketPda,
            yesMintPda,
            noMintPda,
            yesVaultPda,
            noVaultPda,
            userYesAta,
            userNoAta,
            lamports,
            minOut
          )

      transaction.add(buyIx)

      // Send transaction
      const { blockhash } = await connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash
      transaction.feePayer = publicKey

      console.log('📤 Sending transaction...')
      const signed = await window.solana.signTransaction(transaction)
      const signature = await connection.sendRawTransaction(signed.serialize())
      
      console.log('⏳ Confirming transaction...')
      await connection.confirmTransaction(signature, 'confirmed')

      showStatus(`✅ Bought ${estimatedShares} ${side} shares! TX: ${signature.slice(0, 12)}...`)
      setSolAmount('')
      
      // Refresh page after 2s
      setTimeout(() => window.location.reload(), 2000)
    } catch (error: any) {
      console.error('Trade error:', error)
      showStatus(`Error: ${error.message}`, true)
    } finally {
      setLoading(false)
    }
  }

  const isDisabled = !solAmount || parseFloat(solAmount) <= 0 || !connected || loading

  return (
    <div className="bg-[#1a1a1a] rounded-lg h-full flex flex-col">
      <div className="border-b border-white/20 p-3">
        <p className="text-white font-bold text-lg uppercase">{marketData.word}</p>
      </div>

      <div className="p-4 space-y-5 flex-1">
        {/* Status Message */}
        {status && (
          <div className={`text-sm p-2 rounded ${status.includes('Error') || status.includes('❌') ? 'bg-red-900/30 text-red-400' : 'bg-green-900/30 text-green-400'}`}>
            {status}
          </div>
        )}

        {/* Buy/Sell Toggle */}
        <div>
          <label className="text-white font-bold text-sm uppercase block mb-2">
            ACTION
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setAction('BUY')}
              disabled={loading}
              className={`h-10 font-bold text-sm uppercase rounded transition-colors border border-white/20 ${
                action === 'BUY'
                  ? 'bg-white text-black border-white'
                  : 'bg-transparent text-white hover:bg-white/5'
              } disabled:opacity-50`}
            >
              BUY
            </button>
            <button
              onClick={() => setAction('SELL')}
              disabled={loading}
              className={`h-10 font-bold text-sm uppercase rounded transition-colors border border-white/20 ${
                action === 'SELL'
                  ? 'bg-white text-black border-white'
                  : 'bg-transparent text-white hover:bg-white/5'
              } disabled:opacity-50`}
            >
              SELL
            </button>
          </div>
        </div>

        {/* Side Selector */}
        <div>
          <label className="text-white font-bold text-sm uppercase block mb-2">
            POSITION
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setSide('YES')}
              disabled={loading}
              className={`h-10 font-bold text-sm uppercase rounded transition-colors border border-white/20 ${
                side === 'YES'
                  ? 'bg-white text-black border-white'
                  : 'bg-transparent text-white hover:bg-white/5'
              } disabled:opacity-50`}
            >
              YES
            </button>
            <button
              onClick={() => setSide('NO')}
              disabled={loading}
              className={`h-10 font-bold text-sm uppercase rounded transition-colors border border-white/20 ${
                side === 'NO'
                  ? 'bg-white text-black border-white'
                  : 'bg-transparent text-white hover:bg-white/5'
              } disabled:opacity-50`}
            >
              NO
            </button>
          </div>
        </div>

        {/* Amount Input */}
        <div>
          <label className="text-white font-bold text-sm uppercase block mb-2">
            SOL AMOUNT
          </label>
          <input
            type="number"
            value={solAmount}
            onChange={(e) => setSolAmount(e.target.value)}
            placeholder="0.0"
            disabled={loading}
            className="w-full h-10 bg-transparent border border-white/20 rounded text-white font-bold text-xl px-3 focus:outline-none focus:border-white disabled:opacity-50"
            min="0"
            step="0.01"
          />
        </div>

        {/* Estimate */}
        <div className="border border-white/20 rounded p-3 text-sm space-y-1.5">
          <div className="flex justify-between">
            <span className="text-white">PRICE:</span>
            <span className="text-white font-bold">${currentPrice.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white">EST. SHARES:</span>
            <span className="text-white font-bold">{estimatedShares}</span>
          </div>
          <div className="border-t border-white/20 pt-1.5 mt-1.5 flex justify-between">
            <span className="text-white">COST:</span>
            <span className="text-white font-bold text-base">{solAmount || '0'} SOL</span>
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={handleTrade}
          disabled={isDisabled}
          className="w-full h-12 bg-white text-black font-bold text-sm uppercase rounded hover:bg-white/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={!connected ? 'Connect wallet to trade' : !solAmount ? 'Enter amount to trade' : ''}
        >
          {loading ? 'PROCESSING...' : !connected ? 'CONNECT WALLET' : `${action} ${side}`}
        </button>
        
        {!connected && (
          <p className="text-xs text-gray-400 text-center -mt-2">
            Connect your wallet in the header to start trading
          </p>
        )}
      </div>
    </div>
  )
}
