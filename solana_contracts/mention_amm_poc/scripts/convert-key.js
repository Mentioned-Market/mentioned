const bs58 = require('bs58');
const fs = require('fs');
const path = require('path');

// Your private key
const privKeyString = "2Dfpja89ocTqvE4f1wgGKhJshhH9qCahPHD8qSHxiU5VZgPXxEZt1TAZGgUwULWu6RCGDDdxY435BDjSfuNotU7";

try {
  // Decode base58 to bytes
  const decoded = bs58.decode(privKeyString);
  
  // Convert to JSON array format for Solana CLI
  const jsonArray = JSON.stringify(Array.from(decoded));
  
  // Ensure .config/solana directory exists
  const solanaDir = path.join(process.env.HOME, '.config', 'solana');
  if (!fs.existsSync(solanaDir)) {
    fs.mkdirSync(solanaDir, { recursive: true });
  }
  
  // Write to file
  const keypairPath = path.join(solanaDir, 'id.json');
  fs.writeFileSync(keypairPath, jsonArray);
  
  console.log("✅ Keypair file created successfully!");
  console.log(`📁 Location: ${keypairPath}`);
  console.log(`📊 Array length: ${decoded.length} bytes`);
  
  // Try to get the public key using solana-web3.js
  const { Keypair } = require('@solana/web3.js');
  const keypair = Keypair.fromSecretKey(decoded);
  console.log(`🔑 Public Key: ${keypair.publicKey.toString()}`);
  
} catch (error) {
  console.error("❌ Error:", error.message);
  process.exit(1);
}

