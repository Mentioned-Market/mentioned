# Mentioned

Trade on what gets said!

Mentioned is a prediction market platform on Solana where users trade YES/NO outcomes on whether specific words will be mentioned in live events — speeches, podcasts, earnings calls, and more.

## Current State

### Frontend (live on devnet)
- Next.js 14 app with two trading modes: **Normal** (simple buy/sell) and **Pro** (charts, detailed order flow)
- Phantom wallet integration via Wallet Standard (`@solana/kit`)
- Dynamic market pages with real on-chain LMSR pricing
- Admin panel for market creation, liquidity management, and resolution
- User profile with positions, cost basis, trade history, and claim flow
- Trade event indexer via Helius webhooks into Postgres

### Solana Contracts (deployed to devnet)
- **mention-market-amm** — Active AMM contract with LMSR pricing (`2oKQaiKx3C2qpkqFYGDdvEGTyBDJP85iuQtJ5vaPdFrU`)
- **mention-market** — Legacy CLOB contract (`AJ4XSwJoh2C8vmd8U7xhpzMkzkZZPaBRpbfpkmm4DmeN`)
- Per-word binary LMSR with shared liquidity pool, up to 8 words per market
- Full instruction set: deposit, withdraw, create_market, pause_market, buy, sell, deposit_liquidity, withdraw_liquidity, resolve_word, redeem
- All instructions emit Anchor events for indexer support

## Project Structure

```
app/                    Next.js App Router pages
  page.tsx              Landing page
  admin/                Market creation, liquidity, resolution
  market/[id]/          Dynamic market trading page
  markets/              Market listing
  profile/              User positions, history, claims
  waitlist/             Waitlist signup
  api/                  API routes (waitlist, webhook, trades)

components/             React components
  Header.tsx            Nav with wallet connect, escrow balance, positions
  MarketCard.tsx        Market preview cards
  MarketChart.tsx       LMSR price chart
  DepositModal.tsx      SOL deposit/withdraw modal
  FlashValue.tsx        Animated value transitions
  CountdownTimer.tsx    Event countdown
  Footer.tsx            Site footer
  WalletProviderWrapper.tsx  Wallet context wrapper

contexts/
  WalletContext.tsx      Phantom wallet provider (Wallet Standard, devnet)

lib/
  mentionMarket.ts      Solana program SDK (instruction builders, LMSR math, data fetching)
  seo-schemas.ts        SEO structured data
  rich-snippets.ts      Schema.org snippets

solana_contracts/
  programs/
    mention-market-amm/ Active AMM program (LMSR pricing)
    mention-market/     Legacy CLOB program
  tests/                Integration tests

docs/                   Project documentation (Docsify)
```

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Tech Stack

- **Frontend:** Next.js 14, React 18, TypeScript, Tailwind CSS
- **Blockchain:** Solana, Anchor 0.31.1, @solana/kit, SPL Token
- **Wallet:** Phantom (via Wallet Standard)
- **Backend:** Supabase, Railway Postgres (indexer)
- **Indexing:** Helius webhooks

## Documentation

Full docs at [`docs/`](docs/) — run with [Docsify](https://docsify.js.org/) or browse the markdown files directly.
