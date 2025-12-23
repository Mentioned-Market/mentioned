'use client'

import { useState } from 'react'

interface TradingInterfaceProps {
  word: string
  yesPrice: number
  noPrice: number
}

export default function TradingInterface({ word, yesPrice, noPrice }: TradingInterfaceProps) {
  const [side, setSide] = useState<'YES' | 'NO'>('YES')
  const [action, setAction] = useState<'BUY' | 'SELL'>('BUY')
  const [amount, setAmount] = useState('')

  const currentPrice = side === 'YES' ? yesPrice : noPrice
  const estimatedCost = amount ? (parseFloat(amount) * currentPrice).toFixed(2) : '0.00'

  return (
    <div className="bg-[#1a1a1a] rounded-lg h-full flex flex-col">
      <div className="border-b border-white/20 p-3">
        <p className="text-white font-bold text-lg uppercase">{word}</p>
      </div>

      <div className="p-4 space-y-5 flex-1">
        {/* Buy/Sell Toggle */}
        <div>
          <label className="text-white font-bold text-sm uppercase block mb-2">
            ACTION
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setAction('BUY')}
              className={`h-10 font-bold text-sm uppercase rounded transition-colors border border-white/20 ${
                action === 'BUY'
                  ? 'bg-white text-black border-white'
                  : 'bg-transparent text-white hover:bg-white/5'
              }`}
            >
              BUY
            </button>
            <button
              onClick={() => setAction('SELL')}
              className={`h-10 font-bold text-sm uppercase rounded transition-colors border border-white/20 ${
                action === 'SELL'
                  ? 'bg-white text-black border-white'
                  : 'bg-transparent text-white hover:bg-white/5'
              }`}
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
              className={`h-10 font-bold text-sm uppercase rounded transition-colors border border-white/20 ${
                side === 'YES'
                  ? 'bg-white text-black border-white'
                  : 'bg-transparent text-white hover:bg-white/5'
              }`}
            >
              YES
            </button>
            <button
              onClick={() => setSide('NO')}
              className={`h-10 font-bold text-sm uppercase rounded transition-colors border border-white/20 ${
                side === 'NO'
                  ? 'bg-white text-black border-white'
                  : 'bg-transparent text-white hover:bg-white/5'
              }`}
            >
              NO
            </button>
          </div>
        </div>

        {/* Amount Input */}
        <div>
          <label className="text-white font-bold text-sm uppercase block mb-2">
            SHARES
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="w-full h-10 bg-transparent border border-white/20 rounded text-white font-bold text-xl px-3 focus:outline-none focus:border-white"
            min="0"
            step="1"
          />
        </div>

        {/* Estimate */}
        <div className="border border-white/20 rounded p-3 text-sm space-y-1.5">
          <div className="flex justify-between">
            <span className="text-white">PRICE:</span>
            <span className="text-white font-bold">${currentPrice.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white">SHARES:</span>
            <span className="text-white font-bold">{amount || 0}</span>
          </div>
          <div className="border-t border-white/20 pt-1.5 mt-1.5 flex justify-between">
            <span className="text-white">TOTAL:</span>
            <span className="text-white font-bold text-base">${estimatedCost}</span>
          </div>
        </div>

        {/* Action Button */}
        <button
          disabled={!amount || parseFloat(amount) <= 0}
          className="w-full h-12 bg-white text-black font-bold text-sm uppercase rounded hover:bg-white/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {action} {side}
        </button>
      </div>
    </div>
  )
}
