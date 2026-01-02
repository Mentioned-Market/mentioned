'use client'

import { useState, useEffect } from 'react'
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
  fetchTokenBalance,
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
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET')
  const [limitPrice, setLimitPrice] = useState('')
  const [solAmount, setSolAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [userYesBalance, setUserYesBalance] = useState<number>(0)
  const [userNoBalance, setUserNoBalance] = useState<number>(0)
  const [loadingPositions, setLoadingPositions] = useState(false)

  const currentPrice = side === 'YES' ? marketData.yesPrice : marketData.noPrice
  const estimatedShares = solAmount ? (parseFloat(solAmount) / currentPrice).toFixed(2) : '0.00'

  // Fetch user positions
  const fetchUserPositions = async () => {
    if (!connected || !publicKey) {
      setUserYesBalance(0)
      setUserNoBalance(0)
      return
    }

    setLoadingPositions(true)
    try {
      const connection = new Connection(DEVNET_RPC, 'confirmed')
      const [yesMintPda] = getYesMintPDA(marketData.marketPda)
      const [noMintPda] = getNoMintPDA(marketData.marketPda)
      
      const userYesAta = await getAssociatedTokenAddress(yesMintPda, publicKey)
      const userNoAta = await getAssociatedTokenAddress(noMintPda, publicKey)

      const yesBalance = await fetchTokenBalance(connection, userYesAta)
      const noBalance = await fetchTokenBalance(connection, userNoAta)

      setUserYesBalance(yesBalance)
      setUserNoBalance(noBalance)
    } catch (error) {
      console.error('Error fetching user positions:', error)
      // If accounts don't exist yet, balances are 0
      setUserYesBalance(0)
      setUserNoBalance(0)
    } finally {
      setLoadingPositions(false)
    }
  }

  // Fetch positions on mount and when market/connection changes
  useEffect(() => {
    fetchUserPositions()
    
    // Refresh positions every 10 seconds
    const interval = setInterval(fetchUserPositions, 10000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, publicKey?.toString(), marketData.marketPda.toString()])

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

    // Validate limit price if limit order
    if (orderType === 'LIMIT') {
      if (!limitPrice || parseFloat(limitPrice) <= 0 || parseFloat(limitPrice) >= 1) {
        showStatus('Enter a valid limit price between 0 and 1', true)
        return
      }
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

      if (action === 'BUY') {
        // STEP 1: Mint a set (YES + NO tokens) by depositing SOL
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

        // STEP 2: Place a sell order for the unwanted tokens to get only YES or NO
        // If buying YES, sell NO tokens. If buying NO, sell YES tokens.
        const nextOrderId = new BN(marketData.marketData.nextOrderId)
        const [orderPda] = getOrderPDA(marketData.marketPda, nextOrderId)
        const [orderEscrowPda] = getOrderEscrowPDA(orderPda)
        
        // Calculate price in basis points (0-10000, where 10000 = 1.0 = 100%)
        const sellPrice = orderType === 'LIMIT' 
          ? new BN(Math.floor(parseFloat(limitPrice) * 10000))
          : new BN(Math.floor(currentPrice * 10000))
        
        // Sell the opposite token to get the desired side
        const sellOutcome = side === 'YES' ? 'no' : 'yes'
        
        console.log(`📊 Placing sell order for ${sellOutcome.toUpperCase()} tokens at price ${sellPrice.toNumber() / 10000}`)
        
        const placeOrderIx = createPlaceOrderInstruction(
          publicKey,
          marketData.marketPda,
          orderPda,
          yesMintPda,
          noMintPda,
          userYesAta,
          userNoAta,
          orderEscrowPda,
          'sell',
          sellOutcome,
          sellPrice,
          lamports
        )
        transaction.add(placeOrderIx)
      } else {
        // SELL action: Place a sell order for tokens you already have
        // NOTE: Contract limitation - escrow uses yes_mint, so we can only directly sell YES tokens
        // To sell NO tokens, you'd need to use burn_set or wait for contract update
        if (side === 'NO') {
          showStatus('⚠️ Contract limitation: Cannot directly sell NO tokens. Use burn_set to redeem SOL, or buy YES first.', true)
          return
        }

        if (userYesBalance === 0) {
          showStatus('You don\'t have enough YES tokens to sell', true)
          return
        }

        const sellAmount = lamports.toNumber()
        
        if (sellAmount > userYesBalance) {
          showStatus(`Insufficient balance. You have ${(userYesBalance / 1_000_000_000).toFixed(4)} YES tokens`, true)
          return
        }

        const nextOrderId = new BN(marketData.marketData.nextOrderId)
        const [orderPda] = getOrderPDA(marketData.marketPda, nextOrderId)
        const [orderEscrowPda] = getOrderEscrowPDA(orderPda)
        
        const sellPrice = orderType === 'LIMIT' 
          ? new BN(Math.floor(parseFloat(limitPrice) * 10000))
          : new BN(Math.floor(currentPrice * 10000))
        
        console.log(`📊 Placing sell order for YES tokens at price ${sellPrice.toNumber() / 10000}`)
        
        const placeOrderIx = createPlaceOrderInstruction(
          publicKey,
          marketData.marketPda,
          orderPda,
          yesMintPda,
          noMintPda,
          userYesAta,
          userNoAta,
          orderEscrowPda,
          'sell',
          'yes',
          sellPrice,
          lamports
        )
        transaction.add(placeOrderIx)
      }

      // Send transaction
      const { blockhash } = await connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash
      transaction.feePayer = publicKey

      // Simulate transaction first to catch errors before signing
      console.log('🔍 Simulating transaction...')
      try {
        const simulation = await connection.simulateTransaction(transaction)
        console.log('Simulation result:', simulation)
        
        if (simulation.value.err) {
          console.error('❌ Simulation failed:', simulation.value.err)
          console.error('📋 Simulation logs:', simulation.value.logs)
          
          // Extract error details
          let errorMessage = 'Transaction simulation failed'
          if (simulation.value.logs) {
            const logs = simulation.value.logs.join('\n')
            if (logs.includes('InstructionFallbackNotFound') || logs.includes('0x65')) {
              errorMessage = 'Instruction not found (0x65). The program may have been updated. Please refresh the page.'
            } else if (logs.includes('MarketResolved')) {
              errorMessage = 'This market has already been resolved. Trading is closed.'
            } else if (logs.includes('InvalidAmount')) {
              errorMessage = 'Invalid amount. Please enter a valid SOL amount.'
            } else if (logs.includes('InsufficientFunds')) {
              errorMessage = 'Insufficient SOL balance. Please add more SOL to your wallet.'
            } else {
              errorMessage = `Simulation failed: ${logs.slice(0, 200)}`
            }
          }
          
          throw new Error(errorMessage)
        }
        console.log('✅ Simulation succeeded!')
      } catch (simError: any) {
        console.error('Simulation error:', simError)
        throw new Error(`Pre-flight check failed: ${simError.message}`)
      }

      console.log('📤 Sending transaction...')
      const signed = await window.solana.signTransaction(transaction)
      const signature = await connection.sendRawTransaction(signed.serialize())
      
      console.log('✅ Transaction sent:', signature)
      console.log('⏳ Waiting for confirmation...')
      
      const confirmation = await connection.confirmTransaction(signature, 'confirmed')
      
      if (confirmation.value.err) {
        // Get detailed error logs
        const txDetails = await connection.getTransaction(signature, {
          maxSupportedTransactionVersion: 0
        })
        console.error('❌ Transaction logs:', txDetails?.meta?.logMessages)
        
        let errorMessage = 'Transaction failed'
        if (txDetails?.meta?.logMessages) {
          const logs = txDetails.meta.logMessages.join('\n')
          if (logs.includes('InstructionFallbackNotFound') || logs.includes('0x65')) {
            errorMessage = 'Instruction not found (0x65). The program may have been updated.'
          } else if (logs.includes('MarketResolved')) {
            errorMessage = 'This market has already been resolved. Trading is closed.'
          } else {
            errorMessage = `Transaction failed: ${logs.slice(0, 200)}`
          }
        }
        
        throw new Error(errorMessage)
      }

      const solAmountNum = parseFloat(solAmount)
      if (action === 'BUY') {
        showStatus(`✅ ${orderType === 'LIMIT' ? 'Limit order' : 'Market order'} placed! Minted set and selling ${side === 'YES' ? 'NO' : 'YES'} tokens. TX: ${signature.slice(0, 12)}...`)
      } else {
        showStatus(`✅ ${orderType === 'LIMIT' ? 'Limit order' : 'Market order'} placed! Selling ${solAmountNum.toFixed(4)} ${side} tokens. TX: ${signature.slice(0, 12)}...`)
      }
      setSolAmount('')
      setLimitPrice('')
      
      // Refresh user positions after successful transaction
      setTimeout(() => {
        fetchUserPositions()
      }, 2000)
    } catch (error: any) {
      console.error('Trade error:', error)
      
      // Handle SendTransactionError and other error types
      let errorMessage = error.message || 'Unknown error occurred'
      
      // Check for common Solana error patterns
      if (error.message?.includes('SendTransactionError') || error.message?.includes('simulation failed')) {
        errorMessage = error.message
      } else if (error.message?.includes('User rejected')) {
        errorMessage = 'Transaction was cancelled by user.'
      } else if (error.message?.includes('insufficient funds')) {
        errorMessage = 'Insufficient SOL balance. Please add more SOL to your wallet.'
      } else if (error.message?.includes('0x65') || error.message?.includes('InstructionFallbackNotFound')) {
        errorMessage = 'Instruction not found (0x65). The program may have been updated. Please refresh the page and try again.'
      }
      
      showStatus(`❌ ${errorMessage}`, true)
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

        {/* Order Type Toggle */}
        <div>
          <label className="text-neutral-400 font-medium text-sm block mb-2">
            Order Type
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setOrderType('MARKET')}
              disabled={loading}
              className={`h-10 font-semibold text-sm rounded-lg transition-all duration-200 ${
                orderType === 'MARKET'
                  ? 'bg-white text-black shadow-button'
                  : 'glass hover:bg-white/10'
              } disabled:opacity-50`}
            >
              Market
            </button>
            <button
              onClick={() => setOrderType('LIMIT')}
              disabled={loading}
              className={`h-10 font-semibold text-sm rounded-lg transition-all duration-200 ${
                orderType === 'LIMIT'
                  ? 'bg-white text-black shadow-button'
                  : 'glass hover:bg-white/10'
              } disabled:opacity-50`}
            >
              Limit
            </button>
          </div>
        </div>

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

        {/* Limit Price Input (only for limit orders) */}
        {orderType === 'LIMIT' && (
          <div>
            <label className="text-neutral-400 font-medium text-sm block mb-2">
              Limit Price (0-1)
            </label>
            <input
              type="number"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder={currentPrice.toFixed(2)}
              disabled={loading}
              className="w-full h-10 glass rounded-lg text-white font-semibold text-xl px-3 focus:outline-none focus:bg-white/10 disabled:opacity-50 transition-all duration-200"
              min="0"
              max="1"
              step="0.01"
            />
            <p className="text-xs text-neutral-500 mt-1">Current market price: ${currentPrice.toFixed(2)}</p>
          </div>
        )}

        {/* Amount Input */}
        <div>
          <label className="text-neutral-400 font-medium text-sm block mb-2">
            {action === 'BUY' ? 'SOL Amount' : `${side} Tokens`}
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
          {action === 'SELL' && (
            <p className="text-xs text-neutral-500 mt-1">
              Available: {(side === 'YES' ? userYesBalance : userNoBalance) / 1_000_000_000} {side}
            </p>
          )}
        </div>

        {/* User Positions */}
        {connected && (
          <div className="bg-black/30 rounded-lg p-3 text-sm space-y-1.5">
            <div className="text-neutral-400 font-medium mb-2">Your Position</div>
            {loadingPositions ? (
              <div className="text-neutral-500 text-xs">Loading...</div>
            ) : (
              <>
                <div className="flex justify-between">
                  <span className="text-neutral-400 font-medium">YES Tokens:</span>
                  <span className="text-apple-green font-semibold">{(userYesBalance / 1_000_000_000).toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-400 font-medium">NO Tokens:</span>
                  <span className="text-apple-red font-semibold">{(userNoBalance / 1_000_000_000).toFixed(4)}</span>
                </div>
                <div className="border-t border-white/20 pt-1.5 mt-1.5 flex justify-between">
                  <span className="text-neutral-400 font-medium">Total Value:</span>
                  <span className="text-white font-semibold">
                    {((userYesBalance + userNoBalance) / 1_000_000_000).toFixed(4)} SOL
                  </span>
                </div>
                {userYesBalance > 0 || userNoBalance > 0 ? (
                  <div className="text-xs text-neutral-500 mt-2 pt-2 border-t border-white/10">
                    💡 Buying mints a set (YES + NO). Sell unwanted tokens to get only YES or NO.
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}

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

        {/* Info Note */}
        {action === 'BUY' && (
          <div className="text-xs text-neutral-500 bg-black/20 rounded-lg p-2">
            💡 <strong>Buy Flow:</strong> Mints a set (YES + NO), then automatically places a sell order for unwanted tokens.
          </div>
        )}
        {action === 'SELL' && (
          <div className="text-xs text-neutral-500 bg-black/20 rounded-lg p-2">
            💡 <strong>Sell Flow:</strong> Places a {orderType.toLowerCase()} order to sell your {side} tokens.
          </div>
        )}

        {/* Action Button */}
        <button
          onClick={handleTrade}
          disabled={isDisabled || (orderType === 'LIMIT' && !limitPrice)}
          className="w-full h-12 bg-white text-black font-semibold text-sm rounded-lg hover:bg-neutral-100 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-button"
          title={!connected ? 'Connect wallet to trade' : !solAmount ? 'Enter amount to trade' : orderType === 'LIMIT' && !limitPrice ? 'Enter limit price' : ''}
        >
          {loading ? 'Processing...' : !connected ? 'Connect Wallet' : `${orderType} ${action} ${side}`}
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
