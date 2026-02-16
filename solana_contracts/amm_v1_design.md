# Mentioned — Shared Liquidity AMM: V1 Program Design

## Overview

This document defines the on-chain architecture for Mentioned's shared liquidity AMM on Solana. The system uses a **single SOL pool per market** that backs all word sub-markets simultaneously, with LMSR (Logarithmic Market Scoring Rule) as the pricing function.

The design is built to be **CPI-callable and extensible**, so that a v2 order book + router layer can be added on top without modifying the core AMM logic.

---

## 1. Core Concepts

### What the AMM does

For each market (e.g., "State of the Union"), the AMM:

- Holds a **single pool of SOL** deposited by liquidity providers
- Prices **YES and NO tokens** for each word using the LMSR formula
- Mints tokens on purchase, burns them on sale
- Resolves markets and lets winners redeem SOL

### LMSR Pricing — Per-Word Binary Model

Each word runs its own **independent binary LMSR**. Prices for "Economy" don't affect prices for "Immigration" — they are separate markets that share the same liquidity pool.

**Per-word cost function:**

```
C_i(q_yes, q_no) = b × ln( e^(q_yes / b) + e^(q_no / b) )

Where:
  q_yes = outstanding YES tokens for this word
  q_no  = outstanding NO tokens for this word
  b     = shared liquidity parameter (scales with pool size)
```

The cost of buying N YES tokens for word i is:

```
cost = C_i(q_yes + N, q_no) - C_i(q_yes, q_no)
```

The **implied price** (probability) of YES for word i is:

```
p_yes = e^(q_yes / b) / ( e^(q_yes / b) + e^(q_no / b) )
p_no  = 1 - p_yes
```

**Why per-word and not joint?** Word mentions are independent events. A joint LMSR over all 16 outcomes (8 words × YES/NO) would create artificial price correlation — buying YES on one word would change prices on others. Per-word LMSR keeps prices independent while still sharing the liquidity pool.

**Shared pool:** All words draw from and pay into the same SOL vault. The `b` parameter is shared and scales with total pool size. More LP deposits = deeper liquidity = tighter spreads on every word.

---

## 2. Account Architecture

Every piece of state lives in Solana accounts derived from deterministic seeds (PDAs). This makes them discoverable by any program — critical for v2 CPI calls.

### 2.1 Market Account

One per market. This is the central state container.

```
Seeds: ["market", market_id.to_le_bytes()]

MarketAccount {
    // Header
    version: u8,                          // Schema version (start at 1)
    bump: u8,                             // PDA bump seed
    market_id: u64,                       // Numeric market ID (used in PDAs and frontend URLs)
    label: String,                        // Human-readable name, max 64 chars (e.g. "SOTU 2026")

    // Authority & Config
    authority: Pubkey,                    // Market creator / admin
    resolver: Pubkey,                     // Address authorized to resolve outcomes
    router: Option<Pubkey>,              // V2: authorized router program (None in v1)

    // Pool State
    pool_vault: Pubkey,                   // PDA-controlled native SOL vault
    total_lp_shares: u64,                // Total outstanding LP share tokens
    liquidity_param_b: u64,              // LMSR 'b' parameter (fixed-point, scaled by 1e9)
    base_b_per_sol: u64,                 // How much 'b' increases per SOL deposited

    // Word Sub-Markets
    num_words: u8,                        // Number of words (max 8)
    words: [WordState; 8],                // Fixed array, use num_words for actual count

    // Market Lifecycle
    status: MarketStatus,                 // Open, Paused, Resolved
    created_at: i64,                      // Unix timestamp
    resolves_at: i64,                     // Scheduled resolution time
    resolved_at: Option<i64>,             // Actual resolution time

    // Fees
    trade_fee_bps: u16,                   // Fee on each trade in basis points (e.g., 50 = 0.5%)
    protocol_fee_bps: u16,                // Portion of trade fee going to protocol
    accumulated_fees: u64,                // Fees collected, withdrawable by protocol

    // V2 Extension Space
    _reserved: [u8; 256],                 // Reserved bytes for future fields
}
```

**Dual ID scheme:** `market_id` (u64) is the primary on-chain identifier — used in PDA seeds and frontend URLs (`/market/1`). `label` is a human-readable string for display and backend tracking. The backend can maintain its own mapping from external IDs (UUIDs, hashes) to on-chain `market_id` values.

**Why `_reserved`?** When v2 arrives, you may need fields like `order_book_program`, `routing_config`, or `fee_tier_overrides`. Instead of migrating every market account, you just reinterpret the reserved bytes. The `version` field tells the program which schema to use.

### 2.2 Word State (Embedded in Market Account)

```
WordState {
    word_index: u8,                       // Index within the market (0-7)
    label: String,                        // The word itself, max 32 chars (e.g. "Economy")
    yes_mint: Pubkey,                     // SPL token mint for YES tokens
    no_mint: Pubkey,                      // SPL token mint for NO tokens
    yes_quantity: i64,                    // Net YES tokens outstanding (fixed-point, scaled by 1e9)
    no_quantity: i64,                     // Net NO tokens outstanding (fixed-point, scaled by 1e9)
    outcome: Option<bool>,                // None = unresolved, Some(true) = mentioned
    _reserved: [u8; 32],                  // Per-word extension space
}
```

**Why store the label on-chain?** The frontend already reads word labels directly from on-chain data (current contract does this). Storing labels on-chain makes the system self-describing — no external lookup needed.

### 2.3 LP Share Account

Tracks each liquidity provider's share of the pool.

```
Seeds: ["lp", market_id.to_le_bytes(), lp_wallet]

LpPositionAccount {
    version: u8,
    bump: u8,
    market: Pubkey,                       // Parent market account
    owner: Pubkey,                        // LP's wallet
    shares: u64,                          // Number of LP shares held
    deposited_at: i64,                    // Timestamp of last deposit
    _reserved: [u8; 64],
}
```

LP shares are tracked as a simple ledger rather than a separate SPL token in v1. This keeps things simpler. If you want tradable LP tokens in v2, you can mint an SPL token backed by this ledger.

### 2.4 Pool Vault

The pool holds **native SOL** (lamports) in a PDA account. No wrapped SOL — keeps things simple and avoids wrap/unwrap overhead on every trade.

```
Seeds: ["vault", market_id.to_le_bytes()]
```

The vault is a system-owned PDA. SOL is transferred in/out via `system_program::transfer` (or direct lamport manipulation for PDA → user). Only the AMM program can sign for the vault PDA.

### 2.5 User Escrow (Preserved for V2 CLOB)

The escrow system from the current contract is preserved. Users deposit SOL into their escrow, and AMM trades deduct from escrow balance. This prepares for v2 where the CLOB will also use the escrow for limit order locking.

```
Seeds: ["escrow", user_wallet]

UserEscrow {
    owner: Pubkey,                        // User's wallet address
    balance: u64,                         // Available lamports (can trade or withdraw)
    locked: u64,                          // V2: lamports committed to open CLOB orders
    bump: u8,
}
```

**Why keep escrow for an AMM?**
- **V2 readiness:** The CLOB will need `balance` → `locked` transitions for limit orders. Having users already deposited into escrow means no migration.
- **Unified balance:** Users see one "Cash" balance across both AMM trades and future CLOB orders.
- **Simpler frontend:** The existing deposit modal and balance display in the header continue to work.

**Trade flow with escrow:**
1. User deposits SOL → escrow (existing `deposit` instruction)
2. User buys YES tokens → AMM deducts cost from `escrow.balance`, transfers lamports from escrow PDA to vault, mints tokens
3. User sells YES tokens → AMM burns tokens, transfers lamports from vault to escrow PDA, credits `escrow.balance`
4. User withdraws → escrow sends SOL back to wallet (existing `withdraw` instruction)

---

## 3. Instruction Set

These are the functions the program exposes. Each one is designed to be callable both by user wallets (v1) AND by a router program via CPI (v2).

### 3.1 `deposit` / `withdraw` (User Escrow)

Preserved from the current contract. These manage the user's escrow balance.

```
deposit(amount: u64)

Accounts:
    [signer, writable]  user              // User's wallet
    [writable]          escrow            // PDA: ["escrow", user]
    []                  system_program

Logic:
    1. Transfer `amount` lamports from user to escrow PDA
    2. Increment escrow.balance by `amount`
    3. Initialize escrow if it doesn't exist (set owner, bump)
```

```
withdraw(amount: u64)

Accounts:
    [signer, writable]  user
    [writable]          escrow

Logic:
    1. Verify escrow.balance >= amount
    2. Decrement escrow.balance by `amount`
    3. Transfer `amount` lamports from escrow PDA to user
```

### 3.2 `create_market`

Creates a new market with up to 8 words.

```
Params:
    market_id: u64                        // Numeric ID (used in PDAs and frontend URLs)
    label: String                         // Human-readable name, max 64 chars
    word_labels: Vec<String>              // 1-8 word labels (max 32 chars each)
    resolves_at: i64                      // Resolution timestamp
    resolver: Pubkey                      // Who can resolve
    trade_fee_bps: u16
    initial_b: u64                        // Starting liquidity parameter

Accounts:
    [signer]    authority                 // Market creator, pays rent
    [writable]  market_account            // PDA: ["market", market_id.to_le_bytes()]
    [writable]  pool_vault                // PDA: ["vault", market_id.to_le_bytes()]
    [writable]  yes_mints × num_words     // PDA token mints to initialize
    [writable]  no_mints × num_words      // PDA token mints to initialize
    []          system_program
    []          token_program

Logic:
    1. Initialize market account with all fields
    2. Create pool vault as native SOL PDA
    3. Create YES and NO mint accounts for each word (market PDA is mint authority)
    4. Set status = Open
    5. Set router = None (v2 will populate this)
    6. Store word labels in WordState array
```

### 3.3 `deposit_liquidity`

LP adds SOL to the shared pool.

```
Params:
    amount: u64                           // SOL to deposit (in lamports)

Accounts:
    [signer]    lp_wallet
    [writable]  market_account
    [writable]  pool_vault
    [writable]  lp_position               // LP's position PDA
    []          system_program
    []          token_program

Logic:
    1. Transfer SOL from lp_wallet to pool_vault
    2. Calculate LP shares:
        - If pool is empty: shares = amount
        - Otherwise: shares = amount × (total_lp_shares / pool_vault.balance)
    3. Mint shares to LP position
    4. Update total_lp_shares
    5. Optionally scale liquidity_param_b based on new pool size
```

**The `b` scaling decision:** You can either keep `b` fixed (simpler) or scale it proportionally with pool size (more capital-efficient). If you scale it:

```
new_b = base_b_per_sol × pool_vault.balance / 1e9
```

This means more LP deposits = deeper liquidity = tighter prices. Most prediction market AMMs do this.

### 3.4 `withdraw_liquidity`

LP removes their share of the pool.

```
Params:
    shares_to_burn: u64

Accounts:
    [signer]    lp_wallet
    [writable]  market_account
    [writable]  pool_vault
    [writable]  lp_position

Logic:
    1. Verify lp_position.shares >= shares_to_burn
    2. Calculate SOL to return:
        sol_out = shares_to_burn × (pool_vault.balance / total_lp_shares)
    3. Transfer SOL from pool_vault to lp_wallet
    4. Reduce lp_position.shares and total_lp_shares
    5. Rescale b if using dynamic b
```

**Important:** If the market has open positions, the pool balance reflects unrealized P&L. An LP withdrawing mid-market is getting their proportional share of the current pool, which might be more or less than what they deposited. This is the risk they take.

### 3.5 `get_quote` (Read-Only)

Returns the cost of a hypothetical trade WITHOUT executing it. This is the key function the v2 router will call to compare AMM prices against the order book.

```
Params:
    word_index: u8                        // Which word (0-7)
    direction: Side                       // YES or NO
    quantity: u64                         // How many tokens

Accounts:
    []          market_account            // Read-only

Returns (via return data or simulation):
    cost: u64                             // SOL cost for this trade
    avg_price: u64                        // Average price per token (fixed-point)
    new_implied_prob: u64                 // Price after trade (fixed-point)
```

**Implementation note:** Solana programs can't directly return values to external callers (only to CPI callers). For v1, the frontend calculates quotes client-side using the same math. For v2, the router calls this via CPI and reads the return data. Build both paths.

### 3.6 `buy`

Purchase YES or NO tokens for a specific word. Cost is deducted from the user's escrow balance.

```
Params:
    word_index: u8
    direction: Side                       // YES or NO
    quantity: u64                         // Tokens to buy (scaled by 1e9)
    max_cost: u64                         // Slippage protection: max lamports willing to pay

Accounts:
    [signer]    trader                    // OR router program in v2
    [writable]  trader_escrow             // PDA: ["escrow", trader]
    [writable]  market_account
    [writable]  pool_vault
    [writable]  token_mint                // The YES or NO mint for this word
    [writable]  trader_token_account      // Trader's ATA for the token
    []          token_program
    []          system_program

Logic:
    1. Verify market status == Open
    2. Verify word_index < num_words
    3. Calculate cost using per-word binary LMSR:
        a. Read q_yes, q_no for this word
        b. Compute C_before = b × ln(e^(q_yes/b) + e^(q_no/b))
        c. Increment the target direction's quantity by `quantity`
        d. Compute C_after = b × ln(e^(q_yes'/b) + e^(q_no'/b))
        e. cost = C_after - C_before
    4. Apply trade fee: total_cost = cost + (cost × trade_fee_bps / 10000)
    5. Verify total_cost <= max_cost (slippage check)
    6. Verify trader_escrow.balance >= total_cost
    7. Deduct total_cost from trader_escrow.balance
    8. Transfer total_cost lamports from escrow PDA to pool_vault
    9. Accumulate fee portion in accumulated_fees
    10. Mint `quantity` tokens to trader's token account
    11. Update word's yes_quantity or no_quantity
    12. Emit trade event (for indexing)
```

**Escrow-based trading:** The user must have deposited SOL into their escrow first. The buy instruction deducts from `escrow.balance` and transfers lamports to the vault. This keeps the same UX as the current contract and prepares for v2 CLOB where `balance` → `locked` transitions happen for limit orders.

**The `signer` flexibility:** In v1, the signer is always the trader's wallet. In v2, the router program might be the one calling `buy` via CPI, having already collected SOL from the trader. The program validates the escrow ownership and balance — it doesn't care who initiated the call.

### 3.7 `sell`

Sell tokens back to the AMM. Proceeds are credited to the user's escrow balance.

```
Params:
    word_index: u8
    direction: Side
    quantity: u64                         // Tokens to sell (scaled by 1e9)
    min_return: u64                       // Slippage protection: min lamports to receive

Accounts:
    [signer]    trader
    [writable]  trader_escrow             // PDA: ["escrow", trader]
    [writable]  market_account
    [writable]  pool_vault
    [writable]  token_mint                // The YES or NO mint for this word
    [writable]  trader_token_account      // Trader's ATA for the token
    []          token_program
    []          system_program

Logic:
    1. Verify market status == Open
    2. Verify trader holds >= quantity tokens
    3. Calculate return using per-word binary LMSR:
        a. Read q_yes, q_no for this word
        b. Compute C_before, decrement target direction by quantity, compute C_after
        c. return_amount = C_before - C_after
    4. Apply trade fee: net_return = return_amount - (return_amount × trade_fee_bps / 10000)
    5. Verify net_return >= min_return (slippage check)
    6. Burn `quantity` tokens from trader's token account
    7. Transfer net_return lamports from pool_vault to escrow PDA
    8. Credit net_return to trader_escrow.balance
    9. Accumulate fee portion in accumulated_fees
    10. Update word's yes_quantity or no_quantity
    11. Emit trade event
```

### 3.8 `resolve_word`

Called by the resolver to report whether a word was mentioned.

```
Params:
    word_index: u8
    outcome: bool                         // true = mentioned, false = not mentioned

Accounts:
    [signer]    resolver                  // Must match market.resolver
    [writable]  market_account

Logic:
    1. Verify signer == market.resolver
    2. Verify market.words[word_index].outcome == None
    3. Set market.words[word_index].outcome = Some(outcome)
    4. If ALL words now resolved, set market.status = Resolved
```

Words can be resolved individually or all at once. The market is fully resolved only when every word has an outcome.

### 3.9 `redeem`

Winning token holders redeem SOL. Proceeds go to the user's escrow balance.

```
Params:
    word_index: u8
    direction: Side

Accounts:
    [signer]    trader
    [writable]  trader_escrow             // PDA: ["escrow", trader]
    [writable]  market_account
    [writable]  pool_vault
    [writable]  token_mint
    [writable]  trader_token_account
    []          token_program
    []          system_program

Logic:
    1. Verify word is resolved
    2. Verify direction matches outcome:
        - If outcome == true, only YES holders redeem
        - If outcome == false, only NO holders redeem
    3. Calculate payout: 1 SOL (1e9 lamports) per token
    4. Burn all tokens from trader
    5. Transfer payout lamports from pool_vault to escrow PDA
    6. Credit payout to trader_escrow.balance
    7. Emit redemption event
```

**Why credit escrow instead of wallet?** Keeps funds in the system for reinvestment into other markets. The user can withdraw to their wallet at any time via the `withdraw` instruction.

---

## 4. Fixed-Point Math Library

All on-chain math uses **fixed-point integers** scaled by `PRECISION = 1_000_000_000` (1e9). No floating point.

```rust
const PRECISION: u64 = 1_000_000_000;      // 1e9

// Example: a price of 0.65 SOL is stored as 650_000_000
// Example: b = 100.0 is stored as 100_000_000_000

/// Fixed-point natural log approximation
/// Uses a polynomial or lookup table approach
/// Input and output scaled by PRECISION
fn fp_ln(x: u64) -> i64 { /* implementation */ }

/// Fixed-point exponential approximation
/// Input: i64 (can be negative)
/// Output: u64 (always positive)
fn fp_exp(x: i64) -> u64 { /* implementation */ }
```

### Per-Word Binary LMSR

Each word has exactly 2 outcomes (YES/NO), so the cost function per word is:

```rust
/// Binary LMSR cost function for a single word
/// q_yes, q_no: outstanding quantities (fixed-point, scaled by 1e9)
/// b: liquidity parameter (fixed-point, scaled by 1e9)
fn binary_lmsr_cost(q_yes: i64, q_no: i64, b: u64) -> u64 {
    // C(q_yes, q_no) = b * ln( exp(q_yes / b) + exp(q_no / b) )
    let exp_yes = fp_exp((q_yes as i128 * PRECISION as i128 / b as i128) as i64) as u128;
    let exp_no  = fp_exp((q_no  as i128 * PRECISION as i128 / b as i128) as i64) as u128;
    let sum = exp_yes + exp_no;
    let ln_sum = fp_ln(sum as u64);  // may need u128→u64 scaling
    (b as i128 * ln_sum as i128 / PRECISION as i128) as u64
}

/// Cost to buy `amount` of YES or NO for a single word
fn calculate_buy_cost(
    q_yes: i64,
    q_no: i64,
    direction: Side,
    amount: u64,
    b: u64,
) -> u64 {
    let cost_before = binary_lmsr_cost(q_yes, q_no, b);

    let (new_yes, new_no) = match direction {
        Side::Yes => (q_yes + amount as i64, q_no),
        Side::No  => (q_yes, q_no + amount as i64),
    };

    let cost_after = binary_lmsr_cost(new_yes, new_no, b);
    cost_after - cost_before
}

/// Implied YES price for a single word
fn implied_price(q_yes: i64, q_no: i64, b: u64) -> u64 {
    // p_yes = exp(q_yes / b) / (exp(q_yes / b) + exp(q_no / b))
    let exp_yes = fp_exp((q_yes as i128 * PRECISION as i128 / b as i128) as i64) as u128;
    let exp_no  = fp_exp((q_no  as i128 * PRECISION as i128 / b as i128) as i64) as u128;
    (exp_yes * PRECISION as u128 / (exp_yes + exp_no)) as u64
}
```

### Why per-word is simpler

With a binary LMSR per word, each buy/sell only needs 2 `exp()` calls (YES and NO for that word), not 16 (all outcomes across all words). This keeps compute costs low and predictable.

**Precision note:** Use `u128` for intermediate calculations to avoid overflow. Test with edge cases: prices near 0 and 1, large trade sizes, and empty initial state (q_yes = q_no = 0 → price = 0.50).

---

## 5. Event Emission

Emit events for every state change. These are indexed off-chain for the frontend, analytics, and v2 router logic.

```rust
#[event]
struct TradeEvent {
    market_id: u64,
    word_index: u8,
    direction: Side,          // YES or NO
    quantity: u64,
    cost: u64,                // Lamports paid/received
    fee: u64,
    new_yes_qty: i64,
    new_no_qty: i64,
    implied_yes_price: u64,   // New YES price after trade (fixed-point)
    trader: Pubkey,
    timestamp: i64,
}

#[event]
struct LiquidityEvent {
    market_id: u64,
    provider: Pubkey,
    action: LpAction,         // Deposit or Withdraw
    sol_amount: u64,
    shares: u64,
    new_pool_balance: u64,
    new_b: u64,
    timestamp: i64,
}

#[event]
struct ResolutionEvent {
    market_id: u64,
    word_index: u8,
    outcome: bool,
    resolver: Pubkey,
    timestamp: i64,
}

#[event]
struct RedemptionEvent {
    market_id: u64,
    word_index: u8,
    direction: Side,
    tokens_burned: u64,
    sol_paid: u64,
    redeemer: Pubkey,
    timestamp: i64,
}
```

---

## 6. V2 Extension Points

Here's exactly where v2 plugs in, and what you DON'T need to build now but should be aware of.

### 6.1 The Router

A separate Solana program that sits between the trader and the AMM.

```
V1 flow:    Trader → AMM Program
V2 flow:    Trader → Router Program → (Order Book | AMM Program)
```

The router calls `get_quote` on the AMM via CPI, compares it to the best order book price, and routes accordingly. The AMM's `buy` and `sell` instructions work identically — the router just calls them instead of the trader calling them directly.

**What to build now for this:** Make sure the `buy`/`sell` instructions don't assume the signer IS the trader. Instead, accept a `beneficiary` account that receives the tokens. In v1, beneficiary == signer. In v2, the router is the signer but the trader is the beneficiary.

### 6.2 The Router Authorization

The `router` field in MarketAccount (currently `None`) will be set to the router program's address in v2. The AMM can then optionally verify that CPI calls come from the authorized router.

```
// V1: No router check
// V2: If market.router is Some, verify caller == market.router for CPI calls
```

### 6.3 Fee Tier Overrides

In v2, DMMs might get different fee rates. The `_reserved` space in MarketAccount can hold a fee schedule or pointer to a fee config account.

### 6.4 Order Book Integration

The order book is a completely separate program. It maintains its own state (open orders, maker balances). The router reads from both the order book and the AMM to find the best execution path.

The AMM doesn't need to know the order book exists. It just processes buy/sell instructions from whoever calls it. This separation of concerns is what makes the v2 extension clean.

---

## 7. Account Sizing

Solana charges rent for account storage. Here are the sizes:

```
MarketAccount:
    Header (version, bump, market_id, label):   ~80 bytes
    Authority + resolver + router:              ~100 bytes
    Pool state + LP tracking:                   ~40 bytes
    8 × WordState (each ~140 bytes):            ~1,120 bytes
    Lifecycle + fees:                           ~50 bytes
    _reserved:                                  256 bytes
    TOTAL:                                      ~1,646 bytes
    Rent: ~0.013 SOL

LpPositionAccount:
    ~120 bytes
    Rent: ~0.001 SOL

Pool Vault (Native SOL PDA):
    0 bytes data (just holds lamports)
    Rent-exempt minimum: ~0.001 SOL

UserEscrow:
    49 bytes (32 owner + 8 balance + 8 locked + 1 bump)
    Rent: ~0.001 SOL
```

Total cost to create a market: roughly 0.015 SOL in rent (reclaimable when market closes).
User escrow is created once per user (~0.001 SOL, reclaimable).

---

## 8. Security Considerations

### Access Control

- Only `authority` can pause/unpause markets
- Only `resolver` can resolve word outcomes
- Only the AMM program PDA can move funds from the vault
- In v2, only the authorized `router` can make CPI calls (optional enforcement)

### Economic Safety

- `max_cost` and `min_return` parameters prevent sandwich attacks and slippage
- Trade fees create a spread that protects LPs from small-value arbitrage
- The `b` parameter bounds maximum LP loss per word: worst case = b × ln(2)
- Escrow balance checks prevent users from spending more than they deposited
- Per-word LMSR isolates risk: a large trade on one word doesn't affect other words' prices

### On-Chain Safety

- All math uses checked arithmetic (overflow panics rather than wrapping)
- Fixed-point precision is validated — no division by zero in edge cases
- Account ownership and PDA derivation are verified on every instruction
- Token mint authority is always the market PDA — no external minting possible

---

## 9. Summary: What to Build for V1

| Component | Status | Notes |
|-----------|--------|-------|
| Market account + PDA derivation (u64 ID) | Build now | Include version, label, reserved bytes |
| Pool vault (native lamports PDA) | Build now | System-owned PDA, no wrapped SOL |
| User escrow (deposit/withdraw) | Build now | Preserved from current contract for v2 CLOB |
| YES/NO token mints per word | Build now | Market PDA as mint authority |
| Per-word binary LMSR (fixed-point) | Build now | Independent prices, shared `b` param |
| `deposit` / `withdraw` escrow | Build now | Unchanged from current contract |
| `create_market` instruction | Build now | u64 market_id + label + word labels |
| `deposit_liquidity` instruction | Build now | Dynamic b scaling optional |
| `withdraw_liquidity` instruction | Build now | |
| `buy` instruction (from escrow) | Build now | Deducts from escrow.balance, include beneficiary for v2 |
| `sell` instruction (to escrow) | Build now | Credits escrow.balance, include beneficiary for v2 |
| `get_quote` (CPI-compatible) | Build now | Router will call this in v2 |
| `resolve_word` instruction | Build now | |
| `redeem` instruction (to escrow) | Build now | Credits escrow.balance |
| Event emission | Build now | Index off-chain for frontend + analytics |
| Escrow `lock_funds` / `unlock_funds` | V2 | For CLOB limit order locking |
| Router program | V2 | AMM is already CPI-ready |
| Order book program | V2 | Separate program, AMM doesn't know about it |
| Fee tier overrides | V2 | Use reserved bytes in market account |
| Tradable LP tokens (SPL) | V2 | Shares ledger already tracks ownership |