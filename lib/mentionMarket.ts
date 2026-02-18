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
  signAndSendTransactionMessageWithSigners,
} from '@solana/kit'

// ── Constants ────────────────────────────────────────────

export const PROGRAM_ID = toAddress(
  '2oKQaiKx3C2qpkqFYGDdvEGTyBDJP85iuQtJ5vaPdFrU'
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
export const COMPUTE_BUDGET_PROGRAM = toAddress(
  'ComputeBudget111111111111111111111111111111'
)
export const DEVNET_URL = 'https://api.devnet.solana.com'
const LAMPORTS_PER_SOL = 1_000_000_000

// Anchor instruction discriminators (from IDL)
const DISC = {
  deposit: new Uint8Array([242, 35, 198, 137, 82, 225, 242, 182]),
  withdraw: new Uint8Array([183, 18, 70, 156, 148, 109, 161, 34]),
  createMarket: new Uint8Array([103, 226, 97, 235, 200, 188, 251, 254]),
  pauseMarket: new Uint8Array([216, 238, 4, 164, 65, 11, 162, 91]),
  resolveWord: new Uint8Array([233, 96, 121, 102, 6, 222, 241, 147]),
  depositLiquidity: new Uint8Array([245, 99, 59, 25, 151, 71, 233, 249]),
  buy: new Uint8Array([102, 6, 61, 18, 1, 218, 235, 234]),
  sell: new Uint8Array([51, 230, 133, 164, 1, 127, 131, 173]),
  redeem: new Uint8Array([184, 12, 86, 149, 70, 196, 97, 225]),
  withdrawLiquidity: new Uint8Array([149, 158, 33, 185, 47, 243, 253, 31]),
}

// Account discriminators
const ACCT_DISC = {
  userEscrow: new Uint8Array([242, 233, 85, 38, 26, 5, 142, 109]),
  marketAccount: new Uint8Array([201, 78, 187, 225, 240, 198, 201, 251]),
  lpPosition: new Uint8Array([105, 241, 37, 200, 224, 2, 252, 90]),
}

// ── Types ────────────────────────────────────────────────

export interface UserEscrow {
  owner: Address
  balance: bigint
  locked: bigint
  bump: number
}

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

export interface MarketAccount {
  version: number
  bump: number
  marketId: bigint
  label: string
  authority: Address
  resolver: Address
  router: Address | null
  poolVault: Address
  vaultBump: number
  totalLpShares: bigint
  liquidityParamB: bigint
  baseBPerSol: bigint
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

export interface UserPosition {
  marketId: bigint
  wordIndex: number
  wordLabel: string
  marketLabel: string
  marketStatus: MarketStatus
  side: 'YES' | 'NO'
  rawAmount: bigint
  shares: number
  estimatedValueSol: number
  claimable: boolean
  /** null = unresolved, true = winning side, false = losing side */
  won: boolean | null
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

export async function getEscrowPDA(
  user: Address
): Promise<[Address, number]> {
  const [pda, bump] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: ['escrow', addrEncoder.encode(user)],
  })
  return [pda, bump]
}

export async function getMarketPDA(
  marketId: bigint
): Promise<[Address, number]> {
  const [pda, bump] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: ['market', u64LE(marketId)],
  })
  return [pda, bump]
}

export async function getVaultPDA(
  marketId: bigint
): Promise<[Address, number]> {
  const [pda, bump] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: ['vault', u64LE(marketId)],
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

// ── Instruction builders ─────────────────────────────────

export function createSetComputeUnitLimitIx(units: number): Instruction {
  const data = new Uint8Array(5)
  data[0] = 2 // SetComputeUnitLimit discriminator
  new DataView(data.buffer).setUint32(1, units, true)
  return {
    programAddress: COMPUTE_BUDGET_PROGRAM,
    accounts: [],
    data,
  }
}

export async function createDepositIx(
  user: Address,
  amount: bigint
): Promise<Instruction> {
  const [escrow] = await getEscrowPDA(user)
  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: user, role: AccountRole.WRITABLE_SIGNER },
      { address: escrow, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ] as AccountMeta[],
    data: concat(DISC.deposit, u64LE(amount)),
  }
}

export async function createWithdrawIx(
  user: Address,
  amount: bigint
): Promise<Instruction> {
  const [escrow] = await getEscrowPDA(user)
  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: user, role: AccountRole.WRITABLE_SIGNER },
      { address: escrow, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ] as AccountMeta[],
    data: concat(DISC.withdraw, u64LE(amount)),
  }
}

export async function createCreateMarketIx(
  authority: Address,
  marketId: bigint,
  label: string,
  wordLabels: string[],
  resolvesAt: bigint,
  resolver: Address,
  tradeFeeBps: number,
  initialB: bigint,
  baseBPerSol: bigint
): Promise<Instruction> {
  const [marketPda] = await getMarketPDA(marketId)
  const [vaultPda] = await getVaultPDA(marketId)

  // Build remaining accounts: (yes_mint, yes_metadata, no_mint, no_metadata) per word
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

  // Encode Vec<String> for word_labels
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
      { address: vaultPda, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
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
      u64LE(baseBPerSol)
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
  const [vaultPda] = await getVaultPDA(marketId)
  const [lpPositionPda] = await getLpPositionPDA(marketId, lpWallet)
  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: lpWallet, role: AccountRole.WRITABLE_SIGNER },
      { address: marketPda, role: AccountRole.WRITABLE },
      { address: vaultPda, role: AccountRole.WRITABLE },
      { address: lpPositionPda, role: AccountRole.WRITABLE },
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
  const [vaultPda] = await getVaultPDA(marketId)
  const [lpPositionPda] = await getLpPositionPDA(marketId, lpWallet)
  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: lpWallet, role: AccountRole.WRITABLE_SIGNER },
      { address: marketPda, role: AccountRole.WRITABLE },
      { address: vaultPda, role: AccountRole.WRITABLE },
      { address: lpPositionPda, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ] as AccountMeta[],
    data: concat(DISC.withdrawLiquidity, u64LE(sharesToBurn)),
  }
}

export async function createBuyIx(
  trader: Address,
  marketId: bigint,
  wordIndex: number,
  side: 'YES' | 'NO',
  quantity: bigint,
  maxCost: bigint,
  market: MarketAccount
): Promise<Instruction> {
  const [escrow] = await getEscrowPDA(trader)
  const [marketPda] = await getMarketPDA(marketId)
  const [vaultPda] = await getVaultPDA(marketId)

  const word = market.words[wordIndex]
  const mintAddr = side === 'YES' ? word.yesMint : word.noMint
  const ata = await getAssociatedTokenAddress(mintAddr, trader)

  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: trader, role: AccountRole.WRITABLE_SIGNER },
      { address: escrow, role: AccountRole.WRITABLE },
      { address: marketPda, role: AccountRole.WRITABLE },
      { address: vaultPda, role: AccountRole.WRITABLE },
      { address: mintAddr, role: AccountRole.WRITABLE },
      { address: ata, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ] as AccountMeta[],
    data: concat(
      DISC.buy,
      new Uint8Array([wordIndex]),
      new Uint8Array([side === 'YES' ? 0 : 1]), // Side enum: Yes=0, No=1
      u64LE(quantity),
      u64LE(maxCost)
    ),
  }
}

export async function createSellIx(
  trader: Address,
  marketId: bigint,
  wordIndex: number,
  side: 'YES' | 'NO',
  quantity: bigint,
  minReturn: bigint,
  market: MarketAccount
): Promise<Instruction> {
  const [escrow] = await getEscrowPDA(trader)
  const [marketPda] = await getMarketPDA(marketId)
  const [vaultPda] = await getVaultPDA(marketId)

  const word = market.words[wordIndex]
  const mintAddr = side === 'YES' ? word.yesMint : word.noMint
  const ata = await getAssociatedTokenAddress(mintAddr, trader)

  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: trader, role: AccountRole.WRITABLE_SIGNER },
      { address: escrow, role: AccountRole.WRITABLE },
      { address: marketPda, role: AccountRole.WRITABLE },
      { address: vaultPda, role: AccountRole.WRITABLE },
      { address: mintAddr, role: AccountRole.WRITABLE },
      { address: ata, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ] as AccountMeta[],
    data: concat(
      DISC.sell,
      new Uint8Array([wordIndex]),
      new Uint8Array([side === 'YES' ? 0 : 1]),
      u64LE(quantity),
      u64LE(minReturn)
    ),
  }
}

export async function createRedeemIx(
  trader: Address,
  marketId: bigint,
  wordIndex: number,
  side: 'YES' | 'NO',
  market: MarketAccount
): Promise<Instruction> {
  const [escrow] = await getEscrowPDA(trader)
  const [marketPda] = await getMarketPDA(marketId)
  const [vaultPda] = await getVaultPDA(marketId)

  const word = market.words[wordIndex]
  const mintAddr = side === 'YES' ? word.yesMint : word.noMint
  const ata = await getAssociatedTokenAddress(mintAddr, trader)

  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: trader, role: AccountRole.WRITABLE_SIGNER },
      { address: escrow, role: AccountRole.WRITABLE },
      { address: marketPda, role: AccountRole.WRITABLE },
      { address: vaultPda, role: AccountRole.WRITABLE },
      { address: mintAddr, role: AccountRole.WRITABLE },
      { address: ata, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ] as AccountMeta[],
    data: concat(
      DISC.redeem,
      new Uint8Array([wordIndex]),
      new Uint8Array([side === 'YES' ? 0 : 1])
    ),
  }
}

// ── ATA creation helper ─────────────────────────────────

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
    data: new Uint8Array(0),
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
  return new DataView(
    data.buffer,
    data.byteOffset + offset,
    8
  ).getBigUint64(0, true)
}

function readI64(data: Uint8Array, offset: number): bigint {
  return new DataView(
    data.buffer,
    data.byteOffset + offset,
    8
  ).getBigInt64(0, true)
}

function readU16(data: Uint8Array, offset: number): number {
  return new DataView(
    data.buffer,
    data.byteOffset + offset,
    2
  ).getUint16(0, true)
}

function readU32(data: Uint8Array, offset: number): number {
  return new DataView(
    data.buffer,
    data.byteOffset + offset,
    4
  ).getUint32(0, true)
}

function readBorshString(data: Uint8Array, offset: number): [string, number] {
  const len = readU32(data, offset)
  offset += 4
  const str = new TextDecoder().decode(data.slice(offset, offset + len))
  offset += len
  return [str, offset]
}

function readOptionPubkey(data: Uint8Array, offset: number): [Address | null, number] {
  const flag = data[offset]
  offset += 1
  if (flag === 0) return [null, offset]
  const addr = readAddress(data, offset)
  offset += 32
  return [addr, offset]
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

export function deserializeUserEscrow(data: Uint8Array): UserEscrow | null {
  if (data.length < 57) return null
  if (!arraysEqual(data.slice(0, 8), ACCT_DISC.userEscrow)) return null

  let off = 8
  const owner = readAddress(data, off); off += 32
  const balance = readU64(data, off); off += 8
  const locked = readU64(data, off); off += 8
  const bump = data[off]

  return { owner, balance, locked, bump }
}

export function deserializeLpPosition(data: Uint8Array): LpPosition | null {
  // 8 (disc) + 1 + 1 + 32 + 32 + 8 + 8 + 64 = 154
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

export async function fetchLpPosition(
  marketId: bigint,
  lpWallet: Address
): Promise<LpPosition | null> {
  const rpc = createRpc()
  const [pda] = await getLpPositionPDA(marketId, lpWallet)
  const result = await rpc
    .getAccountInfo(pda, { encoding: 'base64' })
    .send()
  if (!result.value) return null
  const bytes = decodeBase64(result.value.data)
  return deserializeLpPosition(bytes)
}

export async function fetchVaultBalance(
  marketId: bigint
): Promise<bigint> {
  const rpc = createRpc()
  const [vaultPda] = await getVaultPDA(marketId)
  const result = await rpc
    .getAccountInfo(vaultPda, { encoding: 'base64' })
    .send()
  if (!result.value) return 0n
  return BigInt(result.value.lamports)
}

export function deserializeMarketAccount(data: Uint8Array): MarketAccount | null {
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

  let router: Address | null
  ;[router, off] = readOptionPubkey(data, off)

  const poolVault = readAddress(data, off); off += 32
  const vaultBump = data[off]; off += 1
  const totalLpShares = readU64(data, off); off += 8
  const liquidityParamB = readU64(data, off); off += 8
  const baseBPerSol = readU64(data, off); off += 8
  const numWords = data[off]; off += 1

  // Parse all 8 WordState entries (fixed array, variable-length strings)
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

    words.push({
      wordIndex, label: wordLabel, yesMint, noMint,
      yesQuantity, noQuantity, outcome,
    })
  }

  const status = data[off] as MarketStatus; off += 1
  const createdAt = readI64(data, off); off += 8
  const resolvesAt = readI64(data, off); off += 8
  let resolvedAt: bigint | null
  ;[resolvedAt, off] = readOptionI64(data, off)
  const tradeFeeBps = readU16(data, off); off += 2
  const protocolFeeBps = readU16(data, off); off += 2
  const accumulatedFees = readU64(data, off); off += 8

  return {
    version, bump, marketId, label, authority, resolver, router,
    poolVault, vaultBump, totalLpShares, liquidityParamB, baseBPerSol,
    numWords, words: words.slice(0, numWords),
    status, createdAt, resolvesAt, resolvedAt,
    tradeFeeBps, protocolFeeBps, accumulatedFees,
  }
}

// ── Account fetching ─────────────────────────────────────

export function createRpc() {
  return createSolanaRpc(devnet(DEVNET_URL))
}

function decodeBase64(raw: unknown): Uint8Array {
  const b64 = typeof raw === 'string' ? raw : (raw as readonly string[])[0]
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

export async function fetchEscrow(
  userAddr: Address
): Promise<UserEscrow | null> {
  const rpc = createRpc()
  const [pda] = await getEscrowPDA(userAddr)
  const result = await rpc
    .getAccountInfo(pda, { encoding: 'base64' })
    .send()
  if (!result.value) return null
  const bytes = decodeBase64(result.value.data)
  return deserializeUserEscrow(bytes)
}

export async function fetchMarket(
  marketId: bigint
): Promise<MarketAccount | null> {
  const rpc = createRpc()
  const [pda] = await getMarketPDA(marketId)
  const result = await rpc
    .getAccountInfo(pda, { encoding: 'base64' })
    .send()
  if (!result.value) return null
  const bytes = decodeBase64(result.value.data)
  return deserializeMarketAccount(bytes)
}

export async function fetchAllMarkets(): Promise<
  Array<{ pubkey: Address; account: MarketAccount }>
> {
  const rpc = createRpc()

  const discB64 = btoa(
    String.fromCharCode(...ACCT_DISC.marketAccount)
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await rpc
    .getProgramAccounts(PROGRAM_ID, {
      encoding: 'base64',
      filters: [
        {
          memcmp: {
            offset: 0n,
            bytes: discB64 as any,
            encoding: 'base64',
          },
        },
      ],
    })
    .send()

  const out: Array<{ pubkey: Address; account: MarketAccount }> = []
  for (const item of result) {
    const bytes = decodeBase64(item.account.data)
    const parsed = deserializeMarketAccount(bytes)
    if (parsed) {
      out.push({ pubkey: item.pubkey, account: parsed })
    }
  }
  return out
}

// ── Display helpers ──────────────────────────────────────

export function lamportsToSol(lamports: bigint | number): string {
  const n = typeof lamports === 'bigint' ? Number(lamports) : lamports
  return (n / LAMPORTS_PER_SOL).toFixed(2)
}

export function solToLamports(sol: number): bigint {
  return BigInt(Math.floor(sol * LAMPORTS_PER_SOL))
}

export function marketStatusStr(s: MarketStatus): string {
  return s === MarketStatus.Open
    ? 'Open'
    : s === MarketStatus.Paused
    ? 'Paused'
    : 'Resolved'
}

export function outcomeStr(o: boolean | null): string {
  if (o === null) return 'Unresolved'
  return o ? 'YES (Mentioned)' : 'NO (Not mentioned)'
}

/**
 * Compute LMSR implied prices from on-chain quantities.
 * Uses softmax trick: P(yes) = 1 / (1 + exp((q_no - q_yes) / b))
 */
export function lmsrImpliedPrice(
  yesQty: bigint,
  noQty: bigint,
  b: bigint
): { yes: number; no: number } {
  if (b === 0n) return { yes: 0.5, no: 0.5 }
  const diff = (Number(noQty) - Number(yesQty)) / Number(b)
  const pYes = 1 / (1 + Math.exp(diff))
  return { yes: pYes, no: 1 - pYes }
}

/**
 * Log-sum-exp trick for numerical stability:
 * ln(exp(a) + exp(b)) = max(a,b) + ln(exp(a-max) + exp(b-max))
 */
function logSumExp(a: number, b: number): number {
  const m = Math.max(a, b)
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m))
}

/**
 * LMSR cost function: C(q_yes, q_no) = b * ln(exp(q_yes/b) + exp(q_no/b))
 * All inputs as floats in SOL/share units.
 */
function lmsrCostFn(qYes: number, qNo: number, b: number): number {
  return b * logSumExp(qYes / b, qNo / b)
}

/**
 * Calculate the LMSR cost to buy `amount` shares.
 * Inputs: on-chain bigint quantities and b. Amount in shares (float).
 * Returns cost in SOL.
 */
export function lmsrBuyCost(
  yesQty: bigint,
  noQty: bigint,
  side: 'YES' | 'NO',
  amount: number,
  b: bigint
): number {
  const bF = Number(b) / 1e9
  const qY = Number(yesQty) / 1e9
  const qN = Number(noQty) / 1e9
  if (bF === 0) return 0

  const before = lmsrCostFn(qY, qN, bF)
  const after = side === 'YES'
    ? lmsrCostFn(qY + amount, qN, bF)
    : lmsrCostFn(qY, qN + amount, bF)

  return Math.max(0, after - before)
}

/**
 * Calculate the LMSR return from selling `amount` shares.
 * Returns gross return in SOL (before fees).
 */
export function lmsrSellReturn(
  yesQty: bigint,
  noQty: bigint,
  side: 'YES' | 'NO',
  amount: number,
  b: bigint
): number {
  const bF = Number(b) / 1e9
  const qY = Number(yesQty) / 1e9
  const qN = Number(noQty) / 1e9
  if (bF === 0) return 0

  const before = lmsrCostFn(qY, qN, bF)
  const after = side === 'YES'
    ? lmsrCostFn(qY - amount, qN, bF)
    : lmsrCostFn(qY, qN - amount, bF)

  return Math.max(0, before - after)
}

// ── Transaction helper ───────────────────────────────────

export async function sendIxs(
  signer: TransactionSendingSigner,
  instructions: Instruction[]
): Promise<void> {
  const rpc = createRpc()
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send()

  const txMsg = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(signer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx)
  )

  await signAndSendTransactionMessageWithSigners(txMsg)
}

// ── Position fetching ───────────────────────────────────

const TOKEN_BASE = 1_000_000_000 // 9 decimals

export async function fetchUserPositions(
  userAddr: Address
): Promise<UserPosition[]> {
  const rpc = createRpc()

  const [allMarkets, tokenResult] = await Promise.all([
    fetchAllMarkets(),
    rpc
      .getTokenAccountsByOwner(
        userAddr,
        { programId: TOKEN_PROGRAM },
        { encoding: 'jsonParsed' }
      )
      .send(),
  ])

  // Build mint → position info lookup
  const mintMap = new Map<
    string,
    { marketId: bigint; wordIndex: number; side: 'YES' | 'NO'; market: MarketAccount; word: WordState }
  >()

  for (const m of allMarkets) {
    for (const w of m.account.words) {
      mintMap.set(w.yesMint as string, {
        marketId: m.account.marketId,
        wordIndex: w.wordIndex,
        side: 'YES',
        market: m.account,
        word: w,
      })
      mintMap.set(w.noMint as string, {
        marketId: m.account.marketId,
        wordIndex: w.wordIndex,
        side: 'NO',
        market: m.account,
        word: w,
      })
    }
  }

  const positions: UserPosition[] = []

  for (const item of tokenResult.value) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = (item.account.data as any).parsed
    if (!parsed?.info) continue

    const mint = parsed.info.mint as string
    const amountStr = parsed.info.tokenAmount?.amount as string

    const info = mintMap.get(mint)
    if (!info) continue

    const rawAmount = amountStr ? BigInt(amountStr) : 0n
    // Skip 0-balance positions unless market is resolved (show closed/sold positions)
    if (rawAmount === 0n && info.market.status !== MarketStatus.Resolved) continue

    const shares = Number(rawAmount) / TOKEN_BASE
    const { market, word, side } = info

    let estimatedValueSol: number
    let claimable = false
    let won: boolean | null = null

    if (market.status === MarketStatus.Resolved && word.outcome !== null) {
      won =
        (word.outcome === true && side === 'YES') ||
        (word.outcome === false && side === 'NO')
      estimatedValueSol = won ? shares * 1.0 : 0
      claimable = won && rawAmount > 0n
    } else {
      const price = lmsrImpliedPrice(
        word.yesQuantity,
        word.noQuantity,
        market.liquidityParamB
      )
      const sidePrice = side === 'YES' ? price.yes : price.no
      estimatedValueSol = shares * sidePrice
    }

    positions.push({
      marketId: info.marketId,
      wordIndex: info.wordIndex,
      wordLabel: word.label,
      marketLabel: market.label,
      marketStatus: market.status,
      side,
      rawAmount,
      shares,
      estimatedValueSol,
      claimable,
      won,
    })
  }

  return positions
}

// ── Trade history from indexer API ──────────────────────

export interface TradeHistoryPoint {
  timestamp: number       // unix seconds
  wordIndex: number
  impliedYesPrice: number // 0..1
  direction: 'YES' | 'NO'
  quantity: number        // shares
  cost: number            // SOL
}

/**
 * Fetch trade history for a market from the indexer API.
 * Returns price points sorted chronologically.
 */
export async function fetchTradeHistory(
  marketId: bigint,
  limit = 500
): Promise<TradeHistoryPoint[]> {
  const res = await fetch(`/api/trades?marketId=${marketId}&limit=${limit}`)
  if (!res.ok) return []
  const { trades } = await res.json()

  // Map API response to TradeHistoryPoint, sorted chronologically
  const points: TradeHistoryPoint[] = trades.map((t: {
    wordIndex: number
    impliedPrice: number
    direction: string
    quantity: number
    cost: number
    timestamp: string
  }) => ({
    timestamp: Math.floor(new Date(t.timestamp).getTime() / 1000),
    wordIndex: t.wordIndex,
    impliedYesPrice: t.impliedPrice,
    direction: t.direction as 'YES' | 'NO',
    quantity: t.quantity,
    cost: t.cost,
  }))

  // API returns newest-first, we need chronological
  points.sort((a: TradeHistoryPoint, b: TradeHistoryPoint) => a.timestamp - b.timestamp)
  return points
}

// ── User trade history ─────────────────────────────────

export interface UserTradeEntry {
  timestamp: number
  marketId: bigint
  marketLabel: string
  wordIndex: number
  wordLabel: string
  direction: 'YES' | 'NO'
  quantity: number   // shares
  cost: number       // SOL
  isBuy: boolean
  txSignature: string
}

/**
 * Fetch all trades by a specific user across all markets from the indexer API.
 */
export async function fetchUserTradeHistory(
  userAddr: Address,
  limit = 200
): Promise<UserTradeEntry[]> {
  const [res, allMarkets] = await Promise.all([
    fetch(`/api/trades?trader=${userAddr}&limit=${limit}`),
    fetchAllMarkets(),
  ])

  if (!res.ok) return []
  const { trades } = await res.json()

  // Build market label lookup
  const marketLabelMap = new Map<string, { label: string; words: WordState[] }>()
  for (const m of allMarkets) {
    marketLabelMap.set(m.account.marketId.toString(), {
      label: m.account.label,
      words: m.account.words,
    })
  }

  return trades.map((t: {
    signature: string
    marketId: string
    wordIndex: number
    direction: string
    isBuy: boolean
    quantity: number
    cost: number
    timestamp: string
  }) => {
    const marketInfo = marketLabelMap.get(t.marketId)
    const wordInfo = marketInfo?.words.find((w) => w.wordIndex === t.wordIndex)

    return {
      timestamp: Math.floor(new Date(t.timestamp).getTime() / 1000),
      marketId: BigInt(t.marketId),
      marketLabel: marketInfo?.label || `Market #${t.marketId}`,
      wordIndex: t.wordIndex,
      wordLabel: wordInfo?.label || `Word #${t.wordIndex}`,
      direction: t.direction as 'YES' | 'NO',
      quantity: t.quantity,
      cost: t.cost,
      isBuy: t.isBuy,
      txSignature: t.signature,
    }
  })
}
