# Mention Market — Solana Program Specification

## Overview
Prediction market program on Solana (Anchor framework) for binary YES/NO markets on word mentions. Off-chain CLOB backend matches orders, on-chain program handles custody, token minting, and payouts.

Program ID: `MENTionXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX` (placeholder — replace after `anchor keys list`)

## Architecture
- Users deposit SOL into per-user escrow PDAs on the program
- Admin creates word markets, each with a YES and NO SPL token mint and a SOL vault
- Backend matches YES buyers with NO buyers off-chain, then calls `settle_match` on-chain to mint tokens and move SOL to the vault
- Admin resolves markets with a YES/NO outcome
- Users burn winning tokens via `claim` to receive SOL 1:1 from the vault
- The invariant is: 1 SOL deposited = 1 YES token + 1 NO token minted. Vault is always solvent.

## Account Structures

### UserEscrow
PDA seeds: `["escrow", user_wallet_pubkey]`
```
owner: Pubkey        // user's wallet
balance: u64         // available lamports (can withdraw or use for orders)
locked: u64          // lamports committed to open orders (cannot withdraw)
bump: u8
```
Size: 8 (discriminator) + 32 + 8 + 8 + 1 = 57 bytes

### WordMarket
PDA seeds: `["market", market_id.to_le_bytes(), word_index.to_le_bytes()]`
```
authority: Pubkey       // admin wallet
market_id: u64          // groups words under one market
word_index: u16         // index of this word within the market
label: String           // the word (max 32 chars), e.g. "economy"
yes_mint: Pubkey        // SPL token mint for YES shares
no_mint: Pubkey         // SPL token mint for NO shares
vault: Pubkey           // SOL vault PDA address
total_collateral: u64   // total lamports locked in vault
status: MarketStatus    // Active | Paused | Resolved
outcome: Option<Outcome> // None until resolved, then Some(Yes) or Some(No)
bump: u8
vault_bump: u8
```

### Related PDAs
- YES mint: seeds `["yes_mint", word_market_pubkey]`, mint authority = word_market PDA
- NO mint: seeds `["no_mint", word_market_pubkey]`, mint authority = word_market PDA
- Vault: seeds `["vault", word_market_pubkey]`, holds collateral SOL
- Token decimals: 6 (so 1_000_000 = 1 share)

## Enums

```rust
MarketStatus { Active, Paused, Resolved }
Outcome { Yes, No }
```

## Instructions

### 1. deposit(amount: u64)
**Status: Fully implemented**
**Signer:** User
**Accounts:** user (signer, mut), escrow (init_if_needed, mut), system_program
**Effect:** Transfers `amount` lamports from user wallet to their escrow PDA. Creates escrow on first call. Increments `escrow.balance`.

### 2. withdraw(amount: u64)
**Status: Fully implemented**
**Signer:** User
**Accounts:** user (signer, mut), escrow (mut), system_program
**Effect:** Transfers `amount` lamports from escrow PDA back to user wallet. Only withdraws from `balance`, not `locked`. Fails if `amount > escrow.balance`.

### 3. create_market(market_id: u64, word_index: u16, label: String)
**Status: Fully implemented**
**Signer:** Admin (authority)
**Accounts:** authority (signer, mut), word_market (init), yes_mint (init), no_mint (init), vault, token_program, system_program, rent
**Effect:** Creates a new word market in Active status with YES/NO SPL token mints. Label max 32 chars.

### 4. pause_market()
**Status: Implemented**
**Signer:** Admin (authority)
**Accounts:** authority (signer), word_market (mut)
**Effect:** Sets market status from Active to Paused. Requires `authority == word_market.authority`.

### 5. resolve_market(outcome: Outcome)
**Status: Implemented**
**Signer:** Admin (authority)
**Accounts:** authority (signer), word_market (mut)
**Effect:** Sets market status to Resolved and records the outcome (Yes/No). Market must be Active or Paused.

### 6. settle_match(price: u64, amount: u64)
**Status: Stubbed — accounts defined, logic TODO**
**Signer:** Backend wallet (co-signer)
**Accounts:** backend (signer), word_market (mut), yes_buyer_escrow (mut), yes_buyer, yes_buyer_token_account (mut), no_buyer_escrow (mut), no_buyer, no_buyer_token_account (mut), yes_mint (mut), no_mint (mut), vault (mut), token_program, system_program
**Parameters:**
- `price`: lamports per share the YES buyer pays (e.g. 500_000_000 = 0.5 SOL)
- `amount`: number of shares in token base units (1_000_000 = 1 share)
- NO buyer pays `(1_000_000_000 - price)` per share
**Intended effect:**
1. Deduct from `yes_buyer_escrow.locked` and `no_buyer_escrow.locked`
2. Transfer SOL from both escrows to market vault
3. Mint YES tokens to yes_buyer, NO tokens to no_buyer
4. Increment `word_market.total_collateral`

### 7. claim()
**Status: Stubbed — accounts defined, logic TODO**
**Signer:** User
**Accounts:** user (signer, mut), word_market (mut), user_yes_account (mut), user_no_account (mut), yes_mint (mut), no_mint (mut), vault (mut), token_program, system_program
**Intended effect:**
1. Market must be Resolved
2. Read user's balance of winning token
3. Burn winning tokens
4. Transfer equivalent SOL from vault to user wallet (1 token = 1 SOL)
5. Decrement `total_collateral`

## PDA Derivation (TypeScript)

```typescript
import { PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("MENTionXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");

// User escrow
const [escrow] = PublicKey.findProgramAddressSync(
  [Buffer.from("escrow"), userWallet.toBuffer()],
  PROGRAM_ID
);

// Word market
const [wordMarket] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("market"),
    new BN(marketId).toArrayLike(Buffer, "le", 8),
    new BN(wordIndex).toArrayLike(Buffer, "le", 2),
  ],
  PROGRAM_ID
);

// YES/NO mints and vault (derived from word market PDA)
const [yesMint] = PublicKey.findProgramAddressSync(
  [Buffer.from("yes_mint"), wordMarket.toBuffer()],
  PROGRAM_ID
);
const [noMint] = PublicKey.findProgramAddressSync(
  [Buffer.from("no_mint"), wordMarket.toBuffer()],
  PROGRAM_ID
);
const [vault] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault"), wordMarket.toBuffer()],
  PROGRAM_ID
);
```

## Backend ↔ Contract Interface

The backend (CLOB matching engine) interacts with the contract via:
1. **Read escrow balances** — to validate order placement (balance >= order cost)
2. **Lock funds** — when user places an order, backend calls an instruction to move funds from `balance` to `locked` (NOTE: lock/unlock instructions not yet added — needed for order placement/cancellation)
3. **settle_match** — after matching two orders, backend builds and signs the settlement tx
4. **Read word_market status** — to know which markets are tradeable

Missing instructions to add:
- `lock_funds(market, amount)` — backend calls to move escrow balance → locked when order placed
- `unlock_funds(market, amount)` — backend calls to move locked → balance when order cancelled

## File Structure
```
programs/mention-market/src/
├── lib.rs                          // Program entrypoint, instruction dispatch
├── state/
│   ├── mod.rs
│   ├── user_escrow.rs              // UserEscrow account
│   └── word_market.rs              // WordMarket account, MarketStatus, Outcome enums
└── instructions/
    ├── mod.rs
    ├── deposit.rs                  // ✅ Implemented
    ├── withdraw.rs                 // ✅ Implemented
    ├── create_market.rs            // ✅ Implemented
    ├── pause_market.rs             // ✅ Implemented
    ├── resolve_market.rs           // ✅ Implemented
    ├── settle_match.rs             // 🔲 Stubbed
    └── claim.rs                    // 🔲 Stubbed
```
