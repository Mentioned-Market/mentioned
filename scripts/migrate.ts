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
CREATE INDEX IF NOT EXISTS idx_chat_messages_wallet ON chat_messages(wallet);

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

-- Timestamp set when market transitions to 'resolved' (all words resolved).
-- Used to compute listing grace window (max of 48h after resolution or end of UTC week).
ALTER TABLE custom_markets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

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

-- Profile picture emoji (from unlocked achievements)
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS pfp_emoji TEXT;

-- Discord linking for sybil resistance
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS discord_id TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS discord_username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_discord_id ON user_profiles(discord_id) WHERE discord_id IS NOT NULL;

-- Account lock (admin enforcement). discord_id stays populated so the unique
-- constraint still blocks the user from re-linking the same Discord on a fresh wallet.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS locked_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_profile_locked ON user_profiles(locked_at) WHERE locked_at IS NOT NULL;

-- Referral system
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS referral_code TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS referred_by TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_referral_code ON user_profiles(referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profile_referred_by ON user_profiles(referred_by) WHERE referred_by IS NOT NULL;

-- User achievements
CREATE TABLE IF NOT EXISTS user_achievements (
  id             SERIAL PRIMARY KEY,
  wallet         TEXT NOT NULL,
  achievement_id TEXT NOT NULL,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  unlocked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (wallet, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_user_achievements_wallet ON user_achievements(wallet);

-- Add week_start to user_achievements so each week's unlock is tracked independently
ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS week_start DATE NOT NULL DEFAULT date_trunc('week', NOW())::date;

-- Drop the old all-time unique constraint and replace with a per-week one
-- (DO block so it's safe to re-run)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_achievements_wallet_achievement_id_key'
  ) THEN
    ALTER TABLE user_achievements DROP CONSTRAINT user_achievements_wallet_achievement_id_key;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_achievements_wallet_week ON user_achievements(wallet, achievement_id, week_start);

-- URL slug for free markets (e.g. TRUMP-1a2b3c)
ALTER TABLE custom_markets ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_markets_slug ON custom_markets(slug);

-- Chat real-time: NOTIFY trigger for SSE streaming
CREATE OR REPLACE FUNCTION notify_chat_insert() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'chat_messages' THEN
    PERFORM pg_notify('chat_new', json_build_object(
      'channel', 'global',
      'id', NEW.id,
      'wallet', NEW.wallet,
      'username', NEW.username,
      'message', NEW.message,
      'created_at', NEW.created_at
    )::text);
  ELSIF TG_TABLE_NAME = 'event_chat_messages' THEN
    PERFORM pg_notify('chat_new', json_build_object(
      'channel', 'event_' || NEW.event_id,
      'id', NEW.id,
      'event_id', NEW.event_id,
      'wallet', NEW.wallet,
      'username', NEW.username,
      'message', NEW.message,
      'created_at', NEW.created_at,
      'pfp_emoji', (SELECT pfp_emoji FROM user_profiles WHERE wallet = NEW.wallet)
    )::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chat_messages_notify ON chat_messages;
CREATE TRIGGER trg_chat_messages_notify
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION notify_chat_insert();

DROP TRIGGER IF EXISTS trg_event_chat_messages_notify ON event_chat_messages;
CREATE TRIGGER trg_event_chat_messages_notify
  AFTER INSERT ON event_chat_messages
  FOR EACH ROW EXECUTE FUNCTION notify_chat_insert();

-- Daily visit tracking for login streak achievements
CREATE TABLE IF NOT EXISTS user_visit_logs (
  id         SERIAL PRIMARY KEY,
  wallet     TEXT NOT NULL,
  visit_date DATE NOT NULL,
  week_start DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (wallet, visit_date)
);

CREATE INDEX IF NOT EXISTS idx_user_visit_logs_wallet_week ON user_visit_logs(wallet, week_start);

-- IP / user-agent capture for multi-account detection.
-- INET stores both v4 and v6 efficiently and supports subnet operators.
ALTER TABLE user_visit_logs ADD COLUMN IF NOT EXISTS ip         INET;
ALTER TABLE user_visit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;
CREATE INDEX IF NOT EXISTS idx_user_visit_logs_ip
  ON user_visit_logs(ip, visit_date DESC)
  WHERE ip IS NOT NULL;

-- Featured market flag (only one market should be featured at a time)
ALTER TABLE custom_markets ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;

-- Market type: 'continuous' (always live when open) or 'event' (live only after event_start_time)
ALTER TABLE custom_markets ADD COLUMN IF NOT EXISTS market_type TEXT NOT NULL DEFAULT 'continuous';
ALTER TABLE custom_markets ADD COLUMN IF NOT EXISTS event_start_time TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_custom_markets_featured ON custom_markets(is_featured) WHERE is_featured = TRUE;

-- Admin audit log
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id SERIAL PRIMARY KEY,
  wallet TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC);

-- Teams system
CREATE TABLE IF NOT EXISTS teams (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  slug        TEXT UNIQUE,
  join_code   TEXT NOT NULL UNIQUE,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE teams ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS pfp_data TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS x_url TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_slug ON teams(slug) WHERE slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_teams_join_code ON teams(join_code);
CREATE INDEX IF NOT EXISTS idx_teams_created_by ON teams(created_by);

CREATE TABLE IF NOT EXISTS team_members (
  team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  wallet     TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member',
  joined_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (wallet)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);

-- Market resolution results: per-wallet per-word final P&L snapshot (populated on market resolution)
CREATE TABLE IF NOT EXISTS custom_market_results (
  id               SERIAL PRIMARY KEY,
  market_id        INTEGER NOT NULL REFERENCES custom_markets(id) ON DELETE CASCADE,
  wallet           TEXT NOT NULL,
  word_id          INTEGER NOT NULL REFERENCES custom_market_words(id) ON DELETE CASCADE,
  word             TEXT NOT NULL,
  outcome          TEXT NOT NULL CHECK (outcome IN ('YES', 'NO')),
  yes_shares       NUMERIC(18,6) NOT NULL DEFAULT 0,
  no_shares        NUMERIC(18,6) NOT NULL DEFAULT 0,
  tokens_spent     NUMERIC(18,6) NOT NULL DEFAULT 0,
  tokens_received  NUMERIC(18,6) NOT NULL DEFAULT 0,
  net_tokens       NUMERIC(18,6) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (market_id, wallet, word_id)
);

CREATE INDEX IF NOT EXISTS idx_cmr_market ON custom_market_results(market_id);
CREATE INDEX IF NOT EXISTS idx_cmr_wallet ON custom_market_results(wallet, market_id);

-- Paid (on-chain USDC) market metadata stored in DB to supplement on-chain state
CREATE TABLE IF NOT EXISTS paid_market_metadata (
  market_id       BIGINT PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT,
  cover_image_url TEXT,
  stream_url      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User feedback submissions
CREATE TABLE IF NOT EXISTS feedback_submissions (
  id              SERIAL PRIMARY KEY,
  wallet          TEXT NOT NULL UNIQUE,
  honest_thoughts TEXT NOT NULL,
  sad_if_gone     TEXT NOT NULL,
  improvements    TEXT NOT NULL,
  real_money      TEXT NOT NULL,
  extra           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Live transcription / word mention detection ─────────────────────────────
-- Owned by the transcript-worker service (services/transcript-worker).
-- v1: free markets only. event_id format follows event_chat_messages: 'custom_<id>'.

-- Per-market monitoring intent. Multiple terminal rows per event_id are
-- allowed (one per historical run); only one row per event_id may be active
-- at a time, enforced by the partial unique index below.
CREATE TABLE IF NOT EXISTS monitored_streams (
  id              SERIAL PRIMARY KEY,
  event_id        TEXT NOT NULL,                    -- 'custom_<id>' for free markets
  stream_url      TEXT NOT NULL,                    -- twitch.tv/foo, youtube.com/watch?v=...
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | live | ended | error
  source          TEXT,                             -- 'twitch' | 'youtube'
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  minutes_used    NUMERIC NOT NULL DEFAULT 0,
  cost_cents      INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  created_by      TEXT NOT NULL,                    -- admin wallet
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_monitored_streams_status
  ON monitored_streams(status) WHERE status IN ('pending', 'live');
-- Drop the original column-level UNIQUE constraint on existing DBs so
-- terminal rows accumulate (each historical run keeps its segments +
-- mentions). The partial unique index below still blocks a second active
-- row for the same event_id.
ALTER TABLE monitored_streams DROP CONSTRAINT IF EXISTS monitored_streams_event_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_monitored_streams_event_active
  ON monitored_streams(event_id) WHERE status IN ('pending', 'live');

-- Finalized transcript segments. One row per Deepgram is_final=true.
CREATE TABLE IF NOT EXISTS live_transcript_segments (
  id           BIGSERIAL PRIMARY KEY,
  stream_id    INTEGER NOT NULL REFERENCES monitored_streams(id) ON DELETE CASCADE,
  start_ms     INTEGER NOT NULL,
  end_ms       INTEGER NOT NULL,
  text         TEXT NOT NULL,
  confidence   REAL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lts_stream_time
  ON live_transcript_segments(stream_id, start_ms);

-- Detected word/phrase matches. Position-based dedupe via UNIQUE constraint.
CREATE TABLE IF NOT EXISTS word_mentions (
  id                 BIGSERIAL PRIMARY KEY,
  stream_id          INTEGER NOT NULL REFERENCES monitored_streams(id) ON DELETE CASCADE,
  event_id           TEXT NOT NULL,                          -- denormalized for fast filter
  word_index         INTEGER NOT NULL,
  word               TEXT NOT NULL,                          -- canonical from custom_market_words
  matched_text       TEXT NOT NULL,                          -- actual variant that matched
  segment_id         BIGINT REFERENCES live_transcript_segments(id) ON DELETE SET NULL,
  stream_offset_ms   INTEGER NOT NULL,                       -- jump-to-time link
  global_char_offset INTEGER NOT NULL,                       -- position-based dedupe key
  snippet            TEXT NOT NULL,                          -- ±40 chars around the hit
  confidence         REAL,
  superseded         BOOLEAN NOT NULL DEFAULT FALSE,
  superseded_by      TEXT,
  superseded_at      TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stream_id, word_index, global_char_offset)
);
CREATE INDEX IF NOT EXISTS idx_word_mentions_event_active
  ON word_mentions(event_id, word_index) WHERE superseded = FALSE;
CREATE INDEX IF NOT EXISTS idx_word_mentions_stream
  ON word_mentions(stream_id, created_at);

-- Word-level resolution rules. Default 1 = any-mention semantics (no behavioral
-- change for existing markets). Higher = count-based ("said 10+ times").
ALTER TABLE custom_market_words
  ADD COLUMN IF NOT EXISTS mention_threshold INTEGER NOT NULL DEFAULT 1;
ALTER TABLE custom_market_words
  ADD COLUMN IF NOT EXISTS match_variants TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Admin marks a word "pending resolution" after seeing a Discord mention
-- ping but before manually verifying the outcome. While pending, trading
-- on that word is fully frozen (mirrors how 'locked' markets behave).
-- Reversible until the word is actually resolved (resolved_outcome IS NOT NULL).
ALTER TABLE custom_market_words
  ADD COLUMN IF NOT EXISTS pending_resolution BOOLEAN NOT NULL DEFAULT FALSE;

-- Admin opt-in: when TRUE, the transcript worker auto-flips pending_resolution
-- on the first mention with confidence > AUTO_LOCK_MIN_CONFIDENCE (0.95). Off
-- by default — auto-lock is a per-word trust decision the admin makes.
ALTER TABLE custom_market_words
  ADD COLUMN IF NOT EXISTS auto_lock_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Worker pool: which transcript-worker instance is responsible for this row.
-- 'cloud' = the Railway-hosted worker (handles twitch://, youtube:// URLs).
-- 'local' (or 'local-<machine>') = a laptop running with WORKER_POOL=local
-- and reading audio from a virtual cable / loopback device. Workers only
-- claim rows whose worker_pool matches their own.
ALTER TABLE monitored_streams
  ADD COLUMN IF NOT EXISTS worker_pool TEXT NOT NULL DEFAULT 'cloud';
CREATE INDEX IF NOT EXISTS idx_monitored_streams_pool
  ON monitored_streams(worker_pool, status) WHERE status IN ('pending', 'live');

-- Job kind: 'live' (default) routes to the streaming pipeline (streamlink/
-- yt-dlp → ffmpeg → Deepgram WS). 'vod' routes to the pre-recorded pipeline
-- (yt-dlp -g → Deepgram REST). Same DB shape; different code path.
ALTER TABLE monitored_streams
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'live';
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
