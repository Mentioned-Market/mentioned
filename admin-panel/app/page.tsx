"use client";

import { useState, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, Transaction } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import BN from "bn.js";
import {
  PROGRAM_ID,
  getEventPDA,
  getMarketPDA,
  hashWord,
  createInitializeEventInstruction,
  createInitializeMarketInstruction,
  createAddLiquidityInstruction,
  createResolveMarketInstruction,
  fetchEventAccount,
  fetchMarketAccount,
  lamportsToSol,
  solToLamports,
  EventAccount,
  MarketAccount,
} from "@/lib/program";

interface EventWithMarkets {
  eventId: BN;
  eventPda: PublicKey;
  eventData: EventAccount;
  markets: Array<{
    marketId: BN;
    marketPda: PublicKey;
    marketData: MarketAccount;
    word: string;
  }>;
}

export default function AdminDashboard() {
  const { publicKey, sendTransaction, signTransaction } = useWallet();
  const { connection } = useConnection();
  
  const [events, setEvents] = useState<EventWithMarkets[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  // Form states
  const [newEventId, setNewEventId] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [newMarketWord, setNewMarketWord] = useState("");
  const [newMarketFee, setNewMarketFee] = useState("100");
  const [liquidityAmount, setLiquidityAmount] = useState("1");

  const showStatus = (msg: string, isError = false) => {
    setStatus(msg);
    console.log(isError ? `❌ ${msg}` : `✅ ${msg}`);
  };

  const handleCreateEvent = async () => {
    if (!publicKey || !signTransaction) {
      showStatus("Please connect your wallet", true);
      return;
    }

    if (!newEventId) {
      showStatus("Please enter an event ID", true);
      return;
    }

    setLoading(true);
    try {
      const eventId = new BN(newEventId);
      const [eventPda] = getEventPDA(publicKey, eventId);

      const instruction = createInitializeEventInstruction(publicKey, eventPda, eventId);
      
      const transaction = new Transaction().add(instruction);
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, "confirmed");

      showStatus(`Event created! TX: ${signature}`);
      setNewEventId("");
      
      // Refresh events list
      setTimeout(() => loadEvents(), 2000);
    } catch (error: any) {
      showStatus(`Error: ${error.message}`, true);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateMarket = async () => {
    if (!publicKey || !signTransaction) {
      showStatus("Please connect your wallet", true);
      return;
    }

    if (!selectedEventId || !newMarketWord) {
      showStatus("Please select an event and enter a word", true);
      return;
    }

    setLoading(true);
    try {
      const eventId = new BN(selectedEventId);
      const [eventPda] = getEventPDA(publicKey, eventId);

      // Check if event exists
      const eventData = await fetchEventAccount(connection, eventPda);
      if (!eventData) {
        showStatus("Event not found. Please create it first.", true);
        setLoading(false);
        return;
      }

      // Generate market ID (timestamp-based for uniqueness)
      const marketId = new BN(Date.now());
      const [marketPda] = getMarketPDA(eventPda, marketId);
      
      const wordHash = hashWord(newMarketWord);
      const feeBps = parseInt(newMarketFee);

      const instruction = createInitializeMarketInstruction(
        publicKey,
        eventPda,
        marketPda,
        marketId,
        wordHash,
        feeBps
      );

      const transaction = new Transaction().add(instruction);
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, "confirmed");

      showStatus(`Market created for "${newMarketWord}"! TX: ${signature}`);
      setNewMarketWord("");
      
      // Refresh markets
      setTimeout(() => loadEvents(), 2000);
    } catch (error: any) {
      showStatus(`Error: ${error.message}`, true);
    } finally {
      setLoading(false);
    }
  };

  const handleAddLiquidity = async (eventId: BN, marketId: BN, marketPda: PublicKey) => {
    if (!publicKey || !signTransaction) {
      showStatus("Please connect your wallet", true);
      return;
    }

    setLoading(true);
    try {
      const [eventPda] = getEventPDA(publicKey, eventId);
      
      // For this demo, we'll assume mints are created externally
      // In production, you'd store mint addresses or create them here
      showStatus("Note: You need to create YES/NO mints first and provide them", true);
      
      // This is a placeholder - you'd need actual mint addresses
      const lamports = solToLamports(parseFloat(liquidityAmount));
      
      showStatus("Liquidity feature requires mint setup. See console for details.", true);
    } catch (error: any) {
      showStatus(`Error: ${error.message}`, true);
    } finally {
      setLoading(false);
    }
  };

  const handleResolveMarket = async (eventId: BN, marketId: BN, marketPda: PublicKey, winningSide: "yes" | "no") => {
    if (!publicKey || !signTransaction) {
      showStatus("Please connect your wallet", true);
      return;
    }

    if (!confirm(`Are you sure you want to resolve this market as ${winningSide.toUpperCase()}?`)) {
      return;
    }

    setLoading(true);
    try {
      const [eventPda] = getEventPDA(publicKey, eventId);
      
      const instruction = createResolveMarketInstruction(
        publicKey,
        eventPda,
        marketPda,
        winningSide
      );

      const transaction = new Transaction().add(instruction);
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, "confirmed");

      showStatus(`Market resolved as ${winningSide.toUpperCase()}! TX: ${signature}`);
      
      // Refresh markets
      setTimeout(() => loadEvents(), 2000);
    } catch (error: any) {
      showStatus(`Error: ${error.message}`, true);
    } finally {
      setLoading(false);
    }
  };

  const loadEvents = async () => {
    if (!publicKey) return;

    setLoading(true);
    try {
      // In a real app, you'd track event IDs in a database or state
      // For demo, we'll try to load a few known IDs
      const knownEventIds = [1, 2, 3, Date.now()]; // Add your event IDs here
      const loadedEvents: EventWithMarkets[] = [];

      for (const id of knownEventIds) {
        const eventId = new BN(id);
        const [eventPda] = getEventPDA(publicKey, eventId);
        const eventData = await fetchEventAccount(connection, eventPda);
        
        if (eventData) {
          // Try to load markets for this event (would need market ID tracking in production)
          loadedEvents.push({
            eventId,
            eventPda,
            eventData,
            markets: [], // Markets would be loaded here with known market IDs
          });
        }
      }

      setEvents(loadedEvents);
      if (loadedEvents.length === 0) {
        showStatus("No events found. Create one to get started!");
      }
    } catch (error: any) {
      console.error("Error loading events:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (publicKey) {
      loadEvents();
    }
  }, [publicKey]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold mb-2">🎯 Prediction Market Admin</h1>
            <p className="text-gray-300">Manage events and markets on Solana Devnet</p>
            <p className="text-sm text-gray-400 mt-1">Program: {PROGRAM_ID.toString().slice(0, 20)}...</p>
          </div>
          <WalletMultiButton />
        </div>

        {/* Status Bar */}
        {status && (
          <div className="mb-6 p-4 bg-white/10 backdrop-blur-sm rounded-lg border border-white/20">
            <p className="text-sm">{status}</p>
          </div>
        )}

        {!publicKey ? (
          <div className="text-center py-20">
            <h2 className="text-2xl mb-4">👆 Connect your wallet to get started</h2>
            <p className="text-gray-400">You'll need SOL on Devnet to create events and markets</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Create Event Card */}
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
              <h2 className="text-2xl font-bold mb-4">📅 Create Event</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Event ID</label>
                  <input
                    type="number"
                    value={newEventId}
                    onChange={(e) => setNewEventId(e.target.value)}
                    placeholder="e.g., 1, 2, 3..."
                    className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-purple-500 focus:outline-none"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Use a unique number (e.g., timestamp: {Date.now()})
                  </p>
                </div>
                <button
                  onClick={handleCreateEvent}
                  disabled={loading || !newEventId}
                  className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg font-semibold hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {loading ? "Creating..." : "Create Event"}
                </button>
              </div>
            </div>

            {/* Create Market Card */}
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
              <h2 className="text-2xl font-bold mb-4">📊 Create Market</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Event ID</label>
                  <input
                    type="number"
                    value={selectedEventId}
                    onChange={(e) => setSelectedEventId(e.target.value)}
                    placeholder="Enter existing event ID"
                    className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Word to Track</label>
                  <input
                    type="text"
                    value={newMarketWord}
                    onChange={(e) => setNewMarketWord(e.target.value)}
                    placeholder="e.g., Mexico, Left, Taxes"
                    className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Fee (basis points)</label>
                  <input
                    type="number"
                    value={newMarketFee}
                    onChange={(e) => setNewMarketFee(e.target.value)}
                    placeholder="100 = 1%"
                    className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-purple-500 focus:outline-none"
                  />
                  <p className="text-xs text-gray-400 mt-1">100 basis points = 1%</p>
                </div>
                <button
                  onClick={handleCreateMarket}
                  disabled={loading || !selectedEventId || !newMarketWord}
                  className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-lg font-semibold hover:from-blue-700 hover:to-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {loading ? "Creating..." : "Create Market"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Events List */}
        {publicKey && events.length > 0 && (
          <div className="mt-8">
            <h2 className="text-2xl font-bold mb-4">📋 Your Events</h2>
            <div className="space-y-4">
              {events.map((event) => (
                <div
                  key={event.eventId.toString()}
                  className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-xl font-bold">Event #{event.eventId.toString()}</h3>
                      <p className="text-sm text-gray-400">PDA: {event.eventPda.toString().slice(0, 20)}...</p>
                    </div>
                    <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-sm">
                      Active
                    </span>
                  </div>

                  {event.markets.length === 0 ? (
                    <p className="text-gray-400 text-sm">No markets yet. Create one above!</p>
                  ) : (
                    <div className="space-y-2">
                      {event.markets.map((market) => (
                        <div
                          key={market.marketId.toString()}
                          className="bg-white/5 rounded-lg p-4 border border-white/10"
                        >
                          <div className="flex justify-between items-center">
                            <div>
                              <h4 className="font-semibold">"{market.word}"</h4>
                              <p className="text-xs text-gray-400">
                                Market #{market.marketId.toString()} • Fee: {market.marketData.feeBps}bp
                              </p>
                            </div>
                            <div className="flex gap-2">
                              {!market.marketData.resolved && (
                                <>
                                  <button
                                    onClick={() => handleResolveMarket(event.eventId, market.marketId, market.marketPda, "yes")}
                                    className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-sm transition-all"
                                  >
                                    Resolve YES
                                  </button>
                                  <button
                                    onClick={() => handleResolveMarket(event.eventId, market.marketId, market.marketPda, "no")}
                                    className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm transition-all"
                                  >
                                    Resolve NO
                                  </button>
                                </>
                              )}
                              {market.marketData.resolved && (
                                <span className="px-3 py-1 bg-yellow-500/20 text-yellow-300 rounded-full text-sm">
                                  Resolved
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick Start Guide */}
        {publicKey && events.length === 0 && !loading && (
          <div className="mt-8 bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10">
            <h3 className="text-xl font-bold mb-4">🚀 Quick Start</h3>
            <ol className="space-y-2 text-sm">
              <li>1. Create an Event with a unique ID (try using: {Date.now()})</li>
              <li>2. Create Markets for words you want to track (e.g., "Mexico", "Left", "Taxes")</li>
              <li>3. After the event, resolve markets by selecting YES or NO</li>
              <li>4. Users can redeem their winning tokens for SOL</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
