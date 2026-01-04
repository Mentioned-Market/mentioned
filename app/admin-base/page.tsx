'use client'

import { useState, useEffect } from 'react'
import { useEVMWallet } from '@/contexts/EVMWalletContext'
import { formatUnits, parseUnits } from 'viem'
import { contracts, abis, EventState, Outcome } from '@/lib/contracts'

export default function AdminPage() {
  const { address, isConnected, connect, disconnect, walletClient, publicClient } = useEVMWallet()
  
  // State for forms
  const [eventName, setEventName] = useState('')
  const [wordText, setWordText] = useState('')
  const [bulkWords, setBulkWords] = useState('')
  const [eventId, setEventId] = useState('1')
  const [wordId, setWordId] = useState('1')
  const [newState, setNewState] = useState('1')
  const [mintAddress, setMintAddress] = useState('')
  const [mintAmount, setMintAmount] = useState('10000')
  
  // State for contract data
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null)
  const [eventData, setEventData] = useState<any>(null)
  const [wordData, setWordData] = useState<any>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [txStatus, setTxStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  // Fetch USDC balance
  useEffect(() => {
    if (address && publicClient) {
      fetchUsdcBalance()
      const interval = setInterval(fetchUsdcBalance, 10000)
      return () => clearInterval(interval)
    }
  }, [address, publicClient])

  const fetchUsdcBalance = async () => {
    if (!address) return
    try {
      const balance = await publicClient.readContract({
        address: contracts.mockUSDC,
        abi: abis.mockUSDC,
        functionName: 'balanceOf',
        args: [address],
      })
      setUsdcBalance(balance as bigint)
    } catch (err) {
      console.error('Error fetching balance:', err)
    }
  }

  // Fetch event data
  useEffect(() => {
    if (eventId && publicClient) {
      fetchEventData()
    }
  }, [eventId, publicClient])

  const fetchEventData = async () => {
    try {
      const data = await publicClient.readContract({
        address: contracts.mentionedMarket,
        abi: abis.mentionedMarket,
        functionName: 'getEvent',
        args: [BigInt(eventId)],
      })
      setEventData(data)
    } catch (err) {
      setEventData(null)
    }
  }

  // Fetch word data
  useEffect(() => {
    if (wordId && publicClient) {
      fetchWordData()
    }
  }, [wordId, publicClient])

  const fetchWordData = async () => {
    try {
      const data = await publicClient.readContract({
        address: contracts.mentionedMarket,
        abi: abis.mentionedMarket,
        functionName: 'getWord',
        args: [BigInt(wordId)],
      })
      setWordData(data)
    } catch (err) {
      setWordData(null)
    }
  }

  // Contract write helper
  const writeContract = async (
    contractAddress: `0x${string}`,
    abi: any,
    functionName: string,
    args: any[] = []
  ) => {
    if (!walletClient) return
    
    setTxStatus('pending')
    setError(null)
    setTxHash(null)

    try {
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi,
        functionName,
        args,
        account: address as `0x${string}`,
        chain: walletClient.chain,
      })
      
      setTxHash(hash)
      
      // Wait for transaction
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      
      if (receipt.status === 'success') {
        setTxStatus('success')
        // Refresh data
        fetchUsdcBalance()
        fetchEventData()
        fetchWordData()
      } else {
        setTxStatus('error')
        setError('Transaction failed')
      }
    } catch (err: any) {
      setTxStatus('error')
      setError(err.message || 'Transaction failed')
      console.error('Transaction error:', err)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Admin Panel - Base Sepolia</h1>
          <p className="mt-2 text-sm text-gray-600">
            Manage events, words, and USDC for the Mentioned Market
          </p>
        </div>

        {/* Wallet Connection */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Wallet</h2>
          {!isConnected ? (
            <button
              onClick={connect}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Connect MetaMask
            </button>
          ) : (
            <div>
              <p className="text-sm text-gray-600">Connected: {address}</p>
              <p className="text-sm text-gray-600 mt-1">
                mUSDC Balance: {usdcBalance ? formatUnits(usdcBalance, 6) : '0'}
              </p>
              <button
                onClick={disconnect}
                className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>

        {isConnected && (
          <>
            {/* Transaction Status */}
            {txHash && (
              <div className="bg-white shadow rounded-lg p-6 mb-6">
                <h2 className="text-xl font-semibold mb-4">Transaction Status</h2>
                <p className="text-sm text-gray-600 break-all">Hash: {txHash}</p>
                <a 
                  href={`https://sepolia.basescan.org/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline text-sm"
                >
                  View on BaseScan →
                </a>
                {txStatus === 'pending' && <p className="text-yellow-600 mt-2">⏳ Confirming...</p>}
                {txStatus === 'success' && <p className="text-green-600 mt-2">✅ Confirmed!</p>}
                {txStatus === 'error' && <p className="text-red-600 mt-2">❌ {error}</p>}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* MockUSDC Section */}
              <div className="bg-white shadow rounded-lg p-6">
                <h2 className="text-xl font-semibold mb-4">MockUSDC Faucet</h2>
                
                <div className="space-y-4">
                  <button
                    onClick={() => writeContract(contracts.mockUSDC, abis.mockUSDC, 'faucet')}
                    className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                    disabled={txStatus === 'pending'}
                  >
                    Claim 10,000 mUSDC (1hr cooldown)
                  </button>

                  <div className="border-t pt-4">
                    <h3 className="font-semibold mb-3">Admin Mint</h3>
                    <input
                      type="text"
                      placeholder="Address"
                      value={mintAddress}
                      onChange={(e) => setMintAddress(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg mb-2 text-gray-900"
                    />
                    <input
                      type="number"
                      placeholder="Amount"
                      value={mintAmount}
                      onChange={(e) => setMintAmount(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg mb-2 text-gray-900"
                    />
                    <button
                      onClick={() => writeContract(
                        contracts.mockUSDC, 
                        abis.mockUSDC, 
                        'mint',
                        [mintAddress as `0x${string}`, parseUnits(mintAmount, 6)]
                      )}
                      className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                      disabled={txStatus === 'pending' || !mintAddress}
                    >
                      Mint mUSDC
                    </button>
                  </div>
                </div>
              </div>

              {/* Event Management */}
              <div className="bg-white shadow rounded-lg p-6">
                <h2 className="text-xl font-semibold mb-4">Event Management</h2>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Create Event
                    </label>
                    <input
                      type="text"
                      placeholder="Event name"
                      value={eventName}
                      onChange={(e) => setEventName(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg mb-2 text-gray-900"
                    />
                    <button
                      onClick={() => writeContract(
                        contracts.mentionedMarket,
                        abis.mentionedMarket,
                        'createEvent',
                        [eventName]
                      )}
                      className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                      disabled={txStatus === 'pending' || !eventName}
                    >
                      Create Event
                    </button>
                  </div>

                  <div className="border-t pt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Change Event State
                    </label>
                    <input
                      type="number"
                      placeholder="Event ID"
                      value={eventId}
                      onChange={(e) => setEventId(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg mb-2 text-gray-900"
                    />
                    <select
                      value={newState}
                      onChange={(e) => setNewState(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg mb-2 text-gray-900"
                    >
                      <option value="0">PREMARKET</option>
                      <option value="1">LIVE</option>
                      <option value="2">RESOLVED</option>
                    </select>
                    <button
                      onClick={() => writeContract(
                        contracts.mentionedMarket,
                        abis.mentionedMarket,
                        'setEventState',
                        [BigInt(eventId), parseInt(newState)]
                      )}
                      className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                      disabled={txStatus === 'pending'}
                    >
                      Set State
                    </button>
                  </div>

                  {eventData && (
                    <div className="border-t pt-4">
                      <h3 className="font-semibold mb-2">Event {eventId} Info</h3>
                      <p className="text-sm text-gray-600">Name: {eventData[0]}</p>
                      <p className="text-sm text-gray-600">
                        State: {['PREMARKET', 'LIVE', 'RESOLVED'][Number(eventData[1])]}
                      </p>
                      <p className="text-sm text-gray-600">
                        Words: {eventData[3]?.length || 0}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Word Management */}
              <div className="bg-white shadow rounded-lg p-6">
                <h2 className="text-xl font-semibold mb-4">Word Management</h2>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Add Single Word
                    </label>
                    <input
                      type="number"
                      placeholder="Event ID"
                      value={eventId}
                      onChange={(e) => setEventId(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg mb-2 text-gray-900"
                    />
                    <input
                      type="text"
                      placeholder="Word text"
                      value={wordText}
                      onChange={(e) => setWordText(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg mb-2 text-gray-900"
                    />
                    <button
                      onClick={() => writeContract(
                        contracts.mentionedMarket,
                        abis.mentionedMarket,
                        'addWord',
                        [BigInt(eventId), wordText]
                      )}
                      className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                      disabled={txStatus === 'pending' || !wordText}
                    >
                      Add Word
                    </button>
                  </div>

                  <div className="border-t pt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Add Words (Bulk)
                    </label>
                    <input
                      type="number"
                      placeholder="Event ID"
                      value={eventId}
                      onChange={(e) => setEventId(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg mb-2 text-gray-900"
                    />
                    <textarea
                      placeholder="One word per line"
                      value={bulkWords}
                      onChange={(e) => setBulkWords(e.target.value)}
                      rows={4}
                      className="w-full px-3 py-2 border rounded-lg mb-2 text-gray-900"
                    />
                    <button
                      onClick={() => {
                        const words = bulkWords.split('\n').filter(w => w.trim())
                        writeContract(
                          contracts.mentionedMarket,
                          abis.mentionedMarket,
                          'addWordsBulk',
                          [BigInt(eventId), words]
                        )
                      }}
                      className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                      disabled={txStatus === 'pending' || !bulkWords}
                    >
                      Add Words (Bulk)
                    </button>
                  </div>
                </div>
              </div>

              {/* Word Resolution */}
              <div className="bg-white shadow rounded-lg p-6">
                <h2 className="text-xl font-semibold mb-4">Word Resolution</h2>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Resolve Word
                    </label>
                    <input
                      type="number"
                      placeholder="Word ID"
                      value={wordId}
                      onChange={(e) => setWordId(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg mb-2 text-gray-900"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => writeContract(
                          contracts.mentionedMarket,
                          abis.mentionedMarket,
                          'resolveWord',
                          [BigInt(wordId), Outcome.YES]
                        )}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                        disabled={txStatus === 'pending'}
                      >
                        Resolve YES
                      </button>
                      <button
                        onClick={() => writeContract(
                          contracts.mentionedMarket,
                          abis.mentionedMarket,
                          'resolveWord',
                          [BigInt(wordId), Outcome.NO]
                        )}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                        disabled={txStatus === 'pending'}
                      >
                        Resolve NO
                      </button>
                    </div>
                  </div>

                  {wordData && (
                    <div className="border-t pt-4">
                      <h3 className="font-semibold mb-2">Word {wordId} Info</h3>
                      <p className="text-sm text-gray-600">Text: {wordData[1]}</p>
                      <p className="text-sm text-gray-600">
                        Resolved: {wordData[2] ? 'Yes' : 'No'}
                      </p>
                      {wordData[2] && (
                        <p className="text-sm text-gray-600">
                          Outcome: {Number(wordData[3]) === 0 ? 'YES' : 'NO'}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Contract Addresses */}
            <div className="bg-white shadow rounded-lg p-6 mt-6">
              <h2 className="text-xl font-semibold mb-4">Contract Addresses</h2>
              <div className="space-y-2 text-sm">
                <p>
                  <span className="font-semibold">MockUSDC:</span>{' '}
                  <a
                    href={`https://sepolia.basescan.org/address/${contracts.mockUSDC}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {contracts.mockUSDC}
                  </a>
                </p>
                <p>
                  <span className="font-semibold">MentionedMarket:</span>{' '}
                  <a
                    href={`https://sepolia.basescan.org/address/${contracts.mentionedMarket}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {contracts.mentionedMarket}
                  </a>
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
