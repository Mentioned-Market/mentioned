import 'dotenv/config'
import pg from 'pg'

const dbUrl = process.env.DATABASE_URL ?? ''
const sslDisabled = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')
  || dbUrl.includes('sslmode=disable') || process.env.DB_SSL === 'false'

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: sslDisabled ? false : { rejectUnauthorized: false },
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

-- Virtual LMSR refactor: add AMM columns to custom_markets
ALTER TABLE custom_markets ADD COLUMN IF NOT EXISTS b_parameter NUMERIC(10,2) NOT NULL DEFAULT 500;
ALTER TABLE custom_markets ADD COLUMN IF NOT EXISTS play_tokens INTEGER NOT NULL DEFAULT 1000;

-- Drop old boolean prediction model (replaced by positions + balances)
DROP TABLE IF EXISTS custom_market_predictions;

-- LMSR pool state per word
CREATE TABLE IF NOT EXISTS custom_market_word_pools (
  word_id       INTEGER PRIMARY KEY REFERENCES custom_market_words(id) ON DELETE CASCADE,
  yes_qty       NUMERIC(18,6) NOT NULL DEFAULT 0,
  no_qty        NUMERIC(18,6) NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_pool_yes_non_negative CHECK (yes_qty >= 0),
  CONSTRAINT chk_pool_no_non_negative CHECK (no_qty >= 0)
);

-- User share holdings per word
CREATE TABLE IF NOT EXISTS custom_market_positions (
  id               SERIAL PRIMARY KEY,
  market_id        INTEGER NOT NULL REFERENCES custom_markets(id) ON DELETE CASCADE,
  word_id          INTEGER NOT NULL REFERENCES custom_market_words(id) ON DELETE CASCADE,
  wallet           TEXT NOT NULL,
  yes_shares       NUMERIC(18,6) NOT NULL DEFAULT 0,
  no_shares        NUMERIC(18,6) NOT NULL DEFAULT 0,
  tokens_spent     NUMERIC(18,6) NOT NULL DEFAULT 0,
  tokens_received  NUMERIC(18,6) NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (word_id, wallet),
  CONSTRAINT chk_pos_yes_non_negative CHECK (yes_shares >= 0),
  CONSTRAINT chk_pos_no_non_negative CHECK (no_shares >= 0),
  CONSTRAINT chk_pos_spent_non_negative CHECK (tokens_spent >= 0),
  CONSTRAINT chk_pos_received_non_negative CHECK (tokens_received >= 0)
);

CREATE INDEX IF NOT EXISTS idx_cmp_market_wallet ON custom_market_positions(market_id, wallet);
CREATE INDEX IF NOT EXISTS idx_cmp_word ON custom_market_positions(word_id);

-- User play token balance per market (no DEFAULT — set from market.play_tokens on first trade)
CREATE TABLE IF NOT EXISTS custom_market_balances (
  market_id  INTEGER NOT NULL REFERENCES custom_markets(id) ON DELETE CASCADE,
  wallet     TEXT NOT NULL,
  balance    NUMERIC(18,6) NOT NULL,
  PRIMARY KEY (market_id, wallet),
  CONSTRAINT chk_balance_non_negative CHECK (balance >= 0)
);

-- Price history per word for charting
CREATE TABLE IF NOT EXISTS custom_market_price_history (
  id          SERIAL PRIMARY KEY,
  word_id     INTEGER NOT NULL REFERENCES custom_market_words(id) ON DELETE CASCADE,
  yes_price   NUMERIC(6,4) NOT NULL,
  no_price    NUMERIC(6,4) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmph_word_time ON custom_market_price_history(word_id, recorded_at DESC);

-- Individual trade log
CREATE TABLE IF NOT EXISTS custom_market_trades (
  id          SERIAL PRIMARY KEY,
  market_id   INTEGER NOT NULL REFERENCES custom_markets(id) ON DELETE CASCADE,
  word_id     INTEGER NOT NULL REFERENCES custom_market_words(id) ON DELETE CASCADE,
  wallet      TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('buy', 'sell')),
  side        TEXT NOT NULL CHECK (side IN ('YES', 'NO')),
  shares      NUMERIC(18,6) NOT NULL,
  cost        NUMERIC(18,6) NOT NULL,
  yes_price   NUMERIC(6,4) NOT NULL,
  no_price    NUMERIC(6,4) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmt_market ON custom_market_trades(market_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cmt_wallet ON custom_market_trades(wallet, created_at DESC);

-- Discord linking for sybil resistance
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS discord_id TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS discord_username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_discord_id ON user_profiles(discord_id) WHERE discord_id IS NOT NULL;

-- Referral system
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS referral_code TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS referred_by TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_referral_code ON user_profiles(referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profile_referred_by ON user_profiles(referred_by) WHERE referred_by IS NOT NULL;
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
