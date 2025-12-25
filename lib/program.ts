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

export const PROGRAM_ID = new PublicKey("F8EsP2rp6FBuaTfKQ8ywx4hqhM3YpcJr4HPkXHeGsZyJ");
export const DEVNET_RPC = "https://api.devnet.solana.com";

// Instruction discriminators (first 8 bytes of sha256("global:instruction_name"))
const DISCRIMINATORS = {
  initializeEvent: Buffer.from([126, 249, 86, 221, 202, 171, 134, 20]),
  initializeMarket: Buffer.from([35, 35, 189, 193, 155, 48, 170, 203]),
  addLiquidity: Buffer.from([181, 157, 89, 67, 143, 182, 52, 72]),
  resolveMarket: Buffer.from([155, 23, 80, 173, 46, 74, 23, 239]),
};

export interface EventAccount {
  admin: PublicKey;
  eventId: BN;
  bump: number;
}

export interface MarketAccount {
  event: PublicKey;
  admin: PublicKey;
  marketId: BN;
  wordHash: number[];
  feeBps: number;
  resolved: boolean;
  winningSide: { unresolved?: {} } | { yes?: {} } | { no?: {} };
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

// Get YES vault PDA for a market
export function getYesVaultPDA(marketPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("yes_vault"), marketPubkey.toBuffer()],
    PROGRAM_ID
  );
}

// Get NO vault PDA for a market
export function getNoVaultPDA(marketPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("no_vault"), marketPubkey.toBuffer()],
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
  eventId: BN
): TransactionInstruction {
  const data = Buffer.concat([
    DISCRIMINATORS.initializeEvent,
    eventId.toArrayLike(Buffer, "le", 8),
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
  yesVault: PublicKey,
  noVault: PublicKey,
  marketId: BN,
  wordHash: number[],
  feeBps: number
): TransactionInstruction {
  const feeBuf = Buffer.alloc(2);
  feeBuf.writeUInt16LE(feeBps);

  const data = Buffer.concat([
    DISCRIMINATORS.initializeMarket,
    marketId.toArrayLike(Buffer, "le", 8),
    Buffer.from(wordHash),
    feeBuf,
  ]);

  const SYSVAR_RENT_PUBKEY = new PublicKey("SysvarRent111111111111111111111111111111111");

  return new TransactionInstruction({
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: eventPda, isSigner: false, isWritable: true },
      { pubkey: marketPda, isSigner: false, isWritable: true },
      { pubkey: yesMint, isSigner: false, isWritable: true },
      { pubkey: noMint, isSigner: false, isWritable: true },
      { pubkey: yesVault, isSigner: false, isWritable: true },
      { pubkey: noVault, isSigner: false, isWritable: true },
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

export function createAddLiquidityInstruction(
  admin: PublicKey,
  eventPda: PublicKey,
  marketPda: PublicKey,
  yesMint: PublicKey,
  noMint: PublicKey,
  yesVault: PublicKey,
  noVault: PublicKey,
  lamports: BN
): TransactionInstruction {
  const data = Buffer.concat([
    DISCRIMINATORS.addLiquidity,
    lamports.toArrayLike(Buffer, "le", 8),
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: eventPda, isSigner: false, isWritable: false },
      { pubkey: marketPda, isSigner: false, isWritable: true },
      { pubkey: yesMint, isSigner: false, isWritable: true },
      { pubkey: noMint, isSigner: false, isWritable: true },
      { pubkey: yesVault, isSigner: false, isWritable: true },
      { pubkey: noVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
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
    const bump = data[48];

    return { admin, eventId, bump };
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
    const feeBps = data.readUInt16LE(112);
    const resolved = data[114] === 1;
    const winningSideVariant = data[115];
    
    let winningSide;
    if (winningSideVariant === 0) winningSide = { unresolved: {} };
    else if (winningSideVariant === 1) winningSide = { yes: {} };
    else winningSide = { no: {} };
    
    const bump = data[116];

    return { event, admin, marketId, wordHash, feeBps, resolved, winningSide, bump };
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

// Calculate market prices from vault balances
export function calculateMarketPrices(yesBalance: number, noBalance: number): {
  yesPrice: number;
  noPrice: number;
  totalLiquidity: number;
} {
  if (yesBalance === 0 || noBalance === 0) {
    return {
      yesPrice: 0.5,
      noPrice: 0.5,
      totalLiquidity: 0,
    };
  }

  const total = yesBalance + noBalance;
  const yesPrice = noBalance / total; // Counter-intuitive but correct for AMM
  const noPrice = yesBalance / total;
  
  return {
    yesPrice,
    noPrice,
    totalLiquidity: Math.min(yesBalance, noBalance), // Effective liquidity
  };
}

// Fetch complete market data with prices
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
    const [yesVaultPda] = getYesVaultPDA(marketPda);
    const [noVaultPda] = getNoVaultPDA(marketPda);

    console.log(`Derived PDAs for ${word}:`, {
      yesMint: yesMintPda.toString(),
      noMint: noMintPda.toString(),
      yesVault: yesVaultPda.toString(),
      noVault: noVaultPda.toString()
    });

    const yesBalance = await fetchTokenBalance(connection, yesVaultPda);
    const noBalance = await fetchTokenBalance(connection, noVaultPda);

    console.log(`Token balances for ${word}:`, {
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


