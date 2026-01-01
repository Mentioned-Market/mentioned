import { Connection, PublicKey } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('G11AaYPenVJw7MzbYLX6rp1USGhjRZwQ8eTgAu6G4pnk');
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

async function verifyDeployment() {
  console.log('🔍 Verifying Order Book Contract Deployment...\n');
  
  try {
    // Check if program exists
    const programInfo = await connection.getAccountInfo(PROGRAM_ID);
    
    if (!programInfo) {
      console.log('❌ Program not found on devnet');
      process.exit(1);
    }
    
    console.log('✅ Program Found!');
    console.log(`📍 Program ID: ${PROGRAM_ID.toString()}`);
    console.log(`💾 Data Length: ${programInfo.data.length} bytes`);
    console.log(`💰 Account Balance: ${programInfo.lamports / 1e9} SOL`);
    console.log(`👤 Owner: ${programInfo.owner.toString()}`);
    console.log(`🔧 Executable: ${programInfo.executable}`);
    
    // Check if it's a BPF program
    const isBPFProgram = programInfo.owner.toString() === 'BPFLoaderUpgradeab1e11111111111111111111111';
    console.log(`📦 Is BPF Program: ${isBPFProgram ? '✅' : '❌'}`);
    
    if (isBPFProgram) {
      console.log('\n🎉 ORDER BOOK CONTRACT SUCCESSFULLY DEPLOYED TO DEVNET!');
      console.log('\n📋 Next Steps:');
      console.log('1. ✅ Contract deployed');
      console.log('2. ✅ Frontend updated with program ID');
      console.log('3. 🔲 Create test event and markets');
      console.log('4. 🔲 Test complete trading flow');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

verifyDeployment();

