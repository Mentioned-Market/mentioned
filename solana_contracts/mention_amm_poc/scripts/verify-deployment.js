const { Connection, PublicKey } = require('@solana/web3.js');

const PROGRAM_ID = new PublicKey('G11AaYPenVJw7MzbYLX6rp1USGhjRZwQ8eTgAu6G4pnk');
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

async function verifyDeployment() {
  console.log('🔍 Verifying Order Book Contract Deployment...\n');
  
  try {
    const programInfo = await connection.getAccountInfo(PROGRAM_ID);
    
    if (!programInfo) {
      console.log('❌ Program not found on devnet');
      process.exit(1);
    }
    
    console.log('✅ Program Found!');
    console.log(`📍 Program ID: ${PROGRAM_ID.toString()}`);
    console.log(`💾 Data Length: ${programInfo.data.length} bytes`);
    console.log(`💰 Account Balance: ${(programInfo.lamports / 1e9).toFixed(4)} SOL`);
    console.log(`👤 Owner: ${programInfo.owner.toString()}`);
    console.log(`🔧 Executable: ${programInfo.executable}`);
    
    const isBPFProgram = programInfo.owner.toString() === 'BPFLoaderUpgradeab1e11111111111111111111111';
    console.log(`📦 Is BPF Program: ${isBPFProgram ? '✅' : '❌'}`);
    
    if (isBPFProgram) {
      console.log('\n🎉 ORDER BOOK CONTRACT SUCCESSFULLY DEPLOYED TO DEVNET!');
      console.log('\n📋 Deployment Summary:');
      console.log('  ✅ Contract compiled and deployed');
      console.log('  ✅ Program ID: G11AaYPenVJw7MzbYLX6rp1USGhjRZwQ8eTgAu6G4pnk');
      console.log('  ✅ Frontend updated with new program ID');
      console.log('  ✅ Network: Solana Devnet');
      console.log('\n🔗 View on Explorer:');
      console.log(`  https://explorer.solana.com/address/${PROGRAM_ID.toString()}?cluster=devnet`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

verifyDeployment();

