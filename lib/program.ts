import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { createHash } from "crypto";

export const PROGRAM_ID = new PublicKey("G11AaYPenVJw7MzbYLX6rp1USGhjRZwQ8eTgAu6G4pnk");
export const DEVNET_RPC = "https://api.devnet.solana.com";

// Instruction discriminators (first 8 bytes of sha256("global:instruction_name"))
// These are Anchor-generated discriminators
const DISCRIMINATORS = {
  initializeEvent: Buffer.from([126, 249, 86, 221, 202, 171, 134, 20]), // global:initialize_event
  initializeMarket: Buffer.from([35, 35, 189, 193, 155, 48, 170, 203]), // global:initialize_market
  mintSet: Buffer.from([91, 117, 1, 75, 201, 110, 110, 189]), // global:mint_set
  burnSet: Buffer.from([9, 204, 190, 179, 182, 91, 228, 20]), // global:burn_set
  placeOrder: Buffer.from([51, 194, 155, 175, 109, 130, 96, 106]), // global:place_order
  cancelOrder: Buffer.from([95, 129, 237, 240, 8, 49, 223, 132]), // global:cancel_order (matches)
  matchOrders: Buffer.from([17, 1, 201, 93, 7, 51, 251, 134]), // global:match_orders
  resolveMarket: Buffer.from([155, 23, 80, 173, 46, 74, 23, 239]), // global:resolve_market (matches)
  redeem: Buffer.from([184, 12, 86, 149, 70, 196, 97, 225]), // global:redeem (matches)
  startEvent: Buffer.from([61, 196, 227, 97, 8, 81, 107, 23]), // global:start_event
  endEvent: Buffer.from([210, 72, 122, 58, 113, 167, 161, 20]), // global:end_event
  finalizeEvent: Buffer.from([88, 246, 123, 105, 100, 148, 170, 236]), // global:finalize_event
};

export interface EventAccount {
  admin: PublicKey;
  eventId: BN;
  state: { preMarket?: {} } | { live?: {} } | { ended?: {} } | { resolved?: {} };
  startTime: BN;
  endTime: BN;
  createdAt: BN;
  bump: number;
}

export interface MarketAccount {
  event: PublicKey;
  admin: PublicKey;
  marketId: BN;
  wordHash: number[];
  resolved: boolean;
  winningSide: { unresolved?: {} } | { yes?: {} } | { no?: {} };
  nextOrderId: BN;
  bump: number;
}

// PDA derivations - Note: Event PDA uses admin's public key, NOT just "event" + eventId
export function getEventPDA(adminPubkey: PublicKey, eventId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("event"),
      adminPubkey.toBuffer(),
      eventId.toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID
  );
}

export function getMarketPDA(eventPubkey: PublicKey, marketId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("market"),
      eventPubkey.toBuffer(),
      marketId.toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID
  );
}

// Get YES mint PDA for a market
export function getYesMintPDA(marketPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("yes_mint"), marketPubkey.toBuffer()],
    PROGRAM_ID
  );
}

// Get NO mint PDA for a market
export function getNoMintPDA(marketPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("no_mint"), marketPubkey.toBuffer()],
    PROGRAM_ID
  );
}

// Get order PDA for a market and order ID
export function getOrderPDA(marketPubkey: PublicKey, orderId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("order"),
      marketPubkey.toBuffer(),
      orderId.toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID
  );
}

// Get order escrow token PDA
export function getOrderEscrowPDA(orderPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("order_escrow"), orderPubkey.toBuffer()],
    PROGRAM_ID
  );
}

export function hashWord(word: string): number[] {
  return Array.from(createHash("sha256").update(word).digest());
}

// Instruction builders
export function createInitializeEventInstruction(
  admin: PublicKey,
  eventPda: PublicKey,
  eventId: BN,
  startTime: BN,
  endTime: BN
): TransactionInstruction {
  const data = Buffer.concat([
    DISCRIMINATORS.initializeEvent,
    eventId.toArrayLike(Buffer, "le", 8),
    startTime.toArrayLike(Buffer, "le", 8),
    endTime.toArrayLike(Buffer, "le", 8),
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: eventPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

export function createInitializeMarketInstruction(
  admin: PublicKey,
  eventPda: PublicKey,
  marketPda: PublicKey,
  yesMint: PublicKey,
  noMint: PublicKey,
  marketId: BN,
  wordHash: number[]
): TransactionInstruction {
  const data = Buffer.concat([
    DISCRIMINATORS.initializeMarket,
    marketId.toArrayLike(Buffer, "le", 8),
    Buffer.from(wordHash),
  ]);

  const SYSVAR_RENT_PUBKEY = new PublicKey("SysvarRent111111111111111111111111111111111");

  return new TransactionInstruction({
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: eventPda, isSigner: false, isWritable: false },
      { pubkey: marketPda, isSigner: false, isWritable: true },
      { pubkey: yesMint, isSigner: false, isWritable: true },
      { pubkey: noMint, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

export function createResolveMarketInstruction(
  admin: PublicKey,
  eventPda: PublicKey,
  marketPda: PublicKey,
  winningSide: "yes" | "no"
): TransactionInstruction {
  // WinningSide enum: 0 = Unresolved, 1 = Yes, 2 = No
  const winningSideVariant = winningSide === "yes" ? 1 : 2;
  
  const data = Buffer.concat([
    DISCRIMINATORS.resolveMarket,
    Buffer.from([winningSideVariant]),
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: admin, isSigner: true, isWritable: false },
      { pubkey: eventPda, isSigner: false, isWritable: false },
      { pubkey: marketPda, isSigner: false, isWritable: true },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

// State transition instructions
export function createStartEventInstruction(
  admin: PublicKey,
  eventPda: PublicKey
): TransactionInstruction {
  const data = DISCRIMINATORS.startEvent;

  return new TransactionInstruction({
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: eventPda, isSigner: false, isWritable: true },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

export function createEndEventInstruction(
  admin: PublicKey,
  eventPda: PublicKey
): TransactionInstruction {
  const data = DISCRIMINATORS.endEvent;

  return new TransactionInstruction({
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: eventPda, isSigner: false, isWritable: true },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

export function createFinalizeEventInstruction(
  admin: PublicKey,
  eventPda: PublicKey
): TransactionInstruction {
  const data = DISCRIMINATORS.finalizeEvent;

  return new TransactionInstruction({
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: eventPda, isSigner: false, isWritable: true },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

// Mint set instruction - user deposits SOL and gets YES+NO tokens
export function createMintSetInstruction(
  user: PublicKey,
  eventPda: PublicKey,
  marketPda: PublicKey,
  yesMint: PublicKey,
  noMint: PublicKey,
  userYesAta: PublicKey,
  userNoAta: PublicKey,
  lamports: BN
): TransactionInstruction {
  const data = Buffer.concat([
    DISCRIMINATORS.mintSet,
    lamports.toArrayLike(Buffer, "le", 8),
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: eventPda, isSigner: false, isWritable: false },
      { pubkey: marketPda, isSigner: false, isWritable: true },
      { pubkey: yesMint, isSigner: false, isWritable: true },
      { pubkey: noMint, isSigner: false, isWritable: true },
      { pubkey: userYesAta, isSigner: false, isWritable: true },
      { pubkey: userNoAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

// Burn set instruction - user burns equal YES+NO tokens to get SOL back
export function createBurnSetInstruction(
  user: PublicKey,
  eventPda: PublicKey,
  marketPda: PublicKey,
  yesMint: PublicKey,
  noMint: PublicKey,
  userYesAta: PublicKey,
  userNoAta: PublicKey,
  amount: BN
): TransactionInstruction {
  const data = Buffer.concat([
    DISCRIMINATORS.burnSet,
    amount.toArrayLike(Buffer, "le", 8),
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: eventPda, isSigner: false, isWritable: false },
      { pubkey: marketPda, isSigner: false, isWritable: true },
      { pubkey: yesMint, isSigner: false, isWritable: true },
      { pubkey: noMint, isSigner: false, isWritable: true },
      { pubkey: userYesAta, isSigner: false, isWritable: true },
      { pubkey: userNoAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

// Place order instruction
export function createPlaceOrderInstruction(
  user: PublicKey,
  marketPda: PublicKey,
  orderPda: PublicKey,
  yesMint: PublicKey,
  noMint: PublicKey,
  userYesAta: PublicKey,
  userNoAta: PublicKey,
  orderEscrowToken: PublicKey,
  side: "buy" | "sell",
  outcome: "yes" | "no",
  price: BN,
  size: BN
): TransactionInstruction {
  const sideVariant = side === "buy" ? 0 : 1;
  const outcomeVariant = outcome === "yes" ? 0 : 1;

  const data = Buffer.concat([
    DISCRIMINATORS.placeOrder,
    Buffer.from([sideVariant]),
    Buffer.from([outcomeVariant]),
    price.toArrayLike(Buffer, "le", 8),
    size.toArrayLike(Buffer, "le", 8),
  ]);

  const SYSVAR_RENT_PUBKEY = new PublicKey("SysvarRent111111111111111111111111111111111");

  return new TransactionInstruction({
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: marketPda, isSigner: false, isWritable: true },
      { pubkey: orderPda, isSigner: false, isWritable: true },
      { pubkey: yesMint, isSigner: false, isWritable: false },
      { pubkey: noMint, isSigner: false, isWritable: false },
      { pubkey: userYesAta, isSigner: false, isWritable: true },
      { pubkey: userNoAta, isSigner: false, isWritable: true },
      { pubkey: orderEscrowToken, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

// Account fetching
export async function fetchEventAccount(
  connection: Connection,
  eventPda: PublicKey
): Promise<EventAccount | null> {
  try {
    const accountInfo = await connection.getAccountInfo(eventPda);
    if (!accountInfo) return null;

    const data = accountInfo.data;
    
    // Skip 8-byte discriminator
    const admin = new PublicKey(data.slice(8, 40));
    const eventId = new BN(data.slice(40, 48), "le");
    const stateVariant = data[48];
    const startTime = new BN(data.slice(49, 57), "le");
    const endTime = new BN(data.slice(57, 65), "le");
    const createdAt = new BN(data.slice(65, 73), "le");
    const bump = data[73];
    
    let state;
    if (stateVariant === 0) state = { preMarket: {} };
    else if (stateVariant === 1) state = { live: {} };
    else if (stateVariant === 2) state = { ended: {} };
    else state = { resolved: {} };

    return { admin, eventId, state, startTime, endTime, createdAt, bump };
  } catch (error) {
    console.error("Error fetching event account:", error);
    return null;
  }
}

export async function fetchMarketAccount(
  connection: Connection,
  marketPda: PublicKey
): Promise<MarketAccount | null> {
  try {
    const accountInfo = await connection.getAccountInfo(marketPda);
    if (!accountInfo) return null;

    const data = accountInfo.data;
    
    // Skip 8-byte discriminator
    const event = new PublicKey(data.slice(8, 40));
    const admin = new PublicKey(data.slice(40, 72));
    const marketId = new BN(data.slice(72, 80), "le");
    const wordHash = Array.from(data.slice(80, 112));
    const resolved = data[112] === 1;
    const winningSideVariant = data[113];
    const nextOrderId = new BN(data.slice(114, 122), "le");
    const bump = data[122];
    
    let winningSide;
    if (winningSideVariant === 0) winningSide = { unresolved: {} };
    else if (winningSideVariant === 1) winningSide = { yes: {} };
    else winningSide = { no: {} };

    return { event, admin, marketId, wordHash, resolved, winningSide, nextOrderId, bump };
  } catch (error) {
    console.error("Error fetching market account:", error);
    return null;
  }
}

export function lamportsToSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(4);
}

export function solToLamports(sol: number): BN {
  return new BN(Math.floor(sol * LAMPORTS_PER_SOL));
}

// Helper to get event state as string
export function getEventStateString(state: EventAccount['state']): string {
  if ('preMarket' in state) return 'PreMarket';
  if ('live' in state) return 'Live';
  if ('ended' in state) return 'Ended';
  if ('resolved' in state) return 'Resolved';
  return 'Unknown';
}

// Fetch token account balance
export async function fetchTokenBalance(
  connection: Connection,
  tokenAccount: PublicKey
): Promise<number> {
  try {
    const accountInfo = await connection.getAccountInfo(tokenAccount);
    if (!accountInfo) return 0;
    
    // Token account amount is at offset 64, 8 bytes (u64)
    const amount = accountInfo.data.readBigUInt64LE(64);
    return Number(amount);
  } catch (error) {
    console.error("Error fetching token balance:", error);
    return 0;
  }
}

// Calculate market prices from token supply or order book
// For order book markets, this returns mock prices (will be replaced by order book pricing later)
export function calculateMarketPrices(yesSupply: number, noSupply: number): {
  yesPrice: number;
  noPrice: number;
  totalLiquidity: number;
} {
  // Order book pricing - for now, return 50/50 (will be calculated from actual orders later)
  return {
    yesPrice: 0.5,
    noPrice: 0.5,
    totalLiquidity: yesSupply + noSupply, // Total tokens minted
  };
}

// Fetch complete market data with prices
// Note: For order book, yesBalance/noBalance represent total supply, not vault balances
export async function fetchMarketWithPrices(
  connection: Connection,
  marketPda: PublicKey,
  word: string
): Promise<{
  marketPda: PublicKey;
  marketData: MarketAccount;
  word: string;
  yesPrice: number;
  noPrice: number;
  totalLiquidity: number;
  yesBalance: number;
  noBalance: number;
} | null> {
  try {
    const marketData = await fetchMarketAccount(connection, marketPda);
    if (!marketData) {
      console.warn(`Market account not found for ${word} at ${marketPda.toString()}`);
      return null;
    }

    const [yesMintPda] = getYesMintPDA(marketPda);
    const [noMintPda] = getNoMintPDA(marketPda);

    console.log(`Derived PDAs for ${word}:`, {
      yesMint: yesMintPda.toString(),
      noMint: noMintPda.toString(),
    });

    // Fetch mint supply (total tokens minted)
    const yesMintInfo = await connection.getAccountInfo(yesMintPda);
    const noMintInfo = await connection.getAccountInfo(noMintPda);
    
    const yesBalance = yesMintInfo ? Number(yesMintInfo.data.readBigUInt64LE(36)) : 0; // Supply at offset 36
    const noBalance = noMintInfo ? Number(noMintInfo.data.readBigUInt64LE(36)) : 0;

    console.log(`Token supplies for ${word}:`, {
      yes: yesBalance,
      no: noBalance
    });

    const { yesPrice, noPrice, totalLiquidity } = calculateMarketPrices(yesBalance, noBalance);

    return {
      marketPda,
      marketData,
      word,
      yesPrice,
      noPrice,
      totalLiquidity,
      yesBalance,
      noBalance,
    };
  } catch (error) {
    console.error(`Error fetching market with prices for ${word}:`, error);
    return null;
  }
}

// Fetch all markets for an event
export async function fetchEventMarkets(
  connection: Connection,
  adminPublicKey: PublicKey,
  eventId: BN,
  marketWords: Array<{ id: string; word: string }>
): Promise<Array<{
  marketPda: PublicKey;
  marketData: MarketAccount;
  word: string;
  yesPrice: number;
  noPrice: number;
  totalLiquidity: number;
  yesBalance: number;
  noBalance: number;
}>> {
  const [eventPda] = getEventPDA(adminPublicKey, eventId);
  console.log("Event PDA:", eventPda.toString());
  
  const markets = [];

  for (const marketInfo of marketWords) {
    try {
      console.log(`Fetching market for word: ${marketInfo.word}, id: ${marketInfo.id}`);
      
      const marketId = new BN(marketInfo.id);
      const [marketPda] = getMarketPDA(eventPda, marketId);
      
      console.log(`Market PDA: ${marketPda.toString()}`);
      
      const marketWithPrices = await fetchMarketWithPrices(connection, marketPda, marketInfo.word);
      if (marketWithPrices) {
        console.log(`Successfully loaded ${marketInfo.word}:`, {
          yesPrice: marketWithPrices.yesPrice,
          noPrice: marketWithPrices.noPrice,
          liquidity: marketWithPrices.totalLiquidity / 1_000_000_000
        });
        markets.push(marketWithPrices);
      } else {
        console.warn(`Failed to load market data for ${marketInfo.word}`);
      }
    } catch (error) {
      console.error(`Error loading market ${marketInfo.word}:`, error);
    }
  }

  console.log(`Loaded ${markets.length} out of ${marketWords.length} markets`);
  return markets;
}
