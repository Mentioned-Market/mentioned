'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Header from '@/components/Header'
import CountdownTimer from '@/components/CountdownTimer'
import TradingChart from '@/components/TradingChart'
import { useEVMWallet } from '@/contexts/EVMWalletContext'
import { contracts, abis, EventState, Outcome, OrderType, ContractOrder } from '@/lib/contracts'
import { formatUnits, parseUnits } from 'viem'

interface Word {
  wordId: number
  word: string
  yesPrice: string
  noPrice: string
  volume: number
  resolved: boolean
  outcome?: number
}

interface DataPoint {
  timestamp: number
  price: number
}

interface Order {
  price: number
  amount: number
  total: number
}

export default function EventPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const eventId = params.id as string
  const { address, isConnected, walletClient, publicClient } = useEVMWallet()
  
  // Mode state - check query param
  const initialMode = searchParams.get('mode') === 'pro' ? 'pro' : 'normal'
  const [mode, setMode] = useState<'normal' | 'pro'>(initialMode)
  
  // Debug log
  console.log('Current mode:', mode)
  
  // Event state
  const [eventData, setEventData] = useState<any>(null)
  const [words, setWords] = useState<Word[]>([])
  const [loading, setLoading] = useState(true)
  const [userBalances, setUserBalances] = useState<Record<number, { yes: bigint, no: bigint }>>({})
  const [userOrders, setUserOrders] = useState<ContractOrder[]>([])
  
  // Trading state
  const [selectedWord, setSelectedWord] = useState<Word | null>(null)
  const [amount, setAmount] = useState('')
  const [activeTab, setActiveTab] = useState<'trading' | 'stream'>('trading')
  const [chatMessage, setChatMessage] = useState('')
  const [txStatus, setTxStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [tradeAction, setTradeAction] = useState<'buy' | 'sell'>('buy') // New: buy or sell
  
  // Pro mode specific state
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET')
  const [side, setSide] = useState<'YES' | 'NO'>('YES')
  const [limitPrice, setLimitPrice] = useState('')
  
  // Mock chat messages
  const [chatMessages, setChatMessages] = useState([
    { id: 1, user: 'trader123', message: 'This is going to moon! 🚀', timestamp: '2m ago' },
    { id: 2, user: 'cryptoking', message: 'Already bought 1000 YES shares', timestamp: '5m ago' },
    { id: 3, user: 'betmaster', message: 'Stream starting soon!', timestamp: '8m ago' },
  ])

  // Event time - must be before any conditional returns
  const eventTime = useMemo(() => new Date(Date.now() + 2 * 60 * 60 * 1000), [])

  // Fetch event data
  useEffect(() => {
    fetchEventData()
  }, [eventId, publicClient])

  // Fetch user balances
  useEffect(() => {
    if (address && words.length > 0) {
      fetchUserBalances()
      fetchUserOrders()
    }
  }, [address, words, publicClient])

  const fetchUserBalances = async () => {
    if (!address) return
    
    const balances: Record<number, { yes: bigint, no: bigint }> = {}
    
    for (const word of words) {
      try {
        const yesBalance = await publicClient.readContract({
          address: contracts.mentionedMarket,
          abi: abis.mentionedMarket,
          functionName: 'getTokenBalance',
          args: [address, BigInt(word.wordId), Outcome.YES],
        }) as bigint

        const noBalance = await publicClient.readContract({
          address: contracts.mentionedMarket,
          abi: abis.mentionedMarket,
          functionName: 'getTokenBalance',
          args: [address, BigInt(word.wordId), Outcome.NO],
        }) as bigint

        balances[word.wordId] = { yes: yesBalance, no: noBalance }
      } catch (err) {
        console.error('Error fetching balance for word', word.wordId, err)
      }
    }
    
    setUserBalances(balances)
  }

  const fetchUserOrders = async () => {
    if (!address) return
    
    try {
      // Get user's order IDs
      const orderIds = await publicClient.readContract({
        address: contracts.mentionedMarket,
        abi: abis.mentionedMarket,
        functionName: 'getUserOrders',
        args: [address],
      }) as bigint[]

      console.log('User order IDs:', orderIds)

      // Fetch each order's details
      const orders: ContractOrder[] = []
      for (const orderId of orderIds) {
        const order = await publicClient.readContract({
          address: contracts.mentionedMarket,
          abi: abis.mentionedMarket,
          functionName: 'getOrder',
          args: [orderId],
        }) as ContractOrder

        console.log('Order details:', order)

        // Only include active orders (not cancelled, not fully filled)
        if (!order.cancelled && order.filled < order.amount) {
          orders.push(order)
        }
      }

      console.log('Active orders:', orders)
      setUserOrders(orders)
    } catch (err) {
      console.error('Error fetching user orders:', err)
    }
  }

  const fetchEventData = async () => {
    try {
      setLoading(true)
      
      const event = await publicClient.readContract({
        address: contracts.mentionedMarket,
        abi: abis.mentionedMarket,
        functionName: 'getEvent',
        args: [BigInt(eventId)],
      }) as any

      setEventData({
        name: event[0],
        state: event[1],
        createdAt: event[2],
        wordIds: event[3],
      })

      // Fetch all words
      const wordPromises = event[3].map(async (wordId: bigint) => {
        const wordData = await publicClient.readContract({
          address: contracts.mentionedMarket,
          abi: abis.mentionedMarket,
          functionName: 'getWord',
          args: [wordId],
        }) as any

        // Fetch real prices from order book
        let yesPrice = '0.50' // Default midpoint
        let noPrice = '0.50'
        
        try {
          // Get best sell orders for YES (what you'd pay to buy YES)
          const yesSellOrders = await publicClient.readContract({
            address: contracts.mentionedMarket,
            abi: abis.mentionedMarket,
            functionName: 'getBestOrders',
            args: [wordId, Outcome.YES, OrderType.SELL, BigInt(1)],
          }) as any

          // Get best sell orders for NO (what you'd pay to buy NO)
          const noSellOrders = await publicClient.readContract({
            address: contracts.mentionedMarket,
            abi: abis.mentionedMarket,
            functionName: 'getBestOrders',
            args: [wordId, Outcome.NO, OrderType.SELL, BigInt(1)],
          }) as any

          // If there are sell orders, use the best (lowest) price
          if (yesSellOrders[1] && yesSellOrders[1].length > 0) {
            yesPrice = (Number(yesSellOrders[1][0]) / 1e6).toFixed(2)
          } else {
            // No orders yet, try to get buy orders to estimate
            const yesBuyOrders = await publicClient.readContract({
              address: contracts.mentionedMarket,
              abi: abis.mentionedMarket,
              functionName: 'getBestOrders',
              args: [wordId, Outcome.YES, OrderType.BUY, BigInt(1)],
            }) as any
            
            if (yesBuyOrders[1] && yesBuyOrders[1].length > 0) {
              yesPrice = (Number(yesBuyOrders[1][0]) / 1e6).toFixed(2)
            }
          }

          if (noSellOrders[1] && noSellOrders[1].length > 0) {
            noPrice = (Number(noSellOrders[1][0]) / 1e6).toFixed(2)
          } else {
            // Calculate NO price as complement of YES if no orders
            noPrice = (1 - parseFloat(yesPrice)).toFixed(2)
          }
        } catch (err) {
          console.log('No orders yet for word', wordData[1])
          // Keep default prices if no orders
        }

        // Mock volume for now (could calculate from order book later)
        const volume = Math.floor(Math.random() * 200000) + 50000

        return {
          wordId: Number(wordId),
          word: wordData[1],
          yesPrice,
          noPrice,
          volume,
          resolved: wordData[2],
          outcome: wordData[2] ? Number(wordData[3]) : undefined,
        }
      })

      const fetchedWords = await Promise.all(wordPromises)
      setWords(fetchedWords)
      if (fetchedWords.length > 0) {
        setSelectedWord(fetchedWords[0])
      }
    } catch (err) {
      console.error('Error fetching event:', err)
    } finally {
      setLoading(false)
    }
  }

  // Trading functions
  const handleBuy = async (buyYes: boolean) => {
    if (!amount || !selectedWord || !walletClient) return
    
    setTxStatus('pending')
    
    try {
      const numShares = parseFloat(amount)
      const price = parseFloat(buyYes ? selectedWord.yesPrice : selectedWord.noPrice)
      
      // Calculate cost (price * shares)
      const cost = price * numShares
      
      // Approve USDC for the cost
      const approveTx = await walletClient.writeContract({
        address: contracts.mockUSDC,
        abi: abis.mockUSDC,
        functionName: 'approve',
        args: [contracts.mentionedMarket, parseUnits(cost.toFixed(6), 6)],
        account: address as `0x${string}`,
        chain: walletClient.chain,
      })
      
      await publicClient.waitForTransactionReceipt({ hash: approveTx })
      
      // Place a limit order to BUY at current market price
      // Note: This creates an order that needs to be matched with a SELL order
      // Prices will update once orders are matched/filled
      const orderTx = await walletClient.writeContract({
        address: contracts.mentionedMarket,
        abi: abis.mentionedMarket,
        functionName: 'placeLimitOrder',
        args: [
          BigInt(selectedWord.wordId),
          buyYes ? Outcome.YES : Outcome.NO,
          OrderType.BUY,
          parseUnits(price.toString(), 6), // price scaled to 1e6
          BigInt(numShares)
        ],
        account: address as `0x${string}`,
        chain: walletClient.chain,
      })
      
      setTxHash(orderTx)
      
      const receipt = await publicClient.waitForTransactionReceipt({ hash: orderTx })
      
      if (receipt.status === 'success') {
        setTxStatus('success')
        setAmount('')
        // Refresh data
        setTimeout(() => {
          fetchEventData()
          fetchUserBalances()
          fetchUserOrders()
        }, 1000)
      } else {
        setTxStatus('error')
      }
    } catch (err: any) {
      setTxStatus('error')
      console.error('Buy error:', err)
    }
  }

  const handleSell = async (sellYes: boolean) => {
    if (!amount || !selectedWord || !walletClient) return
    
    setTxStatus('pending')
    
    try {
      const numShares = parseFloat(amount)
      const price = parseFloat(sellYes ? selectedWord.yesPrice : selectedWord.noPrice)
      
      // Place a limit order to SELL at current market price
      // Note: This creates an order that needs to be matched with a BUY order
      const orderTx = await walletClient.writeContract({
        address: contracts.mentionedMarket,
        abi: abis.mentionedMarket,
        functionName: 'placeLimitOrder',
        args: [
          BigInt(selectedWord.wordId),
          sellYes ? Outcome.YES : Outcome.NO,
          OrderType.SELL,
          parseUnits(price.toString(), 6), // price scaled to 1e6
          BigInt(numShares)
        ],
        account: address as `0x${string}`,
        chain: walletClient.chain,
      })
      
      setTxHash(orderTx)
      
      const receipt = await publicClient.waitForTransactionReceipt({ hash: orderTx })
      
      if (receipt.status === 'success') {
        setTxStatus('success')
        setAmount('')
        // Refresh data
        setTimeout(() => {
          fetchEventData()
          fetchUserBalances()
          fetchUserOrders()
        }, 1000)
      } else {
        setTxStatus('error')
      }
    } catch (err: any) {
      setTxStatus('error')
      console.error('Sell error:', err)
    }
  }

  const handleRefresh = () => {
    fetchEventData()
    fetchUserBalances()
    fetchUserOrders()
  }

  const handleCancelOrder = async (orderId: bigint) => {
    if (!walletClient) return
    
    try {
      const tx = await walletClient.writeContract({
        address: contracts.mentionedMarket,
        abi: abis.mentionedMarket,
        functionName: 'cancelOrder',
        args: [orderId],
        account: address as `0x${string}`,
        chain: walletClient.chain,
      })

      await publicClient.waitForTransactionReceipt({ hash: tx })
      
      // Refresh orders
      fetchUserOrders()
    } catch (err) {
      console.error('Error cancelling order:', err)
    }
  }

  // Event time - must be before any conditional returns
  const selectedWordData = selectedWord || (words.length > 0 ? words[0] : null)
  
  // Generate historical data
  const generateHistoricalData = (word: Word): DataPoint[] => {
    const data: DataPoint[] = []
    const now = Date.now()
    const startPrice = parseFloat(word.yesPrice) - 0.15
    const endPrice = parseFloat(word.yesPrice)
    
    for (let i = 0; i < 50; i++) {
      const timestamp = now - (24 * 60 * 60 * 1000) * (1 - i / 49)
      const progress = i / 49
      const volatility = (Math.random() - 0.5) * 0.05
      const price = startPrice + (endPrice - startPrice) * progress + volatility
      data.push({ timestamp, price: Math.max(0, Math.min(1, price)) })
    }
    return data
  }

  // Generate order book
  const generateOrderBook = (word: Word): { buyOrders: Order[], sellOrders: Order[] } => {
    const yesPrice = parseFloat(word.yesPrice)
    const buyOrders = []
    const sellOrders = []
    
    for (let i = 0; i < 8; i++) {
      const price = yesPrice - (i + 1) * 0.02
      const amount = Math.floor(Math.random() * 500) + 100
      buyOrders.push({ price, amount, total: price * amount })
    }
    
    for (let i = 0; i < 8; i++) {
      const price = yesPrice + (i + 1) * 0.02
      const amount = Math.floor(Math.random() * 500) + 100
      sellOrders.push({ price, amount, total: price * amount })
    }
    
    return { buyOrders, sellOrders }
  }

  const historicalData = selectedWordData ? generateHistoricalData(selectedWordData) : []
  const orderBook = selectedWordData ? generateOrderBook(selectedWordData) : { buyOrders: [], sellOrders: [] }
  
  // Normal mode calculations
  const estimatedYesCost = amount && selectedWordData ? (parseFloat(amount) * parseFloat(selectedWordData.yesPrice)).toFixed(2) : '0.00'
  const estimatedNoCost = amount && selectedWordData ? (parseFloat(amount) * parseFloat(selectedWordData.noPrice)).toFixed(2) : '0.00'
  const yesShares = amount ? parseFloat(amount).toFixed(0) : '0'
  const noShares = amount ? parseFloat(amount).toFixed(0) : '0'
  
  // Pro mode calculations
  const currentPrice = selectedWordData && side === 'YES' ? parseFloat(selectedWordData.yesPrice) : selectedWordData ? parseFloat(selectedWordData.noPrice) : 0
  const estimatedCost = amount ? (parseFloat(amount) * (orderType === 'MARKET' ? currentPrice : parseFloat(limitPrice || '0'))).toFixed(2) : '0.00'
  
  if (loading || !selectedWordData) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-2xl">Loading...</div>
      </div>
    )
  }

  // Normal Mode Render
  if (mode === 'normal') {
    return (
      <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
        <div className="layout-container flex h-full grow flex-col">
          <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
            <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
              <Header />
            
            <main className="py-6">
              {/* Header with Tabs */}
              <div className="flex items-center justify-between mb-6 pb-5 border-b border-white/10">
                <div>
                  <h1 className="text-2xl font-semibold text-white mb-1">{eventData?.name || 'Loading...'}</h1>
                  <div className="flex items-center gap-3 text-sm text-neutral-400">
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium">Ends in</span>
                      <CountdownTimer targetTime={eventTime} />
                    </span>
                    <button
                      onClick={handleRefresh}
                      className="text-xs px-3 py-1 glass rounded-lg hover:bg-white/10 transition-all duration-200"
                    >
                      Refresh
                    </button>
                  </div>
                </div>
                
                {/* Tabs and Mode Toggle */}
                <div className="flex flex-col items-end gap-3">
                  {/* Mode Toggle */}
                  <button
                    onClick={() => setMode('pro')}
                    className="flex items-center gap-2 px-4 py-2 glass rounded-lg hover:bg-white/10 transition-all duration-200"
                  >
                    <span className="text-xs text-neutral-400 font-medium">Normal</span>
                    <div className="relative w-11 h-6 bg-white/10 rounded-full">
                      <div className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200 translate-x-0"></div>
                    </div>
                    <span className="text-xs text-neutral-400 font-medium">Pro</span>
                  </button>
                  
                  {/* Tabs */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setActiveTab('trading')}
                      className={`px-6 py-2.5 font-semibold text-sm transition-all duration-200 rounded-lg ${
                        activeTab === 'trading'
                          ? 'bg-white text-black shadow-button'
                          : 'glass text-neutral-300 hover:bg-white/10'
                      }`}
                    >
                      Trading
                    </button>
                    <button
                      onClick={() => setActiveTab('stream')}
                      className={`px-6 py-2.5 font-semibold text-sm transition-all duration-200 rounded-lg ${
                        activeTab === 'stream'
                          ? 'bg-white text-black shadow-button'
                          : 'glass text-neutral-300 hover:bg-white/10'
                      }`}
                    >
                      Stream
                    </button>
                  </div>
                </div>
              </div>

              {/* Trading Tab */}
              <div className={activeTab === 'trading' ? 'block' : 'hidden'}>
                <div className="grid grid-cols-12 gap-5 min-h-[calc(100vh-280px)]">
                {/* Left - Words List */}
                <div className="col-span-7 glass rounded-2xl p-4 overflow-y-auto max-h-[calc(100vh-280px)]">
                  <div className="space-y-2">
                    {words.map((word) => (
                      <button
                        key={word.wordId}
                        onClick={() => setSelectedWord(word)}
                        className={`w-full p-4 rounded-xl transition-all duration-200 ${
                          selectedWord?.wordId === word.wordId
                            ? 'bg-white text-black shadow-card'
                            : 'glass hover:bg-white/10'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-lg font-semibold">{word.word}</div>
                          <div className="flex gap-4 text-sm font-semibold">
                            <span className={selectedWord?.wordId === word.wordId ? 'text-green-600' : 'text-apple-green'}>
                              YES ${word.yesPrice}
                            </span>
                            <span className={selectedWord?.wordId === word.wordId ? 'text-red-600' : 'text-apple-red'}>
                              NO ${word.noPrice}
                            </span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Right - Trading Interface */}
                <div className="col-span-5">
                  <div className="glass rounded-2xl p-6 flex flex-col max-h-[calc(100vh-280px)] overflow-y-auto">
                    <h2 className="text-2xl font-semibold mb-4 text-center">
                      {selectedWordData.word}
                    </h2>
                    
                    <div className="space-y-4">
                      {/* Quick Stats */}
                      <div className="grid grid-cols-3 gap-2 mb-4">
                        <div className="bg-black/30 rounded-xl p-3 text-center">
                          <div className="text-neutral-500 text-xs font-medium">Volume</div>
                          <div className="text-lg font-semibold">${(selectedWordData.volume / 1000).toFixed(0)}K</div>
                        </div>
                        <div className="bg-black/30 rounded-xl p-3 text-center">
                          <div className="text-neutral-500 text-xs font-medium">Yes</div>
                          <div className="text-lg font-semibold text-apple-green">${selectedWordData.yesPrice}</div>
                        </div>
                        <div className="bg-black/30 rounded-xl p-3 text-center">
                          <div className="text-neutral-500 text-xs font-medium">No</div>
                          <div className="text-lg font-semibold text-apple-red">${selectedWordData.noPrice}</div>
                        </div>
                      </div>

                      {/* Your Holdings */}
                      {isConnected && userBalances[selectedWordData.wordId] && (
                        <div className="bg-black/30 rounded-xl p-3 mb-4">
                          <div className="text-neutral-500 text-xs font-medium text-center mb-2">Your Holdings</div>
                          <div className="flex justify-around">
                            <div className="text-center">
                              <div className="text-apple-green text-lg font-bold">
                                {userBalances[selectedWordData.wordId].yes.toString()}
                              </div>
                              <div className="text-neutral-400 text-xs">YES</div>
                            </div>
                            <div className="text-center">
                              <div className="text-apple-red text-lg font-bold">
                                {userBalances[selectedWordData.wordId].no.toString()}
                              </div>
                              <div className="text-neutral-400 text-xs">NO</div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Buy/Sell Toggle */}
                      <div className="flex gap-2 mb-4">
                        <button
                          onClick={() => setTradeAction('buy')}
                          className={`flex-1 py-2.5 rounded-lg font-semibold transition-all duration-200 ${
                            tradeAction === 'buy'
                              ? 'bg-white text-black shadow-button'
                              : 'glass text-neutral-300 hover:bg-white/10'
                          }`}
                        >
                          Buy
                        </button>
                        <button
                          onClick={() => setTradeAction('sell')}
                          className={`flex-1 py-2.5 rounded-lg font-semibold transition-all duration-200 ${
                            tradeAction === 'sell'
                              ? 'bg-white text-black shadow-button'
                              : 'glass text-neutral-300 hover:bg-white/10'
                          }`}
                        >
                          Sell
                        </button>
                      </div>

                      {/* Amount Input */}
                      <div>
                        <label className="text-neutral-400 text-sm font-medium block mb-2">Shares</label>
                        <input
                          type="number"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder="0"
                          className="w-full h-14 bg-black/50 border border-white/20 rounded-xl text-white text-2xl px-4 focus:outline-none focus:border-white/50 text-center font-semibold transition-all duration-200"
                          min="0"
                          step="1"
                        />
                      </div>

                      {/* Action Buttons */}
                      <div className="space-y-3">
                        <div>
                          <button
                            onClick={() => tradeAction === 'buy' ? handleBuy(true) : handleSell(true)}
                            disabled={!amount || parseFloat(amount) <= 0 || !isConnected || txStatus === 'pending'}
                            className="w-full h-20 bg-apple-green hover:bg-apple-green/90 text-white font-semibold text-xl rounded-xl transition-all duration-200 transform hover:scale-[1.02] shadow-button disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                          >
                            <div>{tradeAction === 'buy' ? 'Buy' : 'Sell'} Yes</div>
                            <div className="text-2xl font-bold mt-1">${selectedWordData.yesPrice}</div>
                          </button>
                          <div className="mt-2 text-sm text-center space-y-1">
                            <div className="text-neutral-400">
                              {tradeAction === 'buy' ? 'Cost:' : 'Receive:'} <span className="text-white font-semibold">${estimatedYesCost}</span>
                            </div>
                            <div className="text-apple-green font-semibold">
                              {tradeAction === 'buy' ? 'Win:' : 'Sell:'} {yesShares} shares
                            </div>
                          </div>
                        </div>
                        
                        <div>
                          <button
                            onClick={() => tradeAction === 'buy' ? handleBuy(false) : handleSell(false)}
                            disabled={!amount || parseFloat(amount) <= 0 || !isConnected || txStatus === 'pending'}
                            className="w-full h-20 bg-apple-red hover:bg-apple-red/90 text-white font-semibold text-xl rounded-xl transition-all duration-200 transform hover:scale-[1.02] shadow-button disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                          >
                            <div>{tradeAction === 'buy' ? 'Buy' : 'Sell'} No</div>
                            <div className="text-2xl font-bold mt-1">${selectedWordData.noPrice}</div>
                          </button>
                          <div className="mt-2 text-sm text-center space-y-1">
                            <div className="text-neutral-400">
                              {tradeAction === 'buy' ? 'Cost:' : 'Receive:'} <span className="text-white font-semibold">${estimatedNoCost}</span>
                            </div>
                            <div className="text-apple-red font-semibold">
                              {tradeAction === 'buy' ? 'Win:' : 'Sell:'} {noShares} shares
                            </div>
                          </div>
                        </div>
                      </div>

                      {!isConnected && (
                        <div className="text-center text-apple-orange text-sm font-semibold mt-4 bg-apple-orange/10 rounded-lg py-3">
                          Connect wallet to trade
                        </div>
                      )}
                      
                      {txHash && (
                        <div className="text-center text-xs">
                          <a href={`https://sepolia.basescan.org/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                            View transaction →
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Your Pending Orders */}
              {isConnected && (
                <div className="mt-5">
                  <div className="glass rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xl font-semibold">Your Pending Orders</h3>
                      <span className="text-sm text-neutral-400">{userOrders.length} orders</span>
                    </div>
                    {userOrders.length === 0 ? (
                      <div className="text-center py-8 text-neutral-400">
                        No pending orders. Place a buy or sell order to get started!
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {userOrders.map((order) => {
                          const word = words.find(w => w.wordId === Number(order.wordId))
                          const remaining = order.amount - order.filled
                          return (
                            <div key={order.orderId.toString()} className="bg-black/30 rounded-xl p-4">
                              <div className="flex items-center justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center gap-3 mb-2">
                                    <span className="text-white font-semibold">{word?.word || `Word #${order.wordId}`}</span>
                                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                      order.outcome === Outcome.YES ? 'bg-apple-green/20 text-apple-green' : 'bg-apple-red/20 text-apple-red'
                                    }`}>
                                      {order.outcome === Outcome.YES ? 'YES' : 'NO'}
                                    </span>
                                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                      order.orderType === OrderType.BUY ? 'bg-blue-500/20 text-blue-400' : 'bg-orange-500/20 text-orange-400'
                                    }`}>
                                      {order.orderType === OrderType.BUY ? 'BUY' : 'SELL'}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-4 text-sm text-neutral-400">
                                    <span>Price: <span className="text-white font-semibold">${formatUnits(order.price, 6)}</span></span>
                                    <span>Amount: <span className="text-white font-semibold">{remaining.toString()}</span></span>
                                    {order.filled > 0n && (
                                      <span>Filled: <span className="text-apple-green font-semibold">{order.filled.toString()}</span></span>
                                    )}
                                  </div>
                                </div>
                                <button
                                  onClick={() => handleCancelOrder(order.orderId)}
                                  className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm font-semibold transition-all duration-200"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            
            {/* Stream Tab */}
            <div className={activeTab === 'stream' ? 'block' : 'hidden'}>
              <div className="grid grid-cols-12 gap-4 h-[calc(100vh-280px)]">
                <div className="col-span-8 glass rounded-2xl overflow-hidden">
                  <div className="w-full h-full bg-black flex items-center justify-center">
                    <div className="text-white/50">Stream will appear here when live</div>
                  </div>
                </div>

                <div className="col-span-4 glass rounded-2xl flex flex-col">
                  <div className="p-4 border-b border-white/10">
                    <h3 className="text-sm font-semibold text-neutral-300">Live Chat</h3>
                  </div>
                  
                  <div className="flex-1 p-4 overflow-y-auto space-y-3">
                    {chatMessages.map((msg) => (
                      <div key={msg.id} className="glass rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-white">{msg.user}</span>
                          <span className="text-xs text-neutral-500">{msg.timestamp}</span>
                        </div>
                        <p className="text-xs text-neutral-300">{msg.message}</p>
                      </div>
                    ))}
                  </div>
                  
                  <div className="p-4 border-t border-white/10">
                    {isConnected ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={chatMessage}
                          onChange={(e) => setChatMessage(e.target.value)}
                          placeholder="Message..."
                          className="flex-1 glass rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:bg-white/10 transition-all duration-200"
                        />
                        <button className="px-4 py-2 bg-white text-black font-semibold text-xs rounded-lg hover:bg-neutral-100 transition-colors duration-200">
                          Send
                        </button>
                      </div>
                    ) : (
                      <div className="text-center text-neutral-500 text-xs">
                        Connect wallet to chat
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </main>
          </div>
        </div>
      </div>
    </div>
  )
  } else {
    // Pro Mode Render
    return (
      <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-black">
      <div className="layout-container flex h-full grow flex-col">
        <div className="px-4 md:px-10 lg:px-20 flex flex-1 justify-center">
          <div className="layout-content-container flex flex-col w-full max-w-7xl flex-1">
            <Header />
          
          <main className="py-6">
            {/* Header with Tabs - SAME AS NORMAL MODE */}
            <div className="flex items-center justify-between mb-6 pb-5 border-b border-white/10">
              <div>
                <h1 className="text-2xl font-semibold text-white mb-1">{eventData?.name || 'Loading...'}</h1>
                <div className="flex items-center gap-3 text-sm text-neutral-400">
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium">Ends in</span>
                    <CountdownTimer targetTime={eventTime} />
                  </span>
                  <button
                    onClick={handleRefresh}
                    className="text-xs px-3 py-1 glass rounded-lg hover:bg-white/10 transition-all duration-200"
                  >
                    Refresh
                  </button>
                </div>
              </div>
              
              {/* Tabs and Mode Toggle */}
              <div className="flex flex-col items-end gap-3">
                {/* Mode Toggle */}
                <button
                  onClick={() => setMode('normal')}
                  className="flex items-center gap-2 px-4 py-2 glass rounded-lg hover:bg-white/10 transition-all duration-200"
                >
                  <span className="text-xs text-neutral-400 font-medium">Normal</span>
                  <div className="relative w-11 h-6 bg-white/10 rounded-full">
                    <div className="absolute top-1 right-1 w-4 h-4 bg-white rounded-full transition-transform duration-200"></div>
                  </div>
                  <span className="text-xs text-neutral-400 font-medium">Pro</span>
                </button>
                
                {/* Tabs */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setActiveTab('trading')}
                    className={`px-6 py-2.5 font-semibold text-sm transition-all duration-200 rounded-lg ${
                      activeTab === 'trading'
                        ? 'bg-white text-black shadow-button'
                        : 'glass text-neutral-300 hover:bg-white/10'
                    }`}
                  >
                    Trading
                  </button>
                  <button
                    onClick={() => setActiveTab('stream')}
                    className={`px-6 py-2.5 font-semibold text-sm transition-all duration-200 rounded-lg ${
                      activeTab === 'stream'
                        ? 'bg-white text-black shadow-button'
                        : 'glass text-neutral-300 hover:bg-white/10'
                    }`}
                  >
                    Stream
                  </button>
                </div>
              </div>
            </div>

          {/* Main Grid - Trading Tab */}
          {activeTab === 'trading' && (
            <div className="grid grid-cols-12 gap-3">
            {/* Left - Words List */}
            <div className="col-span-2 space-y-1">
              <div className="text-xs text-neutral-500 font-semibold mb-2 px-2">Markets</div>
              {words.map((word) => (
                <button
                  key={word.wordId}
                  onClick={() => setSelectedWord(word)}
                  className={`w-full text-left px-2 py-2 text-xs font-mono transition-colors rounded-lg ${
                    selectedWord?.wordId === word.wordId
                      ? 'bg-white/10 text-white'
                      : 'text-white/50 hover:bg-white/5 hover:text-white/70'
                  }`}
                >
                  <div className="font-bold">{word.word}</div>
                  <div className="flex gap-2 mt-1">
                    <span className="text-apple-green">${word.yesPrice}</span>
                    <span className="text-apple-red">${word.noPrice}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Center - Chart */}
            <div className="col-span-7">
              <div className="glass rounded-2xl border border-white/10">
                <div className="border-b border-white/10 p-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-neutral-300">{selectedWordData.word} / Yes</span>
                  <span className="text-lg font-bold">${parseFloat(selectedWordData.yesPrice).toFixed(2)}</span>
                </div>
                <div className="h-[350px] p-2">
                  <TradingChart
                    word={selectedWordData.word}
                    data={historicalData}
                    currentPrice={parseFloat(selectedWordData.yesPrice)}
                  />
                </div>
              </div>

              {/* Order Book */}
              <div className="mt-3 glass rounded-2xl border border-white/10">
                <div className="border-b border-white/10 p-3">
                  <span className="text-sm font-semibold text-neutral-300">Order Book</span>
                </div>
                <div className="grid grid-cols-2 divide-x divide-white/10">
                  <div className="p-3">
                    <div className="text-xs text-apple-green font-bold mb-2">Bids</div>
                    <div className="space-y-1 font-mono text-xs">
                      {orderBook.buyOrders.slice(0, 5).map((order, i) => (
                        <div key={i} className="grid grid-cols-3 gap-2 text-white/70">
                          <span className="text-apple-green">{order.price.toFixed(2)}</span>
                          <span className="text-right">{order.amount}</span>
                          <span className="text-right">${order.total.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="text-xs text-apple-red font-bold mb-2">Asks</div>
                    <div className="space-y-1 font-mono text-xs">
                      {orderBook.sellOrders.slice(0, 5).map((order, i) => (
                        <div key={i} className="grid grid-cols-3 gap-2 text-white/70">
                          <span className="text-apple-red">{order.price.toFixed(2)}</span>
                          <span className="text-right">{order.amount}</span>
                          <span className="text-right">${order.total.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right - Trading Terminal */}
            <div className="col-span-3">
              <div className="glass rounded-2xl border border-white/10 p-4">
                <div className="text-sm font-semibold text-neutral-300 mb-4">Place Order</div>
                
                {/* Order Type */}
                <div className="mb-3">
                  <div className="text-xs text-neutral-400 mb-2">Type</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setOrderType('MARKET')}
                      className={`px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        orderType === 'MARKET'
                          ? 'bg-white text-black shadow-button'
                          : 'glass text-neutral-300 hover:bg-white/10'
                      }`}
                    >
                      Market
                    </button>
                    <button
                      onClick={() => setOrderType('LIMIT')}
                      className={`px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        orderType === 'LIMIT'
                          ? 'bg-white text-black shadow-button'
                          : 'glass text-neutral-300 hover:bg-white/10'
                      }`}
                    >
                      Limit
                    </button>
                  </div>
                </div>

                {/* Side */}
                <div className="mb-3">
                  <div className="text-xs text-neutral-400 mb-2">Side</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setSide('YES')}
                      className={`px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        side === 'YES'
                          ? 'bg-apple-green text-white shadow-button'
                          : 'glass text-neutral-300 hover:bg-white/10'
                      }`}
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setSide('NO')}
                      className={`px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        side === 'NO'
                          ? 'bg-apple-red text-white shadow-button'
                          : 'glass text-neutral-300 hover:bg-white/10'
                      }`}
                    >
                      No
                    </button>
                  </div>
                </div>

                {/* Limit Price (if limit order) */}
                {orderType === 'LIMIT' && (
                  <div className="mb-3">
                    <div className="text-xs text-neutral-400 mb-2">Price</div>
                    <input
                      type="number"
                      value={limitPrice}
                      onChange={(e) => setLimitPrice(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-black/50 border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/40"
                      step="0.01"
                    />
                  </div>
                )}

                {/* Amount */}
                <div className="mb-3">
                  <div className="text-xs text-neutral-400 mb-2">Shares</div>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                    className="w-full bg-black/50 border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/40"
                    step="1"
                  />
                </div>

                {/* Summary */}
                <div className="bg-black/30 rounded-lg p-3 mb-3 space-y-1 text-xs font-mono">
                  <div className="flex justify-between text-neutral-400">
                    <span>Price:</span>
                    <span className="text-white">${orderType === 'MARKET' ? currentPrice.toFixed(2) : (limitPrice || '0.00')}</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Shares:</span>
                    <span className="text-white">{amount || 0}</span>
                  </div>
                  <div className="flex justify-between text-white font-bold border-t border-white/20 pt-2 mt-2">
                    <span>Total:</span>
                    <span>${estimatedCost}</span>
                  </div>
                </div>

                {/* Submit */}
                <button
                  onClick={() => side === 'YES' ? handleBuy(true) : handleBuy(false)}
                  disabled={!amount || parseFloat(amount) <= 0 || !isConnected || (orderType === 'LIMIT' && !limitPrice) || txStatus === 'pending'}
                  className="w-full bg-white text-black font-bold text-sm py-3 rounded-lg hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  {orderType === 'MARKET' ? 'Market' : 'Limit'} {side === 'YES' ? 'Buy' : 'Sell'}
                </button>

                {!isConnected && (
                  <div className="text-xs text-center text-apple-orange mt-2">Connect wallet</div>
                )}
                
                {txHash && (
                  <div className="text-center text-xs mt-2">
                    <a href={`https://sepolia.basescan.org/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                      View tx →
                    </a>
                  </div>
                )}
              </div>

              {/* Market Stats */}
              <div className="mt-3 glass rounded-2xl border border-white/10 p-4">
                <div className="text-sm font-semibold text-neutral-300 mb-3">Market Data</div>
                <div className="space-y-2 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-neutral-400">Volume:</span>
                    <span className="text-white">${(selectedWordData.volume / 1000).toFixed(0)}K</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-400">Yes Price:</span>
                    <span className="text-apple-green">${selectedWordData.yesPrice}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-400">No Price:</span>
                    <span className="text-apple-red">${selectedWordData.noPrice}</span>
                  </div>
                  {isConnected && userBalances[selectedWordData.wordId] && (
                    <>
                      <div className="border-t border-white/20 pt-2 mt-2">
                        <div className="text-xs text-neutral-400 font-semibold mb-2">Your Holdings</div>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Yes:</span>
                        <span className="text-apple-green">{userBalances[selectedWordData.wordId].yes.toString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-400">No:</span>
                        <span className="text-apple-red">{userBalances[selectedWordData.wordId].no.toString()}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
          )}

          {/* Stream Tab */}
          {activeTab === 'stream' && (
            <div className="grid grid-cols-12 gap-3">
              {/* Left - Words List with Quick Buy */}
              <div className="col-span-2 space-y-1">
                <div className="text-xs text-neutral-500 font-semibold mb-2 px-2">Quick Buy</div>
                {words.map((word) => {
                  const isExpanded = selectedWord?.wordId === word.wordId
                  
                  return (
                    <div key={word.wordId} className="glass rounded-xl border border-white/10">
                      <button
                        onClick={() => setSelectedWord(word)}
                        className="w-full text-left px-2 py-2 text-xs hover:bg-white/5 transition-colors"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-white">{word.word}</span>
                          <span className="text-white/50 text-xs">{isExpanded ? '▲' : '▼'}</span>
                        </div>
                        <div className="flex gap-2 text-xs">
                          <span className="text-apple-green">${word.yesPrice}</span>
                          <span className="text-apple-red">${word.noPrice}</span>
                        </div>
                      </button>
                      
                      {isExpanded && (
                        <div className="border-t border-white/10 p-2 space-y-2">
                          <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="Shares"
                            className="w-full bg-black/50 border border-white/20 rounded px-2 py-1 text-xs text-white focus:outline-none"
                            min="0"
                            step="1"
                          />
                          <div className="grid grid-cols-2 gap-1">
                            <button 
                              onClick={() => handleBuy(true)}
                              disabled={!amount || parseFloat(amount) <= 0 || !isConnected || txStatus === 'pending'}
                              className="bg-apple-green hover:bg-apple-green/90 text-white text-xs font-bold py-1 rounded disabled:opacity-50"
                            >
                              Yes
                            </button>
                            <button 
                              onClick={() => handleBuy(false)}
                              disabled={!amount || parseFloat(amount) <= 0 || !isConnected || txStatus === 'pending'}
                              className="bg-apple-red hover:bg-apple-red/90 text-white text-xs font-bold py-1 rounded disabled:opacity-50"
                            >
                              No
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Center/Right - Stream */}
              <div className="col-span-10">
                <div className="glass rounded-2xl border border-white/10 overflow-hidden">
                  <div className="aspect-video bg-black flex items-center justify-center">
                    <div className="text-white/50">Stream will appear here when live</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
        </div>
      </div>
    </div>
    </div>
  )
  }
}
