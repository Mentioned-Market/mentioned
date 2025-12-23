'use client'

import { useState } from 'react'

interface Word {
  word: string
  yesPrice: string
  noPrice: string
  volume: number
}

interface QuickBuyProps {
  words: Word[]
}

export default function QuickBuy({ words }: QuickBuyProps) {
  const [expandedWord, setExpandedWord] = useState<string | null>(null)
  const [amounts, setAmounts] = useState<Record<string, string>>({})

  const handleAmountChange = (word: string, value: string) => {
    setAmounts(prev => ({ ...prev, [word]: value }))
  }

  const toggleWord = (word: string) => {
    setExpandedWord(expandedWord === word ? null : word)
  }

  return (
    <div className="bg-[#1a1a1a] rounded-lg mt-4">
      <div className="border-b border-white/20 p-4">
        <h3 className="text-white font-bold text-xl uppercase">QUICK BUY</h3>
      </div>
      
      <div className="p-4 space-y-2">
        {words.map((word) => {
          const isExpanded = expandedWord === word.word
          const amount = amounts[word.word] || ''
          
          return (
            <div key={word.word} className="bg-[#0d0d0d] rounded-lg overflow-hidden">
              {/* Word Header */}
              <button
                onClick={() => toggleWord(word.word)}
                className="w-full flex items-center justify-between p-3 hover:bg-[#161616] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-white font-bold text-sm uppercase">{word.word}</span>
                  <span className="text-white/50 text-xs">${(word.volume / 1000).toFixed(0)}K VOL</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex gap-2 text-xs">
                    <span className="text-green-500">YES ${word.yesPrice}</span>
                    <span className="text-red-500">NO ${word.noPrice}</span>
                  </div>
                  <span className="text-white/50 text-xs">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </button>

              {/* Expanded Buy/Sell Interface */}
              {isExpanded && (
                <div className="border-t border-white/20 p-4 space-y-3">
                  {/* Amount Input */}
                  <div>
                    <label className="text-white text-xs font-bold uppercase block mb-2">
                      Shares
                    </label>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => handleAmountChange(word.word, e.target.value)}
                      placeholder="0"
                      className="w-full h-9 bg-transparent border border-white/20 rounded text-white font-bold text-sm px-3 focus:outline-none focus:border-white"
                      min="0"
                      step="1"
                    />
                  </div>

                  {/* Buy/Sell Buttons Grid */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      disabled={!amount || parseFloat(amount) <= 0}
                      className="h-9 bg-green-600 hover:bg-green-700 text-white font-bold text-xs uppercase rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      BUY YES ${word.yesPrice}
                    </button>
                    <button
                      disabled={!amount || parseFloat(amount) <= 0}
                      className="h-9 bg-red-600 hover:bg-red-700 text-white font-bold text-xs uppercase rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      BUY NO ${word.noPrice}
                    </button>
                  </div>

                  {amount && parseFloat(amount) > 0 && (
                    <div className="flex justify-between text-xs text-white/50 pt-2 border-t border-white/10">
                      <span>Est. Cost:</span>
                      <span>
                        YES: ${(parseFloat(amount) * parseFloat(word.yesPrice)).toFixed(2)} | 
                        NO: ${(parseFloat(amount) * parseFloat(word.noPrice)).toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

