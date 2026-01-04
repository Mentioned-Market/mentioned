# Demo Mode with MockUSDC Faucet

## Overview

Your contract now uses **MockUSDC** with a built-in public faucet, perfect for demo/MVP where:
- Users create wallets on arrival
- Auto-fund new wallets instantly
- No real money needed for testing

## MockUSDC Features

### 1. Public Faucet
```solidity
function faucet() external
```
- Anyone can claim **10,000 mUSDC**
- **1-hour cooldown** between claims
- Perfect for new demo users

### 2. Admin Minting
```solidity
function mint(address to, uint256 amount) external
```
- Mint any amount to any address
- No restrictions (it's a demo token!)

### 3. Batch Funding
```solidity
function fundDemoWallets(address[] wallets, uint256 amount) external
```
- Fund multiple wallets at once
- Great for onboarding many users

## Frontend Integration

### Auto-Fund New Users

```typescript
import { createWalletClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const USDC_ADDRESS = '0x...' // Your deployed MockUSDC address

// 1. Generate new wallet for user
function generateDemoWallet() {
  const privateKey = generatePrivateKey() // viem
  const account = privateKeyToAccount(privateKey)
  
  // Store in browser localStorage for demo
  localStorage.setItem('demo_wallet_key', privateKey)
  
  return account
}

// 2. Auto-fund the wallet using faucet
async function fundNewUser(userAddress: string) {
  const walletClient = createWalletClient({
    account: userAddress,
    chain: baseSepolia,
    transport: http()
  })
  
  // Call faucet to get 10,000 mUSDC
  const hash = await walletClient.writeContract({
    address: USDC_ADDRESS,
    abi: MockUSDCABI,
    functionName: 'faucet'
  })
  
  await publicClient.waitForTransactionReceipt({ hash })
  
  console.log('User funded with 10,000 mUSDC!')
  return hash
}

// 3. Complete onboarding flow
async function onboardNewUser() {
  // Generate wallet
  const account = generateDemoWallet()
  console.log('Generated wallet:', account.address)
  
  // Fund with USDC
  await fundNewUser(account.address)
  console.log('Wallet funded!')
  
  // User is ready to trade!
  return account
}
```

### Check Faucet Cooldown

```typescript
async function canClaimFaucet(userAddress: string): Promise<boolean> {
  const lastClaim = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: MockUSDCABI,
    functionName: 'lastFaucetClaim',
    args: [userAddress]
  })
  
  if (lastClaim === 0n) return true // Never claimed
  
  const now = Math.floor(Date.now() / 1000)
  const cooldown = 3600 // 1 hour
  
  return now >= Number(lastClaim) + cooldown
}
```

### Admin Batch Funding (Backend)

```typescript
// Fund multiple demo users at once
async function fundDemoUsers(wallets: string[], amount: bigint) {
  const tx = await adminWalletClient.writeContract({
    address: USDC_ADDRESS,
    abi: MockUSDCABI,
    functionName: 'fundDemoWallets',
    args: [wallets, amount]
  })
  
  return await publicClient.waitForTransactionReceipt({ hash: tx })
}

// Example: Fund 10 new users with 5,000 mUSDC each
const newUsers = [/* array of 10 addresses */]
await fundDemoUsers(newUsers, parseUnits('5000', 6))
```

## Deployment (Updated)

Now you only need **ONE command** to deploy everything:

```bash
# Deploy MockUSDC + MentionedMarket together
forge script script/Deploy.s.sol:DeployMentionedMarket \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --broadcast \
  --verify
```

This will:
1. ✅ Deploy MockUSDC with faucet
2. ✅ Deploy MentionedMarket
3. ✅ Fund deployer with 100k mUSDC
4. ✅ Print both contract addresses

## User Flow

### First-Time User
1. **Arrives at your site**
2. **Generate wallet** (in browser, private key in localStorage)
3. **Auto-call faucet** → Gets 10,000 mUSDC instantly
4. **Start trading!**

### Returning User
1. **Load wallet** from localStorage
2. **Check balance**
3. **If low, call faucet again** (after cooldown)
4. **Continue trading**

## Example React Component

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useAccount, useWriteContract } from 'wagmi'
import { parseUnits } from 'viem'

export function DemoWalletSetup() {
  const { address } = useAccount()
  const [funded, setFunded] = useState(false)
  const { writeContract } = useWriteContract()
  
  useEffect(() => {
    if (address) {
      checkAndFund()
    }
  }, [address])
  
  async function checkAndFund() {
    if (!address) return
    
    // Check USDC balance
    const balance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: MockUSDCABI,
      functionName: 'balanceOf',
      args: [address]
    })
    
    // If balance low, claim faucet
    if (balance < parseUnits('1000', 6)) {
      const canClaim = await canClaimFaucet(address)
      
      if (canClaim) {
        writeContract({
          address: USDC_ADDRESS,
          abi: MockUSDCABI,
          functionName: 'faucet'
        })
        setFunded(true)
      }
    } else {
      setFunded(true)
    }
  }
  
  return (
    <div>
      {funded ? (
        <div className="text-green-600">
          ✅ Wallet funded! You're ready to trade.
        </div>
      ) : (
        <div className="text-yellow-600">
          ⏳ Funding your demo wallet...
        </div>
      )}
    </div>
  )
}
```

## Smart Contract Wallet Integration

Works perfectly with Privy, Dynamic, or any ERC-4337 wallet:

```tsx
import { usePrivy } from '@privy-io/react-auth'

function DemoSetup() {
  const { createWallet } = usePrivy()
  
  async function setupDemoUser() {
    // Create embedded wallet for user
    const wallet = await createWallet()
    
    // Auto-fund via faucet
    const tx = await wallet.sendTransaction({
      to: USDC_ADDRESS,
      data: encodeFunctionData({
        abi: MockUSDCABI,
        functionName: 'faucet'
      })
    })
    // Gas sponsored if configured in Privy!
    
    console.log('User ready:', wallet.address)
  }
  
  return <button onClick={setupDemoUser}>Start Demo</button>
}
```

## Contract Addresses (After Deployment)

Save these to your `.env` or config:

```bash
# .env.local
NEXT_PUBLIC_MOCK_USDC_ADDRESS=0x...
NEXT_PUBLIC_MARKET_ADDRESS=0x...
NEXT_PUBLIC_CHAIN_ID=84532 # Base Sepolia
```

## Testing Locally

```bash
# Start local node
anvil

# Deploy
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast

# Interact
export USDC=<deployed_usdc_address>

# Claim faucet for address
cast send $USDC "faucet()" --rpc-url http://localhost:8545 --private-key 0xac0...

# Check balance
cast call $USDC "balanceOf(address)" <address> --rpc-url http://localhost:8545
```

## Production Considerations

For production (real money), you would:
1. Use real USDC contract
2. Remove faucet functionality
3. Users bring their own USDC
4. Add proper access controls

But for demo/MVP, MockUSDC with faucet is **perfect**! 🎉

## Summary

- ✅ One-command deployment
- ✅ Auto-fund new users
- ✅ No manual USDC setup needed
- ✅ Perfect for demos
- ✅ Works with smart wallets
- ✅ Gas sponsorship compatible

Your users can start trading in seconds! 🚀

