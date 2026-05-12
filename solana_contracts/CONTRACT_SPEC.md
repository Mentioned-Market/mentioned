# Mention Market USDC AMM — Contract Specification

## Overview

Binary prediction market program on Solana (Anchor 0.31.1). Each market contains up to 8 word sub-markets. Users trade YES/NO outcome tokens priced by the LMSR (Logarithmic Market Scoring Rule) AMM. Settlement is in USDC (6 decimals). All token math and account layout uses 1e6 fixed-point precision matching USDC.

**The core flow:**
1. Admin creates a market with N words and deposits initial USDC liquidity
2. Users buy YES/NO tokens for each word; the AMM prices them via LMSR
3. Resolver sets each word's outcome (true = mentioned, false = not mentioned) one at a time
4. When all words are resolved the market moves to `Resolved`
5. Winners burn their tokens for a 1:1 USDC payout from the vault
6. LP withdraws their share of remaining USDC

---

## Network & Program IDs

| Key | Value |
|-----|-------|
| Program ID | `9kSuebrHKKnFsgFcv5fc8S2gBazHA9Gki2NEWt2ft9tk` |
| Network | Solana Devnet |
| USDC Mint (devnet test) | `CxRN4jp8ki3o3Bs16Ld6JsKsAP8rG8Jrp6dq48TYig9L` |
| Metaplex Metadata | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` |
| RPC | `NEXT_PUBLIC_HELIUS_DEVNET_RPC_URL` env var (falls back to public devnet) |
| TypeScript client | `lib/mentionMarketUsdc.ts` |

---

## Account Structures

### MarketAccount
PDA seeds: `["market", market_id_u64_le]`
Space: `8 (discriminator) + 1701 bytes`
Account discriminator: `[201, 78, 187, 225, 240, 198, 201, 251]`

```
version:           u8       // schema version (currently 1)
bump:              u8       // PDA bump seed
market_id:         u64      // numeric ID, used in URLs and PDAs
label:             String   // market name, max 64 chars
authority:         Pubkey   // admin wallet (pause, withdraw_fees)
resolver:          Pubkey   // resolve wallet (resolve_word)
usdc_mint:         Pubkey   // validated against USDC_MINT constant
total_lp_shares:   u64      // outstanding LP share tokens
liquidity_param_b: u64      // LMSR b parameter (fixed-point, scaled 1e6)
base_b_per_usdc:   u64      // b growth per USDC deposited (scaled 1e6)
num_words:         u8       // number of words (1–8)
words:             [WordState; 8]
status:            MarketStatus  // Open | Paused | Resolved
created_at:        i64      // unix timestamp
resolves_at:       i64      // scheduled resolution unix timestamp
resolved_at:       Option<i64>
trade_fee_bps:     u16      // fee on each trade (e.g. 50 = 0.5%)
protocol_fee_bps:  u16      // reserved, currently 0
accumulated_fees:  u64      // withdrawable by authority
_reserved:         [u8; 256]
```

### WordState (embedded array inside MarketAccount)
Fixed size per word: `151 bytes`

```
word_index:    u8           // 0–7
label:         String       // word text, max 32 chars
yes_mint:      Pubkey       // PDA — SPL mint for YES tokens
no_mint:       Pubkey       // PDA — SPL mint for NO tokens
yes_quantity:  i64          // net YES tokens minted (fixed-point 1e6)
no_quantity:   i64          // net NO tokens minted (fixed-point 1e6)
outcome:       Option<bool> // None=unresolved, true=mentioned, false=not mentioned
_reserved:     [u8; 32]
```

### LpPosition
PDA seeds: `["lp", market_id_u64_le, lp_wallet_pubkey]`
Space: `8 (discriminator) + 146 bytes`
Account discriminator: `[105, 241, 37, 200, 224, 2, 252, 90]`

```
version:      u8     // schema version (1)
bump:         u8
market:       Pubkey // parent market
owner:        Pubkey // LP wallet
shares:       u64    // LP share tokens held
deposited_at: i64    // last deposit timestamp
_reserved:    [u8; 64]
```

### Vault
The market's USDC ATA. Not a custom account — it's the Associated Token Account owned by the market PDA.
```
Address = getAssociatedTokenAddress(USDC_MINT, marketPDA)
```

---

## PDA Derivations

All derivations use `PROGRAM_ID = BKYVi5hWefmtWhE2hCoarcjufQQvaxDAcfeMSo27SEyA`.

### TypeScript (via `lib/mentionMarketUsdc.ts`)

```typescript
import {
  getMarketPDA,
  getYesMintPDA,
  getNoMintPDA,
  getMetadataPDA,
  getLpPositionPDA,
  getAssociatedTokenAddress,
  getVaultAddress,
  USDC_MINT,
} from '@/lib/mentionMarketUsdc'

// Market account
const [marketPDA, bump] = await getMarketPDA(marketId)           // marketId: bigint

// YES/NO mints for word at index i
const [yesMint] = await getYesMintPDA(marketId, wordIndex)       // wordIndex: number 0–7
const [noMint]  = await getNoMintPDA(marketId, wordIndex)

// Metaplex metadata accounts (passed as remaining_accounts in create_market)
const [yesMetadata] = await getMetadataPDA(yesMint)
const [noMetadata]  = await getMetadataPDA(noMint)

// LP position
const [lpPosition] = await getLpPositionPDA(marketId, lpWallet)

// USDC vault (market's ATA)
const vault = await getVaultAddress(marketId)

// Any wallet's ATA for a given mint
const ata = await getAssociatedTokenAddress(mint, owner)
```

### Raw seeds reference
| Account | Seeds |
|---------|-------|
| Market | `["market", market_id.to_le_bytes()]` |
| YES mint | `["yes_mint", market_id.to_le_bytes(), word_index.to_le_bytes()]` |
| NO mint | `["no_mint", market_id.to_le_bytes(), word_index.to_le_bytes()]` |
| LP position | `["lp", market_id.to_le_bytes(), lp_wallet_pubkey]` |
| Vault | ATA: `[owner_pubkey, TOKEN_PROGRAM, USDC_MINT]` via Associated Token Program |
| YES/NO metadata | `["metadata", MPL_PROGRAM_ID, mint_pubkey]` via Metaplex |

---

## LMSR Pricing

The AMM uses the binary LMSR cost function:

```
C(q_yes, q_no) = b × ln( exp(q_yes / b) + exp(q_no / b) )
```

All values are scaled by `PRECISION = 1_000_000` (1e6, matching USDC decimals). Intermediate calculations use u128/i128 to prevent overflow. The `b` parameter controls liquidity depth — higher `b` means prices move less per trade.

**Dynamic b:** When `base_b_per_usdc > 0`, the parameter scales with vault size:
```
b = base_b_per_usdc × vault_balance / PRECISION
```
This means more liquidity deposited = deeper market = smaller price impact.

**Implied YES price:**
```
p_yes = exp(q_yes / b) / ( exp(q_yes / b) + exp(q_no / b) )
```
Ranges from 0 to 1, interpreted as probability the word will be mentioned.

**Buy cost** (USDC base units for `amount` YES or NO tokens):
```
cost = C(q_yes + amount, q_no) − C(q_yes, q_no)   // YES
cost = C(q_yes, q_no + amount) − C(q_yes, q_no)   // NO
```

**Sell return** (USDC base units for selling `amount` tokens):
```
return = C(q_yes, q_no) − C(q_yes − amount, q_no)  // YES
return = C(q_yes, q_no) − C(q_yes, q_no − amount)  // NO
```

**Critical:** The TypeScript client (`lib/mentionMarketUsdc.ts`) reimplements the exact same Taylor-series integer math as the Rust program. Do **not** use `Math.exp`/`Math.log` for cost calculations — floating-point divergence will cause `SlippageExceeded` errors on larger trades. The `estimateBuyCost`, `estimateSellReturn`, and `sharesForUsdc` exports are the correct functions to use.

---

## Instructions

### 1. `create_market`
Creates a new market with N word sub-markets. Initialises YES/NO SPL mints and Metaplex metadata for each word. Vault ATA is created as part of this instruction.

**Signer:** `authority`

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `market_id` | `u64` | Numeric ID. Must be unique — determines the market PDA. |
| `label` | `String` | Market title, max 64 chars |
| `word_labels` | `Vec<String>` | Words to track, max 8, each max 32 chars |
| `resolves_at` | `i64` | Scheduled resolution unix timestamp |
| `resolver` | `Pubkey` | Wallet authorised to call `resolve_word` |
| `trade_fee_bps` | `u16` | Fee in basis points (e.g. `50` = 0.5%). **Max 1000 (10%).** |
| `initial_b` | `u64` | Starting LMSR b (fixed-point 1e6). Set to `0` if using dynamic b. At least one of `initial_b` or `base_b_per_usdc` must be non-zero. |
| `base_b_per_usdc` | `u64` | Dynamic b scaling factor (fixed-point 1e6). Set to `0` for fixed b. **Max `1_000_000` (1:1 scaling) — larger values break vault solvency.** |

**Named accounts:** `authority`, `market`, `usdc_mint`, `vault`, `token_program`, `associated_token_program`, `system_program`, `rent`, `token_metadata_program`

**`remaining_accounts`:** 4 accounts per word, in order for each word `i`:
```
[i*4 + 0] = yes_mint PDA      (writable)
[i*4 + 1] = yes_metadata PDA  (writable)
[i*4 + 2] = no_mint PDA       (writable)
[i*4 + 3] = no_metadata PDA   (writable)
```

**Transaction size warning:** Each word adds 4 accounts × 32 bytes to the transaction. The Solana wire format limit is 1232 bytes. With the fixed overhead of ~270 bytes, you can fit at most 4–5 words depending on label length. The admin UI validates this with `estimateCreateMarketTxBytes()` before signing.

**TypeScript:**
```typescript
import { createCreateMarketIx, sendInstructions } from '@/lib/mentionMarketUsdc'

const ix = await createCreateMarketIx(
  authority,             // Address
  1778148840437n,        // market_id: bigint (use Date.now() or similar)
  'Bitcoin Price Bet',   // label
  ['Bitcoin', 'ETH'],   // wordLabels
  BigInt(Math.floor(Date.now() / 1000) + 86400), // resolves_at
  resolver,              // Address (can equal authority)
  50,                    // trade_fee_bps
  0n,                    // initial_b (0 = use dynamic b)
  1_000_000n,            // base_b_per_usdc (1:1 scaling)
)
await sendInstructions(signer, signOnly, [ix])
```

---

### 2. `pause_market`
Toggles between `Open` and `Paused`. Paused markets reject all `buy`/`sell`. Can be called repeatedly to unpause.

**Signer:** `authority` (must match `market.authority`)

**Accounts:** `authority`, `market`

**TypeScript:**
```typescript
import { createPauseMarketIx } from '@/lib/mentionMarketUsdc'
const ix = await createPauseMarketIx(authority, marketId)
await sendInstructions(signer, signOnly, [ix])
```

---

### 3. `deposit_liquidity`
Deposits USDC into the vault. Issues LP shares proportional to the deposit. Updates `liquidity_param_b` dynamically if `base_b_per_usdc > 0`. Only callable on `Open` markets.

**Signer:** `lp_wallet` — **must equal `market.authority`**. Public deposits are prohibited to prevent third parties from rescaling `b` mid-market (which creates MEV and LP-dilution vectors).

**Parameters:** `amount: u64` — USDC base units to deposit

**Accounts:** `lp_wallet`, `market`, `vault`, `lp_usdc` (wallet's USDC ATA), `lp_position` (init_if_needed), `token_program`, `system_program`

**Share math:** First depositor receives `shares = amount` (1:1). Subsequent depositors receive `shares = amount × total_lp_shares / vault_balance_before`.

**Solvency constraint (fixed-b markets only):** When `base_b_per_usdc == 0` the vault must hold at least `b × ln(2) ≈ b × 693_148 / 1_000_000` USDC after the deposit. This guarantees the worst-case LP loss is covered and 1:1 redemptions remain solvent. Dynamic-b markets (`base_b_per_usdc > 0`) are solvent by construction because `b ≤ vault` when `base_b_per_usdc ≤ PRECISION`.

**TypeScript:**
```typescript
import { createDepositLiquidityIx } from '@/lib/mentionMarketUsdc'
const ix = await createDepositLiquidityIx(lpWallet, marketId, 100_000_000n) // 100 USDC
await sendInstructions(signer, signOnly, [ix])
```

---

### 4. `withdraw_liquidity`
Burns LP shares and returns proportional USDC. Only callable after the market reaches `Resolved` status (liquidity is locked during active trading).

**Signer:** `lp_wallet`

**Parameters:** `shares_to_burn: u64`

**Accounts:** `lp_wallet`, `market`, `vault`, `lp_usdc`, `lp_position`, `token_program`, `system_program`

**Payout math:** `usdc_out = shares_to_burn × vault_balance / total_lp_shares`

**TypeScript:**
```typescript
import { createWithdrawLiquidityIx, fetchLpPosition } from '@/lib/mentionMarketUsdc'
const lp = await fetchLpPosition(marketId, wallet)
const ix = await createWithdrawLiquidityIx(wallet, marketId, lp.shares)
await sendInstructions(signer, signOnly, [ix])
```

---

### 5. `buy`
Buys YES or NO tokens for a specific word. Transfers USDC from trader's ATA to vault, mints prediction tokens to trader. Enforces slippage via `max_cost`.

**Signer:** `trader`

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `word_index` | `u8` | Which word (0-based) |
| `direction` | `Side` | `Yes` = 0, `No` = 1 |
| `quantity` | `u64` | Token base units to buy (6 decimals, so 1 share = 1_000_000) |
| `max_cost` | `u64` | Maximum USDC base units willing to pay (includes fee). Transaction fails if cost exceeds this. |

**Accounts:** `trader`, `market`, `vault`, `trader_usdc`, `token_mint` (YES or NO mint for the word), `trader_token_account` (must be pre-created — see ATA creation), `token_program`

**Fee:** Applied on top of the LMSR cost: `fee = cost × trade_fee_bps / 10_000`. Added to `market.accumulated_fees`.

**ATA pre-creation:** The trader's token ATA must exist before calling `buy`. In the admin UI, a `createAtaIx` (idempotent, no-op if already exists) is prepended to the same transaction.

**TypeScript:**
```typescript
import { createAtaIx, createBuyIx, sharesForUsdc, estimateBuyCost, sendInstructions } from '@/lib/mentionMarketUsdc'

const usdcToSpend = 5_000_000n // 5 USDC in base units
const shares = sharesForUsdc(word, market.liquidityParamB, 'YES', usdcToSpend)
const cost = estimateBuyCost(word, market.liquidityParamB, 'YES', shares)
const fee = cost * BigInt(market.tradeFeeBps) / 10000n
const maxCost = cost + fee + (cost + fee) / 50n  // 2% slippage buffer

const ataIx = await createAtaIx(trader, trader, word.yesMint)
const buyIx = await createBuyIx(trader, marketId, wordIndex, 'YES', shares, maxCost)
await sendInstructions(signer, signOnly, [ataIx, buyIx])
```

---

### 6. `sell`
Burns the trader's YES/NO tokens and transfers USDC net-of-fee from vault to trader. Enforces slippage via `min_return`.

**Signer:** `trader`

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `word_index` | `u8` | Which word |
| `direction` | `Side` | `Yes` = 0, `No` = 1 |
| `quantity` | `u64` | Token base units to sell |
| `min_return` | `u64` | Minimum USDC base units to accept net of fee. Transaction fails if return is below this. |

**Accounts:** `trader`, `market`, `vault`, `trader_usdc`, `token_mint`, `trader_token_account`, `token_program`

**Fee:** `fee = gross_return × trade_fee_bps / 10_000`. Deducted from the return.

**TypeScript:**
```typescript
import { createSellIx, estimateSellReturn, sendInstructions } from '@/lib/mentionMarketUsdc'

const shares = word.yesQuantity // or however many the user holds
const ret = estimateSellReturn(word, market.liquidityParamB, 'YES', shares)
const minReturn = ret - ret / 50n  // 2% slippage

const sellIx = await createSellIx(trader, marketId, wordIndex, 'YES', shares, minReturn)
await sendInstructions(signer, signOnly, [sellIx])
```

---

### 7. `resolve_word`
Sets the outcome for a single word. Can only be called by the `resolver`. Resolving all words in a market automatically transitions the market to `Resolved` status.

**Signer:** `resolver` (must match `market.resolver`)

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `word_index` | `u8` | Which word to resolve |
| `outcome` | `bool` | `true` = word was mentioned, `false` = not mentioned |

**Accounts:** `resolver`, `market`

**Constraints:** Market must not already be `Resolved`. The specific word must not already be resolved. **`Clock::unix_timestamp` must be ≥ `market.resolves_at`** — early resolution is blocked to prevent the resolver from locking in outcomes before the observed event occurs.

**TypeScript:**
```typescript
import { createResolveWordIx } from '@/lib/mentionMarketUsdc'
const ix = await createResolveWordIx(resolver, marketId, wordIndex, true)
await sendInstructions(signer, signOnly, [ix])
```

---

### 8. `redeem`
Burns winning tokens for a 1:1 USDC payout. The word must be resolved and the `direction` must match the winning outcome.

**Signer:** `redeemer`

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `word_index` | `u8` | Which word |
| `direction` | `Side` | Must match the winning side |

**Accounts:** `redeemer`, `market`, `vault`, `redeemer_usdc`, `token_mint` (winning mint), `redeemer_token_account`, `token_program`

**Constraints:** **Market status must be `Resolved`** (all words resolved). Partial-resolution redemption is blocked — without this, concurrent trading and redemption on a partially-resolved multi-word market would drain the vault faster than LMSR pricing replenishes it.

**Payout:** `payout = token_amount` (1:1 since both tokens and USDC use 6 decimals).

**TypeScript:**
```typescript
import { createRedeemIx } from '@/lib/mentionMarketUsdc'
const ix = await createRedeemIx(redeemer, marketId, wordIndex, 'YES')
await sendInstructions(signer, signOnly, [ix])
```

---

### 9. `withdraw_fees`
Transfers all accumulated protocol fees from the vault to the authority's USDC ATA. Resets `accumulated_fees` to zero.

**Signer:** `authority` (must match `market.authority`)

**Accounts:** `authority`, `market`, `vault`, `authority_usdc` (authority's USDC ATA), `token_program`

**Constraint:** **Market must be `Resolved`.** Fees are part of the vault balance that backs 1:1 winner redemptions; withdrawing them from an active market reduces the safety margin and can leave the vault insolvent.

**TypeScript:**
```typescript
import { createWithdrawFeesIx } from '@/lib/mentionMarketUsdc'
const ix = await createWithdrawFeesIx(authority, marketId)
await sendInstructions(signer, signOnly, [ix])
```

---

## Market Lifecycle

```
Created ──► Open ──► Paused ──► Open (toggled by authority)
                └─► Resolved (when all words resolved by resolver)
                     └─► LP can withdraw_liquidity
```

| State | Trades | LP deposit | LP withdraw | Resolve | Redeem |
|-------|--------|------------|-------------|---------|--------|
| Open | Yes | Authority only | No | After `resolves_at` | No |
| Paused | No | No | No | After `resolves_at` | No |
| Resolved | No | No | Yes | — | Yes |

Words are resolved individually. The market stays in its current state (Open or Paused) until **all** words have been resolved, at which point it automatically transitions to `Resolved`. Redeem and `withdraw_fees` require the market to be fully `Resolved`.

---

## Anchor Events

All instructions emit structured events readable via Helius webhooks or `gPA` log filtering.

### `TradeEvent` (emitted by `buy` and `sell`)
```
market_id:         u64
word_index:        u8
direction:         Side  (Yes=0, No=1)
quantity:          u64   // token base units
cost:              u64   // total USDC including fee (buy) OR net USDC returned (sell)
fee:               u64   // USDC fee collected
new_yes_qty:       i64   // updated word.yes_quantity after trade
new_no_qty:        i64   // updated word.no_quantity after trade
implied_yes_price: u64   // new implied YES price (fixed-point 1e6, e.g. 650000 = 65%)
trader:            Pubkey
timestamp:         i64
```

### `RedemptionEvent` (emitted by `redeem`)
```
market_id:     u64
word_index:    u8
direction:     Side
tokens_burned: u64
usdc_paid:     u64
redeemer:      Pubkey
timestamp:     i64
```

### `ResolutionEvent` (emitted by `resolve_word`)
```
market_id:  u64
word_index: u8
outcome:    bool
resolver:   Pubkey
timestamp:  i64
```

### `MarketCreatedEvent` (emitted by `create_market`)
```
market_id:     u64
label:         String
num_words:     u8
authority:     Pubkey
resolver:      Pubkey
resolves_at:   i64
trade_fee_bps: u16
initial_b:     u64
timestamp:     i64
```

### `LiquidityEvent` (emitted by `deposit_liquidity` and `withdraw_liquidity`)
```
market_id:        u64
provider:         Pubkey
action:           LpAction  (Deposit=0, Withdraw=1)
usdc_amount:      u64
shares:           u64
new_pool_balance: u64
new_b:            u64
timestamp:        i64
```

---

## Error Codes

| Code | Name | Message |
|------|------|---------|
| 6000 | ZeroAmount | Amount must be greater than zero |
| 6001 | MathOverflow | Arithmetic overflow |
| 6002 | NotOwner | Only the account owner can perform this action |
| 6003 | NotAuthority | Only the market authority can perform this action |
| 6004 | NotResolver | Only the resolver can resolve outcomes |
| 6005 | MarketLabelTooLong | Market label must be 64 characters or fewer |
| 6006 | WordLabelTooLong | Word label must be 32 characters or fewer |
| 6007 | TooManyWords | Too many words (max 8) |
| 6008 | NoWords | Must provide at least one word |
| 6009 | MarketNotOpen | Market is not open for trading |
| 6010 | MarketAlreadyResolved | Market is already resolved |
| 6011 | MarketPaused | Market is paused |
| 6012 | MarketNotResolved | Liquidity is locked until market is resolved |
| 6013 | InvalidWordIndex | Invalid word index |
| 6014 | SlippageExceeded | Cost exceeds max_cost slippage limit |
| 6015 | SlippageBelowMin | Return is below min_return slippage limit |
| 6016 | InsufficientTokens | Insufficient token balance to sell |
| 6017 | InsufficientBalance | Insufficient balance |
| 6018 | WrongMint | Wrong token mint for this word/direction |
| 6019 | ZeroLiquidity | Liquidity parameter b is zero |
| 6020 | InsufficientShares | Insufficient LP shares |
| 6021 | EmptyPool | Pool has no balance |
| 6022 | WordNotResolved | Word is not yet resolved |
| 6023 | WordAlreadyResolved | Word is already resolved |
| 6024 | NotWinningDirection | Direction does not match winning outcome |
| 6025 | NothingToRedeem | No tokens to redeem |
| 6026 | NotResolved | Market is not resolved |
| 6027 | InvalidOutcome | Invalid word outcome direction |
| 6028 | InvalidVault | Vault account is invalid for this market |
| 6029 | InvalidUsdcMint | USDC mint does not match expected devnet USDC mint |
| 6030 | NoFeesToWithdraw | No accumulated fees to withdraw |
| 6031 | FeeTooHigh | trade_fee_bps exceeds maximum (1000 bps = 10%) |
| 6032 | InvalidBParameter | base_b_per_usdc must be <= PRECISION (1_000_000) to guarantee vault solvency |
| 6033 | InsufficientLiquidityForB | Vault balance is insufficient relative to the fixed b parameter; deposit more USDC |
| 6034 | ResolutionTooEarly | Cannot resolve before the scheduled resolves_at timestamp |

---

## Anchor Instruction Discriminators

These 8-byte discriminators prefix every instruction's data payload. Required when building instructions manually (the TypeScript client handles this automatically).

| Instruction | Discriminator |
|-------------|---------------|
| `create_market` | `[103, 226, 97, 235, 200, 188, 251, 254]` |
| `pause_market` | `[216, 238, 4, 164, 65, 11, 162, 91]` |
| `deposit_liquidity` | `[245, 99, 59, 25, 151, 71, 233, 249]` |
| `withdraw_liquidity` | `[149, 158, 33, 185, 47, 243, 253, 31]` |
| `buy` | `[102, 6, 61, 18, 1, 218, 235, 234]` |
| `sell` | `[51, 230, 133, 164, 1, 127, 131, 173]` |
| `resolve_word` | `[233, 96, 121, 102, 6, 222, 241, 147]` |
| `redeem` | `[184, 12, 86, 149, 70, 196, 97, 225]` |
| `withdraw_fees` | `[198, 212, 171, 109, 144, 215, 174, 89]` |

Account discriminators (first 8 bytes of account data):

| Account | Discriminator |
|---------|---------------|
| `MarketAccount` | `[201, 78, 187, 225, 240, 198, 201, 251]` |
| `LpPosition` | `[105, 241, 37, 200, 224, 2, 252, 90]` |

---

## Reading On-Chain State

### Fetch a single market
```typescript
import { fetchMarket } from '@/lib/mentionMarketUsdc'
const market = await fetchMarket(1778148840437n)
// Returns UsdcMarketAccount | null
```

### Fetch all markets (for listings)
```typescript
import { fetchAllMarkets } from '@/lib/mentionMarketUsdc'
const markets = await fetchAllMarkets()
// Returns Array<{ pubkey: Address; account: UsdcMarketAccount }>
// Sorted newest-first by created_at
// Uses getProgramAccounts with discriminator memcmp filter
```

### Fetch vault balance
```typescript
import { fetchVaultBalance } from '@/lib/mentionMarketUsdc'
const balance = await fetchVaultBalance(marketId)  // bigint, USDC base units
```

### Fetch user token balances
```typescript
import { fetchTokenBalance, fetchUsdcBalance } from '@/lib/mentionMarketUsdc'
const usdc = await fetchUsdcBalance(wallet)
const yesHeld = await fetchTokenBalance(word.yesMint, wallet)
const noHeld  = await fetchTokenBalance(word.noMint, wallet)
```

---

## On-Chain Indexing

Trades are indexed off-chain via Helius webhooks into the `trade_events` PostgreSQL table. The webhook endpoint is `POST /api/webhook`, parsed by `lib/tradeParser.ts`.

**`trade_events` schema:**
```sql
signature    TEXT    -- transaction signature (dedup key)
market_id    TEXT    -- market_id as string
word_index   INT
direction    INT     -- 0=YES, 1=NO
is_buy       BOOL
quantity     NUMERIC -- token base units
cost         NUMERIC -- USDC base units (total cost for buy, net return for sell)
fee          NUMERIC -- USDC fee base units
new_yes_qty  NUMERIC
new_no_qty   NUMERIC
implied_price NUMERIC -- YES price after trade (0–1 float)
trader       TEXT    -- wallet pubkey
block_time   TIMESTAMPTZ
```

This table powers:
- `/api/trades?marketId=X` — trade history
- `/api/paid-markets/chart?id=X` — price chart series (implied_price over time per word)
- Volume calculation (SUM of cost for buy/sell trades only — deposits/withdrawals never appear)

---

## Development & Deployment

### Build
```bash
cd solana_contracts
anchor build
```

### Test
```bash
anchor test  # runs tests/mention-market-usdc-amm.ts via npx ts-mocha
```

### Deploy to devnet
```bash
anchor deploy --provider.cluster devnet --provider.wallet ./deployer-keypair.json
```

### Known constraints
- **Max compute units:** `create_market` uses 1,400,000 CU (the Solana maximum) due to Metaplex CPI calls per word
- **Transaction size limit:** 1232 bytes wire format. Max ~4–5 words depending on label length. The admin UI enforces this
- **Pre-simulation:** All transactions are simulated before signing to surface program logs. `skipPreflight: true` is set on the final broadcast (simulation already passed)
- **b = 0 guard:** If `initial_b = 0` and `base_b_per_usdc = 0`, `create_market` will reject with `ZeroLiquidity`. Always set at least one
- **Fee cap:** `trade_fee_bps` is capped at 1000 (10%). Higher values are rejected at `create_market`
- **b scaling cap:** `base_b_per_usdc` is capped at `1_000_000` (1:1). Higher values would allow b to exceed vault balance, breaking 1:1 redemption solvency
- **Fixed-b minimum deposit:** For markets with `base_b_per_usdc = 0`, the first deposit must be ≥ `initial_b × 693_148 / 1_000_000` USDC or it will be rejected with `InsufficientLiquidityForB`
- **Resolve timing:** `resolve_word` will reject with `ResolutionTooEarly` if called before `market.resolves_at`. Do not set `resolves_at` in the past at market creation if you want to resolve immediately
- **Fee withdrawal timing:** `withdraw_fees` is only available after the market reaches `Resolved` status
- **Authority-only liquidity:** Only `market.authority` can call `deposit_liquidity`. Public LP participation is not supported
- **Token metadata immutable:** YES/NO token metadata is locked at creation (`is_mutable = false`). Metadata cannot be updated after the market is created
