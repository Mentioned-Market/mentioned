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
  createMintSetInstruction,
  createPlaceOrderInstruction,
  getOrderPDA,
  getOrderEscrowPDA,
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

    // For POC: Only implement BUY - this will mint a set and then place a limit order
    if (action === 'SELL') {
      showStatus('SELL functionality: You can burn YES+NO tokens to get SOL back. Coming soon to UI!', true)
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

      // STEP 1: Mint a set (YES + NO tokens) by depositing SOL
      // This gives the user equal YES and NO tokens
      console.log('📝 Minting set of YES+NO tokens...')
      const mintSetIx = createMintSetInstruction(
        publicKey,
        eventPda,
        marketData.marketPda,
        yesMintPda,
        noMintPda,
        userYesAta,
        userNoAta,
        lamports
      )
      transaction.add(mintSetIx)

      // STEP 2: For POC, skip placing order - just mint the set
      // In production, you'd place a limit order here with the tokens you want to sell
      // For example: if buying YES, you'd sell the NO tokens on the order book
      
      // TODO: Add order placement logic
      // const nextOrderId = new BN(marketData.marketData.nextOrderId)
      // const [orderPda] = getOrderPDA(marketData.marketPda, nextOrderId)
      // const [orderEscrowPda] = getOrderEscrowPDA(orderPda)
      // 
      // const placeOrderIx = createPlaceOrderInstruction(
      //   publicKey,
      //   marketData.marketPda,
      //   orderPda,
      //   yesMintPda,
      //   noMintPda,
      //   userYesAta,
      //   userNoAta,
      //   orderEscrowPda,
      //   'sell', // Sell the opposite token
      //   side === 'YES' ? 'no' : 'yes',
      //   new BN(currentPrice * 1_000_000), // Price in basis points
      //   lamports // Size
      // )
      // transaction.add(placeOrderIx)

      // Send transaction
      const { blockhash } = await connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash
      transaction.feePayer = publicKey

      console.log('📤 Sending transaction...')
      const signed = await window.solana.signTransaction(transaction)
      const signature = await connection.sendRawTransaction(signed.serialize())
      
      console.log('⏳ Confirming transaction...')
      await connection.confirmTransaction(signature, 'confirmed')

      showStatus(`✅ Minted ${(parseFloat(solAmount) * 1_000_000_000).toFixed(0)} YES+NO tokens! TX: ${signature.slice(0, 12)}...`)
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
    <div className="glass rounded-2xl h-full flex flex-col">
      <div className="border-b border-white/10 p-4">
        <p className="text-white font-semibold text-lg">{marketData.word}</p>
      </div>

      <div className="p-5 space-y-5 flex-1">
        {/* Status Message */}
        {status && (
          <div className={`text-sm font-medium p-3 rounded-lg ${status.includes('Error') || status.includes('❌') ? 'bg-apple-red/10 text-apple-red' : 'bg-apple-green/10 text-apple-green'}`}>
            {status}
          </div>
        )}

        {/* Buy/Sell Toggle */}
        <div>
          <label className="text-neutral-400 font-medium text-sm block mb-2">
            Action
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setAction('BUY')}
              disabled={loading}
              className={`h-10 font-semibold text-sm rounded-lg transition-all duration-200 ${
                action === 'BUY'
                  ? 'bg-white text-black shadow-button'
                  : 'glass hover:bg-white/10'
              } disabled:opacity-50`}
            >
              Buy
            </button>
            <button
              onClick={() => setAction('SELL')}
              disabled={loading}
              className={`h-10 font-semibold text-sm rounded-lg transition-all duration-200 ${
                action === 'SELL'
                  ? 'bg-white text-black shadow-button'
                  : 'glass hover:bg-white/10'
              } disabled:opacity-50`}
            >
              Sell
            </button>
          </div>
        </div>

        {/* Side Selector */}
        <div>
          <label className="text-neutral-400 font-medium text-sm block mb-2">
            Position
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setSide('YES')}
              disabled={loading}
              className={`h-10 font-semibold text-sm rounded-lg transition-all duration-200 ${
                side === 'YES'
                  ? 'bg-apple-green text-white'
                  : 'glass hover:bg-white/10'
              } disabled:opacity-50`}
            >
              Yes
            </button>
            <button
              onClick={() => setSide('NO')}
              disabled={loading}
              className={`h-10 font-semibold text-sm rounded-lg transition-all duration-200 ${
                side === 'NO'
                  ? 'bg-apple-red text-white'
                  : 'glass hover:bg-white/10'
              } disabled:opacity-50`}
            >
              No
            </button>
          </div>
        </div>

        {/* Amount Input */}
        <div>
          <label className="text-neutral-400 font-medium text-sm block mb-2">
            SOL Amount
          </label>
          <input
            type="number"
            value={solAmount}
            onChange={(e) => setSolAmount(e.target.value)}
            placeholder="0.0"
            disabled={loading}
            className="w-full h-10 glass rounded-lg text-white font-semibold text-xl px-3 focus:outline-none focus:bg-white/10 disabled:opacity-50 transition-all duration-200"
            min="0"
            step="0.01"
          />
        </div>

        {/* Estimate */}
        <div className="bg-black/30 rounded-lg p-3 text-sm space-y-1.5">
          <div className="flex justify-between">
            <span className="text-neutral-400 font-medium">Price:</span>
            <span className="text-white font-semibold">${currentPrice.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400 font-medium">Est. Shares:</span>
            <span className="text-white font-semibold">{estimatedShares}</span>
          </div>
          <div className="border-t border-white/20 pt-1.5 mt-1.5 flex justify-between">
            <span className="text-neutral-400 font-medium">Cost:</span>
            <span className="text-white font-semibold text-base">{solAmount || '0'} SOL</span>
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={handleTrade}
          disabled={isDisabled}
          className="w-full h-12 bg-white text-black font-semibold text-sm rounded-lg hover:bg-neutral-100 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-button"
          title={!connected ? 'Connect wallet to trade' : !solAmount ? 'Enter amount to trade' : ''}
        >
          {loading ? 'Processing...' : !connected ? 'Connect Wallet' : `${action} ${side}`}
        </button>
        
        {!connected && (
          <p className="text-xs text-neutral-500 text-center -mt-2">
            Connect your wallet in the header to start trading
          </p>
        )}
      </div>
    </div>
  )
}
