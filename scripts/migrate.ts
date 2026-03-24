import 'dotenv/config'
import pg from 'pg'

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
})

const schema = `
CREATE TABLE IF NOT EXISTS trade_events (
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_sig_unique ON trade_events(signature, market_id, word_index, trader);
CREATE INDEX IF NOT EXISTS idx_trade_market ON trade_events(market_id, block_time);
CREATE INDEX IF NOT EXISTS idx_trade_trader ON trade_events(trader, block_time);
CREATE INDEX IF NOT EXISTS idx_trade_word   ON trade_events(market_id, word_index);

CREATE TABLE IF NOT EXISTS market_transcripts (
  id            SERIAL PRIMARY KEY,
  market_id     BIGINT NOT NULL UNIQUE,
  transcript    TEXT NOT NULL,
  source_url    TEXT,
  submitted_by  TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcript_market ON market_transcripts(market_id);

CREATE TABLE IF NOT EXISTS market_metadata (
  id            SERIAL PRIMARY KEY,
  market_id     BIGINT NOT NULL UNIQUE,
  image_url     TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metadata_market ON market_metadata(market_id);

CREATE TABLE IF NOT EXISTS user_profiles (
  id         SERIAL PRIMARY KEY,
  wallet     TEXT NOT NULL UNIQUE,
  username   TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_wallet ON user_profiles(wallet);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         SERIAL PRIMARY KEY,
  wallet     TEXT NOT NULL,
  username   TEXT NOT NULL,
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at DESC);

CREATE TABLE IF NOT EXISTS polymarket_trades (
  id            SERIAL PRIMARY KEY,
  wallet        TEXT NOT NULL,
  market_id     TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  is_yes        BOOLEAN NOT NULL,
  is_buy        BOOLEAN NOT NULL DEFAULT TRUE,
  side          TEXT NOT NULL,
  amount_usd    NUMERIC NOT NULL,
  tx_signature  TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_poly_trades_wallet ON polymarket_trades(wallet, created_at);
CREATE INDEX IF NOT EXISTS idx_poly_trades_created ON polymarket_trades(created_at);

CREATE TABLE IF NOT EXISTS point_events (
  id         SERIAL PRIMARY KEY,
  wallet     TEXT NOT NULL,
  action     TEXT NOT NULL,
  points     INTEGER NOT NULL,
  ref_id     TEXT,
  metadata   JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_point_events_wallet ON point_events(wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_point_events_action ON point_events(action, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_point_events_dedup ON point_events(wallet, action, ref_id) WHERE ref_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS event_streams (
  id         SERIAL PRIMARY KEY,
  event_id   TEXT NOT NULL UNIQUE,
  stream_url TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_chat_messages (
  id         SERIAL PRIMARY KEY,
  event_id   TEXT NOT NULL,
  wallet     TEXT NOT NULL,
  username   TEXT NOT NULL,
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_chat_event ON event_chat_messages(event_id, id);
CREATE INDEX IF NOT EXISTS idx_event_chat_created ON event_chat_messages(event_id, created_at DESC);

ALTER TABLE polymarket_trades ADD COLUMN IF NOT EXISTS market_title TEXT;

CREATE TABLE IF NOT EXISTS custom_markets (
  id              SERIAL PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT,
  cover_image_url TEXT,
  stream_url      TEXT,
  status          TEXT NOT NULL DEFAULT 'draft',
  lock_time       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_markets_status ON custom_markets(status);

CREATE TABLE IF NOT EXISTS custom_market_words (
  id               SERIAL PRIMARY KEY,
  market_id        INTEGER NOT NULL REFERENCES custom_markets(id) ON DELETE CASCADE,
  word             TEXT NOT NULL,
  resolved_outcome BOOLEAN
);

CREATE INDEX IF NOT EXISTS idx_custom_words_market ON custom_market_words(market_id);

CREATE TABLE IF NOT EXISTS custom_market_predictions (
  id          SERIAL PRIMARY KEY,
  market_id   INTEGER NOT NULL REFERENCES custom_markets(id) ON DELETE CASCADE,
  word_id     INTEGER NOT NULL REFERENCES custom_market_words(id) ON DELETE CASCADE,
  wallet      TEXT NOT NULL,
  prediction  BOOLEAN NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_pred_unique ON custom_market_predictions(market_id, word_id, wallet);
CREATE INDEX IF NOT EXISTS idx_custom_pred_market ON custom_market_predictions(market_id);
CREATE INDEX IF NOT EXISTS idx_custom_pred_wallet ON custom_market_predictions(wallet, market_id);
CREATE INDEX IF NOT EXISTS idx_custom_pred_word ON custom_market_predictions(word_id);
`

async function main() {
  console.log('Running migration...')
  await pool.query(schema)
  console.log('Migration complete.')
  await pool.end()
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
