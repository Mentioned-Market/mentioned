# Indexer Plan — Helius Webhooks + Postgres on Devnet

Plan for setting up a Helius webhook to capture `TradeEvent` Anchor events from the AMM program on devnet, persisting them to Postgres, and exposing them via a REST API. This is the same architecture we'd use in production.

---

## Prerequisites

| Item | Details |
|---|---|
| Helius account | Sign up at [helius.dev](https://helius.dev) — free tier includes devnet webhooks |
| Helius API key | Generate from the Helius dashboard after signup |
| Railway account | Sign up at [railway.app](https://railway.app) — free tier covers a small server + Postgres |
| Node.js | 18+ for the webhook receiver |
| AMM Program ID | `2oKQaiKx3C2qpkqFYGDdvEGTyBDJP85iuQtJ5vaPdFrU` (devnet) |

---

## What we're capturing

All instructions now emit Anchor events via `emit!()`. These events are embedded in transaction log messages as base64-encoded data prefixed with `"Program data: "`. They don't exist as on-chain accounts — they only exist in transaction metadata.

### All event types

| Instruction | Event | Key Fields |
|---|---|---|
| create_market | MarketCreatedEvent | market_id, label, num_words, authority, resolver, resolves_at, trade_fee_bps, initial_b, timestamp |
| deposit | EscrowEvent | user, action (Deposit), amount, new_balance, timestamp |
| withdraw | EscrowEvent | user, action (Withdraw), amount, new_balance, timestamp |
| pause_market | MarketPausedEvent | market_id, paused (bool), authority, timestamp |
| buy | TradeEvent | market_id, word_index, direction, quantity, cost, fee, new_yes_qty, new_no_qty, implied_yes_price, trader, timestamp |
| sell | TradeEvent | (same as buy) |
| deposit_liquidity | LiquidityEvent | (existing) |
| withdraw_liquidity | LiquidityEvent | (existing) |
| resolve_word | ResolutionEvent | (existing) |
| redeem | RedemptionEvent | (existing) |

For the initial proof of concept, we focus on `TradeEvent` since that's the highest-volume and most immediately useful for the frontend (charts, history, cost basis). The other events can be indexed with the same parsing approach once the pipeline is proven.

### TradeEvent structure (Rust)

```rust
#[event]
pub struct TradeEvent {
    pub market_id: u64,
    pub word_index: u8,
    pub direction: Side,       // 0 = Yes, 1 = No
    pub quantity: u64,
    pub cost: u64,
    pub fee: u64,
    pub new_yes_qty: i64,
    pub new_no_qty: i64,
    pub implied_yes_price: u64,
    pub trader: Pubkey,
    pub timestamp: i64,
}
```

### Binary layout (106 bytes after base64 decode)

```
Bytes 0-7:    Event discriminator (sha256("event:TradeEvent")[0..8])
              → [189, 219, 127, 211, 78, 230, 97, 238]

Bytes 8-15:   market_id        (u64, little-endian)
Byte  16:     word_index       (u8)
Byte  17:     direction        (u8: 0=YES, 1=NO)
Bytes 18-25:  quantity          (u64 LE, divide by 1e9 for shares)
Bytes 26-33:  cost              (u64 LE, divide by 1e9 for SOL)
Bytes 34-41:  fee               (u64 LE, divide by 1e9 for SOL)
Bytes 42-49:  new_yes_qty       (i64 LE, divide by 1e9)
Bytes 50-57:  new_no_qty        (i64 LE, divide by 1e9)
Bytes 58-65:  implied_yes_price (u64 LE, divide by 1e9 for 0..1 price)
Bytes 66-97:  trader            (Pubkey, 32 bytes — base58 encode)
Bytes 98-105: timestamp         (i64 LE, unix seconds)
```

All u64/i64 quantities use 1e9 fixed-point scaling. Divide by `1_000_000_000` to get human-readable values.

---

## Step 1 — Provision Postgres on Railway

Railway gives you a managed Postgres instance with a connection string.

1. Create a new project on Railway
2. Add a **Postgres** plugin
3. Copy the `DATABASE_URL` from the plugin's Variables tab (looks like `postgresql://postgres:xxx@containers.railway.app:5432/railway`)

### Schema

Run this against the database to create the trade events table:

```sql
CREATE TABLE trade_events (
  id            SERIAL PRIMARY KEY,
  signature     TEXT NOT NULL UNIQUE,
  market_id     BIGINT NOT NULL,
  word_index    SMALLINT NOT NULL,
  direction     SMALLINT NOT NULL,  -- 0=YES, 1=NO
  quantity      NUMERIC NOT NULL,   -- shares (after /1e9)
  cost          NUMERIC NOT NULL,   -- SOL (after /1e9)
  fee           NUMERIC NOT NULL,
  new_yes_qty   NUMERIC NOT NULL,
  new_no_qty    NUMERIC NOT NULL,
  implied_price NUMERIC NOT NULL,   -- 0..1
  trader        TEXT NOT NULL,
  timestamp     TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_trade_market ON trade_events(market_id, timestamp);
CREATE INDEX idx_trade_trader ON trade_events(trader, timestamp);
CREATE INDEX idx_trade_word   ON trade_events(market_id, word_index);
```

The `UNIQUE` constraint on `signature` prevents duplicate inserts if Helius retries a delivery.

---

## Step 2 — Build and deploy the webhook receiver

A small Express/Hono server deployed to Railway that receives webhook POSTs, parses TradeEvents, and inserts them into Postgres.

### What the server does

1. Accept POST `/webhook` with JSON body from Helius
2. For each transaction in the payload, scan `logMessages` for `"Program data: "` entries
3. Base64-decode each data entry, check the first 8 bytes against the TradeEvent discriminator
4. If it matches, parse the remaining 98 bytes into the fields above
5. Insert the decoded event into the `trade_events` table
6. Return 200 to Helius (important — Helius retries on non-2xx responses)

### Helius webhook payload format

Helius sends an array of transaction objects. The relevant fields:

```json
[
  {
    "signature": "5abc...",
    "timestamp": 1700000000,
    "meta": {
      "logMessages": [
        "Program 2oKQai... invoke [1]",
        "Program data: vdt/004...",
        "Program 2oKQai... consumed 85000 of 200000 compute units",
        "Program 2oKQai... success"
      ]
    }
  }
]
```

The `"Program data: "` lines contain base64-encoded Anchor events. There may be multiple events per transaction (e.g. if a transaction contains multiple buy/sell instructions).

### Tech stack

- **Hono** or **Express** for the HTTP server
- **pg** (node-postgres) for Postgres queries
- **Single file** — the receiver + parser + insert logic is <150 lines
- `DATABASE_URL` injected via Railway environment variables

### Deploy to Railway

1. Add a **New Service** in the same Railway project as the Postgres plugin
2. Connect your repo (or use Railway's CLI to deploy a directory)
3. Railway auto-detects Node.js and runs `npm start`
4. Copy the public URL from the service's Settings → Networking (e.g. `https://mentioned-indexer.up.railway.app`)

This URL is stable — no ngrok, no tunnels, no URL updates.

---

## Step 3 — Register the webhook with Helius

Use the Helius API to create a webhook that watches the AMM program on devnet.

### API call

```
POST https://api.helius.xyz/v0/webhooks?api-key=<YOUR_API_KEY>
```

```json
{
  "webhookURL": "https://mentioned-indexer.up.railway.app/webhook",
  "transactionTypes": ["Any"],
  "accountAddresses": ["2oKQaiKx3C2qpkqFYGDdvEGTyBDJP85iuQtJ5vaPdFrU"],
  "webhookType": "raw",
  "encoding": "jsonParsed"
}
```

| Field | Value | Why |
|---|---|---|
| `webhookURL` | Railway service URL + `/webhook` | Stable public URL, no tunnel needed |
| `transactionTypes` | `["Any"]` | Catch all transactions touching the program |
| `accountAddresses` | AMM program ID | Filter to only our program |
| `webhookType` | `"raw"` | Get full transaction data including logs (enhanced mode strips logs) |
| `encoding` | `"jsonParsed"` | Easier to work with than base64 |

### Managing the webhook

```
# List webhooks
GET https://api.helius.xyz/v0/webhooks?api-key=<KEY>

# Update webhook URL
PUT https://api.helius.xyz/v0/webhooks/<WEBHOOK_ID>?api-key=<KEY>
{
  "webhookURL": "https://new-url.up.railway.app/webhook"
}

# Delete webhook
DELETE https://api.helius.xyz/v0/webhooks/<WEBHOOK_ID>?api-key=<KEY>
```

---

## Step 4 — Test with a real trade

1. Verify Railway service is running (check deploy logs)
2. Register the webhook with Helius (one curl command)
3. Open the Mentioned app on devnet and execute a buy or sell
4. Check the Railway service logs — you should see the parsed event
5. Query Postgres to confirm the row was inserted:

```sql
SELECT * FROM trade_events ORDER BY timestamp DESC LIMIT 5;
```

### Expected row

| Column | Value |
|---|---|
| market_id | 42 |
| word_index | 0 |
| direction | 0 (YES) |
| quantity | 1.5 |
| cost | 0.823 |
| fee | 0.008 |
| implied_price | 0.6225 |
| trader | `7xKXt...` |
| timestamp | 2025-02-17 14:30:00+00 |

---

## Step 5 — Add read API endpoints

Once events are flowing into Postgres, add GET endpoints to the same server so the frontend can query indexed data instead of parsing transaction logs.

### Endpoints

```
GET /api/trades?marketId=42&limit=50
```
Replaces `fetchTradeHistory()`. Returns trades for a specific market, ordered by timestamp descending. Paginate with `?before=<timestamp>` cursor.

```
GET /api/trades?trader=7xKXt...&limit=50
```
Replaces `fetchUserTradeHistory()`. Returns all trades by a specific user across all markets. This is the query that's currently unusable at scale (scans entire program history client-side).

```
GET /api/cost-basis?trader=7xKXt...
```
Replaces client-side `costBasisMap` computation. Server computes running cost basis per `(market, word, side)` from the indexed trade history and returns it pre-computed.

### Response format

```json
{
  "trades": [
    {
      "signature": "5abc...",
      "marketId": 42,
      "wordIndex": 0,
      "direction": "YES",
      "quantity": 1.5,
      "cost": 0.823,
      "fee": 0.008,
      "impliedPrice": 0.6225,
      "trader": "7xKXt...",
      "timestamp": "2025-02-17T14:30:00Z"
    }
  ],
  "cursor": "2025-02-17T14:29:00Z"
}
```

---

## Step 6 — Swap the frontend

Replace the client-side transaction log parsing with API calls:

| Current (client-side) | New (API) |
|---|---|
| `fetchTradeHistory(marketId, limit)` — fetches signatures, batch-fetches transactions, parses logs | `fetch('/api/trades?marketId=...')` — single HTTP call |
| `fetchUserTradeHistory(userAddr, limit)` — scans entire program history, filters client-side | `fetch('/api/trades?trader=...')` — single HTTP call |
| `costBasisMap` computed in `useMemo` from full trade history | `fetch('/api/cost-basis?trader=...')` — pre-computed server-side |

The frontend changes are minimal — swap the function implementations, keep the same types and UI.

---

## Architecture

```
Solana Devnet
    │
    │  transactions
    ▼
Helius Webhook
    │
    │  POST /webhook (JSON payload)
    ▼
┌──────────────────────────────────┐
│  Railway Service                 │
│  (Hono/Express)                  │
│                                  │
│  POST /webhook                   │
│    → parse TradeEvent from logs  │
│    → INSERT INTO trade_events    │
│                                  │
│  GET /api/trades                 │
│    → SELECT from trade_events    │
│                                  │
│  GET /api/cost-basis             │
│    → aggregate from trade_events │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  Railway Postgres                │
│                                  │
│  trade_events table              │
│  (indexed by market, trader,     │
│   word, timestamp)               │
└──────────────────────────────────┘
               │
               │  SQL queries
               ▼
         Frontend app
    (replaces RPC log parsing)
```

---

## What comes after this

### Account state indexing

Add a second webhook (or expand this one) to watch `MarketAccount` state changes. On each account update, deserialize the MarketAccount and upsert into a `markets` table. This replaces `getProgramAccounts` / `fetchAllMarkets()` on the frontend.

### WebSocket push

Once the indexer is the source of truth, add a WebSocket endpoint to the Railway service that pushes new trade events and price updates to connected frontends in real-time. Replaces the 15-second `setInterval` polling.

### Production scaling

The Railway setup is the same pattern as production. To scale:
- Move Postgres to a managed provider (Neon, Supabase, RDS) for connection pooling and backups
- Add Redis for caching frequent queries (market prices, leaderboard)
- Run multiple receiver instances behind Railway's built-in load balancer
- Add monitoring/alerting for missed webhook deliveries (Helius dashboard shows delivery status)

---

## Estimated effort

| Task | Time | Notes |
|---|---|---|
| Helius signup + API key | 10 min | Free tier is sufficient for devnet |
| Railway project + Postgres | 15 min | One-click Postgres plugin, run schema |
| Webhook receiver + deploy | 1 hour | Single file server, deploy via Railway CLI or Git |
| Register webhook with Helius | 5 min | One curl command |
| Test with live trade | 15 min | Execute a buy on devnet, verify DB row |
| **Total (events in Postgres)** | **~1.5 hours** | |
| Add read API endpoints | 2 hours | 3 GET routes + SQL queries |
| Swap frontend to use API | 2-3 hours | Replace fetch functions, keep same types |
| **Total (frontend integrated)** | **~5-6 hours** | |
