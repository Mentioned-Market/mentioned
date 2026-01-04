# Quick Start Guide

Get your Mentioned Market contract running in 5 minutes!

## 1. Prerequisites

```bash
# Install Foundry (if not installed)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Verify installation
forge --version
```

## 2. Install Dependencies

```bash
cd base_contracts
forge install
```

## 3. Run Tests

```bash
# Run all tests
forge test -vv

# See gas report
forge test --gas-report

# Run specific test
forge test --match-test testFullWorkflow -vvvv
```

Expected output: ✅ **22 tests passed**

## 4. Deploy Locally (Anvil)

```bash
# Terminal 1: Start local node
anvil

# Terminal 2: Deploy
forge script script/DeployMockUSDC.s.sol --rpc-url http://localhost:8545 --broadcast

# Copy the USDC address, update script/Deploy.s.sol

forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast
```

## 5. Deploy to Base Sepolia

```bash
# Create .env file
cp .env.example .env

# Edit .env with your details:
# - PRIVATE_KEY (your wallet private key)
# - BASE_SEPOLIA_RPC_URL (https://sepolia.base.org)
# - BASESCAN_API_KEY (get from basescan.org)

source .env

# Deploy Mock USDC
forge script script/DeployMockUSDC.s.sol:DeployMockUSDC \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --broadcast \
  --verify

# Update USDC address in script/Deploy.s.sol

# Deploy MentionedMarket
forge script script/Deploy.s.sol:DeployMentionedMarket \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --broadcast \
  --verify
```

## 6. Interact with Contract

```bash
# Set variables
export MARKET=0xYourMarketAddress
export USDC=0xYourUSDCAddress

# Create an event
cast send $MARKET \
  "createEvent(string)" "Trump Inauguration" \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --private-key $PRIVATE_KEY

# Get event details
cast call $MARKET \
  "getEvent(uint256)" 1 \
  --rpc-url $BASE_SEPOLIA_RPC_URL
```

## 7. Next Steps

- Read [README.md](./README.md) for full documentation
- Check [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment steps
- See [FRONTEND_GUIDE.md](./FRONTEND_GUIDE.md) for frontend integration
- Review contract code in `src/MentionedMarket.sol`

## Common Commands

```bash
# Build contract
forge build

# Clean build artifacts
forge clean

# Format code
forge fmt

# Check contract size
forge build --sizes

# Run single test
forge test --match-test testCreateEvent -vvv

# Watch tests (rerun on file change)
forge test --watch
```

## Troubleshooting

### "Command not found: forge"
Install Foundry: `curl -L https://foundry.paradigm.xyz | bash && foundryup`

### Tests fail
Run `forge clean && forge build` then try again

### Deployment fails
- Check you have ETH in your wallet
- Verify RPC URL is correct
- Ensure private key is in .env (without 0x prefix)

## Need Help?

- Check [Foundry Book](https://book.getfoundry.sh/)
- Review [Base Docs](https://docs.base.org/)
- Read the comprehensive [README.md](./README.md)

## 🎉 You're Ready!

Your prediction market contract is now deployed and ready to use!

