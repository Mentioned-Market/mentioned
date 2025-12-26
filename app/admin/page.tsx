"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import {
  PROGRAM_ID,
  DEVNET_RPC,
  getEventPDA,
  getMarketPDA,
  getYesMintPDA,
  getNoMintPDA,
  getYesVaultPDA,
  getNoVaultPDA,
  hashWord,
  createInitializeEventInstruction,
  createInitializeMarketInstruction,
  createAddLiquidityInstruction,
  createResolveMarketInstruction,
  fetchEventAccount,
  fetchMarketAccount,
  EventAccount,
  MarketAccount,
  solToLamports,
  lamportsToSol,
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

export default function AdminPage() {
  const { publicKey, connect, disconnect, connected } = useWallet();
  const [connection] = useState(() => new Connection(DEVNET_RPC, "confirmed"));
  
  const [events, setEvents] = useState<EventWithMarkets[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  // Form states
  const [newEventId, setNewEventId] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [newMarketWord, setNewMarketWord] = useState("");
  const [newMarketFee, setNewMarketFee] = useState("100");

  // Market tracking - store created markets in localStorage
  // Structure: { eventId: { admin: string, markets: Array<{id, word, ...}> } }
  const [marketRegistry, setMarketRegistry] = useState<Record<string, {admin: string, markets: Array<{id: string, word: string, yesMint: string, noMint: string, yesVault: string, noVault: string}>}>>({});

  useEffect(() => {
    // Load market registry from localStorage
    const stored = localStorage.getItem("marketRegistry");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Migrate old format if needed
        const migrated: typeof marketRegistry = {};
        for (const [eventId, value] of Object.entries(parsed)) {
          if (Array.isArray(value)) {
            // Old format: array of markets
            migrated[eventId] = {
              admin: publicKey?.toString() || "",
              markets: value as any
            };
          } else {
            // New format: { admin, markets }
            migrated[eventId] = value as any;
          }
        }
        setMarketRegistry(migrated);
      } catch (e) {
        console.error("Error loading market registry:", e);
      }
    }
  }, [publicKey]);

  const showStatus = (msg: string, isError = false) => {
    setStatus(msg);
    console.log(isError ? `❌ ${msg}` : `✅ ${msg}`);
    setTimeout(() => setStatus(""), 8000);
  };

  const handleCreateEvent = async () => {
    if (!publicKey || !window.solana) {
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

      // Check if already exists
      const existing = await fetchEventAccount(connection, eventPda);
      if (existing) {
        showStatus("Event already exists! Use a different ID.", true);
        setLoading(false);
        return;
      }

      const instruction = createInitializeEventInstruction(publicKey, eventPda, eventId);
      
      const transaction = new Transaction().add(instruction);
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      const signed = await window.solana.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(signature, "confirmed");

      showStatus(`Event #${newEventId} created! TX: ${signature.slice(0, 20)}...`);
      setNewEventId("");
      
      // Initialize event in registry with admin pubkey
      const updatedRegistry = {
        ...marketRegistry,
        [newEventId]: {
          admin: publicKey.toString(),
          markets: []
        }
      };
      setMarketRegistry(updatedRegistry);
      localStorage.setItem("marketRegistry", JSON.stringify(updatedRegistry));
      
      setTimeout(() => loadEvents(), 2000);
    } catch (error: any) {
      showStatus(`Error: ${error.message}`, true);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateMarket = async () => {
    if (!publicKey || !window.solana) {
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

      // Check if admin
      if (!eventData.admin.equals(publicKey)) {
        showStatus("Only the event creator can add markets!", true);
        setLoading(false);
        return;
      }

      showStatus("✅ Creating market with PDA-based mints...", false);

      // Generate market ID
      const marketId = new BN(Date.now());
      console.log("📝 Creating market with ID:", marketId.toString());
      console.log("📝 Event PDA:", eventPda.toString());
      
      const [marketPda] = getMarketPDA(eventPda, marketId);
      console.log("📝 Market PDA will be:", marketPda.toString());
      
      // Get PDA-based mints (deterministic, no keypairs needed!)
      const [yesMintPda] = getYesMintPDA(marketPda);
      const [noMintPda] = getNoMintPDA(marketPda);
      
      // Get PDA-based vaults (also deterministic!)
      const [yesVaultPda] = getYesVaultPDA(marketPda);
      const [noVaultPda] = getNoVaultPDA(marketPda);
      
      const wordHash = hashWord(newMarketWord);
      const feeBps = parseInt(newMarketFee);

      // Create market instruction (now includes mint + vault creation as PDAs!)
      const createMarketIx = createInitializeMarketInstruction(
        publicKey,
        eventPda,
        marketPda,
        yesMintPda,
        noMintPda,
        yesVaultPda,
        noVaultPda,
        marketId,
        wordHash,
        feeBps
      );

      const transaction = new Transaction().add(createMarketIx);
      
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;
      
      // ⚠️ SIMULATE first to catch errors before signing!
      console.log("🔍 Simulating transaction...");
      try {
        const simulation = await connection.simulateTransaction(transaction);
        console.log("Simulation result:", simulation);
        
        if (simulation.value.err) {
          console.error("❌ Simulation failed:", simulation.value.err);
          console.error("📋 Simulation logs:", simulation.value.logs);
          throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}\n\nLogs:\n${simulation.value.logs?.join('\n')}`);
        }
        console.log("✅ Simulation succeeded!");
      } catch (simError: any) {
        console.error("Simulation error:", simError);
        throw new Error(`Pre-flight check failed: ${simError.message}`);
      }
      
      // Only wallet needs to sign! No additional keypairs!
      const signedTx = await window.solana.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signedTx.serialize());
      
      console.log("✅ Transaction sent:", signature);
      console.log("⏳ Waiting for confirmation...");
      
      const confirmation = await connection.confirmTransaction(signature, "confirmed");
      
      console.log("📦 Transaction confirmed:", confirmation);
      
      if (confirmation.value.err) {
        // Get detailed error logs
        const txDetails = await connection.getTransaction(signature, {
          maxSupportedTransactionVersion: 0
        });
        console.error("❌ Transaction logs:", txDetails?.meta?.logMessages);
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}\nLogs: ${txDetails?.meta?.logMessages?.join('\n')}`);
      }

      // ✅ Verify the account actually exists before saving
      console.log("🔍 Verifying market account exists on-chain...");
      const marketAccount = await connection.getAccountInfo(marketPda);
      
      if (!marketAccount) {
        console.error("❌ Market account not found at", marketPda.toString());
        throw new Error(`Market account was not created! Expected at ${marketPda.toString()}`);
      }
      
      console.log("✅ Market account confirmed on-chain:", {
        address: marketPda.toString(),
        owner: marketAccount.owner.toString(),
        lamports: marketAccount.lamports,
        dataLength: marketAccount.data.length
      });
      
      // ✅ ONLY save to localStorage AFTER successful confirmation AND verification
      const eventRegistry = marketRegistry[selectedEventId] || { admin: publicKey.toString(), markets: [] };
      const updatedRegistry = {
        ...marketRegistry,
        [selectedEventId]: {
          admin: eventRegistry.admin || publicKey.toString(),
          markets: [
            ...eventRegistry.markets,
            { 
              id: marketId.toString(), 
              word: newMarketWord,
              yesMint: yesMintPda.toString(),
              noMint: noMintPda.toString(),
              yesVault: yesVaultPda.toString(),
              noVault: noVaultPda.toString()
            }
          ]
        }
      };
      setMarketRegistry(updatedRegistry);
      localStorage.setItem("marketRegistry", JSON.stringify(updatedRegistry));
      
      showStatus(`✅ Market created for "${newMarketWord}"! TX: ${signature.slice(0,12)}...`);
      setNewMarketWord("");
      setTimeout(() => loadEvents(), 2000);
    } catch (error: any) {
      console.error("Full error:", error);
      showStatus(`❌ Transaction failed: ${error.message}`, true);
    } finally {
      setLoading(false);
    }
  };

  const handleResolveMarket = async (eventId: BN, marketId: BN, marketPda: PublicKey, winningSide: "yes" | "no") => {
    if (!publicKey || !window.solana) {
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
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      const signed = await window.solana.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(signature, "confirmed");

      showStatus(`Market resolved as ${winningSide.toUpperCase()}! TX: ${signature.slice(0, 20)}...`);
      setTimeout(() => loadEvents(), 2000);
    } catch (error: any) {
      showStatus(`Error: ${error.message}`, true);
    } finally {
      setLoading(false);
    }
  };

  const handleAddLiquidity = async (eventId: BN, marketId: BN, marketPda: PublicKey) => {
    if (!publicKey || !window.solana) {
      showStatus("Please connect your wallet", true);
      return;
    }

    const solAmount = prompt("Enter amount of SOL to add as liquidity (e.g., 0.1):");
    if (!solAmount) return;

    const parsedAmount = parseFloat(solAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      showStatus("Invalid amount", true);
      return;
    }

    setLoading(true);
    try {
      const [eventPda] = getEventPDA(publicKey, eventId);
      const [yesMintPda] = getYesMintPDA(marketPda);
      const [noMintPda] = getNoMintPDA(marketPda);
      const [yesVaultPda] = getYesVaultPDA(marketPda);
      const [noVaultPda] = getNoVaultPDA(marketPda);

      const lamports = solToLamports(parsedAmount);

      const instruction = createAddLiquidityInstruction(
        publicKey,
        eventPda,
        marketPda,
        yesMintPda,
        noMintPda,
        yesVaultPda,
        noVaultPda,
        lamports
      );

      const transaction = new Transaction().add(instruction);
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      const signed = await window.solana.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(signature, "confirmed");

      showStatus(`✅ Added ${parsedAmount} SOL liquidity! TX: ${signature.slice(0, 12)}...`);
      setTimeout(() => loadEvents(), 2000);
    } catch (error: any) {
      console.error("Add liquidity error:", error);
      showStatus(`Error: ${error.message}`, true);
    } finally {
      setLoading(false);
    }
  };

  const loadEvents = async () => {
    if (!publicKey) return;

    setLoading(true);
    try {
      const loadedEvents: EventWithMarkets[] = [];

      // Load events from registry
      const eventIds = Object.keys(marketRegistry);
      
      for (const eventIdStr of eventIds) {
        const eventId = new BN(eventIdStr);
        const [eventPda] = getEventPDA(publicKey, eventId);
        const eventData = await fetchEventAccount(connection, eventPda);
        
        if (eventData) {
          // Load markets for this event
          const markets = [];
          const marketList = marketRegistry[eventIdStr]?.markets || [];
          
          for (const { id: marketIdStr, word } of marketList) {
            const marketId = new BN(marketIdStr);
            const [marketPda] = getMarketPDA(eventPda, marketId);
            const marketData = await fetchMarketAccount(connection, marketPda);
            
            if (marketData) {
              markets.push({ marketId, marketPda, marketData, word });
            }
          }

          loadedEvents.push({
            eventId,
            eventPda,
            eventData,
            markets,
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
    if (publicKey && connected) {
      loadEvents();
    }
  }, [publicKey, connected]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold mb-2">🎯 Admin Panel</h1>
            <p className="text-gray-300">Manage prediction market events & markets</p>
            <p className="text-sm text-gray-400 mt-1">Program: {PROGRAM_ID.toString().slice(0, 30)}...</p>
          </div>
          <div>
            {!connected ? (
              <button
                onClick={connect}
                className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg font-semibold hover:from-purple-700 hover:to-pink-700 transition-all"
              >
                Connect Wallet
              </button>
            ) : (
              <div className="text-right">
                <p className="text-sm text-gray-400">Connected</p>
                <p className="text-xs font-mono">{publicKey?.toString().slice(0, 8)}...</p>
                <button
                  onClick={disconnect}
                  className="text-xs text-red-400 hover:text-red-300 mt-1"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Admin Access Note */}
        <div className="mb-6 p-4 bg-yellow-500/10 backdrop-blur-sm rounded-lg border border-yellow-500/30">
          <p className="text-sm text-yellow-200">
            <strong>🔑 Admin Access:</strong> Only the wallet that creates an event can create markets and resolve them. 
            Events are tied to YOUR wallet address.
          </p>
        </div>

        {/* Status Bar */}
        {status && (
          <div className="mb-6 p-4 bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 animate-pulse">
            <p className="text-sm">{status}</p>
          </div>
        )}

        {!connected ? (
          <div className="text-center py-20">
            <h2 className="text-2xl mb-4">👆 Connect your wallet to get started</h2>
            <p className="text-gray-400">Make sure you have SOL on Devnet to create events and markets</p>
            <a 
              href="https://faucet.solana.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-4 px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-all"
            >
              Get Devnet SOL
            </a>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Create Event Card */}
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
              <h2 className="text-2xl font-bold mb-4">📅 Create Event</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Event ID (unique number)</label>
                  <input
                    type="number"
                    value={newEventId}
                    onChange={(e) => setNewEventId(e.target.value)}
                    placeholder="e.g., 1, 2, 3..."
                    className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-purple-500 focus:outline-none text-white"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Use a unique number (suggested: {Date.now()})
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
                    placeholder="Enter your event ID"
                    className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-purple-500 focus:outline-none text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Word to Track</label>
                  <input
                    type="text"
                    value={newMarketWord}
                    onChange={(e) => setNewMarketWord(e.target.value)}
                    placeholder="e.g., Mexico, Left, Taxes"
                    className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-purple-500 focus:outline-none text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Fee (basis points)</label>
                  <input
                    type="number"
                    value={newMarketFee}
                    onChange={(e) => setNewMarketFee(e.target.value)}
                    placeholder="100 = 1%"
                    className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-purple-500 focus:outline-none text-white"
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
        {connected && events.length > 0 && (
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
                      <p className="text-xs text-gray-400 font-mono">
                        {event.eventPda.toString().slice(0, 30)}...
                      </p>
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
                              <h4 className="font-semibold text-lg">"{market.word}"</h4>
                              <p className="text-xs text-gray-400">
                                Fee: {market.marketData.feeBps}bp
                              </p>
                            </div>
                            <div className="flex gap-2">
                              {!market.marketData.resolved && (
                                <>
                                  <button
                                    onClick={() => handleAddLiquidity(event.eventId, market.marketId, market.marketPda)}
                                    disabled={loading}
                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm transition-all disabled:opacity-50"
                                  >
                                    💧 Add Liquidity
                                  </button>
                                  <button
                                    onClick={() => handleResolveMarket(event.eventId, market.marketId, market.marketPda, "yes")}
                                    disabled={loading}
                                    className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-sm transition-all disabled:opacity-50"
                                  >
                                    Resolve YES
                                  </button>
                                  <button
                                    onClick={() => handleResolveMarket(event.eventId, market.marketId, market.marketPda, "no")}
                                    disabled={loading}
                                    className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm transition-all disabled:opacity-50"
                                  >
                                    Resolve NO
                                  </button>
                                </>
                              )}
                              {market.marketData.resolved && (
                                <span className="px-3 py-1 bg-yellow-500/20 text-yellow-300 rounded-full text-sm">
                                  Resolved: {'yes' in market.marketData.winningSide ? "YES" : "NO"}
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
        {connected && events.length === 0 && !loading && (
          <div className="mt-8 bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10">
            <h3 className="text-xl font-bold mb-4">🚀 Quick Start</h3>
            <ol className="space-y-2 text-sm">
              <li>1. Create an Event with a unique ID (try using: {Date.now()})</li>
              <li>2. Create Markets for words you want to track (e.g., "Mexico", "Left", "Taxes")</li>
              <li>3. After the event, resolve markets by selecting YES or NO</li>
              <li>4. Users can then redeem their winning tokens for SOL</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

