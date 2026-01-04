# Frontend Integration Guide

## Contract ABI Location

After building, the ABI is located at:
```
base_contracts/out/MentionedMarket.sol/MentionedMarket.json
```

## Quick Start with wagmi/viem

```typescript
import { createPublicClient, createWalletClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'
import MentionedMarketABI from './abis/MentionedMarket.json'

const MARKET_ADDRESS = '0x...' // Your deployed contract address
const USDC_ADDRESS = '0x...'   // USDC contract address

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http()
})
```

## Core Workflows

### 1. Read Event and Words

```typescript
// Get event details
const getEvent = async (eventId: number) => {
  const [name, state, createdAt, wordIds] = await publicClient.readContract({
    address: MARKET_ADDRESS,
    abi: MentionedMarketABI.abi,
    functionName: 'getEvent',
    args: [BigInt(eventId)]
  })
  
  return { name, state, createdAt, wordIds }
}

// Get word details
const getWord = async (wordId: number) => {
  const [eventId, text, resolved, outcome] = await publicClient.readContract({
    address: MARKET_ADDRESS,
    abi: MentionedMarketABI.abi,
    functionName: 'getWord',
    args: [BigInt(wordId)]
  })
  
  return { eventId, text, resolved, outcome }
}

// Get user's token balance
const getTokenBalance = async (
  userAddress: string, 
  wordId: number, 
  outcome: 0 | 1 // 0 = YES, 1 = NO
) => {
  const balance = await publicClient.readContract({
    address: MARKET_ADDRESS,
    abi: MentionedMarketABI.abi,
    functionName: 'getTokenBalance',
    args: [userAddress, BigInt(wordId), outcome]
  })
  
  return balance
}
```

### 2. Create Complete Sets (Provide Liquidity)

```typescript
import { parseUnits } from 'viem'
import USDCabi from './abis/USDC.json'

const createCompleteSets = async (
  walletClient: any,
  wordId: number,
  amount: number // Number of complete sets
) => {
  const account = walletClient.account.address
  
  // Step 1: Approve USDC (amount * 1 USDC per set)
  const usdcAmount = parseUnits((amount * 1).toString(), 6) // USDC has 6 decimals
  
  const approveTx = await walletClient.writeContract({
    address: USDC_ADDRESS,
    abi: USDCabi.abi,
    functionName: 'approve',
    args: [MARKET_ADDRESS, usdcAmount],
    account
  })
  
  await publicClient.waitForTransactionReceipt({ hash: approveTx })
  
  // Step 2: Create complete sets
  const createTx = await walletClient.writeContract({
    address: MARKET_ADDRESS,
    abi: MentionedMarketABI.abi,
    functionName: 'createCompleteSets',
    args: [BigInt(wordId), BigInt(amount)],
    account
  })
  
  return await publicClient.waitForTransactionReceipt({ hash: createTx })
}
```

### 3. Place Limit Order

```typescript
const placeLimitOrder = async (
  walletClient: any,
  wordId: number,
  outcome: 0 | 1, // 0 = YES, 1 = NO
  orderType: 0 | 1, // 0 = BUY, 1 = SELL
  price: number, // Price in USDC (e.g., 0.65)
  amount: number // Number of contracts
) => {
  const account = walletClient.account.address
  const priceScaled = parseUnits(price.toString(), 6) // Scale to 1e6
  
  // If BUY order, approve USDC
  if (orderType === 0) {
    const usdcAmount = (priceScaled * BigInt(amount)) / BigInt(1e6)
    
    const approveTx = await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: USDCabi.abi,
      functionName: 'approve',
      args: [MARKET_ADDRESS, usdcAmount],
      account
    })
    
    await publicClient.waitForTransactionReceipt({ hash: approveTx })
  }
  // If SELL order, tokens are automatically burned from user's balance
  
  // Place order
  const orderTx = await walletClient.writeContract({
    address: MARKET_ADDRESS,
    abi: MentionedMarketABI.abi,
    functionName: 'placeLimitOrder',
    args: [
      BigInt(wordId),
      outcome,
      orderType,
      priceScaled,
      BigInt(amount)
    ],
    account
  })
  
  return await publicClient.waitForTransactionReceipt({ hash: orderTx })
}
```

### 4. Get Order Book

```typescript
const getOrderBook = async (
  wordId: number,
  outcome: 0 | 1,
  orderType: 0 | 1,
  limit: number = 10
) => {
  const [orderIds, prices, amounts] = await publicClient.readContract({
    address: MARKET_ADDRESS,
    abi: MentionedMarketABI.abi,
    functionName: 'getBestOrders',
    args: [BigInt(wordId), outcome, orderType, BigInt(limit)]
  })
  
  // Convert to human-readable format
  return orderIds.map((id, i) => ({
    orderId: id,
    price: Number(prices[i]) / 1e6, // Convert from scaled price
    amount: Number(amounts[i])
  }))
}
```

### 5. Fill Order

```typescript
const fillOrder = async (
  walletClient: any,
  orderId: number,
  amount: number
) => {
  const account = walletClient.account.address
  
  // Get order details to know if we need to approve USDC
  const order = await publicClient.readContract({
    address: MARKET_ADDRESS,
    abi: MentionedMarketABI.abi,
    functionName: 'getOrder',
    args: [BigInt(orderId)]
  })
  
  // If filling a SELL order (we're buying), approve USDC
  if (order.orderType === 1) { // SELL
    const usdcAmount = (order.price * BigInt(amount)) / BigInt(1e6)
    
    const approveTx = await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: USDCabi.abi,
      functionName: 'approve',
      args: [MARKET_ADDRESS, usdcAmount],
      account
    })
    
    await publicClient.waitForTransactionReceipt({ hash: approveTx })
  }
  
  // Fill order
  const fillTx = await walletClient.writeContract({
    address: MARKET_ADDRESS,
    abi: MentionedMarketABI.abi,
    functionName: 'fillOrder',
    args: [BigInt(orderId), BigInt(amount)],
    account
  })
  
  return await publicClient.waitForTransactionReceipt({ hash: fillTx })
}
```

### 6. Claim Winnings

```typescript
const claimWinnings = async (
  walletClient: any,
  wordId: number,
  amount: number
) => {
  const account = walletClient.account.address
  
  const claimTx = await walletClient.writeContract({
    address: MARKET_ADDRESS,
    abi: MentionedMarketABI.abi,
    functionName: 'claimWinnings',
    args: [BigInt(wordId), BigInt(amount)],
    account
  })
  
  return await publicClient.waitForTransactionReceipt({ hash: claimTx })
}
```

## Event Listening

```typescript
// Watch for new orders
const unwatchOrders = publicClient.watchContractEvent({
  address: MARKET_ADDRESS,
  abi: MentionedMarketABI.abi,
  eventName: 'OrderPlaced',
  onLogs: (logs) => {
    logs.forEach((log) => {
      const { orderId, wordId, maker, outcome, orderType, price, amount } = log.args
      console.log('New order:', { orderId, wordId, maker, outcome, orderType, price, amount })
      // Update UI
    })
  }
})

// Watch for filled orders
const unwatchFills = publicClient.watchContractEvent({
  address: MARKET_ADDRESS,
  abi: MentionedMarketABI.abi,
  eventName: 'OrderFilled',
  onLogs: (logs) => {
    logs.forEach((log) => {
      const { orderId, taker, amount, price } = log.args
      console.log('Order filled:', { orderId, taker, amount, price })
      // Update UI
    })
  }
})

// Watch for word resolutions
const unwatchResolutions = publicClient.watchContractEvent({
  address: MARKET_ADDRESS,
  abi: MentionedMarketABI.abi,
  eventName: 'WordResolved',
  onLogs: (logs) => {
    logs.forEach((log) => {
      const { wordId, outcome } = log.args
      console.log('Word resolved:', { wordId, outcome: outcome === 0 ? 'YES' : 'NO' })
      // Update UI
    })
  }
})
```

## React Hooks with wagmi

```typescript
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'

// Read hook
function useWordDetails(wordId: number) {
  const { data, isError, isLoading } = useReadContract({
    address: MARKET_ADDRESS,
    abi: MentionedMarketABI.abi,
    functionName: 'getWord',
    args: [BigInt(wordId)]
  })
  
  if (!data) return null
  
  const [eventId, text, resolved, outcome] = data
  return { eventId, text, resolved, outcome }
}

// Write hook
function useCreateCompleteSets() {
  const { writeContract, data: hash } = useWriteContract()
  
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({
    hash
  })
  
  const createSets = (wordId: number, amount: number) => {
    writeContract({
      address: MARKET_ADDRESS,
      abi: MentionedMarketABI.abi,
      functionName: 'createCompleteSets',
      args: [BigInt(wordId), BigInt(amount)]
    })
  }
  
  return { createSets, isLoading, isSuccess }
}
```

## Gas Sponsorship (ERC-4337)

The contract is compatible with smart contract accounts. Example with Privy:

```typescript
import { useSmartWallets } from '@privy-io/react-auth'

const { client } = useSmartWallets()

// Use the smart wallet client instead of regular wallet client
const tx = await client.writeContract({
  address: MARKET_ADDRESS,
  abi: MentionedMarketABI.abi,
  functionName: 'placeLimitOrder',
  args: [/* ... */]
})
// Gas will be sponsored if configured in Privy dashboard
```

## Batch Transactions

```typescript
// Using Privy's batch functionality
const batchTx = await client.sendBatchTransaction([
  {
    to: USDC_ADDRESS,
    data: encodeFunctionData({
      abi: USDCabi.abi,
      functionName: 'approve',
      args: [MARKET_ADDRESS, amount]
    })
  },
  {
    to: MARKET_ADDRESS,
    data: encodeFunctionData({
      abi: MentionedMarketABI.abi,
      functionName: 'createCompleteSets',
      args: [wordId, amount]
    })
  }
])
```

## Enums

```typescript
enum EventState {
  PREMARKET = 0,
  LIVE = 1,
  RESOLVED = 2
}

enum Outcome {
  YES = 0,
  NO = 1
}

enum OrderType {
  BUY = 0,
  SELL = 1
}
```

## Error Handling

```typescript
try {
  const tx = await placeLimitOrder(...)
  console.log('Success:', tx)
} catch (error) {
  if (error.message.includes('Event not live')) {
    console.error('Event is not live yet')
  } else if (error.message.includes('Word already resolved')) {
    console.error('This market has been resolved')
  } else if (error.message.includes('Amount must be positive')) {
    console.error('Invalid amount')
  } else {
    console.error('Transaction failed:', error)
  }
}
```

## TypeScript Types

```typescript
interface Event {
  name: string
  state: EventState
  createdAt: bigint
  wordIds: bigint[]
}

interface Word {
  eventId: bigint
  text: string
  resolved: boolean
  outcome: Outcome
}

interface Order {
  orderId: bigint
  wordId: bigint
  maker: string
  outcome: Outcome
  orderType: OrderType
  price: bigint // Scaled by 1e6
  amount: bigint
  filled: bigint
  cancelled: boolean
}
```

## Testing

Use Anvil for local testing:

```bash
# Start local node with fork
anvil --fork-url https://sepolia.base.org

# Update your frontend to point to localhost:8545
```

## Common Issues

1. **"Insufficient allowance"**: Make sure to approve USDC before transactions
2. **"Event not live"**: Check event state is LIVE (1)
3. **"Word already resolved"**: Cannot trade on resolved markets
4. **Gas estimation failed**: User may not have enough tokens/USDC

## Resources

- [viem Documentation](https://viem.sh/)
- [wagmi Documentation](https://wagmi.sh/)
- [Base Documentation](https://docs.base.org/)
- [OpenZeppelin ERC1155](https://docs.openzeppelin.com/contracts/4.x/erc1155)

