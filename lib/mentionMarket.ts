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
  'AJ4XSwJoh2C8vmd8U7xhpzMkzkZZPaBRpbfpkmm4DmeN'
)
export const TOKEN_PROGRAM = toAddress(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
)
export const SYSTEM_PROGRAM = toAddress(
  '11111111111111111111111111111111'
)
export const DEVNET_URL = 'https://api.devnet.solana.com'
const LAMPORTS_PER_SOL = 1_000_000_000

// Anchor instruction discriminators (from IDL)
const DISC = {
  deposit: new Uint8Array([242, 35, 198, 137, 82, 225, 242, 182]),
  withdraw: new Uint8Array([183, 18, 70, 156, 148, 109, 161, 34]),
  createMarket: new Uint8Array([103, 226, 97, 235, 200, 188, 251, 254]),
  pauseMarket: new Uint8Array([216, 238, 4, 164, 65, 11, 162, 91]),
  resolveMarket: new Uint8Array([155, 23, 80, 173, 46, 74, 23, 239]),
}

// Account discriminators
const ACCT_DISC = {
  userEscrow: new Uint8Array([242, 233, 85, 38, 26, 5, 142, 109]),
  wordMarket: new Uint8Array([19, 245, 212, 180, 55, 87, 181, 250]),
}

// ── Types ────────────────────────────────────────────────

export interface UserEscrow {
  owner: Address
  balance: bigint
  locked: bigint
  bump: number
}

export enum MarketStatus {
  Active = 0,
  Paused = 1,
  Resolved = 2,
}

export enum Outcome {
  Yes = 0,
  No = 1,
}

export interface WordMarket {
  authority: Address
  marketId: bigint
  wordIndex: number
  label: string
  yesMint: Address
  noMint: Address
  vault: Address
  totalCollateral: bigint
  status: MarketStatus
  outcome: Outcome | null
  bump: number
  vaultBump: number
}

// ── Encoding helpers ─────────────────────────────────────

function u64LE(n: bigint): Uint8Array {
  const buf = new ArrayBuffer(8)
  new DataView(buf).setBigUint64(0, n, true)
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

export async function getWordMarketPDA(
  marketId: bigint,
  wordIndex: number
): Promise<[Address, number]> {
  const [pda, bump] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: ['market', u64LE(marketId), u16LE(wordIndex)],
  })
  return [pda, bump]
}

export async function getYesMintPDA(
  wordMarket: Address
): Promise<[Address, number]> {
  const [pda, bump] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: ['yes_mint', addrEncoder.encode(wordMarket)],
  })
  return [pda, bump]
}

export async function getNoMintPDA(
  wordMarket: Address
): Promise<[Address, number]> {
  const [pda, bump] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: ['no_mint', addrEncoder.encode(wordMarket)],
  })
  return [pda, bump]
}

export async function getVaultPDA(
  wordMarket: Address
): Promise<[Address, number]> {
  const [pda, bump] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: ['vault', addrEncoder.encode(wordMarket)],
  })
  return [pda, bump]
}

// ── Instruction builders ─────────────────────────────────

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
  wordIndex: number,
  label: string
): Promise<Instruction> {
  const [wordMarket] = await getWordMarketPDA(marketId, wordIndex)
  const [yesMint] = await getYesMintPDA(wordMarket)
  const [noMint] = await getNoMintPDA(wordMarket)
  const [vault] = await getVaultPDA(wordMarket)

  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: authority, role: AccountRole.WRITABLE_SIGNER },
      { address: wordMarket, role: AccountRole.WRITABLE },
      { address: yesMint, role: AccountRole.WRITABLE },
      { address: noMint, role: AccountRole.WRITABLE },
      { address: vault, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ] as AccountMeta[],
    data: concat(
      DISC.createMarket,
      u64LE(marketId),
      u16LE(wordIndex),
      encodeString(label)
    ),
  }
}

/** Build instructions for a batch of words sharing the same market_id */
export async function createMarketGroupIxs(
  authority: Address,
  marketId: bigint,
  words: string[]
): Promise<Instruction[]> {
  return Promise.all(
    words.map((word, i) =>
      createCreateMarketIx(authority, marketId, i, word.trim())
    )
  )
}

export async function createPauseMarketIx(
  authority: Address,
  marketId: bigint,
  wordIndex: number
): Promise<Instruction> {
  const [wordMarket] = await getWordMarketPDA(marketId, wordIndex)
  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: authority, role: AccountRole.READONLY_SIGNER },
      { address: wordMarket, role: AccountRole.WRITABLE },
    ] as AccountMeta[],
    data: DISC.pauseMarket,
  }
}

export async function createResolveMarketIx(
  authority: Address,
  marketId: bigint,
  wordIndex: number,
  outcome: Outcome
): Promise<Instruction> {
  const [wordMarket] = await getWordMarketPDA(marketId, wordIndex)
  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: authority, role: AccountRole.READONLY_SIGNER },
      { address: wordMarket, role: AccountRole.WRITABLE },
    ] as AccountMeta[],
    data: concat(DISC.resolveMarket, new Uint8Array([outcome])),
  }
}

/** Batch pause all words in a market group */
export async function createPauseGroupIxs(
  authority: Address,
  marketId: bigint,
  wordCount: number
): Promise<Instruction[]> {
  return Promise.all(
    Array.from({ length: wordCount }, (_, i) =>
      createPauseMarketIx(authority, marketId, i)
    )
  )
}

/** Batch resolve all words in a market group */
export async function createResolveGroupIxs(
  authority: Address,
  marketId: bigint,
  wordIndices: number[],
  outcomes: Outcome[]
): Promise<Instruction[]> {
  return Promise.all(
    wordIndices.map((idx, i) =>
      createResolveMarketIx(authority, marketId, idx, outcomes[i])
    )
  )
}

// ── Account deserialization ──────────────────────────────

const addrDecoder = {
  decode(bytes: Uint8Array): Address {
    // Convert 32 raw bytes to base58 address
    // We use getAddressEncoder in reverse via a lookup
    // Simpler: encode to base58 manually
    return base58Encode(bytes) as Address
  },
}

// Minimal base58 for decoding 32-byte pubkeys
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
  return addrDecoder.decode(data.slice(offset, offset + 32))
}

function readU64(data: Uint8Array, offset: number): bigint {
  return new DataView(
    data.buffer,
    data.byteOffset + offset,
    8
  ).getBigUint64(0, true)
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

export function deserializeWordMarket(data: Uint8Array): WordMarket | null {
  if (data.length < 40) return null
  if (!arraysEqual(data.slice(0, 8), ACCT_DISC.wordMarket)) return null

  let off = 8
  const authority = readAddress(data, off); off += 32
  const marketId = readU64(data, off); off += 8
  const wordIndex = readU16(data, off); off += 2

  // Borsh string
  const labelLen = readU32(data, off); off += 4
  const label = new TextDecoder().decode(data.slice(off, off + labelLen)); off += labelLen

  const yesMint = readAddress(data, off); off += 32
  const noMint = readAddress(data, off); off += 32
  const vault = readAddress(data, off); off += 32
  const totalCollateral = readU64(data, off); off += 8

  const status = data[off] as MarketStatus; off += 1

  // Option<Outcome>
  const optionFlag = data[off]; off += 1
  let outcome: Outcome | null = null
  if (optionFlag === 1) {
    outcome = data[off] as Outcome; off += 1
  }

  const bump = data[off]; off += 1
  const vaultBump = data[off]

  return {
    authority, marketId, wordIndex, label,
    yesMint, noMint, vault, totalCollateral,
    status, outcome, bump, vaultBump,
  }
}

// ── Account fetching ─────────────────────────────────────

function createRpc() {
  return createSolanaRpc(devnet(DEVNET_URL))
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
  const raw = result.value.data
  const b64 = typeof raw === 'string' ? raw : (raw as readonly string[])[0]
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return deserializeUserEscrow(bytes)
}

export async function fetchWordMarket(
  marketId: bigint,
  wordIndex: number
): Promise<WordMarket | null> {
  const rpc = createRpc()
  const [pda] = await getWordMarketPDA(marketId, wordIndex)
  const result = await rpc
    .getAccountInfo(pda, { encoding: 'base64' })
    .send()
  if (!result.value) return null
  const raw = result.value.data
  const b64 = typeof raw === 'string' ? raw : (raw as readonly string[])[0]
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return deserializeWordMarket(bytes)
}

export async function fetchAllWordMarkets(): Promise<
  Array<{ pubkey: Address; account: WordMarket }>
> {
  const rpc = createRpc()

  // Discriminator as base64 for memcmp filter
  const discB64 = btoa(
    String.fromCharCode(...ACCT_DISC.wordMarket)
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

  const out: Array<{ pubkey: Address; account: WordMarket }> = []
  for (const item of result) {
    const raw = item.account.data
    const b64 = typeof raw === 'string' ? raw : (raw as readonly string[])[0]
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const parsed = deserializeWordMarket(bytes)
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
  return s === MarketStatus.Active
    ? 'Active'
    : s === MarketStatus.Paused
    ? 'Paused'
    : 'Resolved'
}

export function outcomeStr(o: Outcome | null): string {
  if (o === null) return 'Unresolved'
  return o === Outcome.Yes ? 'YES' : 'NO'
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
