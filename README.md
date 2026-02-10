# Mentioned

Trade on what gets said.

Mentioned is a prediction market platform on Solana where users trade YES/NO outcomes on whether specific words will be mentioned in live events — speeches, podcasts, earnings calls, and more.

## Current State

### Frontend (working)
- Next.js 14 app with two trading modes: **Normal** (simple buy/sell) and **Pro** (order book, charts, limit orders)
- Phantom wallet integration with SOL balance display
- Event pages with word list, trading interface, order book, and live stream placeholder
- Demo market pages with mock data
- Solana admin panel for managing events/markets
- Landing page, waitlist, profile

### Solana Contracts (POC — not yet wired to frontend)
- Anchor programs in `solana_contracts/` with AMM and order book implementations
- Event lifecycle: Pending → Live → Ended → Resolved
- Bulk market creation, order matching, complete sets (mint/burn YES+NO)
- Deployed to devnet: `G11AaYPenVJw7MzbYLX6rp1USGhjRZwQ8eTgAu6G4pnk`

### What's next
- Unified hybrid AMM-CLOB Anchor program (porting the design from the previous Solidity contract)
- Wire Solana contracts to the frontend trading flows
- Deploy to devnet and test end-to-end

## Project Structure

```
app/                    Next.js App Router pages
  (home)/               Landing page
  admin/                Solana admin panel
  event/[id]/           Event trading page (normal + pro modes)
  market/[id]/          Market detail pages
  profile/              User profile
  waitlist/             Waitlist signup
  api/                  API routes (waitlist, sitemap)

components/             React components
  Header.tsx            Nav with Phantom wallet connect + SOL balance
  TradingInterface.tsx  Trading UI (Solana, needs contract wiring)
  OrderBook.tsx         Order book display
  TradingChart.tsx      Price chart
  QuickBuy.tsx          Quick trade widget
  CountdownTimer.tsx    Event countdown
  MarketCard.tsx        Market preview cards
  Ticker.tsx            Animated ticker feed

contexts/
  WalletContext.tsx      Phantom wallet provider (Solana devnet)

lib/
  program.ts            Solana program interaction utilities
  seo-schemas.ts        SEO structured data

solana_contracts/
  amm.rs                Standalone AMM implementation
  mention_amm_poc/      Anchor project
    programs/           Rust programs (AMM + order book)
    tests/              Integration tests
```

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Tech Stack

- **Frontend:** Next.js 14, React 18, TypeScript, Tailwind CSS
- **Blockchain:** Solana, Anchor, @solana/web3.js, SPL Token
- **Wallet:** Phantom
- **Backend:** Supabase
