# Indexer — Trade Event Pipeline

Helius webhook → Next.js API routes → Railway Postgres. All trade events from the AMM contract are indexed in real-time and served via REST API.

---

## Architecture

```
Solana Devnet
    │  transactions
    ▼
Helius Webhook (rawDevnet)
    │  POST /api/webhook
    ▼
Next.js API Route
    │  parse TradeEvent from logs
    │  determine buy/sell
    │  INSERT INTO trade_events
    ▼
Railway Postgres
    │  indexed by market, trader, word
    ▼
Frontend
    GET /api/trades → charts, history, P&L
```

---

## Current API Endpoints

### POST /api/webhook

Receives Helius webhook payloads containing Solana transactions. Extracts TradeEvent Anchor events from transaction logs, determines buy vs sell, and inserts into Postgres.

**Helius config:**
- Webhook type: `rawDevnet`
- Account filter: `2oKQaiKx3C2qpkqFYGDdvEGTyBDJP85iuQtJ5vaPdFrU` (AMM program)
- Transaction types: `ANY`

**Request:** Array of raw transaction objects from Helius

**Response:**
```json
{ "ok": true, "inserted": 3, "skipped": 0 }
```

**Buy/sell detection:** Events are sorted chronologically, then for each event the global quantity for that word is compared before and after — if the relevant side's quantity increased, it's a buy.

**Deduplication:** Uses `ON CONFLICT (signature, market_id, word_index, trader) DO NOTHING` so Helius retries are safe.

---

### GET /api/trades

Query indexed trades by market or trader.

**Parameters:**

| Param | Required | Description |
|---|---|---|
| `marketId` | One of marketId or trader | Filter by market ID |
| `trader` | One of marketId or trader | Filter by trader pubkey |
| `limit` | No (default 100, max 500) | Number of results |
| `before` | No | ISO timestamp for pagination cursor |

**Examples:**
```
GET /api/trades?marketId=2&limit=50
GET /api/trades?trader=6yxf4RZf...&limit=50&before=2026-02-17T00:00:00Z
```

**Response:**
```json
{
  "trades": [
    {
      "signature": "5abc...",
      "marketId": "2",
      "wordIndex": 1,
      "direction": "YES",
      "isBuy": true,
      "quantity": 0.5,
      "cost": 0.283,
      "fee": 0.0014,
      "newYesQty": 0.5,
      "newNoQty": 0,
      "impliedPrice": 0.541,
      "trader": "6yxf4RZf...",
      "timestamp": "2026-02-18T14:07:16.000Z"
    }
  ],
  "cursor": "2026-02-18T14:07:16.000Z"
}
```

Results are ordered newest-first. Use `cursor` as the `before` param for the next page.

---

### GET /api/trades/chart

Price chart data for a specific word in a market. Returns trades oldest-first for charting.

**Parameters:**

| Param | Required | Description |
|---|---|---|
| `marketId` | Yes | Market ID |
| `wordIndex` | No (default 0) | Word index within the market |
| `limit` | No (default 500, max 1000) | Number of data points |

**Example:**
```
GET /api/trades/chart?marketId=2&wordIndex=0&limit=500
```

**Response:**
```json
{
  "points": [
    {
      "timestamp": "2026-02-16T19:26:15.000Z",
      "impliedPrice": 0.533,
      "direction": "YES",
      "quantity": 0.4,
      "cost": 0.207
    }
  ]
}
```

---

## Database Schema

```sql
CREATE TABLE trade_events (
  id            SERIAL PRIMARY KEY,
  signature     TEXT NOT NULL,
  market_id     BIGINT NOT NULL,
  word_index    SMALLINT NOT NULL,
  direction     SMALLINT NOT NULL,  -- 0=YES, 1=NO
  is_buy        BOOLEAN NOT NULL,
  quantity      NUMERIC NOT NULL,   -- shares (after /1e9)
  cost          NUMERIC NOT NULL,   -- SOL (after /1e9)
  fee           NUMERIC NOT NULL,
  new_yes_qty   NUMERIC NOT NULL,
  new_no_qty    NUMERIC NOT NULL,
  implied_price NUMERIC NOT NULL,   -- 0..1
  trader        TEXT NOT NULL,
  block_time    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE UNIQUE INDEX idx_trade_sig_unique ON trade_events(signature, market_id, word_index, trader);
CREATE INDEX idx_trade_market ON trade_events(market_id, block_time);
CREATE INDEX idx_trade_trader ON trade_events(trader, block_time);
CREATE INDEX idx_trade_word   ON trade_events(market_id, word_index);
```

---

## TradeEvent Binary Layout

The on-chain contract emits Anchor events via `emit!()`. These appear in transaction logs as `"Program data: <base64>"`. After base64 decode, the binary layout is:

```
Bytes 0-7:    Event discriminator [189, 219, 127, 211, 78, 230, 97, 238]
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

Total: 106 bytes.

---

## Scripts

### Migration
```bash
npx tsx scripts/migrate.ts
```
Creates the `trade_events` table and indexes. Safe to run multiple times (uses `IF NOT EXISTS`).

### Backfill
```bash
npx tsx scripts/backfill.ts
```
Fetches all historical transactions from the AMM program via Solana RPC, extracts TradeEvents, and inserts them into Postgres. Handles deduplication via `ON CONFLICT`. Run once after initial setup to index trades that occurred before the webhook was registered.

---

## Files

| File | Purpose |
|---|---|
| `lib/tradeParser.ts` | Base64 → binary → ParsedTradeEvent decoder |
| `lib/db.ts` | Postgres connection pool + insert/query functions |
| `app/api/webhook/route.ts` | POST endpoint for Helius webhooks |
| `app/api/trades/route.ts` | GET endpoint for querying trades |
| `app/api/trades/chart/route.ts` | GET endpoint for chart data |
| `scripts/migrate.ts` | Database schema migration |
| `scripts/backfill.ts` | Historical trade backfill from on-chain |

---

## Frontend Integration

The frontend calls the indexer API instead of parsing on-chain transaction logs:

| Before (RPC) | After (Indexer) |
|---|---|
| `getSignaturesForAddress` → batch `getTransaction` → parse logs | `fetch('/api/trades?marketId=X')` |
| Scan entire program history for user trades | `fetch('/api/trades?trader=X')` |
| ~5-15 RPC calls per page load | 1 HTTP call per query |

Functions updated in `lib/mentionMarket.ts`:
- `fetchTradeHistory(marketId)` — chart data and trade feed
- `fetchUserTradeHistory(userAddr)` — profile page history and cost basis

---

## Future Scalability Improvements

### Pre-aggregated candle data (OHLC buckets)

Instead of sending every raw trade to the client for charting, pre-compute OHLC (Open/High/Low/Close) candles at standard intervals (1m, 5m, 1h, 1d). This can be done:

- **On insert**: Update a `candles` table whenever a new trade arrives via webhook
- **Periodically**: A cron job aggregates raw trades into candle buckets

New table:
```sql
CREATE TABLE candles (
  market_id     BIGINT NOT NULL,
  word_index    SMALLINT NOT NULL,
  interval      TEXT NOT NULL,        -- '1m', '5m', '1h', '1d'
  bucket_start  TIMESTAMPTZ NOT NULL,
  open_price    NUMERIC NOT NULL,
  high_price    NUMERIC NOT NULL,
  low_price     NUMERIC NOT NULL,
  close_price   NUMERIC NOT NULL,
  volume        NUMERIC NOT NULL,     -- total shares traded
  trade_count   INTEGER NOT NULL,
  PRIMARY KEY (market_id, word_index, interval, bucket_start)
);
```

New endpoint:
```
GET /api/candles?marketId=2&wordIndex=0&interval=5m&from=2026-02-16&to=2026-02-18
```

This reduces payload size from thousands of raw trades to hundreds of candle points.

### WebSocket push for real-time updates

Replace the 15-second `setInterval` polling with WebSocket connections for instant price updates:

- Use a WebSocket server (Socket.io, or Vercel's edge runtime with WebSocket support)
- When the webhook inserts a new trade, broadcast to all connected clients subscribed to that market
- Client receives: `{ type: 'trade', marketId: 2, wordIndex: 0, impliedPrice: 0.62, ... }`
- Charts update instantly, trade feed shows new entries without delay

This eliminates ~4 RPC calls per user every 15 seconds and gives sub-second updates.

### Caching frequently-requested data

Add a caching layer for hot queries:

- **Latest prices per market**: Cache in-memory or Redis, update on each webhook insert. Avoids hitting Postgres for the most common query.
- **Market summary**: Total volume, 24h change, number of trades — compute once per minute, cache the result.
- **CDN caching**: For public endpoints like `/api/trades/chart`, set `Cache-Control` headers (e.g., `max-age=10`) so Vercel's edge CDN serves cached responses.

### Index additional event types

The contract emits other events that could be indexed with the same pipeline:

| Event | Use Case |
|---|---|
| `MarketCreatedEvent` | Market discovery, creation history |
| `EscrowEvent` | Deposit/withdrawal tracking |
| `MarketPausedEvent` | Market lifecycle tracking |
| `LiquidityEvent` | LP analytics, pool depth charts |
| `ResolutionEvent` | Outcome history, resolver activity |
| `RedemptionEvent` | Claim tracking, settlement data |

Each event has its own Anchor discriminator. Add discriminator checks to the parser and corresponding tables.

### Account state indexing

Add a second webhook (or expand the existing one) to watch `MarketAccount` state changes. On each account update, deserialize the MarketAccount and upsert into a `markets` table. This replaces the `getProgramAccounts` call that currently fetches all markets on every page load.
