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
