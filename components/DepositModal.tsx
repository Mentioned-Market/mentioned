'use client'

import { useState, useRef, useEffect } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import {
  address as toAddress,
} from '@solana/kit'
import {
  createDepositIx,
  sendIxs,
  solToLamports,
} from '@/lib/mentionMarket'

interface DepositModalProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function DepositModal({ open, onClose, onSuccess }: DepositModalProps) {
  const { publicKey, balance, signer } = useWallet()
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setAmount('')
      setError(null)
      setLoading(false)
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  const walletBalance = balance ?? 0
  const maxDeposit = Math.max(0, walletBalance - 0.01)

  const handleMax = () => {
    setAmount(maxDeposit > 0 ? maxDeposit.toFixed(4) : '0')
  }

  const handleDeposit = async () => {
    if (!signer || !publicKey) return

    const sol = parseFloat(amount)
    if (isNaN(sol) || sol <= 0) {
      setError('Enter a valid amount')
      return
    }
    if (sol > walletBalance) {
      setError('Insufficient SOL balance')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const ix = await createDepositIx(toAddress(publicKey), solToLamports(sol))
      await sendIxs(signer, [ix])
      onSuccess()
      onClose()
    } catch (e: any) {
      setError(e?.message ?? 'Transaction failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose()
      }}
    >
      <div className="w-full max-w-sm mx-4 bg-neutral-900 border border-white/10 rounded-2xl shadow-card-hover animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-white text-lg font-semibold">Deposit SOL</h2>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Amount input + wallet balance */}
        <div className="px-5 pb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-neutral-400 text-xs font-medium">Amount (SOL)</label>
            <button
              onClick={handleMax}
              className="text-neutral-400 text-xs font-medium hover:text-white transition-colors"
            >
              {walletBalance.toFixed(2)} SOL available
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="any"
              min="0"
              placeholder="0.00"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
                setError(null)
              }}
              className="flex-1 h-11 px-4 bg-white/5 border border-white/10 rounded-xl text-white text-sm font-medium placeholder:text-neutral-500 focus:outline-none focus:border-white/30 transition-colors"
            />
            <button
              onClick={handleMax}
              className="h-11 px-4 glass hover:bg-white/10 text-white text-xs font-semibold rounded-xl transition-all duration-200"
            >
              Max
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="px-5 pb-3">
            <p className="text-apple-red text-xs">{error}</p>
          </div>
        )}

        {/* Submit */}
        <div className="px-5 pb-5">
          <button
            onClick={handleDeposit}
            disabled={loading || !amount}
            className="w-full h-11 bg-white text-black text-sm font-semibold rounded-xl hover:bg-neutral-100 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Confirming...' : 'Deposit'}
          </button>
        </div>
      </div>
    </div>
  )
}
