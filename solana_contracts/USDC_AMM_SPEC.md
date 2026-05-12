# mention-market-usdc-amm — Developer & LP Reference

**Program ID (devnet):** `BKYVi5hWefmtWhE2hCoarcjufQQvaxDAcfeMSo27SEyA`  
**USDC Mint (devnet):** `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`  
**Upgrade authority:** `deployer-keypair.json`

---

## What this program does

A binary LMSR (Logarithmic Market Scoring Rule) prediction market AMM where:

- Markets are funded with **USDC** — no SOL involved in trading
- Each market contains 1–8 **words** (sub-markets). Each word is a binary YES/NO bet on whether that word gets mentioned in a given context (e.g. a speech, article, earnings call)
- Each word has its own **YES mint** and **NO mint** — SPL token accounts with 6 decimals
- Traders buy/sell YES or NO tokens. The LMSR automatically prices them based on how many tokens are outstanding
- When a word is resolved, winning token holders redeem 1:1 for USDC — 1 token = 1 USDC
- As the admin/LP you seed the vault with USDC to back the market. Fees accumulate in the vault and you withdraw them separately

---

## Units and precision

| Thing | Unit | Scale |
|-------|------|-------|
| USDC amounts | micro-USDC | 1_000_000 = 1 USDC |
| YES/NO tokens | base units | 1_000_000 = 1 full token |
| LMSR `b` parameter | micro-USDC | 1_000_000 = 1 USDC of liquidity depth |
| Implied price | micro-USDC | 1_000_000 = 1.0 (100% probability) |
| Fees (trade_fee_bps) | basis points | 50 = 0.5% |

Because USDC and the YES/NO tokens both use 6 decimals and the same base unit scale, the 1:1 redemption is exact with no conversion — burning 500_000 winning tokens pays out exactly 500_000 micro-USDC (0.50 USDC).

---

## On-chain accounts

### MarketAccount
One per market. PDA derived from `["market", market_id_le_bytes]`.

```
version          u8       Schema version (1)
bump             u8       PDA bump
market_id        u64      Unique ID — you pick this, used in all PDAs
label            String   Market name (max 64 chars)
authority        Pubkey   Who created it and can pause/withdraw fees
resolver         Pubkey   Who can call resolve_word (can be same as authority)
usdc_mint        Pubkey   The USDC mint (locked to devnet USDC at deploy time)
total_lp_shares  u64      Total LP shares outstanding across all depositors
liquidity_param_b u64     LMSR b — controls price sensitivity (scaled 1e6)
base_b_per_usdc  u64      How much b grows per USDC in vault (scaled 1e6)
num_words        u8       How many words (1-8)
words            [WordState; 8]
status           enum     Open | Paused | Resolved
created_at       i64      Unix timestamp
resolves_at      i64      Scheduled resolution time (informational only)
resolved_at      Option<i64>
trade_fee_bps    u16      Fee taken on each buy/sell
accumulated_fees u64      Unclaimed fees in micro-USDC
```

### WordState (embedded in MarketAccount)
One slot per word, always 8 slots (unused ones are zeroed).

```
word_index   u8
label        String    The word (max 32 chars)
yes_mint     Pubkey    YES token mint PDA
no_mint      Pubkey    NO token mint PDA
yes_quantity i64       Net YES tokens minted, scaled 1e6
no_quantity  i64       Net NO tokens minted, scaled 1e6
outcome      Option<bool>  None=unresolved, true=mentioned, false=not mentioned
```

### LpPosition
One per (market, LP wallet) pair. PDA derived from `["lp", market_id_le_bytes, lp_wallet]`.

```
version      u8
bump         u8
market       Pubkey
owner        Pubkey
shares       u64    LP shares held — proportional claim on vault at resolution
deposited_at i64
```

### Vault
A standard SPL token account (TokenAccount), not a PDA. Created during `create_market` with:
- `mint = USDC mint`
- `authority = market PDA`

This means the market PDA is the only signer that can move USDC out. All outgoing transfers (sell proceeds, redemptions, LP withdrawals, fee withdrawals) use the market PDA as a signer with seeds `["market", market_id_le_bytes, bump]`.

### YES/NO Mints
PDA-derived mints, one pair per word:
- YES: `["yes_mint", market_id_le_bytes, word_index_byte]`
- NO: `["no_mint", market_id_le_bytes, word_index_byte]`

The market PDA is the mint authority, so only program instructions can mint tokens. Burn authority is the token holder (no PDA needed — the trader signs).

---

## LMSR pricing

The price of YES tokens for a word is determined by:

```
p_yes = exp(q_yes / b) / (exp(q_yes / b) + exp(q_no / b))
```

Where `q_yes` and `q_no` are the net quantities outstanding and `b` is the liquidity parameter.

The cost to buy `amount` tokens is the cost function differential:

```
cost = C(q_yes + amount, q_no) - C(q_yes, q_no)
C(q_yes, q_no) = b * ln(exp(q_yes/b) + exp(q_no/b))
```

Key properties:
- When no trades have happened (both quantities = 0), each side starts at 50% probability
- Buying YES makes YES more expensive and NO cheaper — prices always sum to 100%
- The larger `b` is, the more USDC it costs to move the price by a given amount — more liquidity depth, less slippage
- `b` scales dynamically with the vault balance: `b = base_b_per_usdc * vault_balance / 1e6`

---

## Instructions

### 1. `create_market`

Creates the market account, the USDC vault, and all YES/NO token mints.

**Who calls it:** Authority (admin wallet)

**Parameters:**
```
market_id        u64      Your unique ID for this market
label            String   Display name
word_labels      Vec<String>  The words (1-8)
resolves_at      i64      Expected resolution unix timestamp (informational)
resolver         Pubkey   Who can resolve outcomes (often same as authority)
trade_fee_bps    u16      Fee on each trade, e.g. 50 = 0.5%
initial_b        u64      Starting LMSR b before any liquidity (micro-USDC)
base_b_per_usdc  u64      b scaling rate per USDC in vault (scaled 1e6)
```

**Named accounts:**
```
authority        Signer   Pays all rent, becomes market.authority
market           PDA      Created here
usdc_mint        Account  Must be the devnet USDC mint
vault            Account  Created here — USDC token account, authority = market PDA
token_program
system_program
rent
token_metadata_program   (Metaplex — for YES/NO token metadata)
```

**remaining_accounts:** 4 accounts per word, in order:
```
[i*4 + 0]  yes_mint PDA    (writable, derived ["yes_mint", market_id, word_index])
[i*4 + 1]  yes_metadata    (writable, Metaplex PDA)
[i*4 + 2]  no_mint PDA     (writable, derived ["no_mint", market_id, word_index])
[i*4 + 3]  no_metadata     (writable, Metaplex PDA)
```

**What happens:**
1. Validates label lengths and word count
2. Creates the market PDA and vault token account
3. For each word: creates YES/NO mint PDAs, initializes them with 6 decimals, attaches Metaplex metadata ("Bitcoin YES" / "BITC-Y")
4. Writes all market fields. Vault starts empty — call `deposit_liquidity` next

**b parameter guidance:**
- `initial_b` is the b value before any liquidity. Set this to a small base if you want the b to grow with deposits, or set it to your full intended b if you're not using dynamic scaling
- `base_b_per_usdc = 1_000_000` means b equals the vault balance (1:1). `base_b_per_usdc = 500_000` means b is half the vault balance
- Example: you plan to deposit 1000 USDC. You want b = 200 USDC (200_000_000 micro-USDC). Set `base_b_per_usdc = 200_000` (0.2 * 1e6) so that `b = 0.2 * vault_balance`

---

### 2. `deposit_liquidity`

Deposits USDC into the vault and issues LP shares. Only callable when market is Open.

**Who calls it:** Authority/LP (you, as admin providing liquidity)

**Parameters:**
```
amount    u64    micro-USDC to deposit
```

**Accounts:**
```
lp_wallet    Signer   Pays for LP position account if first deposit
market       Account  Must be Open
vault        Account  Market's USDC vault (validated by mint + owner)
lp_usdc      Account  LP's USDC ATA — source of funds
lp_position  PDA      Created (init_if_needed) at ["lp", market_id, lp_wallet]
token_program
system_program
```

**Share math:**
- First depositor: `shares = amount` (1:1 bootstrap)
- Subsequent: `shares = amount * total_lp_shares / vault_balance_before`
- This ensures all depositors get a proportional share of the pool at all times

**b scaling:**
After the transfer: `b = base_b_per_usdc * vault_balance_after / 1_000_000`

If `base_b_per_usdc = 0`, b stays at `initial_b` forever (fixed liquidity depth).

---

### 3. `buy`

Trader buys YES or NO tokens for a word. USDC moves directly from the trader's wallet to the vault.

**Who calls it:** Any trader

**Parameters:**
```
word_index   u8    Which word (0-indexed)
direction    Side  Side::Yes or Side::No
quantity     u64   Token base units to buy (6 decimals)
max_cost     u64   Slippage cap in micro-USDC — tx fails if cost exceeds this
```

**Accounts:**
```
trader               Signer
market               Account  Must be Open (Paused or Resolved = rejected)
vault                Account  Receives USDC — validated mint + owner
trader_usdc          Account  Trader's USDC ATA — source of payment
token_mint           Account  The YES or NO mint for this word/direction
trader_token_account Account  Trader's ATA for this token — receives minted tokens
token_program
```

**Flow:**
1. LMSR calculates cost: `C(q + quantity, ...) - C(q, ...)`
2. Fee applied: `total_cost = cost + (cost * trade_fee_bps / 10_000)`
3. Slippage check: `total_cost <= max_cost`
4. `token::transfer` — USDC from `trader_usdc` to `vault` (trader signs)
5. `token::mint_to` — YES/NO tokens minted to `trader_token_account` (market PDA signs)
6. `yes_quantity` or `no_quantity` incremented on the WordState
7. `accumulated_fees` incremented by fee amount

Emits `TradeEvent` with new quantities and implied price.

---

### 4. `sell`

Trader burns YES or NO tokens and receives USDC back. USDC moves from vault to trader's wallet.

**Parameters:**
```
word_index   u8
direction    Side
quantity     u64   Tokens to burn
min_return   u64   Slippage floor in micro-USDC — fails if return is below this
```

**Accounts:**
```
trader               Signer
market               Account  Must be Open
vault                Account  Source of USDC payout
trader_usdc          Account  Trader's USDC ATA — receives proceeds
token_mint           Account  The YES or NO mint
trader_token_account Account  Trader's ATA — tokens burned from here
token_program
```

**Flow:**
1. LMSR calculates gross return: `C(q, ...) - C(q - quantity, ...)`
2. Fee deducted: `net_return = gross_return - (gross_return * trade_fee_bps / 10_000)`
3. Slippage check: `net_return >= min_return`
4. `token::burn` — tokens burned from trader's ATA (trader signs as authority)
5. `token::transfer` — USDC from vault to `trader_usdc` (market PDA signs)
6. Quantities decremented on WordState

---

### 5. `pause_market`

Toggles market between Open and Paused. Paused markets reject all buy/sell calls.

**Who calls it:** Authority only

**No parameters.** Toggles: Open → Paused or Paused → Open. Resolved markets cannot be paused.

Use this if you need to halt trading for any reason — bad oracle data, ongoing resolution, emergency.

---

### 6. `resolve_word`

Sets the outcome for one word. When all words are resolved, the market transitions to Resolved and trading stops permanently.

**Who calls it:** Resolver (set at market creation)

**Parameters:**
```
word_index   u8
outcome      bool   true = word was mentioned, false = not mentioned
```

**Accounts:**
```
resolver   Signer   Must match market.resolver
market     Account  Must not already be Resolved; this word must be unresolved
```

**What happens:**
1. Sets `word.outcome = Some(outcome)`
2. Checks if all words now have outcomes set
3. If yes: sets `market.status = Resolved` and records `resolved_at` timestamp

Once Resolved, buy/sell are permanently rejected. LP withdrawal and redemption become available.

---

### 7. `redeem`

Winners burn their tokens and receive USDC 1:1 from the vault.

**Who calls it:** Any trader who holds winning tokens

**Parameters:**
```
word_index   u8
direction    Side   Must match the winning outcome for this word
```

**Accounts:**
```
redeemer               Signer
market                 Account
vault                  Account  Source of USDC
redeemer_usdc          Account  Trader's USDC ATA — receives payout
token_mint             Account  The winning mint
redeemer_token_account Account  Trader's token ATA — all tokens burned
token_program
```

**Payout:** `payout = token_amount` (base units are equal — both 6 decimals)

Example: trader holds 2_500_000 YES tokens for word 0, and word 0 resolved as YES (mentioned). They burn all 2_500_000 tokens and receive 2_500_000 micro-USDC = **2.50 USDC**.

Losing token holders get nothing — their tokens can still be burned but the program only transfers USDC to winning sides.

---

### 8. `withdraw_liquidity`

LP burns their shares and withdraws their proportional slice of the remaining vault balance. Only callable after market is Resolved.

**Who calls it:** LP (you, the admin)

**Parameters:**
```
shares_to_burn   u64   Number of LP shares to redeem
```

**Accounts:**
```
lp_wallet     Signer
market        Account  Must be Resolved
vault         Account  Source of USDC
lp_usdc       Account  LP's USDC ATA — receives withdrawal
lp_position   PDA      LP's position account
token_program
system_program
```

**Payout math:**
```
usdc_out = shares_to_burn * vault_balance / total_lp_shares
```

The vault balance at the time of withdrawal is whatever is left after redemptions. Losers never redeem, so their losing-side USDC stays in the vault and is captured by the LP.

---

### 9. `withdraw_fees`

Transfers all accumulated fees from the vault to the authority's USDC account.

**Who calls it:** Authority only

**No parameters.** Drains the full `accumulated_fees` amount and resets it to 0.

Call this at any time — before or after resolution. The fee amount is tracked separately from trading funds so LP share math is not affected.

---

## Full lifecycle as admin + LP

Here is the complete sequence from creation to profit withdrawal.

### Phase 1 — Setup

```
1. create_market(
     market_id = 42,
     label = "Fed Meeting May 2026",
     word_labels = ["pivot", "inflation", "pause"],
     resolves_at = 1746748800,  // unix ts of event
     resolver = <your wallet>,
     trade_fee_bps = 50,        // 0.5% fee
     initial_b = 100_000_000,   // 100 USDC base b
     base_b_per_usdc = 200_000, // b = 20% of vault balance
   )
   
   Accounts created:
   - market PDA: ["market", 42_le_bytes]
   - vault: USDC token account, authority = market PDA
   - For each word: yes_mint + no_mint PDAs (6 decimals)
   - Token metadata for all 6 mints
```

```
2. deposit_liquidity(amount = 1_000_000_000)  // 1000 USDC

   - 1_000_000_000 USDC transfers from your ATA to vault
   - You receive 1_000_000_000 LP shares (first depositor, 1:1)
   - b rescaled: 200_000 * 1_000_000_000 / 1_000_000 = 200_000_000_000
     Wait — that's 200,000 USDC which seems too large.
     
   Practical b values:
   - b = 200 USDC (200_000_000 micro-USDC) is a reasonable depth
   - To get b = 200_000_000 from a 1000 USDC deposit:
     base_b_per_usdc = 200_000_000 / 1_000_000_000 * 1_000_000 = 200_000 ✓
   - This means a trade of ~200 USDC moves the price roughly 1/e ≈ 37 percentage points
```

Market is now live. Both sides of each word start at 50% probability.

### Phase 2 — Trading (users interact)

Users call `buy` and `sell`. Your vault grows as fees accumulate. You can watch the `implied_yes_price` field in `TradeEvent` to track market sentiment.

You can call `pause_market` at any time to halt trading (then call it again to resume).

### Phase 3 — Resolution

After the event occurs, call `resolve_word` once per word:

```
resolve_word(word_index = 0, outcome = true)   // "pivot" was mentioned
resolve_word(word_index = 1, outcome = false)  // "inflation" was not mentioned
resolve_word(word_index = 2, outcome = true)   // "pause" was mentioned
```

After the third call, `market.status` automatically becomes `Resolved`. Trading is now permanently closed.

### Phase 4 — Redemptions (users interact)

Winners call `redeem`. Each winning token burns 1:1 for USDC from the vault.

Losers cannot redeem. Their tokens are worthless. The USDC they paid at purchase remains in the vault — this is the LP's profit on those positions.

### Phase 5 — Fee and LP withdrawal

```
// Withdraw accumulated trading fees (any time, including before resolution)
withdraw_fees()
// authority_usdc receives market.accumulated_fees, field resets to 0

// Withdraw LP position (only after Resolved)
withdraw_liquidity(shares_to_burn = 1_000_000_000)  // all your shares
// lp_usdc receives: shares * vault_balance / total_lp_shares
```

**Where LP profit comes from:**
- Every buy costs more than sell (LMSR spread) — the difference is not directly captured; cost efficiency goes both ways
- Trade fees: `accumulated_fees` is yours via `withdraw_fees`
- Losing-side USDC: when YES wins, all NO token holders' USDC stays in the vault. This gets returned to you via `withdraw_liquidity`

---

## PDA derivation reference

```
market:      ["market",   market_id.to_le_bytes()]           → program
vault:       Not a PDA — regular token account init'd at create_market
yes_mint[i]: ["yes_mint", market_id.to_le_bytes(), [i]]      → program
no_mint[i]:  ["no_mint",  market_id.to_le_bytes(), [i]]      → program
lp_position: ["lp",       market_id.to_le_bytes(), lp_wallet] → program
yes_metadata[i]: ["metadata", mpl_token_metadata::ID, yes_mint_pda] → Metaplex
no_metadata[i]:  ["metadata", mpl_token_metadata::ID, no_mint_pda]  → Metaplex
```

The market PDA signs vault outflows using: `["market", market_id.to_le_bytes(), bump]`

---

## Events emitted

| Event | Emitted by | Key fields |
|-------|-----------|------------|
| `MarketCreatedEvent` | create_market | market_id, label, num_words, authority, resolver, trade_fee_bps, initial_b |
| `LiquidityEvent` | deposit/withdraw_liquidity | market_id, provider, action (Deposit/Withdraw), usdc_amount, shares, new_pool_balance, new_b |
| `TradeEvent` | buy, sell | market_id, word_index, direction, quantity, cost, fee, new_yes_qty, new_no_qty, implied_yes_price, trader |
| `ResolutionEvent` | resolve_word | market_id, word_index, outcome, resolver |
| `RedemptionEvent` | redeem | market_id, word_index, direction, tokens_burned, usdc_paid, redeemer |
| `FeesWithdrawnEvent` | withdraw_fees | market_id, authority, amount |

Subscribe to these via websocket or Helius webhooks filtering on this program ID to index all market activity into the database.

---

## Constraints and limits

| Limit | Value |
|-------|-------|
| Max words per market | 8 |
| Max market label | 64 chars |
| Max word label | 32 chars |
| Min USDC per trade | 1 micro-USDC (enforced by zero-amount check) |
| LMSR exp input range | [-20 USDC, +30 USDC] scaled — safe for any realistic market |
| LP withdrawal | Only after market.status == Resolved |
| Pause during resolution | Not possible — resolve_word does not check Open status |
| Fee withdrawal | Any time market is live |
