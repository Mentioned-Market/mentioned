"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@/contexts/WalletContext";
import {
  address as toAddress,
  type Address,
} from "@solana/kit";
import {
  PROGRAM_ID,
  createDepositIx,
  createWithdrawIx,
  createMarketGroupIxs,
  createPauseGroupIxs,
  createResolveMarketIx,
  fetchEscrow,
  fetchAllWordMarkets,
  solToLamports,
  lamportsToSol,
  marketStatusStr,
  outcomeStr,
  sendIxs,
  Outcome,
  MarketStatus,
  type UserEscrow,
  type WordMarket,
} from "@/lib/mentionMarket";

// Group markets by marketId for display
type MarketGroup = {
  marketId: bigint;
  words: Array<{
    pubkey: Address;
    data: WordMarket;
  }>;
};

function groupMarkets(
  markets: Array<{ pubkey: Address; account: WordMarket }>
): MarketGroup[] {
  const map = new Map<string, MarketGroup>();
  for (const m of markets) {
    const key = m.account.marketId.toString();
    if (!map.has(key)) {
      map.set(key, { marketId: m.account.marketId, words: [] });
    }
    map.get(key)!.words.push({ pubkey: m.pubkey, data: m.account });
  }
  // Sort words within each group by wordIndex
  const groups = Array.from(map.values());
  for (const g of groups) {
    g.words.sort((a, b) => a.data.wordIndex - b.data.wordIndex);
  }
  return groups;
}

// ── Component ────────────────────────────────────────────

export default function AdminPage() {
  const { publicKey, connect, disconnect, connected, signer, balance } =
    useWallet();

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{
    msg: string;
    error: boolean;
  } | null>(null);

  // Escrow
  const [escrow, setEscrow] = useState<UserEscrow | null>(null);
  const [depositAmt, setDepositAmt] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");

  // Create market group
  const [marketIdInput, setMarketIdInput] = useState("");
  const [wordsInput, setWordsInput] = useState("");

  // All markets
  const [marketGroups, setMarketGroups] = useState<MarketGroup[]>([]);

  const show = (msg: string, error = false) => {
    setStatus({ msg, error });
    setTimeout(() => setStatus(null), 8000);
  };

  // ── Data loading ──

  const loadEscrow = useCallback(async () => {
    if (!publicKey) return;
    try {
      const data = await fetchEscrow(toAddress(publicKey));
      setEscrow(data);
    } catch (e: any) {
      console.error("Error loading escrow:", e);
    }
  }, [publicKey]);

  const loadMarkets = useCallback(async () => {
    try {
      const all = await fetchAllWordMarkets();
      setMarketGroups(groupMarkets(all));
    } catch (e: any) {
      console.error("Error loading markets:", e);
    }
  }, []);

  useEffect(() => {
    if (publicKey && connected) {
      loadEscrow();
      loadMarkets();
    }
  }, [publicKey, connected, loadEscrow, loadMarkets]);

  // ── Actions ──

  const handleDeposit = async () => {
    if (!signer || !publicKey) return;
    const sol = parseFloat(depositAmt);
    if (isNaN(sol) || sol <= 0) {
      show("Enter a valid SOL amount", true);
      return;
    }
    setLoading(true);
    try {
      const ix = await createDepositIx(toAddress(publicKey), solToLamports(sol));
      await sendIxs(signer, [ix]);
      show(`Deposited ${sol} SOL`);
      setDepositAmt("");
      await loadEscrow();
    } catch (e: any) {
      show(e.message, true);
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!signer || !publicKey) return;
    const sol = parseFloat(withdrawAmt);
    if (isNaN(sol) || sol <= 0) {
      show("Enter a valid SOL amount", true);
      return;
    }
    setLoading(true);
    try {
      const ix = await createWithdrawIx(
        toAddress(publicKey),
        solToLamports(sol)
      );
      await sendIxs(signer, [ix]);
      show(`Withdrew ${sol} SOL`);
      setWithdrawAmt("");
      await loadEscrow();
    } catch (e: any) {
      show(e.message, true);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateMarketGroup = async () => {
    if (!signer || !publicKey) return;
    const mId = parseInt(marketIdInput);
    if (isNaN(mId)) {
      show("Enter a valid market ID", true);
      return;
    }
    const words = wordsInput
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);
    if (words.length === 0) {
      show("Enter at least one word", true);
      return;
    }
    if (words.some((w) => w.length > 32)) {
      show("Each word must be 32 characters or fewer", true);
      return;
    }
    setLoading(true);
    try {
      const ixs = await createMarketGroupIxs(
        toAddress(publicKey),
        BigInt(mId),
        words
      );
      await sendIxs(signer, ixs);
      show(
        `Created market #${mId} with ${words.length} word${words.length > 1 ? "s" : ""}: ${words.join(", ")}`
      );
      setWordsInput("");
      await loadMarkets();
    } catch (e: any) {
      show(e.message, true);
    } finally {
      setLoading(false);
    }
  };

  const handlePauseGroup = async (group: MarketGroup) => {
    if (!signer || !publicKey) return;
    setLoading(true);
    try {
      const ixs = await createPauseGroupIxs(
        toAddress(publicKey),
        group.marketId,
        group.words.length
      );
      await sendIxs(signer, ixs);
      show(`Paused all words in market #${group.marketId}`);
      await loadMarkets();
    } catch (e: any) {
      show(e.message, true);
    } finally {
      setLoading(false);
    }
  };

  const handleResolveWord = async (
    marketId: bigint,
    wordIndex: number,
    label: string,
    outcome: Outcome
  ) => {
    if (!signer || !publicKey) return;
    const outcomeLabel = outcome === Outcome.Yes ? "YES" : "NO";
    if (!confirm(`Resolve "${label}" as ${outcomeLabel}?`)) return;
    setLoading(true);
    try {
      const ix = await createResolveMarketIx(
        toAddress(publicKey),
        marketId,
        wordIndex,
        outcome
      );
      await sendIxs(signer, [ix]);
      show(`Resolved "${label}" as ${outcomeLabel}`);
      await loadMarkets();
    } catch (e: any) {
      show(e.message, true);
    } finally {
      setLoading(false);
    }
  };

  // ── UI ─────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-10">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Admin Panel</h1>
            <p className="text-neutral-400 text-sm mt-1">
              mention_market &middot;{" "}
              <span className="font-mono text-xs">
                {(PROGRAM_ID as string).slice(0, 20)}...
              </span>
            </p>
          </div>
          {!connected ? (
            <button
              onClick={connect}
              className="px-5 py-2.5 bg-apple-blue rounded-lg font-medium hover:opacity-90 transition-opacity"
            >
              Connect Wallet
            </button>
          ) : (
            <div className="text-right">
              <p className="font-mono text-sm">
                {publicKey?.slice(0, 4)}...{publicKey?.slice(-4)}
              </p>
              {balance !== null && (
                <p className="text-xs text-neutral-400">
                  {balance.toFixed(2)} SOL
                </p>
              )}
              <button
                onClick={disconnect}
                className="text-xs text-apple-red hover:opacity-80 mt-0.5"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>

        {/* Status */}
        {status && (
          <div
            className={`p-4 rounded-lg border text-sm whitespace-pre-wrap ${
              status.error
                ? "bg-red-500/10 border-red-500/30 text-red-300"
                : "bg-green-500/10 border-green-500/30 text-green-300"
            }`}
          >
            {status.msg}
          </div>
        )}

        {!connected ? (
          <div className="text-center py-24 text-neutral-500">
            <p className="text-xl">
              Connect your Phantom wallet to get started
            </p>
            <p className="text-sm mt-2">
              Make sure you have SOL on Devnet
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* ── Escrow ── */}
            <Card title="Escrow">
              {escrow ? (
                <div className="mb-4 space-y-1 text-sm">
                  <Row
                    label="Balance"
                    value={`${lamportsToSol(escrow.balance)} SOL`}
                  />
                  <Row
                    label="Locked"
                    value={`${lamportsToSol(escrow.locked)} SOL`}
                  />
                </div>
              ) : (
                <p className="text-neutral-500 text-sm mb-4">
                  No escrow account yet. Deposit to create one.
                </p>
              )}
              <div className="flex gap-2 mb-3">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="SOL"
                  value={depositAmt}
                  onChange={(e) => setDepositAmt(e.target.value)}
                  className="flex-1 input"
                />
                <button
                  onClick={handleDeposit}
                  disabled={loading}
                  className="btn bg-apple-green/80 hover:bg-apple-green"
                >
                  Deposit
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="SOL"
                  value={withdrawAmt}
                  onChange={(e) => setWithdrawAmt(e.target.value)}
                  className="flex-1 input"
                />
                <button
                  onClick={handleWithdraw}
                  disabled={loading}
                  className="btn bg-apple-orange/80 hover:bg-apple-orange"
                >
                  Withdraw
                </button>
              </div>
              <button
                onClick={loadEscrow}
                disabled={loading}
                className="mt-3 text-xs text-neutral-400 hover:text-white transition-colors"
              >
                Refresh
              </button>
            </Card>

            {/* ── Create Market Group ── */}
            <Card title="Create Market">
              <div className="space-y-3">
                <div>
                  <label className="label">Market ID</label>
                  <input
                    type="number"
                    value={marketIdInput}
                    onChange={(e) => setMarketIdInput(e.target.value)}
                    placeholder="e.g. 1"
                    className="w-full input"
                  />
                </div>
                <div>
                  <label className="label">Words (comma-separated)</label>
                  <input
                    type="text"
                    value={wordsInput}
                    onChange={(e) => setWordsInput(e.target.value)}
                    placeholder="economy, taxes, jobs, mexico"
                    className="w-full input"
                  />
                  <p className="text-xs text-neutral-500 mt-1">
                    Each word becomes a YES/NO market. All created in one
                    transaction.
                  </p>
                </div>
                <button
                  onClick={handleCreateMarketGroup}
                  disabled={loading || !marketIdInput || !wordsInput}
                  className="w-full btn bg-apple-blue hover:opacity-90"
                >
                  {loading
                    ? "Creating..."
                    : `Create Market (${
                        wordsInput
                          .split(",")
                          .map((w) => w.trim())
                          .filter(Boolean).length
                      } word${
                        wordsInput
                          .split(",")
                          .map((w) => w.trim())
                          .filter(Boolean).length !== 1
                          ? "s"
                          : ""
                      })`}
                </button>
              </div>
            </Card>

            {/* ── Markets ── */}
            <div className="lg:col-span-2">
              <Card title="Markets">
                <button
                  onClick={loadMarkets}
                  disabled={loading}
                  className="mb-4 text-xs text-neutral-400 hover:text-white transition-colors"
                >
                  Refresh ({marketGroups.length} group
                  {marketGroups.length !== 1 ? "s" : ""})
                </button>

                {marketGroups.length === 0 ? (
                  <p className="text-neutral-500 text-sm">
                    No markets found. Create one above.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {marketGroups.map((group) => {
                      const isAuthority =
                        publicKey === (group.words[0]?.data.authority as string);
                      const allActive = group.words.every(
                        (w) => w.data.status === MarketStatus.Active
                      );
                      const allResolved = group.words.every(
                        (w) => w.data.status === MarketStatus.Resolved
                      );

                      return (
                        <div
                          key={group.marketId.toString()}
                          className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-4"
                        >
                          {/* Group header */}
                          <div className="flex justify-between items-center mb-3">
                            <div>
                              <h3 className="font-semibold">
                                Market #{group.marketId.toString()}
                              </h3>
                              <p className="text-xs text-neutral-500">
                                {group.words.length} word
                                {group.words.length !== 1 ? "s" : ""}{" "}
                                &middot; Authority:{" "}
                                {(group.words[0]?.data.authority as string)?.slice(0, 8)}
                                ...
                              </p>
                            </div>
                            {isAuthority && allActive && (
                              <button
                                onClick={() => handlePauseGroup(group)}
                                disabled={loading}
                                className="btn bg-apple-orange/80 hover:bg-apple-orange text-xs"
                              >
                                Pause All
                              </button>
                            )}
                          </div>

                          {/* Words */}
                          <div className="space-y-2">
                            {group.words.map((w) => {
                              const statusColor =
                                w.data.status === MarketStatus.Active
                                  ? "text-apple-green"
                                  : w.data.status === MarketStatus.Paused
                                  ? "text-apple-orange"
                                  : "text-apple-blue";

                              return (
                                <div
                                  key={w.pubkey as string}
                                  className="flex items-center justify-between bg-neutral-900/50 rounded px-3 py-2"
                                >
                                  <div className="flex items-center gap-3">
                                    <span className="font-medium">
                                      &ldquo;{w.data.label}&rdquo;
                                    </span>
                                    <span
                                      className={`text-xs font-medium ${statusColor}`}
                                    >
                                      {marketStatusStr(w.data.status)}
                                    </span>
                                    {w.data.status ===
                                      MarketStatus.Resolved && (
                                      <span className="text-xs text-neutral-400">
                                        = {outcomeStr(w.data.outcome)}
                                      </span>
                                    )}
                                    <span className="text-xs text-neutral-600">
                                      idx:{w.data.wordIndex}
                                    </span>
                                  </div>

                                  {isAuthority &&
                                    w.data.status === MarketStatus.Active && (
                                      <div className="flex gap-1">
                                        <button
                                          onClick={() =>
                                            handleResolveWord(
                                              w.data.marketId,
                                              w.data.wordIndex,
                                              w.data.label,
                                              Outcome.Yes
                                            )
                                          }
                                          disabled={loading}
                                          className="btn bg-apple-green/60 hover:bg-apple-green text-xs py-1 px-2"
                                        >
                                          YES
                                        </button>
                                        <button
                                          onClick={() =>
                                            handleResolveWord(
                                              w.data.marketId,
                                              w.data.wordIndex,
                                              w.data.label,
                                              Outcome.No
                                            )
                                          }
                                          disabled={loading}
                                          className="btn bg-apple-red/60 hover:bg-apple-red text-xs py-1 px-2"
                                        >
                                          NO
                                        </button>
                                      </div>
                                    )}
                                </div>
                              );
                            })}
                          </div>

                          {/* Collateral */}
                          <p className="text-xs text-neutral-600 mt-2">
                            Total collateral:{" "}
                            {lamportsToSol(
                              group.words.reduce(
                                (sum, w) => sum + w.data.totalCollateral,
                                0n
                              )
                            )}{" "}
                            SOL
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        .input {
          padding: 0.5rem 0.75rem;
          border-radius: 0.5rem;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: white;
          font-size: 0.875rem;
          outline: none;
        }
        .input:focus {
          border-color: #007aff;
        }
        .btn {
          padding: 0.5rem 1rem;
          border-radius: 0.5rem;
          font-weight: 500;
          font-size: 0.875rem;
          transition: all 0.15s;
          white-space: nowrap;
        }
        .btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .label {
          display: block;
          font-size: 0.75rem;
          font-weight: 500;
          color: #a3a3a3;
          margin-bottom: 0.25rem;
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
      <h2 className="text-lg font-semibold mb-4">{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-neutral-400">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
