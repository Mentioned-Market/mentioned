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
  createCreateMarketIx,
  createPauseMarketIx,
  createResolveWordIx,
  createDepositLiquidityIx,
  createWithdrawLiquidityIx,
  createSetComputeUnitLimitIx,
  fetchEscrow,
  fetchAllMarkets,
  fetchLpPosition,
  fetchVaultBalance,
  solToLamports,
  lamportsToSol,
  marketStatusStr,
  outcomeStr,
  sendIxs,
  MarketStatus,
  type UserEscrow,
  type MarketAccount,
  type LpPosition,
} from "@/lib/mentionMarket";

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

  // Create market
  const [marketIdInput, setMarketIdInput] = useState("");
  const [marketLabelInput, setMarketLabelInput] = useState("");
  const [wordsInput, setWordsInput] = useState("");
  const [resolvesInHours, setResolvesInHours] = useState("24");
  const [tradeFeeBpsInput, setTradeFeeBpsInput] = useState("50");
  const [initialBInput, setInitialBInput] = useState("1");
  const [baseBPerSolInput, setBaseBPerSolInput] = useState("1");

  // All markets
  const [markets, setMarkets] = useState<
    Array<{ pubkey: Address; account: MarketAccount }>
  >([]);

  // Liquidity inputs per market (keyed by marketId string)
  const [liquidityAmts, setLiquidityAmts] = useState<Record<string, string>>({});

  // Bulk resolve selections: marketId -> wordIndex -> outcome (true=YES, false=NO, undefined=not set)
  const [bulkResolves, setBulkResolves] = useState<
    Record<string, Record<number, boolean>>
  >({});

  // LP positions per market (keyed by marketId string)
  const [lpPositions, setLpPositions] = useState<Record<string, LpPosition | null>>({});
  // Vault balances per market (keyed by marketId string)
  const [vaultBalances, setVaultBalances] = useState<Record<string, bigint>>({});

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
    } catch (e: unknown) {
      console.error("Error loading escrow:", e);
    }
  }, [publicKey]);

  const loadMarkets = useCallback(async () => {
    try {
      const all = await fetchAllMarkets();
      setMarkets(all);
      return all;
    } catch (e: unknown) {
      console.error("Error loading markets:", e);
      return [];
    }
  }, []);

  const loadLpData = useCallback(async (
    marketList: Array<{ pubkey: Address; account: MarketAccount }>
  ) => {
    if (!publicKey) return;
    const addr = toAddress(publicKey);
    const lpResults: Record<string, LpPosition | null> = {};
    const vaultResults: Record<string, bigint> = {};
    await Promise.all(
      marketList.map(async (m) => {
        const key = m.account.marketId.toString();
        const [lp, vault] = await Promise.all([
          fetchLpPosition(m.account.marketId, addr).catch(() => null),
          fetchVaultBalance(m.account.marketId).catch(() => 0n),
        ]);
        lpResults[key] = lp;
        vaultResults[key] = vault;
      })
    );
    setLpPositions(lpResults);
    setVaultBalances(vaultResults);
  }, [publicKey]);

  useEffect(() => {
    if (publicKey && connected) {
      loadEscrow();
      loadMarkets().then((all) => loadLpData(all));
    }
  }, [publicKey, connected, loadEscrow, loadMarkets, loadLpData]);

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
    } catch (e: unknown) {
      show((e as Error).message, true);
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
    } catch (e: unknown) {
      show((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateMarket = async () => {
    if (!signer || !publicKey) return;
    const mId = parseInt(marketIdInput);
    if (isNaN(mId)) {
      show("Enter a valid market ID", true);
      return;
    }
    const label = marketLabelInput.trim();
    if (!label) {
      show("Enter a market label", true);
      return;
    }
    if (label.length > 64) {
      show("Market label must be 64 characters or fewer", true);
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
    if (words.length > 8) {
      show("Maximum 8 words per market", true);
      return;
    }
    if (words.some((w) => w.length > 32)) {
      show("Each word must be 32 characters or fewer", true);
      return;
    }

    const hours = parseFloat(resolvesInHours);
    if (isNaN(hours) || hours <= 0) {
      show("Enter valid hours until resolution", true);
      return;
    }
    const resolvesAt = BigInt(
      Math.floor(Date.now() / 1000 + hours * 3600)
    );

    const feeBps = parseInt(tradeFeeBpsInput);
    if (isNaN(feeBps) || feeBps < 0 || feeBps > 10000) {
      show("Trade fee must be 0-10000 bps", true);
      return;
    }

    const initialBSol = parseFloat(initialBInput);
    if (isNaN(initialBSol) || initialBSol <= 0) {
      show("Enter a valid initial B (SOL)", true);
      return;
    }
    const initialB = solToLamports(initialBSol);

    const baseBSol = parseFloat(baseBPerSolInput);
    if (isNaN(baseBSol) || baseBSol <= 0) {
      show("Enter a valid base B per SOL", true);
      return;
    }
    const baseBPerSol = solToLamports(baseBSol);

    setLoading(true);
    try {
      const ix = await createCreateMarketIx(
        toAddress(publicKey),
        BigInt(mId),
        label,
        words,
        resolvesAt,
        toAddress(publicKey), // resolver = authority
        feeBps,
        initialB,
        baseBPerSol
      );
      const computeIx = createSetComputeUnitLimitIx(800_000);
      await sendIxs(signer, [computeIx, ix]);
      show(
        `Created market #${mId} "${label}" with ${words.length} word${words.length > 1 ? "s" : ""}: ${words.join(", ")}`
      );
      setMarketIdInput("");
      setMarketLabelInput("");
      setWordsInput("");
      await loadMarkets();
    } catch (e: unknown) {
      show((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  };

  const handlePauseMarket = async (market: MarketAccount) => {
    if (!signer || !publicKey) return;
    setLoading(true);
    try {
      const ix = await createPauseMarketIx(
        toAddress(publicKey),
        market.marketId
      );
      await sendIxs(signer, [ix]);
      const action = market.status === MarketStatus.Paused ? "Unpaused" : "Paused";
      show(`${action} market #${market.marketId}`);
      await loadMarkets();
    } catch (e: unknown) {
      show((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  };

  const handleResolveWord = async (
    marketId: bigint,
    wordIndex: number,
    label: string,
    outcome: boolean
  ) => {
    if (!signer || !publicKey) return;
    const outcomeLabel = outcome ? "YES" : "NO";
    if (!confirm(`Resolve "${label}" as ${outcomeLabel}?`)) return;
    setLoading(true);
    try {
      const ix = await createResolveWordIx(
        toAddress(publicKey),
        marketId,
        wordIndex,
        outcome
      );
      await sendIxs(signer, [ix]);
      show(`Resolved "${label}" as ${outcomeLabel}`);
      await loadMarkets();
    } catch (e: unknown) {
      show((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  };

  const handleDepositLiquidity = async (market: MarketAccount) => {
    if (!signer || !publicKey) return;
    const key = market.marketId.toString();
    const sol = parseFloat(liquidityAmts[key] || "");
    if (isNaN(sol) || sol <= 0) {
      show("Enter a valid SOL amount", true);
      return;
    }
    setLoading(true);
    try {
      const ix = await createDepositLiquidityIx(
        toAddress(publicKey),
        market.marketId,
        solToLamports(sol)
      );
      await sendIxs(signer, [ix]);
      show(`Deposited ${sol} SOL liquidity to market #${key}`);
      setLiquidityAmts((prev) => ({ ...prev, [key]: "" }));
      const all = await loadMarkets();
      await loadLpData(all);
    } catch (e: unknown) {
      show((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  };

  const handleWithdrawLiquidity = async (market: MarketAccount) => {
    if (!signer || !publicKey) return;
    const key = market.marketId.toString();
    const sol = parseFloat(liquidityAmts[key] || "");
    if (isNaN(sol) || sol <= 0) {
      show("Enter a valid amount of LP shares", true);
      return;
    }
    setLoading(true);
    try {
      const ix = await createWithdrawLiquidityIx(
        toAddress(publicKey),
        market.marketId,
        solToLamports(sol)
      );
      await sendIxs(signer, [ix]);
      show(`Withdrew ${sol} LP shares from market #${key}`);
      setLiquidityAmts((prev) => ({ ...prev, [key]: "" }));
      const all = await loadMarkets();
      await loadLpData(all);
    } catch (e: unknown) {
      show((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  };

  const setBulkOutcome = (
    marketId: string,
    wordIndex: number,
    outcome: boolean
  ) => {
    setBulkResolves((prev) => {
      const current = prev[marketId] || {};
      // Toggle off if same value clicked
      if (current[wordIndex] === outcome) {
        const { [wordIndex]: _, ...rest } = current;
        return { ...prev, [marketId]: rest };
      }
      return { ...prev, [marketId]: { ...current, [wordIndex]: outcome } };
    });
  };

  const handleBulkResolve = async (market: MarketAccount) => {
    if (!signer || !publicKey) return;
    const key = market.marketId.toString();
    const selections = bulkResolves[key] || {};
    const entries = Object.entries(selections);
    if (entries.length === 0) {
      show("Select YES or NO for at least one word", true);
      return;
    }

    const summary = entries
      .map(([idx, outcome]) => {
        const w = market.words.find((w) => w.wordIndex === Number(idx));
        return `"${w?.label}" → ${outcome ? "YES" : "NO"}`;
      })
      .join(", ");

    if (!confirm(`Resolve ${entries.length} word(s): ${summary}?`)) return;

    setLoading(true);
    try {
      const ixs = await Promise.all(
        entries.map(([idx, outcome]) =>
          createResolveWordIx(
            toAddress(publicKey!),
            market.marketId,
            Number(idx),
            outcome
          )
        )
      );
      await sendIxs(signer, ixs);
      show(`Resolved ${entries.length} word(s) in market #${key}`);
      setBulkResolves((prev) => ({ ...prev, [key]: {} }));
      await loadMarkets();
    } catch (e: unknown) {
      show((e as Error).message, true);
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
              mention_market_amm &middot;{" "}
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

            {/* ── Create Market ── */}
            <Card title="Create Market">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
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
                    <label className="label">Label</label>
                    <input
                      type="text"
                      value={marketLabelInput}
                      onChange={(e) => setMarketLabelInput(e.target.value)}
                      placeholder="e.g. SOTU 2025"
                      className="w-full input"
                    />
                  </div>
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
                    Max 8 words. Each becomes a YES/NO binary market.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Resolves in (hours)</label>
                    <input
                      type="number"
                      value={resolvesInHours}
                      onChange={(e) => setResolvesInHours(e.target.value)}
                      placeholder="24"
                      className="w-full input"
                    />
                  </div>
                  <div>
                    <label className="label">Trade Fee (bps)</label>
                    <input
                      type="number"
                      value={tradeFeeBpsInput}
                      onChange={(e) => setTradeFeeBpsInput(e.target.value)}
                      placeholder="50"
                      className="w-full input"
                    />
                    <p className="text-xs text-neutral-500 mt-1">
                      50 = 0.5%
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Initial B (SOL)</label>
                    <input
                      type="number"
                      value={initialBInput}
                      onChange={(e) => setInitialBInput(e.target.value)}
                      placeholder="1"
                      step="0.1"
                      className="w-full input"
                    />
                    <p className="text-xs text-neutral-500 mt-1">
                      LMSR liquidity parameter
                    </p>
                  </div>
                  <div>
                    <label className="label">Base B per SOL</label>
                    <input
                      type="number"
                      value={baseBPerSolInput}
                      onChange={(e) => setBaseBPerSolInput(e.target.value)}
                      placeholder="1"
                      step="0.1"
                      className="w-full input"
                    />
                    <p className="text-xs text-neutral-500 mt-1">
                      B scaling rate
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleCreateMarket}
                  disabled={loading || !marketIdInput || !wordsInput || !marketLabelInput}
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
                  Refresh ({markets.length} market
                  {markets.length !== 1 ? "s" : ""})
                </button>

                {markets.length === 0 ? (
                  <p className="text-neutral-500 text-sm">
                    No markets found. Create one above.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {markets.map((m) => {
                      const market = m.account;
                      const mKey = market.marketId.toString();
                      const isAuthority =
                        publicKey === (market.authority as string);
                      const canPause =
                        market.status === MarketStatus.Open ||
                        market.status === MarketStatus.Paused;
                      const allResolved =
                        market.status === MarketStatus.Resolved;
                      const unresolvedWords = market.words.filter(
                        (w) => w.outcome === null
                      );
                      const bulkSelections = bulkResolves[mKey] || {};
                      const bulkCount = Object.keys(bulkSelections).length;

                      return (
                        <div
                          key={mKey}
                          className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-4"
                        >
                          {/* Market header */}
                          <div className="flex justify-between items-center mb-3">
                            <div>
                              <h3 className="font-semibold">
                                Market #{mKey}{" "}
                                <span className="text-neutral-400 font-normal">
                                  &mdash; {market.label}
                                </span>
                              </h3>
                              <p className="text-xs text-neutral-500">
                                {market.numWords} word
                                {market.numWords !== 1 ? "s" : ""} &middot;{" "}
                                <span
                                  className={
                                    market.status === MarketStatus.Open
                                      ? "text-apple-green"
                                      : market.status === MarketStatus.Paused
                                      ? "text-apple-orange"
                                      : "text-apple-blue"
                                  }
                                >
                                  {marketStatusStr(market.status)}
                                </span>{" "}
                                &middot; B:{" "}
                                {lamportsToSol(market.liquidityParamB)} SOL
                                &middot; LP Shares:{" "}
                                {lamportsToSol(market.totalLpShares)}
                                &middot; Fees:{" "}
                                {lamportsToSol(market.accumulatedFees)} SOL
                              </p>
                              <p className="text-xs text-neutral-600">
                                Authority:{" "}
                                {(market.authority as string).slice(0, 8)}...
                              </p>
                            </div>
                            {isAuthority && canPause && (
                              <button
                                onClick={() => handlePauseMarket(market)}
                                disabled={loading}
                                className="btn bg-apple-orange/80 hover:bg-apple-orange text-xs"
                              >
                                {market.status === MarketStatus.Paused
                                  ? "Unpause"
                                  : "Pause"}
                              </button>
                            )}
                          </div>

                          {/* Liquidity Management */}
                          {isAuthority && (
                            <div className="bg-neutral-900/50 rounded-lg p-3 mb-3">
                              <div className="text-xs text-neutral-400 font-medium mb-2">
                                Liquidity
                              </div>
                              <div className="flex gap-2">
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="SOL"
                                  value={liquidityAmts[mKey] || ""}
                                  onChange={(e) =>
                                    setLiquidityAmts((prev) => ({
                                      ...prev,
                                      [mKey]: e.target.value,
                                    }))
                                  }
                                  className="flex-1 input text-xs"
                                />
                                {!allResolved && (
                                  <button
                                    onClick={() =>
                                      handleDepositLiquidity(market)
                                    }
                                    disabled={loading}
                                    className="btn bg-apple-green/60 hover:bg-apple-green text-xs py-1 px-3"
                                  >
                                    Add Liquidity
                                  </button>
                                )}
                                <button
                                  onClick={() =>
                                    handleWithdrawLiquidity(market)
                                  }
                                  disabled={loading}
                                  className="btn bg-apple-orange/60 hover:bg-apple-orange text-xs py-1 px-3"
                                >
                                  Withdraw
                                </button>
                              </div>
                            </div>
                          )}

                          {/* LP Position Overview */}
                          {(() => {
                            const lp = lpPositions[mKey];
                            const vaultBal = vaultBalances[mKey] ?? 0n;
                            const totalShares = market.totalLpShares;
                            const lpShares = lp?.shares ?? 0n;
                            const lpSharePct = totalShares > 0n
                              ? (Number(lpShares) / Number(totalShares)) * 100
                              : 0;
                            // LP's pro-rata share of the vault
                            const lpVaultValue = totalShares > 0n
                              ? (Number(lpShares) * Number(vaultBal)) / Number(totalShares)
                              : 0;
                            // LP's share of accumulated fees (fees sit in the vault too)
                            const lpFeeShare = totalShares > 0n
                              ? (Number(lpShares) * Number(market.accumulatedFees)) / Number(totalShares)
                              : 0;
                            // Original deposit: for first LP, 1 share = 1 lamport
                            const depositedSol = Number(lpShares) / 1e9;
                            const currentValueSol = lpVaultValue / 1e9;
                            const pnl = currentValueSol - depositedSol;

                            return (
                              <div className="bg-neutral-900/50 rounded-lg p-3 mb-3">
                                <div className="text-xs text-neutral-400 font-medium mb-2">
                                  LP Position
                                </div>
                                {!lp || lpShares === 0n ? (
                                  <div className="text-xs text-neutral-600">
                                    No LP position in this market
                                  </div>
                                ) : (
                                  <>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
                                      <div>
                                        <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Your Shares</div>
                                        <div className="text-sm font-semibold text-white">
                                          {lamportsToSol(lpShares)}
                                          <span className="text-neutral-500 text-xs ml-1">
                                            ({lpSharePct.toFixed(1)}%)
                                          </span>
                                        </div>
                                      </div>
                                      <div>
                                        <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Pool Value</div>
                                        <div className="text-sm font-semibold text-white">
                                          {currentValueSol.toFixed(4)} SOL
                                        </div>
                                      </div>
                                      <div>
                                        <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Deposited</div>
                                        <div className="text-sm font-semibold text-white">
                                          {depositedSol.toFixed(4)} SOL
                                        </div>
                                      </div>
                                      <div>
                                        <div className="text-[10px] text-neutral-500 uppercase tracking-wider">LP P&L</div>
                                        <div className={`text-sm font-semibold ${pnl >= 0 ? 'text-apple-green' : 'text-apple-red'}`}>
                                          {pnl >= 0 ? '+' : ''}{pnl.toFixed(4)} SOL
                                        </div>
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-3">
                                      <div>
                                        <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Vault Balance</div>
                                        <div className="text-xs text-neutral-300">
                                          {(Number(vaultBal) / 1e9).toFixed(4)} SOL
                                        </div>
                                      </div>
                                      <div>
                                        <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Total LP Shares</div>
                                        <div className="text-xs text-neutral-300">
                                          {lamportsToSol(totalShares)}
                                        </div>
                                      </div>
                                      <div>
                                        <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Fee Share</div>
                                        <div className="text-xs text-neutral-300">
                                          {(lpFeeShare / 1e9).toFixed(4)} SOL
                                        </div>
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })()}

                          {/* Words */}
                          <div className="space-y-2">
                            {market.words.map((w) => {
                              const resolved = w.outcome !== null;
                              const canResolve =
                                isAuthority && !resolved && !allResolved;
                              const bulkOutcome =
                                bulkSelections[w.wordIndex];

                              return (
                                <div
                                  key={`${mKey}-${w.wordIndex}`}
                                  className="flex items-center justify-between bg-neutral-900/50 rounded px-3 py-2"
                                >
                                  <div className="flex items-center gap-3">
                                    <span className="font-medium">
                                      &ldquo;{w.label}&rdquo;
                                    </span>
                                    {resolved ? (
                                      <span className="text-xs text-apple-blue">
                                        {outcomeStr(w.outcome)}
                                      </span>
                                    ) : (
                                      <span className="text-xs text-neutral-400">
                                        Unresolved
                                      </span>
                                    )}
                                    <span className="text-xs text-neutral-600">
                                      idx:{w.wordIndex}
                                    </span>
                                    <span className="text-xs text-neutral-600">
                                      Y:{Number(w.yesQuantity) / 1e9} / N:
                                      {Number(w.noQuantity) / 1e9}
                                    </span>
                                  </div>

                                  {canResolve && (
                                    <div className="flex gap-1">
                                      <button
                                        onClick={() =>
                                          setBulkOutcome(
                                            mKey,
                                            w.wordIndex,
                                            true
                                          )
                                        }
                                        disabled={loading}
                                        className={`btn text-xs py-1 px-2 ${
                                          bulkOutcome === true
                                            ? "bg-apple-green text-white"
                                            : "bg-apple-green/30 hover:bg-apple-green/60"
                                        }`}
                                      >
                                        YES
                                      </button>
                                      <button
                                        onClick={() =>
                                          setBulkOutcome(
                                            mKey,
                                            w.wordIndex,
                                            false
                                          )
                                        }
                                        disabled={loading}
                                        className={`btn text-xs py-1 px-2 ${
                                          bulkOutcome === false
                                            ? "bg-apple-red text-white"
                                            : "bg-apple-red/30 hover:bg-apple-red/60"
                                        }`}
                                      >
                                        NO
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {/* Bulk Resolve Button */}
                          {isAuthority &&
                            unresolvedWords.length > 0 &&
                            !allResolved && (
                              <div className="mt-3 flex items-center justify-between">
                                <span className="text-xs text-neutral-500">
                                  {bulkCount > 0
                                    ? `${bulkCount} word${bulkCount !== 1 ? "s" : ""} selected`
                                    : "Click YES/NO to select words for bulk resolve"}
                                </span>
                                <button
                                  onClick={() => handleBulkResolve(market)}
                                  disabled={loading || bulkCount === 0}
                                  className="btn bg-apple-blue/80 hover:bg-apple-blue text-xs"
                                >
                                  Resolve {bulkCount > 0 ? bulkCount : ""} Word
                                  {bulkCount !== 1 ? "s" : ""}
                                </button>
                              </div>
                            )}

                          {/* Market info */}
                          <p className="text-xs text-neutral-600 mt-2">
                            Trade fee: {market.tradeFeeBps} bps &middot;
                            Resolves:{" "}
                            {new Date(
                              Number(market.resolvesAt) * 1000
                            ).toLocaleString()}
                            {market.resolvedAt && (
                              <>
                                {" "}
                                &middot; Resolved:{" "}
                                {new Date(
                                  Number(market.resolvedAt) * 1000
                                ).toLocaleString()}
                              </>
                            )}
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
