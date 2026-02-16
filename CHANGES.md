# AMM V1 Migration — Change Summary

## Overview

Migrated from the old per-word CLOB contract (`mention-market`) to a new AMM contract (`mention-market-amm`) using LMSR (Logarithmic Market Scoring Rule) pricing. The AMM uses a single `MarketAccount` per market with up to 8 embedded `WordState` entries, replacing the old model of individual `WordMarket` accounts per word.

**New Program ID**: `2oKQaiKx3C2qpkqFYGDdvEGTyBDJP85iuQtJ5vaPdFrU` (devnet)

---

## Smart Contract Changes

### Architecture

- **Old**: One `WordMarket` PDA per word, grouped by `marketId`. Each word had its own account, authority, collateral pool, and status.
- **New**: One `MarketAccount` PDA per market containing a fixed-size array of `WordState[8]`. All words share a single vault, liquidity pool, and status lifecycle.

### New Instructions

| Instruction | Description |
|---|---|
| `deposit` | Deposit SOL into user escrow (unchanged) |
| `withdraw` | Withdraw SOL from user escrow (unchanged) |
| `create_market` | Creates a market with N words in a single instruction. Mint PDAs passed via `remaining_accounts`. |
| `pause_market` | Toggles pause on the entire market (was per-word) |
| `deposit_liquidity` | LP deposits SOL into the AMM pool, receives LP shares |
| `withdraw_liquidity` | LP withdraws SOL proportional to their shares |
| `buy` | Buy YES/NO tokens for a specific word using LMSR pricing |
| `sell` | Sell YES/NO tokens back to the AMM |
| `resolve_word` | Resolve a single word as `true` (mentioned) or `false` (not mentioned). Market becomes `Resolved` when all words are resolved. |
| `redeem` | Burn winning tokens and receive 1 SOL per token from the vault |

### LMSR Math (`math.rs`)

- Fixed-point arithmetic at 1e9 precision
- `fp_exp(x)` / `fp_ln(x)` — Taylor series approximations with range reduction
- `binary_lmsr_cost(q_yes, q_no, b)` — cost function C = b * ln(exp(q_yes/b) + exp(q_no/b))
- `calculate_buy_cost` / `calculate_sell_return` — delta of cost function before/after trade
- `implied_price` — YES probability = exp(q_yes/b) / (exp(q_yes/b) + exp(q_no/b))

### Key Parameters

| Parameter | Description |
|---|---|
| `liquidity_param_b` | LMSR liquidity parameter (higher = less price impact) |
| `base_b_per_sol` | B scaling rate per SOL of liquidity added |
| `trade_fee_bps` | Fee charged on each buy/sell (in basis points) |
| `resolves_at` | Unix timestamp for market resolution deadline |

### Bug Fixes During Development

- **Vault ownership**: The vault is a `SystemAccount` PDA (owned by System Program). Direct lamport manipulation via `try_borrow_mut_lamports()` failed with "instruction spent from the balance of an account it does not own". Fixed by using `system_program::transfer` with `CpiContext::new_with_signer` and vault PDA signer seeds in `sell.rs`, `withdraw_liquidity.rs`, and `redeem.rs`.
- **Stack overflow**: `CreateMarket` context exceeded SBF 4096-byte stack limit. Fixed by boxing large accounts: `Box<Account<'info, MarketAccount>>`, `Box<Account<'info, Mint>>`.
- **blake3 pin**: Platform-tools v1.51 uses Cargo 1.84.0 which can't parse `edition2024` crates. Pinned `blake3 = "=1.5.5"` as a direct dependency.

### Test Results

42 tests passing (30 AMM + 12 legacy mention-market):
- deposit (3), withdraw (3), create_market (3), pause_market (2)
- deposit_liquidity (2), buy (4), sell (2), withdraw_liquidity (2)
- resolve_word (4), redeem (3), final withdrawal (1)

---

## Frontend Changes

### `lib/mentionMarket.ts` — Complete Rewrite

**Removed exports:**
- `WordMarket` type
- `Outcome` enum
- `fetchAllWordMarkets()`
- `createMarketGroupIxs()` (was multiple IXs, one per word)
- `createPauseGroupIxs()` (was multiple IXs, one per word)
- `createResolveMarketIx()` (used `Outcome` enum)
- `getWordMarketPDA()`, old mint/vault PDA helpers

**New/updated exports:**

| Export | Description |
|---|---|
| `MarketAccount` | Single market with embedded `words: WordState[]` |
| `WordState` | Per-word state: label, yesMint, noMint, yesQuantity, noQuantity, outcome |
| `MarketStatus` | `Open` / `Paused` / `Resolved` (was `Active` / `Paused` / `Resolved`) |
| `UserPosition` | Now includes `marketId`, `wordIndex`, `wordLabel`, `marketLabel`, `marketStatus` |
| `fetchAllMarkets()` | Returns `Array<{pubkey, account: MarketAccount}>` |
| `fetchMarket(marketId)` | Fetches a single market by ID |
| `createCreateMarketIx()` | Single IX with all words + remaining_accounts for mint PDAs |
| `createPauseMarketIx()` | Single IX per market (not per word) |
| `createResolveWordIx()` | Takes `boolean` outcome instead of `Outcome` enum |
| `getMarketPDA(marketId)` | PDA: `["market", marketId]` |
| `getVaultPDA(marketId)` | PDA: `["vault", marketId]` |
| `getYesMintPDA(marketId, wordIndex)` | PDA: `["yes_mint", marketId, wordIndex]` |
| `getNoMintPDA(marketId, wordIndex)` | PDA: `["no_mint", marketId, wordIndex]` |

**Unchanged exports** (same signatures):
- `createDepositIx()`, `createWithdrawIx()`, `fetchEscrow()`, `sendIxs()`
- `lamportsToSol()`, `solToLamports()`, `marketStatusStr()`, `outcomeStr()`
- `UserEscrow` type, `PROGRAM_ID`, `TOKEN_PROGRAM`, `SYSTEM_PROGRAM`

**Deserialization**: Custom Borsh deserializer (`deserializeMarketAccount`) handles variable-length fields (strings, Option types) sequentially rather than fixed-offset parsing.

### `app/admin/page.tsx` — Rewritten for AMM

- Removed `MarketGroup` type and `groupMarkets()` helper — no longer needed since `MarketAccount` embeds all words
- Create market form now includes: market label, resolve time (hours), trade fee (bps), initial B (SOL), base B per SOL
- Markets list iterates `MarketAccount[]` directly, showing embedded words with YES/NO quantities
- Pause button toggles Pause/Unpause on the whole market
- Resolve buttons pass `true`/`false` per word instead of `Outcome` enum
- Market cards show liquidity param B, LP shares, accumulated fees, resolve deadline

### `app/market/[id]/page.tsx` — Updated for AMM

- `fetchAllWordMarkets()` replaced with `fetchMarket(BigInt(marketId))` — single RPC call instead of fetching all accounts
- `WordMarket[]` state replaced with single `MarketAccount` state
- `MarketStatus.Active` renamed to `MarketStatus.Open` throughout
- On-chain market title pulled from `MarketAccount.label`
- Event time derived from `MarketAccount.resolvesAt`
- User position matching uses `p.wordLabel` (was `p.market.label`)
- Removed `totalCollateral` references (not on new AMM WordState)

### `app/profile/page.tsx` — Updated for AMM

- Active position filter: `p.marketStatus === MarketStatus.Open` (was `p.market.status === MarketStatus.Active`)
- Position display uses flat fields: `pos.marketId`, `pos.wordLabel`, `pos.marketLabel`, `pos.marketStatus`
- Removed `pos.wordMarketPubkey` and `pos.market.totalCollateral` references
- Removed unused `lamportsToSol` import

### `components/Header.tsx` — No Changes Needed

Already used `fetchEscrow`, `fetchUserPositions`, `lamportsToSol` which kept the same signatures.

### `components/DepositModal.tsx` — No Changes Needed

Already used `createDepositIx`, `sendIxs`, `solToLamports` which kept the same signatures.

---

## PDA Seed Changes

| PDA | Old Seeds | New Seeds |
|---|---|---|
| Escrow | `["escrow", user]` | `["escrow", user]` (unchanged) |
| Market | `["word_market", marketId, wordIndex]` | `["market", marketId]` |
| Vault | `["vault", marketId, wordIndex]` | `["vault", marketId]` |
| YES Mint | `["yes_mint", marketId, wordIndex]` | `["yes_mint", marketId, wordIndex]` (unchanged) |
| NO Mint | `["no_mint", marketId, wordIndex]` | `["no_mint", marketId, wordIndex]` (unchanged) |

---

## Token Changes

- Token decimals: 9 (was 6 in old contract)
- 1 full token = 1,000,000,000 base units = 1 SOL payout on winning redemption
