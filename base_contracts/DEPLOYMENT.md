# Deployment Guide

## Prerequisites

1. **Install Foundry** (if not already installed):
```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

2. **Get Base Sepolia ETH**:
- Visit [Base Sepolia Faucet](https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet)
- You'll need ETH for gas fees

3. **Get BaseScan API Key** (for verification):
- Visit [BaseScan](https://basescan.org/)
- Sign up and create an API key

## Environment Setup

Create a `.env` file in the `base_contracts` directory:

```bash
# Private key (without 0x prefix)
PRIVATE_KEY=your_private_key_here

# RPC URL
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org

# BaseScan API Key (for verification)
BASESCAN_API_KEY=your_api_key_here
```

**⚠️ IMPORTANT**: Never commit your `.env` file to git! It should already be in `.gitignore`.

## Step 1: Deploy Mock USDC (Testing)

For testing, deploy a mock USDC token:

```bash
forge script script/DeployMockUSDC.s.sol:DeployMockUSDC \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --broadcast \
  --verify
```

Copy the deployed MockUSDC address from the output.

## Step 2: Update Deploy Script

Open `script/Deploy.s.sol` and update the USDC address:

```solidity
address constant USDC_BASE_SEPOLIA = 0xYOUR_MOCK_USDC_ADDRESS;
```

## Step 3: Deploy MentionedMarket Contract

```bash
forge script script/Deploy.s.sol:DeployMentionedMarket \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --broadcast \
  --verify
```

Save the deployed contract address!

## Step 4: Verify Deployment

Check your contract on BaseScan:
- Visit: `https://sepolia.basescan.org/address/YOUR_CONTRACT_ADDRESS`
- Verify the contract is deployed and verified

## Step 5: Test Interaction

Use Cast to test basic functions:

```bash
# Set environment variables
export MARKET_ADDRESS=your_deployed_market_address
export USDC_ADDRESS=your_deployed_usdc_address

# Create an event (as owner)
cast send $MARKET_ADDRESS \
  "createEvent(string)" "Test Event" \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --private-key $PRIVATE_KEY

# Read the event (eventId = 1)
cast call $MARKET_ADDRESS \
  "getEvent(uint256)" 1 \
  --rpc-url $BASE_SEPOLIA_RPC_URL
```

## Deployment to Base Mainnet

When ready for mainnet:

1. Get real ETH for Base Mainnet
2. Update RPC URL to Base Mainnet
3. Use real USDC address: Check [Base Token List](https://docs.base.org/tokens/)
4. Deploy following the same steps above

**Mainnet USDC Address** (verify this!):
- Base Mainnet USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

## Gas Costs (Estimate)

On Base Sepolia:
- Deploy MockUSDC: ~1,000,000 gas
- Deploy MentionedMarket: ~4,000,000 gas
- Create Event: ~100,000 gas
- Add Word: ~120,000 gas
- Place Order: ~150,000 gas

## Troubleshooting

### "Insufficient funds" error
- Ensure you have enough ETH in your deployer wallet
- Get more from the Base Sepolia faucet

### "Nonce too low" error
- Someone else may have used your private key
- Try with a fresh wallet

### Verification failed
- Check your BASESCAN_API_KEY
- Verification can take a few minutes - be patient
- Try manual verification on BaseScan

### Contract compilation issues
```bash
# Clean and rebuild
forge clean
forge build
```

## Next Steps

After deployment:

1. **Save Contract Addresses**: Store in your frontend config
2. **Mint Test USDC**: Mint USDC to test wallets
3. **Create Test Event**: Create an event and add words
4. **Build Frontend**: Connect your React/Next.js app
5. **Test Trading**: Create complete sets and trade

## Security Checklist

Before mainnet:
- [ ] Audit the contract
- [ ] Test all functions on testnet
- [ ] Verify owner address
- [ ] Test with multiple users
- [ ] Check gas costs
- [ ] Implement proper access controls
- [ ] Consider using a multisig for owner
- [ ] Have an incident response plan

## Useful Commands

```bash
# Check balance
cast balance $YOUR_ADDRESS --rpc-url $BASE_SEPOLIA_RPC_URL

# Send ETH
cast send $RECIPIENT_ADDRESS --value 0.1ether \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --private-key $PRIVATE_KEY

# Get transaction receipt
cast receipt $TX_HASH --rpc-url $BASE_SEPOLIA_RPC_URL

# Estimate gas
cast estimate $CONTRACT_ADDRESS "functionSig()" --rpc-url $BASE_SEPOLIA_RPC_URL
```

## Support

If you encounter issues:
1. Check the [Foundry Book](https://book.getfoundry.sh/)
2. Review [Base Documentation](https://docs.base.org/)
3. Ask in Base Discord or Foundry Telegram

