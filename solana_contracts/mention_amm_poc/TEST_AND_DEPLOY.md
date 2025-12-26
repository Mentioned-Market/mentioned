# Order Book Contract - Testing & Deployment Guide

## 📋 Overview

This guide covers testing and deploying the Mentioned order book prediction market contract on Solana.

**Contract Features:**
- Zero protocol risk (no liquidity pools)
- Users trade YES/NO tokens directly via limit orders
- Permissionless order matching
- Risk-free cancellation before orders fill
- Complete on-chain order book

---

## 🧪 Testing

### Test Coverage

The test suite (`tests/order_book.ts`) includes:

1. **Event & Market Initialization**
   - Creating events (e.g., "Trump Space Jan 15")
   - Creating markets for specific words

2. **Complete Set Operations**
   - Minting YES + NO tokens by depositing SOL
   - Burning YES + NO to get SOL back

3. **Order Management**
   - Placing buy and sell orders at custom prices
   - Canceling unfilled orders with collateral refund

4. **Order Matching**
   - Permissionless matching of compatible orders
   - Proper token and collateral transfers

5. **Resolution & Redemption**
   - Admin resolving markets (YES or NO wins)
   - Users redeeming winning tokens for SOL

6. **Error Cases**
   - Preventing redemption of losing tokens
   - Blocking orders after resolution

### Running Tests Locally

```bash
# Navigate to project
cd solana_contracts/mention_amm_poc

# Start local validator (in separate terminal)
solana-test-validator

# Run tests
anchor test --skip-deploy
```

### Running Tests on Devnet

```bash
# Set cluster to devnet
solana config set --url devnet

# Deploy and test
anchor test --skip-local-validator --provider.cluster devnet
```

### Expected Test Output

```
Order Book Tests
  Event & Market Initialization
    ✓ Creates an event
    ✓ Creates a market
  Minting and Burning Sets
    ✓ User mints a complete set
    ✓ User burns a complete set to get SOL back
  Order Placement and Cancellation
    ✓ User places a sell order for NO tokens
    ✓ User cancels an unfilled order
  Order Matching
    ✓ Creates matching buy and sell orders
    ✓ Matches the orders
  Market Resolution & Redemption
    ✓ Admin resolves market
    ✓ User redeems winning tokens
  Error Cases
    ✓ Fails to redeem losing tokens
    ✓ Fails to place order after resolution

  12 passing
```

---

## 🚀 Deployment

### Prerequisites

**Required Tools:**
- Solana CLI (`solana-cli` 1.18+)
- Anchor CLI (`anchor-cli` 0.32+)
- Rust & Cargo
- Node.js & Yarn/NPM

**Verify Installation:**
```bash
solana --version
anchor --version
cargo --version
```

### Step 1: Set Up Deployer Keypair

You provided the private key: `2Dfpja89ocTqvE4f1wgGKhJshhH9qCahPHD8qSHxiU5VZgPXxEZt1TAZGgUwULWu6RCGDDdxY435BDjSfuNotU7`

#### Option A: Import via Phantom/Solflare

1. Import your private key into Phantom wallet
2. Export as JSON keypair file
3. Save to `~/.config/solana/id.json`

#### Option B: Use Existing Keypair

If you already have a keypair file:
```bash
cp /path/to/your/keypair.json ~/.config/solana/id.json
```

#### Option C: Generate New Keypair (Test Only)

```bash
solana-keygen new -o ~/.config/solana/id.json
```

**Verify Keypair Setup:**
```bash
# Check your address
solana address

# Should output something like:
# 5ZiE3vAkrdXBgyFL7KqG3RoEGBws4CjRcXVbABDLZTgx
```

### Step 2: Fund Your Account

**For Devnet (Testing):**
```bash
# Request airdrop (2 SOL at a time, max 5 SOL)
solana airdrop 2 --url devnet

# Or use web faucet: https://faucet.solana.com/

# Check balance
solana balance --url devnet
```

**For Mainnet:**
- Transfer SOL from an exchange or another wallet
- Recommended: 5-10 SOL for deployment

### Step 3: Configure Cluster

**For Devnet (Testing):**
```bash
solana config set --url devnet

# Verify config
solana config get
```

**For Mainnet (Production):**
```bash
solana config set --url mainnet-beta
```

### Step 4: Build the Program

```bash
cd solana_contracts/mention_amm_poc

# Build the Solana program
cargo build-sbf --manifest-path=programs/mention_amm_poc/Cargo.toml

# Verify the build
ls -lh target/sbpf-solana-solana/release/mention_amm_poc.so
```

**Expected output:**
```
-rwxr-xr-x  1 user  staff   XXX KB  mention_amm_poc.so
```

### Step 5: Deploy to Devnet

```bash
# Deploy the program
solana program deploy \
  target/sbpf-solana-solana/release/mention_amm_poc.so \
  --url devnet \
  --keypair ~/.config/solana/id.json

# Expected output:
# Program Id: F8EsP2rp6FBuaTfKQ8ywx4hqhM3YpcJr4HPkXHeGsZyJ
```

**Important:** The program ID `F8EsP2rp6FBuaTfKQ8ywx4hqhM3YpcJr4HPkXHeGsZyJ` is hardcoded in the contract. If Solana assigns a different program ID, you'll need to update `declare_id!` in `order_book.rs` and redeploy.

### Step 6: Verify Deployment

```bash
# Check program info
solana program show F8EsP2rp6FBuaTfKQ8ywx4hqhM3YpcJr4HPkXHeGsZyJ --url devnet

# Expected output shows:
# - Program Id
# - Owner (your deployer address)
# - Data Length
# - Upgradeable: yes
```

### Step 7: Run Tests Against Deployed Contract

```bash
# Run the test suite
anchor test --skip-local-validator --provider.cluster devnet

# All 12 tests should pass
```

---

## 🔄 Upgrading the Program

If you need to update the contract after initial deployment:

```bash
# Build new version
cargo build-sbf --manifest-path=programs/mention_amm_poc/Cargo.toml

# Upgrade (keeps same program ID)
solana program deploy \
  target/sbpf-solana-solana/release/mention_amm_poc.so \
  --program-id F8EsP2rp6FBuaTfKQ8ywx4hqhM3YpcJr4HPkXHeGsZyJ \
  --upgrade-authority ~/.config/solana/id.json \
  --url devnet
```

---

## 🔧 Troubleshooting

### Issue: "Insufficient funds for transaction"

**Solution:**
```bash
# Request more SOL (devnet)
solana airdrop 2 --url devnet

# Or use faucet: https://faucet.solana.com/
```

### Issue: "Invalid keypair file"

**Solution:** Keypair must be JSON array of 64 numbers:
```json
[1,2,3,4,...,64]
```

### Issue: "Program already deployed at this address"

**Solution:** Either upgrade the existing program or deploy to a new address:
```bash
# Option 1: Upgrade existing
solana program deploy target/sbpf-solana-solana/release/mention_amm_poc.so \
  --program-id F8EsP2rp6FBuaTfKQ8ywx4hqhM3YpcJr4HPkXHeGsZyJ \
  --upgrade-authority ~/.config/solana/id.json

# Option 2: Deploy new (generates new program ID)
solana program deploy target/sbpf-solana-solana/release/mention_amm_poc.so
# Then update declare_id! in order_book.rs with the new ID
```

### Issue: "Failed to build program"

**Solution:** Ensure you have the correct Rust toolchain:
```bash
# Check current toolchain
rustup show

# Should show 1.72.0 (per rust-toolchain.toml)

# If not, force install
rustup install 1.72.0
```

### Issue: Tests fail on devnet

**Solution:**
```bash
# Ensure you have sufficient balance for test transactions
solana balance --url devnet

# Ensure cluster is set correctly
solana config get

# Check program is deployed
solana program show F8EsP2rp6FBuaTfKQ8ywx4hqhM3YpcJr4HPkXHeGsZyJ --url devnet
```

---

## 📊 Cost Estimates

### Devnet (Free)
- All operations are free
- Get SOL from faucet
- Perfect for testing

### Mainnet
- **Initial deployment:** ~2-5 SOL (one-time, refundable when closing program)
- **Account creation:** ~0.001-0.01 SOL per account
- **Transactions:** ~0.000005 SOL per transaction
- **Market creation:** ~0.01 SOL per market

---

## 🎯 Post-Deployment Steps

### 1. Update Frontend

Update your frontend `lib/program.ts` with:
```typescript
export const PROGRAM_ID = new PublicKey(
  "F8EsP2rp6FBuaTfKQ8ywx4hqhM3YpcJr4HPkXHeGsZyJ"
);
```

### 2. Create Test Event & Market

```bash
# Use the test suite or create via frontend
anchor run test-create-market
```

### 3. Test Complete Flow

1. **Mint Set:** User deposits SOL → gets YES + NO tokens
2. **Place Orders:** Users create buy/sell orders
3. **Match Orders:** Orders automatically match when prices cross
4. **Resolve Market:** Admin marks YES or NO as winner
5. **Redeem:** Winners burn tokens → get SOL back

---

## 📝 Quick Reference Commands

```bash
# Build
cargo build-sbf --manifest-path=programs/mention_amm_poc/Cargo.toml

# Deploy to devnet
solana program deploy target/sbpf-solana-solana/release/mention_amm_poc.so --url devnet

# Deploy to mainnet
solana program deploy target/sbpf-solana-solana/release/mention_amm_poc.so --url mainnet-beta

# Run tests locally
anchor test

# Run tests on devnet
anchor test --skip-local-validator --provider.cluster devnet

# Check program info
solana program show F8EsP2rp6FBuaTfKQ8ywx4hqhM3YpcJr4HPkXHeGsZyJ

# Check balance
solana balance

# Get devnet SOL
solana airdrop 2 --url devnet
```

---

## 🎉 Success Checklist

- [ ] Solana CLI installed and configured
- [ ] Deployer keypair set up at `~/.config/solana/id.json`
- [ ] Account funded with SOL
- [ ] Program built successfully
- [ ] Program deployed to devnet
- [ ] All 12 tests pass
- [ ] Frontend updated with program ID
- [ ] Test event and market created
- [ ] Complete trading flow tested

---

## 📚 Additional Resources

- **Solana Docs:** https://docs.solana.com/
- **Anchor Docs:** https://www.anchor-lang.com/
- **Devnet Faucet:** https://faucet.solana.com/
- **Explorer (Devnet):** https://explorer.solana.com/?cluster=devnet
- **Explorer (Mainnet):** https://explorer.solana.com/

---

## 🚨 Important Security Notes

⚠️ **Never share your private key or keypair file**

⚠️ **Devnet is for testing only** - tokens have no real value

⚠️ **Test thoroughly on devnet** before deploying to mainnet

⚠️ **Keep backups** of your deployer keypair

⚠️ **Use upgrade authority** carefully - store it securely

---

**Ready to deploy?** Follow the steps above and you'll have your order book live on Solana!

For questions or issues, refer to the troubleshooting section or check the contract code in `programs/mention_amm_poc/src/order_book.rs`.

