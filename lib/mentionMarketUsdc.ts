import {
  address as toAddress,
  type Address,
  type Instruction,
  type AccountMeta,
  type TransactionSendingSigner,
  AccountRole,
  getProgramDerivedAddress,
  getAddressEncoder,
  createSolanaRpc,
  devnet,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  setTransactionMessageComputeUnitLimit,
  compileTransaction,
  getTransactionEncoder,
} from '@solana/kit'

// ── Constants ────────────────────────────────────────────

export const PROGRAM_ID = toAddress(
  'BKYVi5hWefmtWhE2hCoarcjufQQvaxDAcfeMSo27SEyA'
)
export const USDC_MINT = toAddress(
  'CxRN4jp8ki3o3Bs16Ld6JsKsAP8rG8Jrp6dq48TYig9L'
)
export const TOKEN_PROGRAM = toAddress(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
)
export const SYSTEM_PROGRAM = toAddress(
  '11111111111111111111111111111111'
)
export const RENT_SYSVAR = toAddress(
  'SysvarRent111111111111111111111111111111111'
)
export const ASSOCIATED_TOKEN_PROGRAM = toAddress(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
)
export const TOKEN_METADATA_PROGRAM = toAddress(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'
)
// Dedicated devnet RPC to avoid "base64 encoded too large" on the public endpoint.
// Set NEXT_PUBLIC_HELIUS_DEVNET_RPC_URL in .env to your Helius devnet URL:
//   https://devnet.helius-rpc.com/?api-key=YOUR_KEY
export const DEVNET_URL =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_HELIUS_DEVNET_RPC_URL) ||
  'https://api.devnet.solana.com'

// USDC has 6 decimals; 1 USDC = 1_000_000 base units
export const USDC_DECIMALS = 6
export const USDC_PRECISION = 1_000_000n

// Anchor instruction discriminators
const DISC = {
  createMarket:      new Uint8Array([103, 226, 97, 235, 200, 188, 251, 254]),
  pauseMarket:       new Uint8Array([216, 238, 4, 164, 65, 11, 162, 91]),
  resolveWord:       new Uint8Array([233, 96, 121, 102, 6, 222, 241, 147]),
  depositLiquidity:  new Uint8Array([245, 99, 59, 25, 151, 71, 233, 249]),
  withdrawLiquidity: new Uint8Array([149, 158, 33, 185, 47, 243, 253, 31]),
  buy:               new Uint8Array([102, 6, 61, 18, 1, 218, 235, 234]),
  sell:              new Uint8Array([51, 230, 133, 164, 1, 127, 131, 173]),
  redeem:            new Uint8Array([184, 12, 86, 149, 70, 196, 97, 225]),
  withdrawFees:      new Uint8Array([198, 212, 171, 109, 144, 215, 174, 89]),
}

// Account discriminators
const ACCT_DISC = {
  marketAccount: new Uint8Array([201, 78, 187, 225, 240, 198, 201, 251]),
  lpPosition:    new Uint8Array([105, 241, 37, 200, 224, 2, 252, 90]),
}

// ── Types ────────────────────────────────────────────────

export interface LpPosition {
  version: number
  bump: number
  market: Address
  owner: Address
  shares: bigint
  depositedAt: bigint
}

export enum MarketStatus {
  Open = 0,
  Paused = 1,
  Resolved = 2,
}

export interface WordState {
  wordIndex: number
  label: string
  yesMint: Address
  noMint: Address
  yesQuantity: bigint
  noQuantity: bigint
  outcome: boolean | null
}

export interface UsdcMarketAccount {
  version: number
  bump: number
  marketId: bigint
  label: string
  authority: Address
  resolver: Address
  usdcMint: Address
  totalLpShares: bigint
  liquidityParamB: bigint
  baseBPerUsdc: bigint
  numWords: number
  words: WordState[]
  status: MarketStatus
  createdAt: bigint
  resolvesAt: bigint
  resolvedAt: bigint | null
  tradeFeeBps: number
  protocolFeeBps: number
  accumulatedFees: bigint
}

// ── Encoding helpers ─────────────────────────────────────

function u64LE(n: bigint): Uint8Array {
  const buf = new ArrayBuffer(8)
  new DataView(buf).setBigUint64(0, n, true)
  return new Uint8Array(buf)
}

function i64LE(n: bigint): Uint8Array {
  const buf = new ArrayBuffer(8)
  new DataView(buf).setBigInt64(0, n, true)
  return new Uint8Array(buf)
}

function u16LE(n: number): Uint8Array {
  const buf = new ArrayBuffer(2)
  new DataView(buf).setUint16(0, n, true)
  return new Uint8Array(buf)
}

function u32LE(n: number): Uint8Array {
  const buf = new ArrayBuffer(4)
  new DataView(buf).setUint32(0, n, true)
  return new Uint8Array(buf)
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const len = arrays.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(len)
  let off = 0
  for (const a of arrays) {
    out.set(a, off)
    off += a.length
  }
  return out
}

function encodeString(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s)
  return concat(u32LE(bytes.length), bytes)
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

// ── PDA derivations ──────────────────────────────────────

const addrEncoder = getAddressEncoder()

export async function getMarketPDA(
  marketId: bigint
): Promise<[Address, number]> {
  const [pda, bump] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: ['market', u64LE(marketId)],
  })
  return [pda, bump]
}

export async function getYesMintPDA(
  marketId: bigint,
  wordIndex: number
): Promise<[Address, number]> {
  const [pda, bump] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: ['yes_mint', u64LE(marketId), new Uint8Array([wordIndex])],
  })
  return [pda, bump]
}

export async function getNoMintPDA(
  marketId: bigint,
  wordIndex: number
): Promise<[Address, number]> {
  const [pda, bump] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: ['no_mint', u64LE(marketId), new Uint8Array([wordIndex])],
  })
  return [pda, bump]
}

export async function getMetadataPDA(
  mint: Address
): Promise<[Address, number]> {
  const [pda, bump] = await getProgramDerivedAddress({
    programAddress: TOKEN_METADATA_PROGRAM,
    seeds: [
      'metadata',
      addrEncoder.encode(TOKEN_METADATA_PROGRAM),
      addrEncoder.encode(mint),
    ],
  })
  return [pda, bump]
}

export async function getLpPositionPDA(
  marketId: bigint,
  lpWallet: Address
): Promise<[Address, number]> {
  const [pda, bump] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: ['lp', u64LE(marketId), addrEncoder.encode(lpWallet)],
  })
  return [pda, bump]
}

/**
 * Derive ATA address for a given mint + owner.
 * Allows PDAs as owners (allowOwnerOffCurve = true in on-chain context).
 */
export async function getAssociatedTokenAddress(
  mint: Address,
  owner: Address
): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    seeds: [
      addrEncoder.encode(owner),
      addrEncoder.encode(TOKEN_PROGRAM),
      addrEncoder.encode(mint),
    ],
  })
  return pda
}

/** Derive the market's USDC vault (ATA owned by market PDA) */
export async function getVaultAddress(marketId: bigint): Promise<Address> {
  const [marketPda] = await getMarketPDA(marketId)
  return getAssociatedTokenAddress(USDC_MINT, marketPda)
}

// ── Instruction builders ─────────────────────────────────

export async function createCreateMarketIx(
  authority: Address,
  marketId: bigint,
  label: string,
  wordLabels: string[],
  resolvesAt: bigint,
  resolver: Address,
  tradeFeeBps: number,
  initialB: bigint,
  baseBPerUsdc: bigint
): Promise<Instruction> {
  const [marketPda] = await getMarketPDA(marketId)
  const vaultAddr = await getAssociatedTokenAddress(USDC_MINT, marketPda)

  const remainingAccounts: AccountMeta[] = []
  for (let i = 0; i < wordLabels.length; i++) {
    const [yesMint] = await getYesMintPDA(marketId, i)
    const [yesMetadata] = await getMetadataPDA(yesMint)
    const [noMint] = await getNoMintPDA(marketId, i)
    const [noMetadata] = await getMetadataPDA(noMint)
    remainingAccounts.push({ address: yesMint, role: AccountRole.WRITABLE })
    remainingAccounts.push({ address: yesMetadata, role: AccountRole.WRITABLE })
    remainingAccounts.push({ address: noMint, role: AccountRole.WRITABLE })
    remainingAccounts.push({ address: noMetadata, role: AccountRole.WRITABLE })
  }

  const wordLabelsParts: Uint8Array[] = [u32LE(wordLabels.length)]
  for (const w of wordLabels) {
    wordLabelsParts.push(encodeString(w))
  }
  const encodedWordLabels = concat(...wordLabelsParts)

  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: authority, role: AccountRole.WRITABLE_SIGNER },
      { address: marketPda, role: AccountRole.WRITABLE },
      { address: USDC_MINT, role: AccountRole.READONLY },
      { address: vaultAddr, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: RENT_SYSVAR, role: AccountRole.READONLY },
      { address: TOKEN_METADATA_PROGRAM, role: AccountRole.READONLY },
      ...remainingAccounts,
    ] as AccountMeta[],
    data: concat(
      DISC.createMarket,
      u64LE(marketId),
      encodeString(label),
      encodedWordLabels,
      i64LE(resolvesAt),
      new Uint8Array(addrEncoder.encode(resolver)),
      u16LE(tradeFeeBps),
      u64LE(initialB),
      u64LE(baseBPerUsdc)
    ),
  }
}

export async function createPauseMarketIx(
  authority: Address,
  marketId: bigint
): Promise<Instruction> {
  const [marketPda] = await getMarketPDA(marketId)
  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: authority, role: AccountRole.READONLY_SIGNER },
      { address: marketPda, role: AccountRole.WRITABLE },
    ] as AccountMeta[],
    data: DISC.pauseMarket,
  }
}

export async function createResolveWordIx(
  resolver: Address,
  marketId: bigint,
  wordIndex: number,
  outcome: boolean
): Promise<Instruction> {
  const [marketPda] = await getMarketPDA(marketId)
  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: resolver, role: AccountRole.READONLY_SIGNER },
      { address: marketPda, role: AccountRole.WRITABLE },
    ] as AccountMeta[],
    data: concat(
      DISC.resolveWord,
      new Uint8Array([wordIndex]),
      new Uint8Array([outcome ? 1 : 0])
    ),
  }
}

export async function createDepositLiquidityIx(
  lpWallet: Address,
  marketId: bigint,
  amount: bigint
): Promise<Instruction> {
  const [marketPda] = await getMarketPDA(marketId)
  const vaultAddr = await getVaultAddress(marketId)
  const [lpPositionPda] = await getLpPositionPDA(marketId, lpWallet)
  const lpUsdc = await getAssociatedTokenAddress(USDC_MINT, lpWallet)

  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: lpWallet, role: AccountRole.WRITABLE_SIGNER },
      { address: marketPda, role: AccountRole.WRITABLE },
      { address: vaultAddr, role: AccountRole.WRITABLE },
      { address: lpUsdc, role: AccountRole.WRITABLE },
      { address: lpPositionPda, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ] as AccountMeta[],
    data: concat(DISC.depositLiquidity, u64LE(amount)),
  }
}

export async function createWithdrawLiquidityIx(
  lpWallet: Address,
  marketId: bigint,
  sharesToBurn: bigint
): Promise<Instruction> {
  const [marketPda] = await getMarketPDA(marketId)
  const vaultAddr = await getVaultAddress(marketId)
  const [lpPositionPda] = await getLpPositionPDA(marketId, lpWallet)
  const lpUsdc = await getAssociatedTokenAddress(USDC_MINT, lpWallet)

  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: lpWallet, role: AccountRole.WRITABLE_SIGNER },
      { address: marketPda, role: AccountRole.WRITABLE },
      { address: vaultAddr, role: AccountRole.WRITABLE },
      { address: lpUsdc, role: AccountRole.WRITABLE },
      { address: lpPositionPda, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ] as AccountMeta[],
    data: concat(DISC.withdrawLiquidity, u64LE(sharesToBurn)),
  }
}

export async function createWithdrawFeesIx(
  authority: Address,
  marketId: bigint
): Promise<Instruction> {
  const [marketPda] = await getMarketPDA(marketId)
  const vaultAddr = await getVaultAddress(marketId)
  const authorityUsdc = await getAssociatedTokenAddress(USDC_MINT, authority)

  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: authority, role: AccountRole.WRITABLE_SIGNER },
      { address: marketPda, role: AccountRole.WRITABLE },
      { address: vaultAddr, role: AccountRole.WRITABLE },
      { address: authorityUsdc, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
    ] as AccountMeta[],
    data: DISC.withdrawFees,
  }
}

export async function createAtaIx(
  payer: Address,
  owner: Address,
  mint: Address
): Promise<Instruction> {
  const ata = await getAssociatedTokenAddress(mint, owner)
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: ata, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
    ] as AccountMeta[],
    // discriminator 1 = create_idempotent (no-op if ATA already exists)
    data: new Uint8Array([1]),
  }
}

export async function createBuyIx(
  trader: Address,
  marketId: bigint,
  wordIndex: number,
  direction: 'YES' | 'NO',
  quantity: bigint,
  maxCost: bigint
): Promise<Instruction> {
  const [marketPda] = await getMarketPDA(marketId)
  const vault = await getVaultAddress(marketId)
  const traderUsdc = await getAssociatedTokenAddress(USDC_MINT, trader)
  const [tokenMint] = direction === 'YES'
    ? await getYesMintPDA(marketId, wordIndex)
    : await getNoMintPDA(marketId, wordIndex)
  const traderTokenAccount = await getAssociatedTokenAddress(tokenMint, trader)

  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: trader, role: AccountRole.WRITABLE_SIGNER },
      { address: marketPda, role: AccountRole.WRITABLE },
      { address: vault, role: AccountRole.WRITABLE },
      { address: traderUsdc, role: AccountRole.WRITABLE },
      { address: tokenMint, role: AccountRole.WRITABLE },
      { address: traderTokenAccount, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
    ] as AccountMeta[],
    data: concat(
      DISC.buy,
      new Uint8Array([wordIndex]),
      new Uint8Array([direction === 'YES' ? 0 : 1]),
      u64LE(quantity),
      u64LE(maxCost)
    ),
  }
}

export async function createSellIx(
  trader: Address,
  marketId: bigint,
  wordIndex: number,
  direction: 'YES' | 'NO',
  quantity: bigint,
  minReturn: bigint
): Promise<Instruction> {
  const [marketPda] = await getMarketPDA(marketId)
  const vault = await getVaultAddress(marketId)
  const traderUsdc = await getAssociatedTokenAddress(USDC_MINT, trader)
  const [tokenMint] = direction === 'YES'
    ? await getYesMintPDA(marketId, wordIndex)
    : await getNoMintPDA(marketId, wordIndex)
  const traderTokenAccount = await getAssociatedTokenAddress(tokenMint, trader)

  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: trader, role: AccountRole.WRITABLE_SIGNER },
      { address: marketPda, role: AccountRole.WRITABLE },
      { address: vault, role: AccountRole.WRITABLE },
      { address: traderUsdc, role: AccountRole.WRITABLE },
      { address: tokenMint, role: AccountRole.WRITABLE },
      { address: traderTokenAccount, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
    ] as AccountMeta[],
    data: concat(
      DISC.sell,
      new Uint8Array([wordIndex]),
      new Uint8Array([direction === 'YES' ? 0 : 1]),
      u64LE(quantity),
      u64LE(minReturn)
    ),
  }
}

export async function createRedeemIx(
  redeemer: Address,
  marketId: bigint,
  wordIndex: number,
  direction: 'YES' | 'NO'
): Promise<Instruction> {
  const [marketPda] = await getMarketPDA(marketId)
  const vault = await getVaultAddress(marketId)
  const redeemerUsdc = await getAssociatedTokenAddress(USDC_MINT, redeemer)
  const [tokenMint] = direction === 'YES'
    ? await getYesMintPDA(marketId, wordIndex)
    : await getNoMintPDA(marketId, wordIndex)
  const redeemerTokenAccount = await getAssociatedTokenAddress(tokenMint, redeemer)

  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: redeemer, role: AccountRole.WRITABLE_SIGNER },
      { address: marketPda, role: AccountRole.WRITABLE },
      { address: vault, role: AccountRole.WRITABLE },
      { address: redeemerUsdc, role: AccountRole.WRITABLE },
      { address: tokenMint, role: AccountRole.WRITABLE },
      { address: redeemerTokenAccount, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
    ] as AccountMeta[],
    data: concat(
      DISC.redeem,
      new Uint8Array([wordIndex]),
      new Uint8Array([direction === 'YES' ? 0 : 1])
    ),
  }
}

/** Fetch SPL token balance for a given mint + owner, returns 0n if account missing */
export async function fetchTokenBalance(
  mint: Address,
  owner: Address
): Promise<bigint> {
  const rpc = createRpc()
  const ata = await getAssociatedTokenAddress(mint, owner)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (rpc as any)
    .getTokenAccountBalance(ata)
    .send()
    .catch(() => null)
  if (!result?.value) return 0n
  return BigInt(result.value.amount)
}

/** Fetch user's USDC ATA balance in base units */
export async function fetchUsdcBalance(owner: Address): Promise<bigint> {
  return fetchTokenBalance(USDC_MINT, owner)
}

// ── Exact fixed-point LMSR math (mirrors on-chain Rust) ────────────────────
//
// The on-chain program uses a custom Taylor-series exp/ln with integer
// truncation at each step. Using JS Math.exp/Math.log gives a different
// result, which can cause SlippageExceeded errors on larger trades.
// These BigInt functions reproduce the EXACT same arithmetic as the Rust code
// in programs/mention-market-usdc-amm/src/math.rs.

const FP = 1_000_000n         // PRECISION = 1e6
const LN2_FP = 693_147n       // ln(2) * 1e6, truncated (same constant as Rust)

/**
 * Fixed-point exp. Input: i64 scaled by 1e6. Output: u128 scaled by 1e6.
 * Mirrors fp_exp() in math.rs — Taylor series 1 + r + r²/2! + … + r⁶/6!
 * then multiplied by 2^k.
 */
function fpExp(x: bigint): bigint {
  if (x < -20_000_000n) return 0n
  if (x > 30_000_000n) throw new Error('MathOverflow in fpExp')

  // Decompose x = k * LN2 + r  (floor division, matching Rust semantics)
  let k: bigint
  if (x >= 0n) {
    k = x / LN2_FP
  } else {
    k = (x - LN2_FP + 1n) / LN2_FP
  }
  const r = x - k * LN2_FP

  // Taylor series — all divisions truncate, matching Rust integer division
  const r2 = r * r / FP
  const r3 = r2 * r / FP
  const r4 = r3 * r / FP
  const r5 = r4 * r / FP
  const r6 = r5 * r / FP
  const expR = FP + r + r2 / 2n + r3 / 6n + r4 / 24n + r5 / 120n + r6 / 720n

  // Multiply by 2^k (bit-shift)
  if (k >= 0n) {
    return expR << k
  } else {
    return expR >> (-k)
  }
}

/**
 * Fixed-point natural log. Input: u128 scaled by 1e6 (must be > 0).
 * Output: i64 scaled by 1e6. Mirrors fp_ln() in math.rs.
 */
function fpLn(x: bigint): bigint {
  if (x <= 0n) throw new Error('fpLn: input must be > 0')

  // Normalise to m in [PRECISION, 2*PRECISION), track exponent k
  let m = x
  let k = 0n
  while (m >= 2n * FP) { m >>= 1n; k += 1n }
  while (m < FP)        { m <<= 1n; k -= 1n }

  // ln(1 + f) polynomial, f = m - 1 in fixed-point
  const f = m - FP
  const f2 = f * f / FP
  const f3 = f2 * f / FP
  const f4 = f3 * f / FP
  const f5 = f4 * f / FP
  const lnM = f - f2 / 2n + f3 / 3n - f4 / 4n + f5 / 5n

  return k * LN2_FP + lnM
}

/**
 * binary_lmsr_cost(q_yes, q_no, b) → USDC base units.
 * Exactly matches Rust: b * ln( exp(q_yes/b) + exp(q_no/b) ) in fixed-point.
 */
function lmsrCostExact(qYes: bigint, qNo: bigint, b: bigint): bigint {
  if (b === 0n) return 0n
  const scaledYes = qYes * FP / b
  const scaledNo  = qNo  * FP / b
  const sum    = fpExp(scaledYes) + fpExp(scaledNo)
  const lnSum  = fpLn(sum)
  const cost   = b * lnSum / FP
  return cost < 0n ? 0n : cost
}

/** Implied YES price for a word (0–1 float). Uses float for display only. */
export function impliedYesPrice(word: WordState, b: bigint): number {
  if (b === 0n) return 0.5
  // Use float for smooth UI display — small display error is acceptable
  const diff = (Number(word.noQuantity) - Number(word.yesQuantity)) / Number(b)
  return 1 / (1 + Math.exp(diff))
}

/** Estimated buy cost in USDC base units — exact on-chain fixed-point math. */
export function estimateBuyCost(
  word: WordState,
  b: bigint,
  direction: 'YES' | 'NO',
  sharesBaseUnits: bigint
): bigint {
  if (sharesBaseUnits <= 0n || b === 0n) return 0n
  const qYes = word.yesQuantity
  const qNo  = word.noQuantity
  const before = lmsrCostExact(qYes, qNo, b)
  const after  = direction === 'YES'
    ? lmsrCostExact(qYes + sharesBaseUnits, qNo, b)
    : lmsrCostExact(qYes, qNo + sharesBaseUnits, b)
  return after > before ? after - before : 0n
}

/** Estimated sell return in USDC base units — exact on-chain fixed-point math. */
export function estimateSellReturn(
  word: WordState,
  b: bigint,
  direction: 'YES' | 'NO',
  sharesBaseUnits: bigint
): bigint {
  if (sharesBaseUnits <= 0n || b === 0n) return 0n
  const qYes = word.yesQuantity
  const qNo  = word.noQuantity
  const before = lmsrCostExact(qYes, qNo, b)
  const after  = direction === 'YES'
    ? lmsrCostExact(qYes - sharesBaseUnits, qNo, b)
    : lmsrCostExact(qYes, qNo - sharesBaseUnits, b)
  return before > after ? before - after : 0n
}

/** Binary search: max shares purchasable for a given USDC budget (all in base units). */
export function sharesForUsdc(
  word: WordState,
  b: bigint,
  direction: 'YES' | 'NO',
  usdcBaseUnits: bigint
): bigint {
  if (usdcBaseUnits <= 0n || b === 0n) return 0n

  // Upper bound: at most budget / price, doubled for safety
  // Use float for the initial upper bound estimate only
  const price = direction === 'YES'
    ? 1 / (1 + Math.exp((Number(word.noQuantity) - Number(word.yesQuantity)) / Number(b)))
    : 1 - 1 / (1 + Math.exp((Number(word.noQuantity) - Number(word.yesQuantity)) / Number(b)))
  const hiFloat = Number(usdcBaseUnits) / Math.max(0.001, price * 0.4)
  let lo = 0n
  let hi = BigInt(Math.ceil(hiFloat) + 1)

  // 80 iterations gives sub-1 base-unit precision
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2n
    if (mid === lo) break
    const cost = estimateBuyCost(word, b, direction, mid)
    if (cost <= usdcBaseUnits) {
      lo = mid
    } else {
      hi = mid
    }
  }
  return lo
}

// ── Transaction sending ──────────────────────────────────

/**
 * Build, sign, and send a set of instructions to devnet.
 *
 * Uses `signOnly` (Phantom's raw signTransaction, no simulate) to avoid the
 * "base64 encoded too large" error from the mainnet preSimulate in the normal
 * signing flow. Broadcasts directly to the Helius devnet RPC.
 */
export async function sendInstructions(
  signer: TransactionSendingSigner,
  signOnly: (txBytes: Uint8Array) => Promise<Uint8Array>,
  instructions: Instruction[]
): Promise<void> {
  const rpc = createSolanaRpc(devnet(DEVNET_URL))
  const { value: blockhash } = await rpc.getLatestBlockhash().send()

  const txMsg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => setTransactionMessageComputeUnitLimit(800_000, m),
    (m) => appendTransactionMessageInstructions(instructions, m)
  )

  // Compile to bytes (signatures empty), sign via raw Phantom signTransaction,
  // then broadcast directly to devnet — bypasses the mainnet preSimulate proxy.
  const compiled = compileTransaction(txMsg)
  const txBytes = new Uint8Array(getTransactionEncoder().encode(compiled))
  const signedBytes = await signOnly(txBytes)

  const base64Tx = btoa(String.fromCharCode(...signedBytes))
  const res = await fetch(DEVNET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [base64Tx, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed' }],
    }),
  })
  const json = await res.json()
  if (json.error) {
    throw new Error(json.error.message || JSON.stringify(json.error))
  }
}

// ── Account deserialization ──────────────────────────────

const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function base58Encode(bytes: Uint8Array): string {
  const digits = [0]
  for (const byte of bytes) {
    let carry = byte
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8
      digits[j] = carry % 58
      carry = (carry / 58) | 0
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = (carry / 58) | 0
    }
  }
  let str = ''
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) str += '1'
  for (let i = digits.length - 1; i >= 0; i--)
    str += BASE58_ALPHABET[digits[i]]
  return str
}

function readAddress(data: Uint8Array, offset: number): Address {
  return base58Encode(data.slice(offset, offset + 32)) as Address
}

function readU64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset + offset, 8).getBigUint64(0, true)
}

function readI64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset + offset, 8).getBigInt64(0, true)
}

function readU16(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset + offset, 2).getUint16(0, true)
}

function readU32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true)
}

function readBorshString(data: Uint8Array, offset: number): [string, number] {
  const len = readU32(data, offset)
  offset += 4
  const str = new TextDecoder().decode(data.slice(offset, offset + len))
  offset += len
  return [str, offset]
}

function readOptionBool(data: Uint8Array, offset: number): [boolean | null, number] {
  const flag = data[offset]
  offset += 1
  if (flag === 0) return [null, offset]
  const val = data[offset] !== 0
  offset += 1
  return [val, offset]
}

function readOptionI64(data: Uint8Array, offset: number): [bigint | null, number] {
  const flag = data[offset]
  offset += 1
  if (flag === 0) return [null, offset]
  const val = readI64(data, offset)
  offset += 8
  return [val, offset]
}

export function deserializeMarketAccount(data: Uint8Array): UsdcMarketAccount | null {
  if (data.length < 50) return null
  if (!arraysEqual(data.slice(0, 8), ACCT_DISC.marketAccount)) return null

  let off = 8
  const version = data[off]; off += 1
  const bump = data[off]; off += 1
  const marketId = readU64(data, off); off += 8

  let label: string
  ;[label, off] = readBorshString(data, off)

  const authority = readAddress(data, off); off += 32
  const resolver = readAddress(data, off); off += 32
  const usdcMint = readAddress(data, off); off += 32

  const totalLpShares = readU64(data, off); off += 8
  const liquidityParamB = readU64(data, off); off += 8
  const baseBPerUsdc = readU64(data, off); off += 8
  const numWords = data[off]; off += 1

  const words: WordState[] = []
  for (let i = 0; i < 8; i++) {
    const wordIndex = data[off]; off += 1
    let wordLabel: string
    ;[wordLabel, off] = readBorshString(data, off)
    const yesMint = readAddress(data, off); off += 32
    const noMint = readAddress(data, off); off += 32
    const yesQuantity = readI64(data, off); off += 8
    const noQuantity = readI64(data, off); off += 8
    let outcome: boolean | null
    ;[outcome, off] = readOptionBool(data, off)
    off += 32 // _reserved

    words.push({ wordIndex, label: wordLabel, yesMint, noMint, yesQuantity, noQuantity, outcome })
  }

  const status = data[off] as MarketStatus; off += 1
  const createdAt = readI64(data, off); off += 8
  const resolvesAt = readI64(data, off); off += 8
  let resolvedAt: bigint | null
  ;[resolvedAt, off] = readOptionI64(data, off)
  const tradeFeeBps = readU16(data, off); off += 2
  const protocolFeeBps = readU16(data, off); off += 2
  const accumulatedFees = readU64(data, off)

  return {
    version, bump, marketId, label, authority, resolver, usdcMint,
    totalLpShares, liquidityParamB, baseBPerUsdc,
    numWords, words: words.slice(0, numWords),
    status, createdAt, resolvesAt, resolvedAt,
    tradeFeeBps, protocolFeeBps, accumulatedFees,
  }
}

export function deserializeLpPosition(data: Uint8Array): LpPosition | null {
  if (data.length < 8 + 146) return null
  if (!arraysEqual(data.slice(0, 8), ACCT_DISC.lpPosition)) return null

  let off = 8
  const version = data[off]; off += 1
  const bump = data[off]; off += 1
  const market = readAddress(data, off); off += 32
  const owner = readAddress(data, off); off += 32
  const shares = readU64(data, off); off += 8
  const depositedAt = readI64(data, off)

  return { version, bump, market, owner, shares, depositedAt }
}

export function createRpc() {
  return createSolanaRpc(devnet(DEVNET_URL))
}

function decodeBase64(raw: unknown): Uint8Array {
  const b64 = typeof raw === 'string' ? raw : (raw as readonly string[])[0]
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

export async function fetchMarket(
  marketId: bigint
): Promise<UsdcMarketAccount | null> {
  const rpc = createRpc()
  const [pda] = await getMarketPDA(marketId)
  const result = await rpc.getAccountInfo(pda, { encoding: 'base64' }).send()
  if (!result.value) return null
  const bytes = decodeBase64(result.value.data)
  return deserializeMarketAccount(bytes)
}

export async function fetchAllMarkets(): Promise<
  Array<{ pubkey: Address; account: UsdcMarketAccount }>
> {
  const rpc = createRpc()

  const discB64 = btoa(String.fromCharCode(...ACCT_DISC.marketAccount))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (rpc as any)
    .getProgramAccounts(PROGRAM_ID, {
      encoding: 'base64',
      filters: [
        { memcmp: { offset: 0n, bytes: discB64 as any, encoding: 'base64' } },
      ],
    })
    .send()

  const markets: Array<{ pubkey: Address; account: UsdcMarketAccount }> = []
  for (const item of result) {
    const bytes = decodeBase64(item.account.data)
    const account = deserializeMarketAccount(bytes)
    if (account) {
      markets.push({ pubkey: item.pubkey as Address, account })
    }
  }

  return markets.sort((a, b) =>
    Number(b.account.createdAt - a.account.createdAt)
  )
}

export async function fetchLpPosition(
  marketId: bigint,
  lpWallet: Address
): Promise<LpPosition | null> {
  const rpc = createRpc()
  const [pda] = await getLpPositionPDA(marketId, lpWallet)
  const result = await rpc.getAccountInfo(pda, { encoding: 'base64' }).send()
  if (!result.value) return null
  const bytes = decodeBase64(result.value.data)
  return deserializeLpPosition(bytes)
}

/** Fetch vault USDC balance in base units (6 decimals) */
export async function fetchVaultBalance(marketId: bigint): Promise<bigint> {
  const rpc = createRpc()
  const vaultAddr = await getVaultAddress(marketId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (rpc as any)
    .getTokenAccountBalance(vaultAddr)
    .send()
    .catch(() => null)
  if (!result?.value) return 0n
  return BigInt(result.value.amount)
}

/** Format USDC base units to human-readable string (e.g. 1_000_000 -> "1.00") */
export function formatUsdc(baseUnits: bigint): string {
  const whole = baseUnits / USDC_PRECISION
  const frac = baseUnits % USDC_PRECISION
  return `${whole}.${frac.toString().padStart(6, '0').slice(0, 2)}`
}

export function statusLabel(status: MarketStatus): string {
  switch (status) {
    case MarketStatus.Open: return 'Open'
    case MarketStatus.Paused: return 'Paused'
    case MarketStatus.Resolved: return 'Resolved'
  }
}

export function statusColor(status: MarketStatus): string {
  switch (status) {
    case MarketStatus.Open: return 'text-apple-green'
    case MarketStatus.Paused: return 'text-yellow-400'
    case MarketStatus.Resolved: return 'text-neutral-400'
  }
}

