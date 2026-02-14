/**
 * test-settle.ts — Simulates the backend matching engine for settle_match.
 *
 * Usage:
 *   npx ts-node scripts/test-settle.ts \
 *     --yes-buyer <PHANTOM_ADDRESS> \
 *     --market-id 1 \
 *     --word-index 0 \
 *     --price 0.5 \
 *     --shares 1
 *
 * The deployer keypair (./deployer-keypair.json) acts as the backend signer.
 * An ephemeral keypair is created for the NO side of the trade.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MentionMarket } from "../target/types/mention_market";
import {
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Connection,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";

// ── Parse CLI args ──────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const map: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    map[args[i].replace(/^--/, "")] = args[i + 1];
  }

  const yesBuyer = map["yes-buyer"];
  const marketId = parseInt(map["market-id"] ?? "1", 10);
  const wordIndex = parseInt(map["word-index"] ?? "0", 10);
  const price = parseFloat(map["price"] ?? "0.5");
  const shares = parseFloat(map["shares"] ?? "1");

  if (!yesBuyer) {
    console.error(
      "Usage: npx ts-node scripts/test-settle.ts --yes-buyer <ADDRESS> [--market-id N] [--word-index N] [--price 0.5] [--shares 1]"
    );
    process.exit(1);
  }

  return { yesBuyer, marketId, wordIndex, price, shares };
}

// ── PDA helpers ─────────────────────────────────────────────
function getMarketPda(
  programId: PublicKey,
  marketId: number,
  wordIndex: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("market"),
      new BN(marketId).toArrayLike(Buffer, "le", 8),
      new BN(wordIndex).toArrayLike(Buffer, "le", 2),
    ],
    programId
  );
}

function getEscrowPda(
  programId: PublicKey,
  wallet: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), wallet.toBuffer()],
    programId
  );
}

function getMintPda(
  programId: PublicKey,
  prefix: string,
  wordMarket: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(prefix), wordMarket.toBuffer()],
    programId
  );
}

function getVaultPda(
  programId: PublicKey,
  wordMarket: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), wordMarket.toBuffer()],
    programId
  );
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  const { yesBuyer, marketId, wordIndex, price, shares } = parseArgs();

  // Setup provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.MentionMarket as Program<MentionMarket>;
  const connection = provider.connection;

  // Load deployer keypair (= backend signer)
  const deployerKeyfile = JSON.parse(
    fs.readFileSync("./deployer-keypair.json", "utf-8")
  );
  const deployer = Keypair.fromSecretKey(new Uint8Array(deployerKeyfile));
  console.log("Backend signer:", deployer.publicKey.toBase58());

  // YES buyer = the Phantom user address provided via CLI
  const yesBuyerPk = new PublicKey(yesBuyer);
  console.log("YES buyer:", yesBuyerPk.toBase58());

  // Generate ephemeral NO buyer
  const noBuyer = Keypair.generate();
  console.log("NO buyer (ephemeral):", noBuyer.publicKey.toBase58());

  // ── Airdrop to ephemeral NO buyer ───────────────────────
  console.log("\nAirdropping 2 SOL to ephemeral NO buyer...");
  const airdropSig = await connection.requestAirdrop(
    noBuyer.publicKey,
    2 * LAMPORTS_PER_SOL
  );
  await connection.confirmTransaction(airdropSig, "confirmed");
  console.log("Airdrop confirmed");

  // ── Deposit for NO buyer ────────────────────────────────
  const [noBuyerEscrow] = getEscrowPda(program.programId, noBuyer.publicKey);

  // Convert shares to lamports for deposit: need (1-price)*shares SOL for NO side
  const noDepositSol = (1 - price) * shares;
  const noDepositLamports = Math.ceil(noDepositSol * LAMPORTS_PER_SOL);
  console.log(`Depositing ${noDepositSol} SOL for NO buyer's escrow...`);

  await program.methods
    .deposit(new BN(noDepositLamports))
    .accounts({
      user: noBuyer.publicKey,
      escrow: noBuyerEscrow,
      systemProgram: SystemProgram.programId,
    })
    .signers([noBuyer])
    .rpc();
  console.log("NO buyer deposit confirmed");

  // ── Derive PDAs ─────────────────────────────────────────
  const [wordMarketPda] = getMarketPda(
    program.programId,
    marketId,
    wordIndex
  );
  const [yesMint] = getMintPda(program.programId, "yes_mint", wordMarketPda);
  const [noMint] = getMintPda(program.programId, "no_mint", wordMarketPda);
  const [vault] = getVaultPda(program.programId, wordMarketPda);
  const [yesBuyerEscrow] = getEscrowPda(program.programId, yesBuyerPk);

  console.log("\nWord market PDA:", wordMarketPda.toBase58());
  console.log("YES mint:", yesMint.toBase58());
  console.log("NO mint:", noMint.toBase58());
  console.log("Vault:", vault.toBase58());

  // ── Create ATAs (deployer pays) ─────────────────────────
  console.log("\nCreating/fetching ATAs...");

  const yesBuyerYesAta = await getOrCreateAssociatedTokenAccount(
    connection,
    deployer, // payer
    yesMint,
    yesBuyerPk
  );
  console.log("YES buyer YES ATA:", yesBuyerYesAta.address.toBase58());

  const noBuyerNoAta = await getOrCreateAssociatedTokenAccount(
    connection,
    deployer, // payer
    noMint,
    noBuyer.publicKey
  );
  console.log("NO buyer NO ATA:", noBuyerNoAta.address.toBase58());

  // ── Call settle_match ───────────────────────────────────
  // price in lamports: e.g. 0.5 SOL = 500_000_000 lamports
  const priceLamports = new BN(Math.floor(price * LAMPORTS_PER_SOL));
  // amount in token base units (6 decimals): e.g. 1 share = 1_000_000
  const amount = new BN(Math.floor(shares * 1_000_000));

  console.log(
    `\nSettling: ${shares} shares at price ${price} SOL (${priceLamports.toString()} lamports)...`
  );

  await program.methods
    .settleMatch(priceLamports, amount)
    .accounts({
      backend: deployer.publicKey,
      wordMarket: wordMarketPda,
      yesBuyerEscrow: yesBuyerEscrow,
      yesBuyer: yesBuyerPk,
      yesBuyerTokenAccount: yesBuyerYesAta.address,
      noBuyerEscrow: noBuyerEscrow,
      noBuyer: noBuyer.publicKey,
      noBuyerTokenAccount: noBuyerNoAta.address,
      yesMint,
      noMint,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([deployer])
    .rpc();

  console.log("settle_match confirmed!");

  // ── Verify results ──────────────────────────────────────
  const marketAccount = await program.account.wordMarket.fetch(wordMarketPda);
  console.log(
    "\nMarket total collateral:",
    marketAccount.totalCollateral.toString(),
    "lamports",
    `(${marketAccount.totalCollateral.toNumber() / LAMPORTS_PER_SOL} SOL)`
  );

  const yesEscrowAccount = await program.account.userEscrow.fetch(
    yesBuyerEscrow
  );
  console.log(
    "YES buyer escrow balance:",
    yesEscrowAccount.balance.toString(),
    "lamports"
  );

  const noEscrowAccount = await program.account.userEscrow.fetch(
    noBuyerEscrow
  );
  console.log(
    "NO buyer escrow balance:",
    noEscrowAccount.balance.toString(),
    "lamports"
  );

  // Check token balances
  const yesBuyerYesBalance = await connection.getTokenAccountBalance(
    yesBuyerYesAta.address
  );
  console.log(
    "\nYES buyer YES tokens:",
    yesBuyerYesBalance.value.uiAmountString
  );

  const noBuyerNoBalance = await connection.getTokenAccountBalance(
    noBuyerNoAta.address
  );
  console.log("NO buyer NO tokens:", noBuyerNoBalance.value.uiAmountString);

  console.log("\nDone! Settlement successful.");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
