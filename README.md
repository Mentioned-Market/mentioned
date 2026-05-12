# Mentioned

> Trade on what gets said.

Mentioned is a Solana-based prediction market platform where users trade YES/NO outcomes on whether specific words or phrases get mentioned during live events — speeches, podcasts, earnings calls, streamed games. Instead of trading "will X win the election," you trade "will the president say 'tariff' in tonight's address."

Three market types share one product:

- **Free markets** — virtual play-token markets (LMSR AMM) with no real money. Profit converts to platform points. Lowest floor to entry; Discord-linked accounts only.
- **Polymarket** — full event-prediction markets via Jupiter's Prediction API (real USDC, real Solana).
- **On-chain mention markets** — custom LMSR AMM deployed on Solana devnet in devnet USDC. Settles on-chain.

A separate transcript worker service captures live Twitch/YouTube audio in real time, transcribes it via Deepgram, detects word matches, and feeds admins everything they need to resolve markets.

## Tech stack

- **Frontend:** Next.js 14 (App Router), React 18, TypeScript, Tailwind
- **Blockchain:** Solana via `@solana/kit` v2, Anchor 0.31.1, Phantom wallet (Wallet Standard), Privy embedded wallets
- **Database:** PostgreSQL 16 (Railway prod, Docker local), raw SQL via `pg`
- **Real-time:** Postgres `LISTEN/NOTIFY` + SSE for chat and live mention feeds
- **External APIs:** Jupiter Prediction API, Helius webhooks, Deepgram (Nova-3), Discord
- **Infra:** Railway for hosting, Cloudflare in front

## Repo layout

```
app/                   Next.js App Router pages + API routes
components/            React components
contexts/              Wallet + achievement React contexts
lib/                   DB queries, LMSR math, SDK, shared utilities
  ├─ db.ts             All Postgres queries (parameterized, typed)
  ├─ mentionMarketUsdc.ts   Client SDK for the on-chain USDC AMM
  ├─ virtualLmsr.ts    Float-based LMSR for free markets
  └─ tradeParser.ts    Helius webhook → trade_events parser
scripts/               DB migration, seed, backfill utilities
services/
  └─ transcript-worker/    Sibling Node service for live + VOD transcription
                           (own package.json, own Railway deploy)
solana_contracts/      Anchor workspace
  └─ programs/mention-market-usdc-amm/   Active program (devnet)
specs/                 Feature specifications
```

## On-chain program

`mention-market-usdc-amm` is the active Anchor program. Source is in `solana_contracts/programs/mention-market-usdc-amm/`.

- **Program ID (devnet):** `9kSuebrHKKnFsgFcv5fc8S2gBazHA9Gki2NEWt2ft9tk`
- **Settlement currency:** Devnet USDC (6 decimals)
- **Pricing:** Per-word binary LMSR with a shared liquidity pool. Up to 8 words per market.
- **Instructions:** `create_market`, `deposit_liquidity`, `withdraw_liquidity`, `buy`, `sell`, `resolve_word`, `redeem`, `pause_market`, `withdraw_fees`
- **Events:** Anchor events on every trade; indexed via Helius webhooks into `trade_events`.

> The on-chain trading UI lives on the `feat/add-paid-markets` branch and isn't user-facing yet. Main has the program source, the Anchor test suite, the client SDK (`lib/mentionMarketUsdc.ts`), and the read API (`app/api/paid-markets/*`).

## Getting started (local dev)

Prereqs: Node 20+, Docker, Anchor 0.31.1 (for contract work), `solana-cli`.

```bash
# 1. Install
npm install

# 2. Set up env
cp .env.example .env.local
# Edit .env.local — at minimum: NEXT_PUBLIC_PRIVY_APP_ID, PRIVY_APP_SECRET,
# SESSION_SECRET, HELIUS_RPC_URL, JUPITER_API_KEY.

# 3. Start Postgres + run migrations + seed
npm run db:start

# 4. Run the dev server
npm run dev
```

Open <http://localhost:3000>.

### Optional: transcript worker

The transcript worker runs as its own Node process. Local dev:

```bash
cd services/transcript-worker
cp .env.example .env
# Edit .env — at minimum: DATABASE_URL, DEEPGRAM_API_KEY.
npm install
npm run dev
```

See `services/transcript-worker/.env.example` for the full env reference. The worker shares the Next.js app's Postgres database; no HTTP between them.

### Optional: Anchor program

```bash
cd solana_contracts
anchor build
anchor test
```

## Architecture notes

- **No ORM.** Raw SQL via `pg` pool in `lib/db.ts`. Every query is parameterized.
- **No global state manager.** React Context for wallet + achievements. Component-level `useState`/`useEffect` for everything else.
- **Wallet auth.** Phantom (Wallet Standard) for power users, Privy embedded wallets for new users. Server-side auth verifies wallet signatures.
- **Real-time fanout.** Chat and live transcription mentions use Postgres `LISTEN/NOTIFY` with SSE delivery. Singletons survive Next.js hot reloads via `globalThis`.
- **Webhook-driven indexing.** On-chain trades index via Helius → `/api/webhook` → `tradeParser.ts` → `trade_events`.
- **Two-step admin actions.** Admin checks happen via `ADMIN_WALLETS` env var (lib/adminAuth.ts). Sensitive admin actions log to `admin_audit_log`.

For deeper context on specific subsystems:

- `specs/custom_free_market_spec.md` — free markets (LMSR math, scoring, resolution)
- `specs/live_transcription_spec.md` — transcript worker (pipelines, NOTIFY contracts, cost guards)
- `CLAUDE.md` — architectural reference written for both humans and AI assistants

## Status

Devnet-deployed. The on-chain USDC AMM is live on devnet. Free markets are live. Polymarket integration is live. The transcript worker runs in production for live event coverage.

## License

MIT — see [LICENSE](LICENSE).

---

Built by [Mentioned](https://mentioned.market). Submitted to the [Colosseum](https://colosseum.org) Solana hackathon.
