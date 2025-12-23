# 🎯 Prediction Market Admin Panel

A Next.js admin dashboard for managing Solana prediction markets deployed on devnet.

## Features

✅ **Create Events** - Set up prediction events with unique IDs
✅ **Create Markets** - Add markets for specific words (e.g., "Mexico", "Left", "Taxes")  
✅ **Resolve Markets** - Mark markets as YES or NO after events conclude  
✅ **View All Markets** - Dashboard showing all your events and markets  
✅ **Wallet Integration** - Connect with Phantom, Solflare, and other Solana wallets  

## Setup

The app is already set up and running!

### Access the Admin Panel

```bash
cd admin-panel
npm run dev
```

Then open: **http://localhost:3001**

## Program Details

- **Program ID**: `F8EsP2rp6FBuaTfKQ8ywx4hqhM3YpcJr4HPkXHeGsZyJ`
- **Network**: Solana Devnet
- **RPC**: `https://api.devnet.solana.com`

## How to Use

### 1. Connect Your Wallet
- Click "Select Wallet" in the top right
- Choose Phantom or Solflare
- Approve the connection
- Make sure you have SOL on Devnet ([Get Devnet SOL](https://faucet.solana.com/))

### 2. Create an Event
- Enter a unique Event ID (e.g., use the suggested timestamp)
- Click "Create Event"
- Wait for transaction confirmation

### 3. Create Markets
- Enter the Event ID you just created
- Add a word to track (e.g., "Mexico", "Left", "Taxes")
- Set the fee in basis points (100 = 1%)
- Click "Create Market"

### 4. Create "Trump's Speech" Markets

Example flow:
```
Event ID: 1234567890 (use timestamp)
Markets:
  - Word: Mexico, Fee: 100bp
  - Word: Left, Fee: 100bp  
  - Word: Taxes, Fee: 100bp
```

### 5. Resolve Markets (After Event)
- Once your event concludes, click "Resolve YES" or "Resolve NO"
- Users can then redeem their winning tokens

## Architecture

### Program Instructions

- `initialize_event` - Create a new prediction event
- `initialize_market` - Create a market for a specific word
- `add_liquidity` - Bootstrap market with SOL/tokens
- `mint_set` - Create YES+NO token pairs
- `buy_yes_with_sol` / `buy_no_with_sol` - Purchase tokens
- `swap` - Trade between YES and NO
- `resolve_market` - Mark winners
- `redeem` - Claim winnings

### File Structure

```
admin-panel/
├── app/
│   ├── page.tsx          # Main dashboard
│   └── layout.tsx        # Root layout with wallet provider
├── components/
│   └── WalletContextProvider.tsx  # Solana wallet setup
├── lib/
│   └── program.ts        # Program utilities and instructions
└── next.config.ts        # Next.js configuration
```

## Development

### Install Dependencies
```bash
npm install
```

### Run Development Server
```bash
npm run dev
```

### Build for Production
```bash
npm run build
npm start
```

## Troubleshooting

### "Insufficient funds" error
- Request SOL from devnet faucet: https://faucet.solana.com/
- Your wallet address is shown in the admin panel

### "Event not found" when creating market
- Make sure you created the event first
- Use the exact Event ID from the event you created

### Transaction failed
- Check that you have enough SOL (~0.01 SOL per transaction)
- Ensure you're connected to Devnet
- Try refreshing the page and reconnecting wallet

## Next Steps

### For Full Functionality:
1. **Add Market Tracking** - Store event/market IDs in a database
2. **Create Token Mints** - Add UI to create YES/NO token mints
3. **Add Liquidity UI** - Interface for bootstrapping markets with SOL
4. **User Trading Interface** - Separate UI for users to buy/sell
5. **Oracle Integration** - Automated market resolution based on events

## Resources

- [Solana Documentation](https://docs.solana.com/)
- [Solana Web3.js](https://solana-labs.github.io/solana-web3.js/)
- [Next.js Documentation](https://nextjs.org/docs)

## Support

Built for the Mentioned prediction markets platform on Solana.

Program deployed at: `F8EsP2rp6FBuaTfKQ8ywx4hqhM3YpcJr4HPkXHeGsZyJ`
