import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import BN from "bn.js";
import { createHash } from "crypto";

export const PROGRAM_ID = new PublicKey("F8EsP2rp6FBuaTfKQ8ywx4hqhM3YpcJr4HPkXHeGsZyJ");
export const DEVNET_RPC = "https://api.devnet.solana.com";

// Instruction discriminators (first 8 bytes of sha256("global:instruction_name"))
const DISCRIMINATORS = {
  initializeEvent: Buffer.from([141, 241, 141, 145, 87, 214, 143, 132]),
  initializeMarket: Buffer.from([150, 99, 82, 202, 125, 239, 189, 49]),
  addLiquidity: Buffer.from([181, 157, 89, 67, 143, 182, 52, 72]),
  mintSet: Buffer.from([189, 244, 187, 99, 171, 203, 209, 155]),
  buyYesWithSol: Buffer.from([122, 99, 167, 220, 226, 129, 250, 143]),
  buyNoWithSol: Buffer.from([24, 179, 208, 56, 244, 45, 219, 250]),
  swap: Buffer.from([248, 198, 158, 145, 225, 117, 135, 200]),
  resolveMarket: Buffer.from([184, 150, 44, 123, 183, 223, 162, 117]),
  redeem: Buffer.from([184, 12, 86, 149, 70, 196, 97, 230]),
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

// PDA derivations
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

  return new TransactionInstruction({
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: eventPda, isSigner: false, isWritable: false },
      { pubkey: marketPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
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

