#!/usr/bin/env ts-node
/**
 * simulate-trades.ts
 *
 * Generates N devnet wallets, funds them from a provided funder keypair,
 * then runs random buy/sell trades on a specified paid market.
 *
 * Usage:
 *   FUNDER_PRIVATE_KEY=<base58-or-json-array> \
 *   ts-node scripts/simulate-trades.ts <marketId> [wallets=5] [tradesPerWallet=4] [usdcPerTrade=1000000]
 *
 * Examples:
 *   FUNDER_PRIVATE_KEY="[12,34,56,...]" ts-node scripts/simulate-trades.ts 1778148840437
 *   FUNDER_PRIVATE_KEY="5Kf3..."        ts-node scripts/simulate-trades.ts 1778148840437 10 5 2000000
 *
 * FUNDER_PRIVATE_KEY formats:
 *   - JSON array of 64 numbers (Solana CLI keypair file format: cat ~/.config/solana/id.json)
 *   - Base58-encoded 64-byte secret key
 *
 * Defaults:
 *   wallets        = 5     (number of fresh wallets to generate)
 *   tradesPerWallet= 4     (trades each wallet places)
 *   usdcPerTrade   = 1000000  ($1.00 — in USDC base units, 6 decimals)
 *   SOL per wallet = 0.05 SOL (for tx fees)
 */

import 'dotenv/config'
import {
  createSolanaRpc,
  devnet,
  generateKeyPairSigner,
  createKeyPairSignerFromBytes,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  setTransactionMessageComputeUnitLimit,
  signTransactionMessageWithSigners,
  addSignersToInstruction,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  type KeyPairSigner,
  type Address,
  type Instruction,
} from '@solana/kit'
import { getTransferSolInstruction } from '@solana-program/system'
import {
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getTransferCheckedInstruction,
} from '@solana-program/token'
import bs58 from 'bs58'
import {
  DEVNET_URL,
  USDC_MINT,
  USDC_DECIMALS,
  fetchMarket,
  fetchTokenBalance,
  getAssociatedTokenAddress,
  impliedYesPrice,
  sharesForUsdc,
  estimateBuyCost,
  estimateSellReturn,
  createAtaIx,
  createBuyIx,
  createSellIx,
  MarketStatus,
  type UsdcMarketAccount,
} from '../lib/mentionMarketUsdc'

// ── Parse CLI args ────────────────────────────────────────────────────────────

const [,, rawMarketId, rawWallets, rawTrades, rawUsdc] = process.argv

if (!rawMarketId) {
  console.error('Usage: ts-node scripts/simulate-trades.ts <marketId> [wallets=5] [tradesPerWallet=4] [usdcPerTrade=1000000]')
  process.exit(1)
}

const MARKET_ID         = BigInt(rawMarketId)
const NUM_WALLETS       = parseInt(rawWallets  ?? '5',       10)
const TRADES_PER_WALLET = parseInt(rawTrades   ?? '4',       10)
const USDC_PER_TRADE    = BigInt(rawUsdc       ?? '1000000') // $1.00 default (6 dp)
const SOL_FOR_FEES      = BigInt(50_000_000)                 // 0.05 SOL per wallet

// ── RPC setup ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = createSolanaRpc(devnet(DEVNET_URL)) as any

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function rand(n: number): number {
  return Math.floor(Math.random() * n)
}

function loadFunderKey(): Uint8Array {
  const raw = process.env.FUNDER_PRIVATE_KEY
  if (!raw) {
    console.error('Error: FUNDER_PRIVATE_KEY env var not set.')
    console.error('  JSON array format: export FUNDER_PRIVATE_KEY="[12,34,56,...]"')
    console.error('  Base58 format:     export FUNDER_PRIVATE_KEY="5Kf3..."')
    process.exit(1)
  }
  const trimmed = raw.trim()
  if (trimmed.startsWith('[')) {
    return new Uint8Array(JSON.parse(trimmed) as number[])
  }
  const decoded = bs58.decode(trimmed)
  if (decoded.length !== 64) {
    console.error(`Expected 64-byte key, got ${decoded.length} bytes. Check FUNDER_PRIVATE_KEY.`)
    process.exit(1)
  }
  return decoded
}

/**
 * Build, sign, send, and confirm a transaction on devnet.
 * The fee payer signer is also attached to any instruction account
 * that matches its address (covers the custom AMM buy/sell instructions).
 */
async function sendTx(
  feePayer: KeyPairSigner,
  instructions: Instruction[],
): Promise<string> {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()

  // Attach the fee payer as a signer for every instruction account it owns.
  // Required for custom AMM instructions where trader = feePayer (WRITABLE_SIGNER).
  const ixsWithSigners = instructions.map(ix => addSignersToInstruction([feePayer], ix))

  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    m => setTransactionMessageFeePayerSigner(feePayer, m),
    m => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    m => setTransactionMessageComputeUnitLimit(400_000, m),
    m => appendTransactionMessageInstructions(ixsWithSigners, m),
  )

  const signed = await signTransactionMessageWithSigners(msg)
  const b64 = getBase64EncodedWireTransaction(signed)

  await rpc.sendTransaction(b64, {
    encoding: 'base64',
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: BigInt(3),
  }).send()

  const sig = getSignatureFromTransaction(signed)

  // Poll for confirmation (up to 30 seconds)
  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(1000)
    const { value: statuses } = await rpc.getSignatureStatuses([sig]).send()
    const status = statuses[0]
    if (status?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`)
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      break
    }
  }

  return sig
}

// ── Funding logic ─────────────────────────────────────────────────────────────

/**
 * Fund a new simulation wallet from the funder wallet:
 *   Tx 1 — SOL transfer + create USDC ATA (idempotent)
 *   Tx 2 — USDC transfer
 */
async function fundWallet(
  funder: KeyPairSigner,
  wallet: KeyPairSigner,
  usdcTotal: bigint,
): Promise<void> {
  const funderUsdc = await getAssociatedTokenAddress(USDC_MINT, funder.address)
  const walletUsdc = await getAssociatedTokenAddress(USDC_MINT, wallet.address)

  // SOL transfer + ATA creation in one transaction
  const solIx = getTransferSolInstruction({
    source: funder,
    destination: wallet.address,
    amount: SOL_FOR_FEES,
  })
  const ataIx = await getCreateAssociatedTokenIdempotentInstructionAsync({
    payer: funder,
    owner: wallet.address,
    mint: USDC_MINT,
  })
  const sig1 = await sendTx(funder, [solIx as Instruction, ataIx as Instruction])
  console.log(`    SOL + ATA   ${sig1}`)

  // USDC transfer (separate tx — ATA confirmed first)
  const usdcIx = getTransferCheckedInstruction({
    source: funderUsdc as Address,
    mint: USDC_MINT,
    destination: walletUsdc as Address,
    authority: funder,
    amount: usdcTotal,
    decimals: USDC_DECIMALS,
  })
  const sig2 = await sendTx(funder, [usdcIx as Instruction])
  console.log(`    USDC        ${sig2}`)
}

// ── Trading logic ─────────────────────────────────────────────────────────────

async function executeBuy(
  wallet: KeyPairSigner,
  market: UsdcMarketAccount,
  wordIndex: number,
  direction: 'YES' | 'NO',
  usdcAmount: bigint,
): Promise<bigint> {
  const word = market.words[wordIndex]
  const quantity = sharesForUsdc(word, market.liquidityParamB, direction, usdcAmount)
  if (quantity === BigInt(0)) {
    console.log(`      skip — quantity=0 (market too imbalanced for this amount)`)
    return BigInt(0)
  }

  const cost = estimateBuyCost(word, market.liquidityParamB, direction, quantity)
  const maxCost = cost + (cost * BigInt(3) / BigInt(100)) // 3% slippage

  // Create the YES/NO token ATA for this wallet before buying (idempotent — no-op if exists)
  const tokenMint = direction === 'YES' ? word.yesMint : word.noMint
  const ataIx = await createAtaIx(wallet.address, wallet.address, tokenMint)
  const buyIx = await createBuyIx(wallet.address, market.marketId, wordIndex, direction, quantity, maxCost)
  const sig = await sendTx(wallet, [ataIx, buyIx])

  const price = impliedYesPrice(word, market.liquidityParamB)
  console.log(`      BUY  ${direction.padEnd(3)} word[${wordIndex}] "${word.label.padEnd(12)}"  qty=${quantity.toString().padStart(8)}  cost=$${(Number(cost) / 1e6).toFixed(4)}  yesPrice=${(price * 100).toFixed(1)}¢  ${sig.slice(0, 8)}...`)
  return quantity
}

async function executeSell(
  wallet: KeyPairSigner,
  market: UsdcMarketAccount,
  wordIndex: number,
  direction: 'YES' | 'NO',
  heldShares: bigint,
): Promise<void> {
  const sellQty = heldShares / BigInt(2)
  if (sellQty === BigInt(0)) return

  const word = market.words[wordIndex]
  const expectedReturn = estimateSellReturn(word, market.liquidityParamB, direction, sellQty)
  const minReturn = expectedReturn - (expectedReturn * BigInt(5) / BigInt(100)) // 5% slippage

  const ix = await createSellIx(wallet.address, market.marketId, wordIndex, direction, sellQty, minReturn)
  const sig = await sendTx(wallet, [ix])
  console.log(`      SELL ${direction.padEnd(3)} word[${wordIndex}] "${word.label.padEnd(12)}"  qty=${sellQty.toString().padStart(8)}  ret≈$${(Number(expectedReturn) / 1e6).toFixed(4)}  ${sig.slice(0, 8)}...`)
}

/**
 * Run TRADES_PER_WALLET randomised trades for one wallet.
 * ~30% chance of selling after accumulating a position.
 */
async function runWalletTrades(
  wallet: KeyPairSigner,
  initialMarket: UsdcMarketAccount,
): Promise<void> {
  // Track shares held: "wordIndex:direction" -> quantity
  const held = new Map<string, bigint>()

  for (let t = 0; t < TRADES_PER_WALLET; t++) {
    // Re-fetch market for current prices
    const market = await fetchMarket(initialMarket.marketId)
    if (!market) { console.log('      market missing, stopping'); break }

    const wordIndex = rand(market.words.length)
    const direction: 'YES' | 'NO' = Math.random() > 0.5 ? 'YES' : 'NO'
    const key = `${wordIndex}:${direction}`
    const heldQty = held.get(key) ?? BigInt(0)

    try {
      if (heldQty > BigInt(0) && Math.random() < 0.3) {
        // Sell half the position
        await executeSell(wallet, market, wordIndex, direction, heldQty)
        held.set(key, heldQty / BigInt(2))
      } else {
        // Buy
        const qty = await executeBuy(wallet, market, wordIndex, direction, USDC_PER_TRADE)
        if (qty > BigInt(0)) held.set(key, heldQty + qty)
      }
    } catch (e: unknown) {
      // SlippageExceeded / InsufficientFunds etc are expected occasionally
      const msg = e instanceof Error ? e.message : String(e)
      console.log(`      trade error: ${msg.split('\n')[0].slice(0, 120)}`)
    }

    if (t < TRADES_PER_WALLET - 1) await sleep(800)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const divider = '─'.repeat(62)
  console.log(divider)
  console.log('  simulate-trades.ts  |  devnet')
  console.log(divider)
  console.log(`  Market ID:       ${MARKET_ID}`)
  console.log(`  Wallets:         ${NUM_WALLETS}`)
  console.log(`  Trades/wallet:   ${TRADES_PER_WALLET}`)
  console.log(`  USDC/trade:      $${(Number(USDC_PER_TRADE) / 1e6).toFixed(2)}`)
  console.log(`  SOL/wallet:      ${Number(SOL_FOR_FEES) / 1e9} SOL`)
  console.log(divider)

  // Load funder
  const funderBytes = loadFunderKey()
  const funder = await createKeyPairSignerFromBytes(funderBytes)
  console.log(`  Funder:          ${funder.address}\n`)

  // Verify market
  console.log('Fetching market...')
  const market = await fetchMarket(MARKET_ID)
  if (!market) {
    console.error(`Market ${MARKET_ID} not found on devnet`)
    process.exit(1)
  }
  if (market.status !== MarketStatus.Open) {
    console.error(`Market is not Open (status=${market.status}) — only Open markets accept trades`)
    process.exit(1)
  }

  console.log(`  Market: "${market.label}"  (${market.words.length} word${market.words.length !== 1 ? 's' : ''})`)
  for (const w of market.words) {
    const yp = impliedYesPrice(w, market.liquidityParamB)
    console.log(`    [${w.wordIndex}] "${w.label}"  YES=${(yp * 100).toFixed(1)}¢  NO=${((1 - yp) * 100).toFixed(1)}¢`)
  }
  console.log()

  // Check funder USDC balance
  const usdcBuffer = BigInt(500_000) // $0.50 buffer per wallet
  const usdcPerWallet = USDC_PER_TRADE * BigInt(TRADES_PER_WALLET) + usdcBuffer
  const totalUsdcNeeded = usdcPerWallet * BigInt(NUM_WALLETS)

  const funderUsdc = await fetchTokenBalance(USDC_MINT, funder.address)
  console.log(`  Funder USDC:     $${(Number(funderUsdc) / 1e6).toFixed(2)}`)
  console.log(`  Total needed:    $${(Number(totalUsdcNeeded) / 1e6).toFixed(2)}`)
  if (funderUsdc < totalUsdcNeeded) {
    console.error(`\nInsufficient funder USDC. Need $${(Number(totalUsdcNeeded) / 1e6).toFixed(2)}, have $${(Number(funderUsdc) / 1e6).toFixed(2)}.`)
    process.exit(1)
  }
  console.log(`  Balance:         OK ✓\n`)

  // Generate wallets
  console.log(`Generating ${NUM_WALLETS} wallets...`)
  const wallets: KeyPairSigner[] = []
  for (let i = 0; i < NUM_WALLETS; i++) {
    const w = await generateKeyPairSigner()
    wallets.push(w)
    console.log(`  [${i + 1}] ${w.address}`)
  }
  console.log()

  // Fund and trade each wallet sequentially
  for (let i = 0; i < NUM_WALLETS; i++) {
    const wallet = wallets[i]
    console.log(`${divider}`)
    console.log(`Wallet [${i + 1}/${NUM_WALLETS}]  ${wallet.address}`)

    console.log('  Funding...')
    try {
      await fundWallet(funder, wallet, usdcPerWallet)
    } catch (e: unknown) {
      console.error(`  Funding failed: ${e instanceof Error ? e.message : String(e)}`)
      continue
    }

    await sleep(1200) // let funding confirm before trading

    console.log(`  Trading (${TRADES_PER_WALLET} trades)...`)
    await runWalletTrades(wallet, market)
  }

  console.log(divider)
  console.log('Simulation complete.\n')
  console.log('Generated wallets (for inspection on devnet explorer):')
  for (let i = 0; i < wallets.length; i++) {
    console.log(`  [${i + 1}] https://explorer.solana.com/address/${wallets[i].address}?cluster=devnet`)
  }
}

main().catch(err => {
  console.error('\nFatal error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
