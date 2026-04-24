import 'dotenv/config'
import pg from 'pg'

// ── Guard: staging DB only ────────────────────────────────────────────────
// Refuses to run against localhost (use seed.ts for that) or anything
// that looks like a production Railway URL without "staging" in it.

const dbUrl = process.env.DATABASE_URL ?? ''

if (dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')) {
  console.error('Seed-staging refused: DATABASE_URL points to localhost.')
  console.error('Use `npm run db:seed` for local dev seeding.')
  process.exit(1)
}

// ── DB connection ─────────────────────────────────────────────────────────

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
})

// ── LMSR helpers (mirror lib/virtualLmsr.ts) ──────────────────────────────

function logSumExp(a: number, b: number): number {
  const m = Math.max(a, b)
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m))
}

function lmsrCostFn(qYes: number, qNo: number, b: number): number {
  return b * logSumExp(qYes / b, qNo / b)
}

function impliedPrice(yesQty: number, noQty: number, b: number): { yes: number; no: number } {
  if (b === 0) return { yes: 0.5, no: 0.5 }
  const diff = (noQty - yesQty) / b
  const yes = 1 / (1 + Math.exp(diff))
  return { yes: round4(yes), no: round4(1 - yes) }
}

function buyCost(yesQty: number, noQty: number, side: 'YES' | 'NO', shares: number, b: number): number {
  const before = lmsrCostFn(yesQty, noQty, b)
  const after = side === 'YES'
    ? lmsrCostFn(yesQty + shares, noQty, b)
    : lmsrCostFn(yesQty, noQty + shares, b)
  return Math.max(0, after - before)
}

function round4(n: number): number { return Math.round(n * 10000) / 10000 }
function round6(n: number): number { return Math.round(n * 1000000) / 1000000 }

// ── Time helpers ──────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function hoursAgo(n: number): Date {
  const d = new Date()
  d.setHours(d.getHours() - n)
  return d
}

function hoursFromNow(n: number): Date {
  return hoursAgo(-n)
}

function minutesAgo(n: number): Date {
  const d = new Date()
  d.setMinutes(d.getMinutes() - n)
  return d
}

function getWeekStart(): string {
  const now = new Date()
  const day = now.getUTCDay()
  const diff = day === 0 ? 6 : day - 1 // Monday = start of week
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff))
  return monday.toISOString().slice(0, 10)
}

// ── Test wallets ──────────────────────────────────────────────────────────
// Fake Solana-style base58 addresses. 20 users with varied engagement levels.

const USERS = [
  // Power users — heavy traders, Discord linked, referrals
  { wallet: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', username: 'cryptowizard',   pfp: '🧙', discordId: '1001', discordUser: 'cryptowiz#1234', referralCode: 'cryp8f2k', referredBy: null,       joinedDaysAgo: 60 },
  { wallet: 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH', username: 'moonbetter',     pfp: '🌙', discordId: '1002', discordUser: 'moonbet#5678',   referralCode: 'moon3a9x', referredBy: 'cryp8f2k', joinedDaysAgo: 45 },
  { wallet: '9WzDXwBMT6XuaTHM4KvXRhbhLs1nYXENAuvgKNNBYRRh', username: 'tradingpete',    pfp: '📈', discordId: '1003', discordUser: 'pete#0001',      referralCode: 'trad7b1m', referredBy: 'cryp8f2k', joinedDaysAgo: 35 },
  { wallet: '6sp2ZFAjNYGbHnMtFJB3yGvdq8x7KjLwCfPeS4mNDAKT', username: 'mentioned_fan',  pfp: '⭐', discordId: '1004', discordUser: 'mfan#9999',      referralCode: 'ment2c5j', referredBy: null,       joinedDaysAgo: 30 },

  // Active users — regular traders
  { wallet: 'Bp4kLFGN8VRtYc2QwXj5mZ9hA3sT7uEqDfW6nP1oRvSx', username: 'solana_shark',   pfp: '🦈', discordId: '1005', discordUser: 'shark#4242',     referralCode: 'sola4d7n', referredBy: 'moon3a9x', joinedDaysAgo: 28 },
  { wallet: 'CjR8vWpNx3YmqKt5Ls2hZe6bA9fQ7wU4gDnXo1iMcTaH', username: 'degen_dana',     pfp: '🎰', discordId: '1006', discordUser: 'dana#7777',      referralCode: 'dege5e8p', referredBy: null,       joinedDaysAgo: 25 },
  { wallet: 'DkS9vWpNx4YmqKt6Ls3hZe7bA0fQ8wU5gEnXo2iMcTaJ', username: 'whale_watcher',  pfp: '🐋', discordId: '1007', discordUser: 'whale#3333',     referralCode: 'whal6f9q', referredBy: 'ment2c5j', joinedDaysAgo: 22 },
  { wallet: 'EmT0vWpNx5YmqKt7Ls4hZe8bA1fQ9wU6gFnXo3iMcTaK', username: 'alpha_hunter',   pfp: '🔥', discordId: '1008', discordUser: 'alpha#1111',     referralCode: 'alph7g0r', referredBy: null,       joinedDaysAgo: 20 },

  // Moderate users — occasional traders
  { wallet: 'FnU1vWpNx6YmqKt8Ls5hZe9bA2fR0wU7gGnXo4iMcTaL', username: 'casual_carl',    pfp: '😎', discordId: '1009', discordUser: 'carl#5555',      referralCode: null,       referredBy: 'dege5e8p', joinedDaysAgo: 18 },
  { wallet: 'GoV2vWpNx7YmqKt9Ls6hZe0bA3fR1wU8gHnXo5iMcTaM', username: 'betsy_bets',     pfp: '🎲', discordId: '1010', discordUser: 'betsy#6666',     referralCode: 'bets8h1s', referredBy: null,       joinedDaysAgo: 15 },
  { wallet: 'HpW3vWpNx8YmqKu0Ls7hZe1bA4fR2wU9gInXo6iMcTaN', username: 'chart_chad',     pfp: '📊', discordId: '1011', discordUser: 'chad#2222',      referralCode: null,       referredBy: 'sola4d7n', joinedDaysAgo: 14 },
  { wallet: 'IqX4vWpNx9YmqKu1Ls8hZe2bA5fR3wV0gJnXo7iMcTaP', username: 'hodl_queen',     pfp: '👑', discordId: '1012', discordUser: 'queen#4444',     referralCode: 'hodl9i2t', referredBy: null,       joinedDaysAgo: 12 },

  // Light users — few trades, some Discord-linked
  { wallet: 'JrY5vWpNy0YmqKu2Ls9hZe3bA6fR4wV1gKnXo8iMcTaQ', username: 'newbie_nick',    pfp: null,  discordId: '1013', discordUser: 'nick#8888',      referralCode: null,       referredBy: 'alph7g0r', joinedDaysAgo: 10 },
  { wallet: 'KsZ6vWpNy1YmqKu3Lt0hZe4bA7fR5wV2gLnXo9iMcTaR', username: 'lurker_lucy',    pfp: null,  discordId: '1014', discordUser: 'lucy#0000',      referralCode: null,       referredBy: null,       joinedDaysAgo: 8 },
  { wallet: 'LtA7vWpNy2YmqKu4Lt1hZe5bA8fR6wV3gMnXp0iMcTaS', username: 'first_timer',    pfp: '🌱', discordId: '1015', discordUser: 'firsty#1010',    referralCode: null,       referredBy: 'bets8h1s', joinedDaysAgo: 5 },
  { wallet: 'MuB8vWpNy3YmqKu5Lt2hZe6bA9fR7wV4gNnXp1iMcTaT', username: 'weekend_warrior', pfp: '⚔️', discordId: '1016', discordUser: 'warrior#2020',  referralCode: null,       referredBy: null,       joinedDaysAgo: 3 },

  // Users without Discord — can view but not trade free markets
  { wallet: 'NvC9vWpNy4YmqKu6Lt3hZe7bB0fR8wV5gOnXp2iMcTaU', username: 'no_discord_dan', pfp: null,  discordId: null,   discordUser: null,             referralCode: null,       referredBy: null,       joinedDaysAgo: 20 },
  { wallet: 'OwD0vWpNy5YmqKu7Lt4hZe8bB1fR9wV6gPnXp3iMcTaV', username: 'anon_amy',       pfp: '🤫', discordId: null,   discordUser: null,             referralCode: null,       referredBy: null,       joinedDaysAgo: 12 },

  // Very new users — just created profiles
  { wallet: 'PxE1vWpNy6YmqKu8Lt5hZe9bB2fS0wV7gQnXp4iMcTaW', username: 'fresh_freddy',   pfp: null,  discordId: '1019', discordUser: 'freddy#3030',    referralCode: null,       referredBy: 'trad7b1m', joinedDaysAgo: 1 },
  { wallet: 'QyF2vWpNy7YmqKu9Lt6hZf0bB3fS1wV8gRnXp5iMcTaX', username: 'just_joined',    pfp: null,  discordId: null,   discordUser: null,             referralCode: null,       referredBy: null,       joinedDaysAgo: 0 },
]

// ── Polymarket events ─────────────────────────────────────────────────────

const POLY_EVENTS = [
  { marketId: '0xa1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2', eventId: 'evt-stg-001', title: 'T1 vs Gen.G — World Finals' },
  { marketId: '0xb2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3', eventId: 'evt-stg-002', title: 'NaVi vs Vitality — ESL Pro League' },
  { marketId: '0xc3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4', eventId: 'evt-stg-003', title: 'Cloud9 vs FaZe — IEM Katowice' },
  { marketId: '0xd4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5', eventId: 'evt-stg-004', title: 'Sentinels vs LOUD — VCT Masters' },
  { marketId: '0xe5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6', eventId: 'evt-stg-005', title: 'TSM vs 100T — LCS Summer Split' },
  { marketId: '0xf6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1', eventId: 'evt-stg-006', title: 'EG vs C9 — NA Regional Finals' },
  { marketId: '0xa7b8c9d0e1f2a7b8c9d0e1f2a7b8c9d0e1f2a7b8', eventId: 'evt-stg-007', title: 'Fnatic vs G2 — LEC Playoffs' },
  { marketId: '0xb8c9d0e1f2a3b8c9d0e1f2a3b8c9d0e1f2a3b8c9', eventId: 'evt-stg-008', title: 'DRX vs T1 — LCK Spring Finals' },
]

// ── On-chain market IDs (for trade_events) ────────────────────────────────

const ONCHAIN_MARKETS = [
  { marketId: 1001, words: ['inflation', 'recession', 'growth', 'deficit'] },
  { marketId: 1002, words: ['nerf', 'buff', 'meta', 'broken'] },
  { marketId: 1003, words: ['partnership', 'acquisition', 'IPO'] },
]

// ── Seed functions ────────────────────────────────────────────────────────

async function seedUserProfiles(client: pg.PoolClient) {
  console.log('  Seeding user profiles...')
  for (const u of USERS) {
    const joinedAt = daysAgo(u.joinedDaysAgo)
    await client.query(
      `INSERT INTO user_profiles (wallet, username, pfp_emoji, discord_id, discord_username, referral_code, referred_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       ON CONFLICT (wallet) DO NOTHING`,
      [u.wallet, u.username, u.pfp, u.discordId, u.discordUser, u.referralCode, u.referredBy, joinedAt],
    )
  }
  console.log(`    → ${USERS.length} users`)
}

async function seedPolymarketTrades(client: pg.PoolClient) {
  console.log('  Seeding polymarket trades...')
  const trades: Array<{
    wallet: string; marketId: string; eventId: string; isYes: boolean
    isBuy: boolean; side: string; amount: string; title: string; daysAgo: number
  }> = []

  // cryptowizard: heavy trader across many events
  const u0 = USERS[0].wallet
  trades.push(
    { wallet: u0, ...POLY_EVENTS[0], isYes: true,  isBuy: true,  side: 'YES', amount: '25000000', title: POLY_EVENTS[0].title, daysAgo: 30 },
    { wallet: u0, ...POLY_EVENTS[0], isYes: true,  isBuy: false, side: 'YES', amount: '30000000', title: POLY_EVENTS[0].title, daysAgo: 25 },
    { wallet: u0, ...POLY_EVENTS[1], isYes: false, isBuy: true,  side: 'NO',  amount: '15000000', title: POLY_EVENTS[1].title, daysAgo: 20 },
    { wallet: u0, ...POLY_EVENTS[2], isYes: true,  isBuy: true,  side: 'YES', amount: '50000000', title: POLY_EVENTS[2].title, daysAgo: 15 },
    { wallet: u0, ...POLY_EVENTS[3], isYes: true,  isBuy: true,  side: 'YES', amount: '35000000', title: POLY_EVENTS[3].title, daysAgo: 5 },
    { wallet: u0, ...POLY_EVENTS[4], isYes: false, isBuy: true,  side: 'NO',  amount: '20000000', title: POLY_EVENTS[4].title, daysAgo: 3 },
    { wallet: u0, ...POLY_EVENTS[5], isYes: true,  isBuy: true,  side: 'YES', amount: '45000000', title: POLY_EVENTS[5].title, daysAgo: 1 },
    { wallet: u0, ...POLY_EVENTS[5], isYes: true,  isBuy: false, side: 'YES', amount: '55000000', title: POLY_EVENTS[5].title, daysAgo: 0 },
  )

  // moonbetter: strong win rate, moderate volume
  const u1 = USERS[1].wallet
  trades.push(
    { wallet: u1, ...POLY_EVENTS[0], isYes: false, isBuy: true,  side: 'NO',  amount: '12000000', title: POLY_EVENTS[0].title, daysAgo: 28 },
    { wallet: u1, ...POLY_EVENTS[1], isYes: true,  isBuy: true,  side: 'YES', amount: '18000000', title: POLY_EVENTS[1].title, daysAgo: 18 },
    { wallet: u1, ...POLY_EVENTS[1], isYes: true,  isBuy: false, side: 'YES', amount: '22000000', title: POLY_EVENTS[1].title, daysAgo: 12 },
    { wallet: u1, ...POLY_EVENTS[3], isYes: true,  isBuy: true,  side: 'YES', amount: '30000000', title: POLY_EVENTS[3].title, daysAgo: 6 },
    { wallet: u1, ...POLY_EVENTS[6], isYes: false, isBuy: true,  side: 'NO',  amount: '25000000', title: POLY_EVENTS[6].title, daysAgo: 2 },
  )

  // tradingpete: growing activity
  const u2 = USERS[2].wallet
  trades.push(
    { wallet: u2, ...POLY_EVENTS[2], isYes: true,  isBuy: true,  side: 'YES', amount: '5000000',  title: POLY_EVENTS[2].title, daysAgo: 14 },
    { wallet: u2, ...POLY_EVENTS[4], isYes: false, isBuy: true,  side: 'NO',  amount: '8000000',  title: POLY_EVENTS[4].title, daysAgo: 7 },
    { wallet: u2, ...POLY_EVENTS[5], isYes: true,  isBuy: true,  side: 'YES', amount: '10000000', title: POLY_EVENTS[5].title, daysAgo: 2 },
    { wallet: u2, ...POLY_EVENTS[7], isYes: true,  isBuy: true,  side: 'YES', amount: '12000000', title: POLY_EVENTS[7].title, daysAgo: 1 },
  )

  // mentioned_fan: moderate
  const u3 = USERS[3].wallet
  trades.push(
    { wallet: u3, ...POLY_EVENTS[1], isYes: true,  isBuy: true,  side: 'YES', amount: '7000000',  title: POLY_EVENTS[1].title, daysAgo: 15 },
    { wallet: u3, ...POLY_EVENTS[3], isYes: false, isBuy: true,  side: 'NO',  amount: '9000000',  title: POLY_EVENTS[3].title, daysAgo: 8 },
    { wallet: u3, ...POLY_EVENTS[6], isYes: true,  isBuy: true,  side: 'YES', amount: '11000000', title: POLY_EVENTS[6].title, daysAgo: 4 },
  )

  // solana_shark: big bets, few trades
  const u4 = USERS[4].wallet
  trades.push(
    { wallet: u4, ...POLY_EVENTS[0], isYes: true,  isBuy: true,  side: 'YES', amount: '75000000', title: POLY_EVENTS[0].title, daysAgo: 20 },
    { wallet: u4, ...POLY_EVENTS[2], isYes: false, isBuy: true,  side: 'NO',  amount: '60000000', title: POLY_EVENTS[2].title, daysAgo: 10 },
    { wallet: u4, ...POLY_EVENTS[7], isYes: true,  isBuy: true,  side: 'YES', amount: '80000000', title: POLY_EVENTS[7].title, daysAgo: 2 },
  )

  // degen_dana: lots of small bets, high frequency
  const u5 = USERS[5].wallet
  for (let i = 0; i < 8; i++) {
    const evt = POLY_EVENTS[i % POLY_EVENTS.length]
    trades.push({
      wallet: u5,
      marketId: evt.marketId,
      eventId: evt.eventId,
      isYes: i % 3 !== 0,
      isBuy: true,
      side: i % 3 !== 0 ? 'YES' : 'NO',
      amount: String(3000000 + Math.floor(i * 1500000)),
      title: evt.title,
      daysAgo: 20 - i * 2,
    })
  }

  // whale_watcher, alpha_hunter: moderate
  const u6 = USERS[6].wallet
  const u7 = USERS[7].wallet
  trades.push(
    { wallet: u6, ...POLY_EVENTS[4], isYes: true,  isBuy: true,  side: 'YES', amount: '40000000', title: POLY_EVENTS[4].title, daysAgo: 12 },
    { wallet: u6, ...POLY_EVENTS[5], isYes: false, isBuy: true,  side: 'NO',  amount: '35000000', title: POLY_EVENTS[5].title, daysAgo: 6 },
    { wallet: u7, ...POLY_EVENTS[6], isYes: true,  isBuy: true,  side: 'YES', amount: '28000000', title: POLY_EVENTS[6].title, daysAgo: 10 },
    { wallet: u7, ...POLY_EVENTS[7], isYes: false, isBuy: true,  side: 'NO',  amount: '32000000', title: POLY_EVENTS[7].title, daysAgo: 3 },
    { wallet: u7, ...POLY_EVENTS[0], isYes: true,  isBuy: true,  side: 'YES', amount: '22000000', title: POLY_EVENTS[0].title, daysAgo: 1 },
  )

  // casual_carl, betsy_bets, chart_chad, hodl_queen: light
  trades.push(
    { wallet: USERS[8].wallet,  ...POLY_EVENTS[1], isYes: true,  isBuy: true, side: 'YES', amount: '6000000',  title: POLY_EVENTS[1].title, daysAgo: 10 },
    { wallet: USERS[9].wallet,  ...POLY_EVENTS[3], isYes: false, isBuy: true, side: 'NO',  amount: '8500000',  title: POLY_EVENTS[3].title, daysAgo: 8 },
    { wallet: USERS[10].wallet, ...POLY_EVENTS[5], isYes: true,  isBuy: true, side: 'YES', amount: '14000000', title: POLY_EVENTS[5].title, daysAgo: 5 },
    { wallet: USERS[11].wallet, ...POLY_EVENTS[7], isYes: true,  isBuy: true, side: 'YES', amount: '20000000', title: POLY_EVENTS[7].title, daysAgo: 4 },
    { wallet: USERS[11].wallet, ...POLY_EVENTS[2], isYes: false, isBuy: true, side: 'NO',  amount: '16000000', title: POLY_EVENTS[2].title, daysAgo: 2 },
  )

  // newbie_nick, first_timer: single trades
  trades.push(
    { wallet: USERS[12].wallet, ...POLY_EVENTS[0], isYes: true,  isBuy: true, side: 'YES', amount: '2000000', title: POLY_EVENTS[0].title, daysAgo: 3 },
    { wallet: USERS[14].wallet, ...POLY_EVENTS[4], isYes: true,  isBuy: true, side: 'YES', amount: '1500000', title: POLY_EVENTS[4].title, daysAgo: 1 },
  )

  // weekend_warrior: recent burst
  trades.push(
    { wallet: USERS[15].wallet, ...POLY_EVENTS[6], isYes: true,  isBuy: true, side: 'YES', amount: '10000000', title: POLY_EVENTS[6].title, daysAgo: 2 },
    { wallet: USERS[15].wallet, ...POLY_EVENTS[7], isYes: false, isBuy: true, side: 'NO',  amount: '8000000',  title: POLY_EVENTS[7].title, daysAgo: 1 },
    { wallet: USERS[15].wallet, ...POLY_EVENTS[0], isYes: true,  isBuy: true, side: 'YES', amount: '15000000', title: POLY_EVENTS[0].title, daysAgo: 0 },
  )

  // no_discord_dan and anon_amy: polymarket only (no free market access)
  trades.push(
    { wallet: USERS[16].wallet, ...POLY_EVENTS[2], isYes: true, isBuy: true, side: 'YES', amount: '9000000',  title: POLY_EVENTS[2].title, daysAgo: 8 },
    { wallet: USERS[17].wallet, ...POLY_EVENTS[5], isYes: true, isBuy: true, side: 'YES', amount: '11000000', title: POLY_EVENTS[5].title, daysAgo: 5 },
  )

  for (const t of trades) {
    const tradeTime = daysAgo(t.daysAgo)
    const sig = `stg_${t.wallet.slice(0, 8)}_${t.marketId.slice(-8)}_${t.daysAgo}d`
    await client.query(
      `INSERT INTO polymarket_trades
         (wallet, market_id, event_id, is_yes, is_buy, side, amount_usd, tx_signature, market_title, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT DO NOTHING`,
      [t.wallet, t.marketId, t.eventId, t.isYes, t.isBuy, t.side, t.amount, sig, t.title, tradeTime],
    )
  }
  console.log(`    → ${trades.length} polymarket trades`)
}

async function seedTradeEvents(client: pg.PoolClient) {
  console.log('  Seeding on-chain trade events...')
  // Simulate Helius-indexed on-chain AMM trades
  const events: Array<{
    sig: string; marketId: number; wordIndex: number; direction: number
    isBuy: boolean; quantity: number; cost: number; fee: number
    newYesQty: number; newNoQty: number; impliedPrice: number
    trader: string; daysAgo: number
  }> = []

  // Market 1001: "inflation" market — lots of activity
  let yesQty = 0, noQty = 0
  const m1Trades = [
    { trader: USERS[0].wallet, wordIndex: 0, direction: 0, isBuy: true,  qty: 5.2,  daysAgo: 40 },
    { trader: USERS[1].wallet, wordIndex: 0, direction: 1, isBuy: true,  qty: 3.8,  daysAgo: 38 },
    { trader: USERS[4].wallet, wordIndex: 0, direction: 0, isBuy: true,  qty: 8.0,  daysAgo: 35 },
    { trader: USERS[0].wallet, wordIndex: 1, direction: 0, isBuy: true,  qty: 4.5,  daysAgo: 30 },
    { trader: USERS[5].wallet, wordIndex: 1, direction: 1, isBuy: true,  qty: 6.2,  daysAgo: 28 },
    { trader: USERS[2].wallet, wordIndex: 2, direction: 0, isBuy: true,  qty: 3.0,  daysAgo: 25 },
    { trader: USERS[7].wallet, wordIndex: 0, direction: 0, isBuy: true,  qty: 2.5,  daysAgo: 20 },
    { trader: USERS[6].wallet, wordIndex: 3, direction: 1, isBuy: true,  qty: 5.0,  daysAgo: 18 },
    { trader: USERS[0].wallet, wordIndex: 0, direction: 0, isBuy: false, qty: 3.0,  daysAgo: 15 },
    { trader: USERS[3].wallet, wordIndex: 2, direction: 0, isBuy: true,  qty: 7.0,  daysAgo: 10 },
    { trader: USERS[1].wallet, wordIndex: 3, direction: 0, isBuy: true,  qty: 4.0,  daysAgo: 5 },
    { trader: USERS[5].wallet, wordIndex: 0, direction: 1, isBuy: true,  qty: 2.0,  daysAgo: 2 },
  ]

  for (const t of m1Trades) {
    // Simplified cost/price calc for seed data
    const cost = round6(t.qty * (0.3 + Math.random() * 0.4))
    const fee = round6(cost * 0.01)
    const newYes = round6(yesQty + (t.direction === 0 && t.isBuy ? t.qty : t.direction === 0 && !t.isBuy ? -t.qty : 0))
    const newNo = round6(noQty + (t.direction === 1 && t.isBuy ? t.qty : t.direction === 1 && !t.isBuy ? -t.qty : 0))
    const ip = round4(0.3 + Math.random() * 0.4)
    yesQty = Math.max(0, newYes)
    noQty = Math.max(0, newNo)

    events.push({
      sig: `stg_onchain_${1001}_${t.wordIndex}_${t.trader.slice(0, 6)}_${t.daysAgo}d`,
      marketId: 1001, wordIndex: t.wordIndex, direction: t.direction,
      isBuy: t.isBuy, quantity: t.qty, cost, fee,
      newYesQty: yesQty, newNoQty: noQty, impliedPrice: ip,
      trader: t.trader, daysAgo: t.daysAgo,
    })
  }

  // Market 1002: "nerf/buff" market — moderate
  const m2Trades = [
    { trader: USERS[0].wallet, wordIndex: 0, direction: 0, isBuy: true, qty: 3.0, daysAgo: 20 },
    { trader: USERS[3].wallet, wordIndex: 1, direction: 0, isBuy: true, qty: 5.0, daysAgo: 15 },
    { trader: USERS[5].wallet, wordIndex: 2, direction: 1, isBuy: true, qty: 4.0, daysAgo: 10 },
    { trader: USERS[7].wallet, wordIndex: 3, direction: 0, isBuy: true, qty: 2.5, daysAgo: 5 },
  ]
  for (const t of m2Trades) {
    const cost = round6(t.qty * (0.3 + Math.random() * 0.4))
    const fee = round6(cost * 0.01)
    events.push({
      sig: `stg_onchain_${1002}_${t.wordIndex}_${t.trader.slice(0, 6)}_${t.daysAgo}d`,
      marketId: 1002, wordIndex: t.wordIndex, direction: t.direction,
      isBuy: t.isBuy, quantity: t.qty, cost, fee,
      newYesQty: round6(t.qty), newNoQty: 0, impliedPrice: round4(0.4 + Math.random() * 0.3),
      trader: t.trader, daysAgo: t.daysAgo,
    })
  }

  // Market 1003: "partnership" market — light
  const m3Trades = [
    { trader: USERS[1].wallet, wordIndex: 0, direction: 0, isBuy: true, qty: 6.0, daysAgo: 12 },
    { trader: USERS[4].wallet, wordIndex: 1, direction: 1, isBuy: true, qty: 4.0, daysAgo: 8 },
  ]
  for (const t of m3Trades) {
    const cost = round6(t.qty * 0.45)
    const fee = round6(cost * 0.01)
    events.push({
      sig: `stg_onchain_${1003}_${t.wordIndex}_${t.trader.slice(0, 6)}_${t.daysAgo}d`,
      marketId: 1003, wordIndex: t.wordIndex, direction: t.direction,
      isBuy: t.isBuy, quantity: t.qty, cost, fee,
      newYesQty: round6(t.qty), newNoQty: 0, impliedPrice: round4(0.5),
      trader: t.trader, daysAgo: t.daysAgo,
    })
  }

  for (const e of events) {
    const blockTime = daysAgo(e.daysAgo)
    await client.query(
      `INSERT INTO trade_events
         (signature, market_id, word_index, direction, is_buy, quantity, cost, fee, new_yes_qty, new_no_qty, implied_price, trader, block_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (signature, market_id, word_index, trader) DO NOTHING`,
      [e.sig, e.marketId, e.wordIndex, e.direction, e.isBuy, e.quantity, e.cost, e.fee, e.newYesQty, e.newNoQty, e.impliedPrice, e.trader, blockTime],
    )
  }
  console.log(`    → ${events.length} on-chain trade events`)
}

async function seedMarketMetadata(client: pg.PoolClient) {
  console.log('  Seeding market metadata & transcripts...')

  // Market metadata (cover images)
  const metadata = [
    { marketId: 1001, imageUrl: 'https://picsum.photos/seed/market1001/800/400' },
    { marketId: 1002, imageUrl: 'https://picsum.photos/seed/market1002/800/400' },
    { marketId: 1003, imageUrl: 'https://picsum.photos/seed/market1003/800/400' },
  ]
  for (const m of metadata) {
    await client.query(
      `INSERT INTO market_metadata (market_id, image_url) VALUES ($1, $2)
       ON CONFLICT (market_id) DO NOTHING`,
      [m.marketId, m.imageUrl],
    )
  }

  // Transcripts
  const transcripts = [
    {
      marketId: 1001,
      transcript: 'The Federal Reserve announced today that inflation targets remain at 2%, citing slow growth in Q3. The deficit is expected to widen if current fiscal policies continue.',
      sourceUrl: 'https://example.com/fed-speech-2025',
      submittedBy: USERS[0].wallet,
    },
    {
      marketId: 1002,
      transcript: 'After the 13-7 scoreline, the analyst desk discussed how the meta shift completely changed the dynamic. "Broken" was used three times to describe the new agent.',
      sourceUrl: null,
      submittedBy: USERS[2].wallet,
    },
  ]
  for (const t of transcripts) {
    await client.query(
      `INSERT INTO market_transcripts (market_id, transcript, source_url, submitted_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (market_id) DO NOTHING`,
      [t.marketId, t.transcript, t.sourceUrl, t.submittedBy],
    )
  }
  console.log(`    → ${metadata.length} metadata, ${transcripts.length} transcripts`)
}

async function seedEventStreams(client: pg.PoolClient) {
  console.log('  Seeding event streams...')
  const streams = [
    { eventId: 'evt-stg-001', streamUrl: 'https://twitch.tv/t1_esports' },
    { eventId: 'evt-stg-003', streamUrl: 'https://twitch.tv/iem_katowice' },
    { eventId: 'evt-stg-004', streamUrl: 'https://twitch.tv/valorant_esports' },
    { eventId: 'evt-stg-007', streamUrl: 'https://twitch.tv/lec_official' },
  ]
  for (const s of streams) {
    await client.query(
      `INSERT INTO event_streams (event_id, stream_url) VALUES ($1, $2)
       ON CONFLICT (event_id) DO NOTHING`,
      [s.eventId, s.streamUrl],
    )
  }
  console.log(`    → ${streams.length} event streams`)
}

async function seedGlobalChat(client: pg.PoolClient) {
  console.log('  Seeding global chat...')
  const messages = [
    { user: USERS[0],  msg: 'gm everyone, the T1 vs Gen.G market is looking spicy',            hoursAgo: 72 },
    { user: USERS[1],  msg: 'who else is watching the ESL stream?',                              hoursAgo: 68 },
    { user: USERS[5],  msg: 'just aped into everything lmao',                                    hoursAgo: 65 },
    { user: USERS[2],  msg: 'hey just joined, whats the best market rn?',                        hoursAgo: 60 },
    { user: USERS[0],  msg: 'check out the free markets if you want to practice first',          hoursAgo: 59 },
    { user: USERS[4],  msg: 'massive YES position on T1, they never lose world finals',          hoursAgo: 55 },
    { user: USERS[3],  msg: 'counter-bet: Gen.G has been looking insane in scrims',               hoursAgo: 50 },
    { user: USERS[6],  msg: 'just sold my NO position on NaVi, taking profits',                  hoursAgo: 48 },
    { user: USERS[7],  msg: 'alpha alert: the analyst desk market is way underpriced on upset',   hoursAgo: 44 },
    { user: USERS[1],  msg: 'moonbetter here, already up 60% this week',                         hoursAgo: 40 },
    { user: USERS[8],  msg: 'casual drop-in, any markets closing soon?',                         hoursAgo: 36 },
    { user: USERS[9],  msg: 'betsy checking in, the VCT market looks juicy',                     hoursAgo: 30 },
    { user: USERS[0],  msg: 'reminder: free markets dont need SOL, just Discord',                 hoursAgo: 28 },
    { user: USERS[10], msg: 'chart says YES is overbought on the FaZe market',                   hoursAgo: 24 },
    { user: USERS[5],  msg: 'bought more dips, this is the way',                                  hoursAgo: 20 },
    { user: USERS[11], msg: 'hodling my T1 position through the weekend',                        hoursAgo: 18 },
    { user: USERS[3],  msg: 'the leaderboard competition is getting intense',                     hoursAgo: 15 },
    { user: USERS[7],  msg: 'who else got the Cashed Out achievement?',                           hoursAgo: 12 },
    { user: USERS[2],  msg: 'finally got my first win, feels good',                               hoursAgo: 10 },
    { user: USERS[12], msg: 'hey im new here, this is cool',                                     hoursAgo: 8 },
    { user: USERS[0],  msg: 'welcome! check the free markets first to get the hang of it',       hoursAgo: 7 },
    { user: USERS[15], msg: 'weekend warrior reporting for duty',                                  hoursAgo: 5 },
    { user: USERS[5],  msg: 'letsgooo LCS summer split market just dropped',                      hoursAgo: 3 },
    { user: USERS[1],  msg: 'gg everyone, what a trading session',                                hoursAgo: 1 },
  ]

  for (const c of messages) {
    const ts = hoursAgo(c.hoursAgo)
    await client.query(
      `INSERT INTO chat_messages (wallet, username, message, created_at)
       VALUES ($1, $2, $3, $4)`,
      [c.user.wallet, c.user.username, c.msg, ts],
    )
  }
  console.log(`    → ${messages.length} global chat messages`)
}

async function seedEventChat(client: pg.PoolClient) {
  console.log('  Seeding event chat...')
  const messages: Array<{ eventId: string; user: typeof USERS[0]; msg: string; hoursAgo: number }> = []

  // T1 vs Gen.G event chat
  messages.push(
    { eventId: 'evt-stg-001', user: USERS[0],  msg: 'T1 is going to destroy them',                      hoursAgo: 48 },
    { eventId: 'evt-stg-001', user: USERS[4],  msg: 'my YES position is huge, lets go T1',               hoursAgo: 46 },
    { eventId: 'evt-stg-001', user: USERS[3],  msg: 'Gen.G has Chovy though, never count them out',      hoursAgo: 44 },
    { eventId: 'evt-stg-001', user: USERS[1],  msg: 'bought NO as a hedge, just in case',                hoursAgo: 40 },
    { eventId: 'evt-stg-001', user: USERS[7],  msg: 'draft is going to be everything in this series',    hoursAgo: 36 },
    { eventId: 'evt-stg-001', user: USERS[15], msg: 'late to the party, whats the current price?',       hoursAgo: 10 },
  )

  // NaVi vs Vitality event chat
  messages.push(
    { eventId: 'evt-stg-002', user: USERS[1],  msg: 'NaVi has this in the bag, s1mple effect',           hoursAgo: 36 },
    { eventId: 'evt-stg-002', user: USERS[5],  msg: 'Vitality eco rounds are insane this tournament',     hoursAgo: 30 },
    { eventId: 'evt-stg-002', user: USERS[8],  msg: 'this should be a banger match',                     hoursAgo: 24 },
    { eventId: 'evt-stg-002', user: USERS[3],  msg: 'the casters are going to go wild',                  hoursAgo: 18 },
  )

  // IEM Katowice event chat
  messages.push(
    { eventId: 'evt-stg-003', user: USERS[2],  msg: 'C9 have been on a tear this tournament',             hoursAgo: 20 },
    { eventId: 'evt-stg-003', user: USERS[6],  msg: 'FaZe always show up at Katowice though',             hoursAgo: 16 },
    { eventId: 'evt-stg-003', user: USERS[16], msg: 'watching from the arena, atmosphere is electric',     hoursAgo: 12 },
  )

  // VCT Masters event chat
  messages.push(
    { eventId: 'evt-stg-004', user: USERS[7],  msg: 'Sentinels comp looks different this time',           hoursAgo: 14 },
    { eventId: 'evt-stg-004', user: USERS[9],  msg: 'LOUD are the real deal, dont sleep on them',         hoursAgo: 10 },
    { eventId: 'evt-stg-004', user: USERS[1],  msg: 'whoever wins map 1 wins the series imo',             hoursAgo: 6 },
  )

  // Free market event chats (use custom_N format)
  messages.push(
    { eventId: 'custom_1', user: USERS[0],  msg: 'GG is basically guaranteed to be said lol',             hoursAgo: 40 },
    { eventId: 'custom_1', user: USERS[1],  msg: 'yeah but "draft diff" is the real question',            hoursAgo: 38 },
    { eventId: 'custom_1', user: USERS[5],  msg: 'bought heavy YES on clutch, T1 always clutch up',       hoursAgo: 30 },
    { eventId: 'custom_1', user: USERS[2],  msg: 'going contrarian with NO on outplayed',                 hoursAgo: 24 },
    { eventId: 'custom_2', user: USERS[0],  msg: 'the caster bingo market is such a fun concept',         hoursAgo: 20 },
    { eventId: 'custom_2', user: USERS[7],  msg: 'insane and unbelievable are basically free money YES',   hoursAgo: 16 },
    { eventId: 'custom_3', user: USERS[3],  msg: 'this market closes in 2 hours, last chance to trade',   hoursAgo: 50 },
    { eventId: 'custom_5', user: USERS[5],  msg: 'the LCS analyst desk always says the same things lol',  hoursAgo: 8 },
  )

  for (const c of messages) {
    const ts = hoursAgo(c.hoursAgo)
    await client.query(
      `INSERT INTO event_chat_messages (event_id, wallet, username, message, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [c.eventId, c.user.wallet, c.user.username, c.msg, ts],
    )
  }
  console.log(`    → ${messages.length} event chat messages`)
}

async function seedPointEvents(client: pg.PoolClient) {
  console.log('  Seeding point events...')

  const points: Array<{ wallet: string; action: string; pts: number; refId: string; hoursAgo: number; metadata?: Record<string, unknown> }> = []

  // cryptowizard: power user — all action types
  const u0 = USERS[0].wallet
  for (let i = 0; i < 12; i++) {
    points.push({ wallet: u0, action: 'trade_placed', pts: 10, refId: `stg_trade_u0_${i}`, hoursAgo: 200 - i * 15 })
  }
  points.push(
    { wallet: u0, action: 'first_trade',  pts: 100, refId: u0,                 hoursAgo: 800 },
    { wallet: u0, action: 'claim_won',    pts: 50,  refId: 'stg_win_u0_1',    hoursAgo: 150 },
    { wallet: u0, action: 'claim_won',    pts: 50,  refId: 'stg_win_u0_2',    hoursAgo: 80 },
    { wallet: u0, action: 'claim_won',    pts: 50,  refId: 'stg_win_u0_3',    hoursAgo: 30 },
    { wallet: u0, action: 'hold_1h',      pts: 5,   refId: 'stg_hold1_u0_1',  hoursAgo: 180 },
    { wallet: u0, action: 'hold_4h',      pts: 15,  refId: 'stg_hold4_u0_1',  hoursAgo: 176 },
    { wallet: u0, action: 'hold_24h',     pts: 30,  refId: 'stg_hold24_u0_1', hoursAgo: 156 },
    { wallet: u0, action: 'hold_1h',      pts: 5,   refId: 'stg_hold1_u0_2',  hoursAgo: 50 },
    { wallet: u0, action: 'hold_4h',      pts: 15,  refId: 'stg_hold4_u0_2',  hoursAgo: 47 },
  )
  for (let i = 0; i < 8; i++) {
    points.push({ wallet: u0, action: 'chat_message', pts: 2, refId: `stg_chat_u0_${i}`, hoursAgo: 100 - i * 10 })
  }
  points.push(
    { wallet: u0, action: 'custom_market_win', pts: 35, refId: 'stg_freewin_u0_1', hoursAgo: 60 },
    { wallet: u0, action: 'custom_market_win', pts: 50, refId: 'stg_freewin_u0_2', hoursAgo: 25 },
    { wallet: u0, action: 'achievement', pts: 100, refId: 'ach:place_trade', hoursAgo: 800 },
    { wallet: u0, action: 'achievement', pts: 150, refId: 'ach:win_trade',   hoursAgo: 150 },
    { wallet: u0, action: 'achievement', pts: 75,  refId: 'ach:send_chat',   hoursAgo: 100 },
    { wallet: u0, action: 'achievement', pts: 75,  refId: 'ach:set_profile', hoursAgo: 810 },
    { wallet: u0, action: 'achievement', pts: 100, refId: 'ach:free_trade',  hoursAgo: 65 },
  )

  // moonbetter: strong winner
  const u1 = USERS[1].wallet
  for (let i = 0; i < 8; i++) {
    points.push({ wallet: u1, action: 'trade_placed', pts: 10, refId: `stg_trade_u1_${i}`, hoursAgo: 300 - i * 30 })
  }
  points.push(
    { wallet: u1, action: 'first_trade',  pts: 100, refId: u1,                 hoursAgo: 700 },
    { wallet: u1, action: 'claim_won',    pts: 50,  refId: 'stg_win_u1_1',    hoursAgo: 200 },
    { wallet: u1, action: 'claim_won',    pts: 50,  refId: 'stg_win_u1_2',    hoursAgo: 120 },
    { wallet: u1, action: 'claim_won',    pts: 50,  refId: 'stg_win_u1_3',    hoursAgo: 60 },
    { wallet: u1, action: 'claim_won',    pts: 50,  refId: 'stg_win_u1_4',    hoursAgo: 20 },
    { wallet: u1, action: 'hold_1h',      pts: 5,   refId: 'stg_hold1_u1_1',  hoursAgo: 250 },
    { wallet: u1, action: 'hold_4h',      pts: 15,  refId: 'stg_hold4_u1_1',  hoursAgo: 246 },
    { wallet: u1, action: 'hold_24h',     pts: 30,  refId: 'stg_hold24_u1_1', hoursAgo: 226 },
    { wallet: u1, action: 'hold_24h',     pts: 30,  refId: 'stg_hold24_u1_2', hoursAgo: 80 },
    { wallet: u1, action: 'custom_market_win', pts: 20, refId: 'stg_freewin_u1_1', hoursAgo: 40 },
    { wallet: u1, action: 'achievement', pts: 100, refId: 'ach:place_trade', hoursAgo: 700 },
    { wallet: u1, action: 'achievement', pts: 150, refId: 'ach:win_trade',   hoursAgo: 200 },
    { wallet: u1, action: 'achievement', pts: 75,  refId: 'ach:send_chat',   hoursAgo: 280 },
    { wallet: u1, action: 'achievement', pts: 75,  refId: 'ach:set_profile', hoursAgo: 710 },
    { wallet: u1, action: 'achievement', pts: 100, refId: 'ach:free_trade',  hoursAgo: 45 },
    { wallet: u1, action: 'achievement', pts: 150, refId: 'ach:refer_friend', hoursAgo: 350 },
  )
  for (let i = 0; i < 5; i++) {
    points.push({ wallet: u1, action: 'chat_message', pts: 2, refId: `stg_chat_u1_${i}`, hoursAgo: 150 - i * 20 })
  }

  // tradingpete: growing user
  const u2 = USERS[2].wallet
  for (let i = 0; i < 5; i++) {
    points.push({ wallet: u2, action: 'trade_placed', pts: 10, refId: `stg_trade_u2_${i}`, hoursAgo: 150 - i * 25 })
  }
  points.push(
    { wallet: u2, action: 'first_trade', pts: 100, refId: u2,              hoursAgo: 500 },
    { wallet: u2, action: 'claim_won',   pts: 50,  refId: 'stg_win_u2_1', hoursAgo: 60 },
    { wallet: u2, action: 'hold_1h',     pts: 5,   refId: 'stg_hold1_u2_1', hoursAgo: 100 },
    { wallet: u2, action: 'custom_market_win', pts: 15, refId: 'stg_freewin_u2_1', hoursAgo: 30 },
    { wallet: u2, action: 'achievement', pts: 100, refId: 'ach:place_trade', hoursAgo: 500 },
    { wallet: u2, action: 'achievement', pts: 75,  refId: 'ach:set_profile', hoursAgo: 510 },
    { wallet: u2, action: 'achievement', pts: 100, refId: 'ach:free_trade',  hoursAgo: 35 },
  )
  for (let i = 0; i < 3; i++) {
    points.push({ wallet: u2, action: 'chat_message', pts: 2, refId: `stg_chat_u2_${i}`, hoursAgo: 80 - i * 20 })
  }

  // mentioned_fan: moderate activity
  const u3 = USERS[3].wallet
  for (let i = 0; i < 4; i++) {
    points.push({ wallet: u3, action: 'trade_placed', pts: 10, refId: `stg_trade_u3_${i}`, hoursAgo: 200 - i * 40 })
  }
  points.push(
    { wallet: u3, action: 'first_trade', pts: 100, refId: u3,              hoursAgo: 400 },
    { wallet: u3, action: 'claim_won',   pts: 50,  refId: 'stg_win_u3_1', hoursAgo: 90 },
    { wallet: u3, action: 'hold_4h',     pts: 15,  refId: 'stg_hold4_u3_1', hoursAgo: 180 },
    { wallet: u3, action: 'custom_market_win', pts: 45, refId: 'stg_freewin_u3_1', hoursAgo: 50 },
    { wallet: u3, action: 'achievement', pts: 100, refId: 'ach:place_trade', hoursAgo: 400 },
    { wallet: u3, action: 'achievement', pts: 150, refId: 'ach:win_trade',   hoursAgo: 90 },
    { wallet: u3, action: 'achievement', pts: 75,  refId: 'ach:set_profile', hoursAgo: 410 },
  )

  // solana_shark: whale, fewer trades but big
  const u4 = USERS[4].wallet
  points.push(
    { wallet: u4, action: 'first_trade',  pts: 100, refId: u4,                hoursAgo: 450 },
    { wallet: u4, action: 'trade_placed', pts: 10,  refId: 'stg_trade_u4_0', hoursAgo: 300 },
    { wallet: u4, action: 'trade_placed', pts: 10,  refId: 'stg_trade_u4_1', hoursAgo: 150 },
    { wallet: u4, action: 'trade_placed', pts: 10,  refId: 'stg_trade_u4_2', hoursAgo: 40 },
    { wallet: u4, action: 'claim_won',    pts: 50,  refId: 'stg_win_u4_1',   hoursAgo: 100 },
    { wallet: u4, action: 'hold_24h',     pts: 30,  refId: 'stg_hold24_u4_1', hoursAgo: 270 },
    { wallet: u4, action: 'achievement', pts: 100, refId: 'ach:place_trade', hoursAgo: 450 },
    { wallet: u4, action: 'achievement', pts: 150, refId: 'ach:win_trade',   hoursAgo: 100 },
    { wallet: u4, action: 'achievement', pts: 75,  refId: 'ach:set_profile', hoursAgo: 460 },
  )

  // degen_dana: high frequency
  const u5 = USERS[5].wallet
  for (let i = 0; i < 15; i++) {
    points.push({ wallet: u5, action: 'trade_placed', pts: 10, refId: `stg_trade_u5_${i}`, hoursAgo: 300 - i * 18 })
  }
  points.push(
    { wallet: u5, action: 'first_trade',  pts: 100, refId: u5,              hoursAgo: 380 },
    { wallet: u5, action: 'claim_won',    pts: 50,  refId: 'stg_win_u5_1', hoursAgo: 100 },
    { wallet: u5, action: 'claim_won',    pts: 50,  refId: 'stg_win_u5_2', hoursAgo: 50 },
    { wallet: u5, action: 'hold_1h',      pts: 5,   refId: 'stg_hold1_u5_1', hoursAgo: 260 },
    { wallet: u5, action: 'custom_market_win', pts: 30, refId: 'stg_freewin_u5_1', hoursAgo: 20 },
    { wallet: u5, action: 'achievement', pts: 100, refId: 'ach:place_trade', hoursAgo: 380 },
    { wallet: u5, action: 'achievement', pts: 75,  refId: 'ach:send_chat',   hoursAgo: 350 },
    { wallet: u5, action: 'achievement', pts: 100, refId: 'ach:free_trade',  hoursAgo: 25 },
  )
  for (let i = 0; i < 10; i++) {
    points.push({ wallet: u5, action: 'chat_message', pts: 2, refId: `stg_chat_u5_${i}`, hoursAgo: 200 - i * 15 })
  }

  // Remaining active users: simplified point seeding
  const activeUsers = [USERS[6], USERS[7], USERS[8], USERS[9], USERS[10], USERS[11]]
  for (const u of activeUsers) {
    const tradeCount = 2 + Math.floor(Math.random() * 4)
    for (let i = 0; i < tradeCount; i++) {
      points.push({ wallet: u.wallet, action: 'trade_placed', pts: 10, refId: `stg_trade_${u.username}_${i}`, hoursAgo: 200 - i * 30 })
    }
    points.push(
      { wallet: u.wallet, action: 'first_trade', pts: 100, refId: u.wallet, hoursAgo: u.joinedDaysAgo * 24 },
      { wallet: u.wallet, action: 'achievement',  pts: 100, refId: 'ach:place_trade', hoursAgo: u.joinedDaysAgo * 24 },
      { wallet: u.wallet, action: 'achievement',  pts: 75,  refId: 'ach:set_profile', hoursAgo: u.joinedDaysAgo * 24 + 5 },
    )
    if (Math.random() > 0.4) {
      points.push({ wallet: u.wallet, action: 'claim_won', pts: 50, refId: `stg_win_${u.username}_1`, hoursAgo: 80 + Math.floor(Math.random() * 100) })
      points.push({ wallet: u.wallet, action: 'achievement', pts: 150, refId: 'ach:win_trade', hoursAgo: 80 + Math.floor(Math.random() * 100) })
    }
  }

  // Light users: minimal points
  for (const u of [USERS[12], USERS[13], USERS[14], USERS[15]]) {
    points.push(
      { wallet: u.wallet, action: 'first_trade', pts: 100, refId: u.wallet, hoursAgo: u.joinedDaysAgo * 24 },
      { wallet: u.wallet, action: 'trade_placed', pts: 10, refId: `stg_trade_${u.username}_0`, hoursAgo: u.joinedDaysAgo * 24 - 5 },
      { wallet: u.wallet, action: 'achievement', pts: 100, refId: 'ach:place_trade', hoursAgo: u.joinedDaysAgo * 24 },
    )
  }

  // No-discord users: polymarket points only
  for (const u of [USERS[16], USERS[17]]) {
    points.push(
      { wallet: u.wallet, action: 'first_trade', pts: 100, refId: u.wallet, hoursAgo: u.joinedDaysAgo * 24 },
      { wallet: u.wallet, action: 'trade_placed', pts: 10, refId: `stg_trade_${u.username}_0`, hoursAgo: u.joinedDaysAgo * 24 - 10 },
    )
  }

  for (const p of points) {
    const ts = hoursAgo(p.hoursAgo)
    await client.query(
      `INSERT INTO point_events (wallet, action, points, ref_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (wallet, action, ref_id) WHERE ref_id IS NOT NULL DO NOTHING`,
      [p.wallet, p.action, p.pts, p.refId, p.metadata ? JSON.stringify(p.metadata) : null, ts],
    )
  }
  console.log(`    → ${points.length} point events`)
}

async function seedAchievements(client: pg.PoolClient) {
  console.log('  Seeding user achievements...')
  // Achievement IDs match current weekly rotation in lib/achievements.ts
  const achievements: Array<{ wallet: string; id: string; pts: number; hoursAgo: number }> = []

  // Power users: most achievements
  achievements.push(
    { wallet: USERS[0].wallet, id: 'place_trade',  pts: 100, hoursAgo: 800 },
    { wallet: USERS[0].wallet, id: 'win_trade',    pts: 150, hoursAgo: 150 },
    { wallet: USERS[0].wallet, id: 'send_chat',    pts: 75,  hoursAgo: 100 },
    { wallet: USERS[0].wallet, id: 'set_profile',  pts: 75,  hoursAgo: 810 },
    { wallet: USERS[0].wallet, id: 'free_trade',   pts: 100, hoursAgo: 65 },

    { wallet: USERS[1].wallet, id: 'place_trade',  pts: 100, hoursAgo: 700 },
    { wallet: USERS[1].wallet, id: 'win_trade',    pts: 150, hoursAgo: 200 },
    { wallet: USERS[1].wallet, id: 'send_chat',    pts: 75,  hoursAgo: 280 },
    { wallet: USERS[1].wallet, id: 'set_profile',  pts: 75,  hoursAgo: 710 },
    { wallet: USERS[1].wallet, id: 'free_trade',   pts: 100, hoursAgo: 45 },
    { wallet: USERS[1].wallet, id: 'refer_friend', pts: 150, hoursAgo: 350 },
  )

  // Active users: 3-4 achievements each
  for (const u of [USERS[2], USERS[3], USERS[4], USERS[5], USERS[6], USERS[7]]) {
    achievements.push(
      { wallet: u.wallet, id: 'place_trade', pts: 100, hoursAgo: u.joinedDaysAgo * 24 },
      { wallet: u.wallet, id: 'set_profile', pts: 75,  hoursAgo: u.joinedDaysAgo * 24 + 5 },
    )
    if (u.username !== 'whale_watcher') { // not everyone has send_chat
      achievements.push({ wallet: u.wallet, id: 'send_chat', pts: 75, hoursAgo: u.joinedDaysAgo * 24 - 20 })
    }
  }
  // Some also have win_trade
  achievements.push(
    { wallet: USERS[4].wallet, id: 'win_trade',  pts: 150, hoursAgo: 100 },
    { wallet: USERS[5].wallet, id: 'free_trade', pts: 100, hoursAgo: 25 },
    { wallet: USERS[7].wallet, id: 'free_trade', pts: 100, hoursAgo: 30 },
  )

  // Moderate users: 1-2 achievements
  for (const u of [USERS[8], USERS[9], USERS[10], USERS[11]]) {
    achievements.push(
      { wallet: u.wallet, id: 'place_trade', pts: 100, hoursAgo: u.joinedDaysAgo * 24 },
      { wallet: u.wallet, id: 'set_profile', pts: 75,  hoursAgo: u.joinedDaysAgo * 24 + 3 },
    )
  }

  // Light users: just place_trade
  for (const u of [USERS[12], USERS[14], USERS[15]]) {
    achievements.push(
      { wallet: u.wallet, id: 'place_trade', pts: 100, hoursAgo: u.joinedDaysAgo * 24 },
    )
  }

  const weekStart = getWeekStart()
  for (const a of achievements) {
    const ts = hoursAgo(a.hoursAgo)
    await client.query(
      `INSERT INTO user_achievements (wallet, achievement_id, points_awarded, unlocked_at, week_start)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (wallet, achievement_id, week_start) DO NOTHING`,
      [a.wallet, a.id, a.pts, ts, weekStart],
    )
  }
  console.log(`    → ${achievements.length} achievements`)
}

// ── Free Markets ──────────────────────────────────────────────────────────

interface FreeMarketDef {
  title: string
  description: string
  coverImageUrl: string | null
  streamUrl: string | null
  status: 'draft' | 'open' | 'locked' | 'resolved'
  b: number
  playTokens: number
  lockTime: Date | null
  createdAt: Date
  slug: string
  isFeatured: boolean
  marketType: 'continuous' | 'event'
  eventStartTime: Date | null
  words: Array<{ word: string; outcome?: boolean }>
}

const FREE_MARKETS: FreeMarketDef[] = [
  // 1: Open, active — esports interview (featured, event type)
  {
    title: 'Will "GG" be said in the T1 vs Gen.G post-match interview?',
    description: 'Predict which words or phrases will be mentioned during the post-match interview. Market locks 5 minutes before the interview starts.',
    coverImageUrl: 'https://picsum.photos/seed/free-gg/800/400',
    streamUrl: 'https://twitch.tv/t1_esports',
    status: 'open', b: 100, playTokens: 1000,
    lockTime: hoursFromNow(48), createdAt: daysAgo(3), slug: 'GG-stg001',
    isFeatured: true, marketType: 'event', eventStartTime: hoursFromNow(47),
    words: [
      { word: 'GG' }, { word: 'well played' }, { word: 'outplayed' },
      { word: 'clutch' }, { word: 'draft diff' },
    ],
  },
  // 2: Open, fresh — no trades yet (continuous)
  {
    title: 'NaVi vs Vitality — caster word bingo',
    description: 'Which words will the casters say during the grand final? Trade on your predictions.',
    coverImageUrl: 'https://picsum.photos/seed/free-navi/800/400',
    streamUrl: null,
    status: 'open', b: 150, playTokens: 500,
    lockTime: hoursFromNow(72), createdAt: daysAgo(1), slug: 'NAVI-stg002',
    isFeatured: false, marketType: 'continuous', eventStartTime: null,
    words: [
      { word: 'insane' }, { word: 'unbelievable' }, { word: 'what a play' },
      { word: 'economy' }, { word: 'ace' },
    ],
  },
  // 3: Resolved — completed market with payouts
  {
    title: 'Cloud9 vs FaZe — analyst desk predictions',
    description: 'Which phrases will the analyst desk use when breaking down this match?',
    coverImageUrl: 'https://picsum.photos/seed/free-c9faze/800/400',
    streamUrl: null,
    status: 'resolved', b: 100, playTokens: 1000,
    lockTime: daysAgo(2), createdAt: daysAgo(8), slug: 'C9FAZE-stg003',
    isFeatured: false, marketType: 'event', eventStartTime: daysAgo(3),
    words: [
      { word: 'dominant', outcome: true }, { word: 'upset', outcome: false },
      { word: 'momentum', outcome: true }, { word: 'choking', outcome: false },
    ],
  },
  // 4: Locked — trading closed, awaiting resolution
  {
    title: 'Sentinels vs LOUD — post-match interview bingo',
    description: 'Which phrases will be said in the winner interview? Market is locked, awaiting resolution.',
    coverImageUrl: 'https://picsum.photos/seed/free-senloud/800/400',
    streamUrl: 'https://twitch.tv/valorant_esports',
    status: 'locked', b: 120, playTokens: 800,
    lockTime: hoursAgo(6), createdAt: daysAgo(5), slug: 'SENLOUD-stg004',
    isFeatured: false, marketType: 'event', eventStartTime: hoursAgo(8),
    words: [
      { word: 'hard fought' }, { word: 'momentum shift' },
      { word: 'team effort' }, { word: 'next tournament' },
      { word: 'fan support' }, { word: 'game plan' },
    ],
  },
  // 5: Open, high activity — LCS themed (continuous)
  {
    title: 'TSM vs 100T — LCS Summer Split analyst desk',
    description: 'Predict what the LCS analysts will say during the post-game breakdown.',
    coverImageUrl: 'https://picsum.photos/seed/free-tsm100t/800/400',
    streamUrl: 'https://twitch.tv/lcs_official',
    status: 'open', b: 200, playTokens: 1500,
    lockTime: hoursFromNow(24), createdAt: daysAgo(4), slug: 'TSM100T-stg005',
    isFeatured: false, marketType: 'continuous', eventStartTime: null,
    words: [
      { word: 'scaling' }, { word: 'early game' }, { word: 'macro' },
      { word: 'team fight' }, { word: 'baron call' }, { word: 'draft kingdom' },
      { word: 'clean' },
    ],
  },
  // 6: Draft — not yet published
  {
    title: 'EG vs C9 — NA Regional Finals caster bingo',
    description: 'Coming soon: predict which words the casters will use.',
    coverImageUrl: null,
    streamUrl: null,
    status: 'draft', b: 100, playTokens: 1000,
    lockTime: null, createdAt: daysAgo(1), slug: 'EGC9-stg006',
    isFeatured: false, marketType: 'event', eventStartTime: null,
    words: [
      { word: 'insane mechanics' }, { word: 'experience' },
      { word: 'pressure' }, { word: 'composure' },
    ],
  },
  // 7: Resolved — another completed one
  {
    title: 'Fnatic vs G2 — LEC Playoffs caster predictions',
    description: 'Classic EU rivalry. Which buzzwords did the casters use?',
    coverImageUrl: 'https://picsum.photos/seed/free-fng2/800/400',
    streamUrl: null,
    status: 'resolved', b: 80, playTokens: 600,
    lockTime: daysAgo(4), createdAt: daysAgo(10), slug: 'FNG2-stg007',
    isFeatured: false, marketType: 'event', eventStartTime: daysAgo(5),
    words: [
      { word: 'rivalry', outcome: true }, { word: 'legacy', outcome: true },
      { word: 'choke', outcome: false }, { word: 'comeback', outcome: true },
      { word: 'stomp', outcome: false },
    ],
  },
  // 8: Open, moderate activity (event type with upcoming start)
  {
    title: 'DRX vs T1 — LCK Spring Finals desk analysis',
    description: 'What will the Korean analysts focus on in their breakdown?',
    coverImageUrl: 'https://picsum.photos/seed/free-drxt1/800/400',
    streamUrl: null,
    status: 'open', b: 100, playTokens: 1000,
    lockTime: hoursFromNow(36), createdAt: daysAgo(2), slug: 'DRXT1-stg008',
    isFeatured: false, marketType: 'event', eventStartTime: hoursFromNow(34),
    words: [
      { word: 'vision control' }, { word: 'objective trading' },
      { word: 'lane kingdom' }, { word: 'jungle diff' },
    ],
  },
]

// Trade sequences that produce consistent LMSR state
interface TradeStep {
  userIdx: number
  wordIdx: number
  action: 'buy' | 'sell'
  side: 'YES' | 'NO'
  shares: number
  hoursAgo: number
}

// Market 1 trades (open, active)
const MARKET_1_TRADES: TradeStep[] = [
  { userIdx: 0, wordIdx: 0, action: 'buy', side: 'YES', shares: 15, hoursAgo: 60 },
  { userIdx: 1, wordIdx: 1, action: 'buy', side: 'NO',  shares: 12, hoursAgo: 55 },
  { userIdx: 0, wordIdx: 3, action: 'buy', side: 'YES', shares: 20, hoursAgo: 50 },
  { userIdx: 2, wordIdx: 2, action: 'buy', side: 'NO',  shares: 8,  hoursAgo: 45 },
  { userIdx: 5, wordIdx: 0, action: 'buy', side: 'YES', shares: 10, hoursAgo: 40 },
  { userIdx: 1, wordIdx: 4, action: 'buy', side: 'YES', shares: 8,  hoursAgo: 35 },
  { userIdx: 7, wordIdx: 3, action: 'buy', side: 'NO',  shares: 5,  hoursAgo: 30 },
  { userIdx: 5, wordIdx: 2, action: 'buy', side: 'YES', shares: 6,  hoursAgo: 25 },
  { userIdx: 0, wordIdx: 0, action: 'buy', side: 'YES', shares: 5,  hoursAgo: 20 },
  { userIdx: 3, wordIdx: 4, action: 'buy', side: 'NO',  shares: 10, hoursAgo: 15 },
  { userIdx: 2, wordIdx: 1, action: 'buy', side: 'YES', shares: 6,  hoursAgo: 10 },
  { userIdx: 7, wordIdx: 0, action: 'buy', side: 'NO',  shares: 4,  hoursAgo: 5 },
]

// Market 4 trades (locked)
const MARKET_4_TRADES: TradeStep[] = [
  { userIdx: 0, wordIdx: 0, action: 'buy', side: 'YES', shares: 10, hoursAgo: 96 },
  { userIdx: 1, wordIdx: 1, action: 'buy', side: 'NO',  shares: 8,  hoursAgo: 90 },
  { userIdx: 3, wordIdx: 2, action: 'buy', side: 'YES', shares: 12, hoursAgo: 84 },
  { userIdx: 5, wordIdx: 3, action: 'buy', side: 'YES', shares: 6,  hoursAgo: 78 },
  { userIdx: 7, wordIdx: 4, action: 'buy', side: 'NO',  shares: 15, hoursAgo: 72 },
  { userIdx: 0, wordIdx: 5, action: 'buy', side: 'YES', shares: 8,  hoursAgo: 60 },
  { userIdx: 9, wordIdx: 0, action: 'buy', side: 'NO',  shares: 5,  hoursAgo: 48 },
  { userIdx: 2, wordIdx: 3, action: 'buy', side: 'NO',  shares: 7,  hoursAgo: 36 },
  { userIdx: 11, wordIdx: 1, action: 'buy', side: 'YES', shares: 10, hoursAgo: 24 },
  { userIdx: 5, wordIdx: 2, action: 'buy', side: 'NO',  shares: 4,  hoursAgo: 12 },
]

// Market 5 trades (open, high activity)
const MARKET_5_TRADES: TradeStep[] = [
  { userIdx: 0, wordIdx: 0, action: 'buy', side: 'YES', shares: 20, hoursAgo: 80 },
  { userIdx: 1, wordIdx: 1, action: 'buy', side: 'YES', shares: 15, hoursAgo: 75 },
  { userIdx: 5, wordIdx: 2, action: 'buy', side: 'NO',  shares: 25, hoursAgo: 70 },
  { userIdx: 7, wordIdx: 3, action: 'buy', side: 'YES', shares: 10, hoursAgo: 65 },
  { userIdx: 3, wordIdx: 4, action: 'buy', side: 'YES', shares: 18, hoursAgo: 60 },
  { userIdx: 0, wordIdx: 5, action: 'buy', side: 'NO',  shares: 12, hoursAgo: 55 },
  { userIdx: 2, wordIdx: 6, action: 'buy', side: 'YES', shares: 8,  hoursAgo: 50 },
  { userIdx: 9, wordIdx: 0, action: 'buy', side: 'NO',  shares: 10, hoursAgo: 45 },
  { userIdx: 5, wordIdx: 1, action: 'buy', side: 'NO',  shares: 8,  hoursAgo: 40 },
  { userIdx: 11, wordIdx: 3, action: 'buy', side: 'NO', shares: 12, hoursAgo: 35 },
  { userIdx: 0, wordIdx: 4, action: 'buy', side: 'NO',  shares: 6,  hoursAgo: 30 },
  { userIdx: 7, wordIdx: 6, action: 'buy', side: 'NO',  shares: 5,  hoursAgo: 25 },
  { userIdx: 1, wordIdx: 2, action: 'buy', side: 'YES', shares: 10, hoursAgo: 20 },
  { userIdx: 3, wordIdx: 5, action: 'buy', side: 'YES', shares: 15, hoursAgo: 15 },
  { userIdx: 8, wordIdx: 0, action: 'buy', side: 'YES', shares: 8,  hoursAgo: 10 },
  { userIdx: 10, wordIdx: 1, action: 'buy', side: 'YES', shares: 6, hoursAgo: 5 },
]

// Market 8 trades (open, moderate)
const MARKET_8_TRADES: TradeStep[] = [
  { userIdx: 0, wordIdx: 0, action: 'buy', side: 'YES', shares: 12, hoursAgo: 40 },
  { userIdx: 5, wordIdx: 1, action: 'buy', side: 'NO',  shares: 8,  hoursAgo: 35 },
  { userIdx: 1, wordIdx: 2, action: 'buy', side: 'YES', shares: 10, hoursAgo: 30 },
  { userIdx: 7, wordIdx: 3, action: 'buy', side: 'YES', shares: 15, hoursAgo: 25 },
  { userIdx: 3, wordIdx: 0, action: 'buy', side: 'NO',  shares: 6,  hoursAgo: 20 },
  { userIdx: 0, wordIdx: 3, action: 'buy', side: 'NO',  shares: 5,  hoursAgo: 15 },
  { userIdx: 5, wordIdx: 2, action: 'buy', side: 'NO',  shares: 7,  hoursAgo: 10 },
]

async function seedFreeMarkets(client: pg.PoolClient) {
  console.log('  Seeding free markets...')

  const tradesByMarket: Record<number, TradeStep[]> = {
    0: MARKET_1_TRADES,
    3: MARKET_4_TRADES,
    4: MARKET_5_TRADES,
    7: MARKET_8_TRADES,
  }

  let totalTrades = 0
  let totalPositions = 0

  for (let mi = 0; mi < FREE_MARKETS.length; mi++) {
    const fm = FREE_MARKETS[mi]

    const { rows: [market] } = await client.query(
      `INSERT INTO custom_markets (title, description, cover_image_url, stream_url, status, b_parameter, play_tokens, lock_time, slug, is_featured, market_type, event_start_time, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [fm.title, fm.description, fm.coverImageUrl, fm.streamUrl, fm.status, fm.b, fm.playTokens, fm.lockTime, fm.slug, fm.isFeatured, fm.marketType, fm.eventStartTime, fm.createdAt],
    )

    if (!market) continue
    const marketId = market.id

    // Insert words
    const wordIds: number[] = []
    for (const w of fm.words) {
      const { rows: [row] } = await client.query(
        `INSERT INTO custom_market_words (market_id, word, resolved_outcome) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING RETURNING id`,
        [marketId, w.word, w.outcome ?? null],
      )
      if (row) wordIds.push(row.id)
    }

    if (wordIds.length === 0) continue

    // Process trades for this market (if any)
    const trades = tradesByMarket[mi]
    if (trades && trades.length > 0) {
      // Track pool state per word
      const pools: Record<number, { yesQty: number; noQty: number }> = {}
      for (const wid of wordIds) pools[wid] = { yesQty: 0, noQty: 0 }

      // Track user positions per word
      const positions: Record<string, { yesShares: number; noShares: number; spent: number; received: number }> = {}
      // Track user balances
      const balances: Record<string, number> = {}

      for (const t of trades) {
        const wordId = wordIds[t.wordIdx]
        if (!wordId) continue

        const pool = pools[wordId]
        const wallet = USERS[t.userIdx].wallet
        const posKey = `${wordId}::${wallet}`

        // Initialize balance on first trade
        if (balances[wallet] === undefined) balances[wallet] = fm.playTokens

        // Initialize position
        if (!positions[posKey]) positions[posKey] = { yesShares: 0, noShares: 0, spent: 0, received: 0 }

        // Calculate cost using real LMSR math
        const cost = round6(buyCost(pool.yesQty, pool.noQty, t.side, t.shares, fm.b))

        // Skip if insufficient balance
        if (balances[wallet] < cost) continue

        // Update pool
        if (t.side === 'YES') pool.yesQty = round6(pool.yesQty + t.shares)
        else pool.noQty = round6(pool.noQty + t.shares)

        // Update position
        const pos = positions[posKey]
        if (t.side === 'YES') pos.yesShares = round6(pos.yesShares + t.shares)
        else pos.noShares = round6(pos.noShares + t.shares)
        pos.spent = round6(pos.spent + cost)

        // Update balance
        balances[wallet] = round6(balances[wallet] - cost)

        // Calculate implied price after trade
        const price = impliedPrice(pool.yesQty, pool.noQty, fm.b)

        // Insert trade record
        const ts = hoursAgo(t.hoursAgo)
        await client.query(
          `INSERT INTO custom_market_trades (market_id, word_id, wallet, action, side, shares, cost, yes_price, no_price, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [marketId, wordId, wallet, t.action, t.side, t.shares, cost, price.yes, price.no, ts],
        )

        // Insert price history
        await client.query(
          `INSERT INTO custom_market_price_history (word_id, yes_price, no_price, recorded_at)
           VALUES ($1, $2, $3, $4)`,
          [wordId, price.yes, price.no, ts],
        )

        totalTrades++
      }

      // Insert final pool states
      for (const wid of wordIds) {
        const p = pools[wid]
        await client.query(
          `INSERT INTO custom_market_word_pools (word_id, yes_qty, no_qty)
           VALUES ($1, $2, $3)
           ON CONFLICT (word_id) DO NOTHING`,
          [wid, p.yesQty, p.noQty],
        )
      }

      // Insert positions
      for (const [key, pos] of Object.entries(positions)) {
        if (pos.yesShares === 0 && pos.noShares === 0) continue
        const [widStr, wallet] = key.split('::')
        const wordId = Number(widStr)
        await client.query(
          `INSERT INTO custom_market_positions (market_id, word_id, wallet, yes_shares, no_shares, tokens_spent, tokens_received)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (word_id, wallet) DO NOTHING`,
          [marketId, wordId, wallet, pos.yesShares, pos.noShares, pos.spent, pos.received],
        )
        totalPositions++
      }

      // Insert balances
      for (const [wallet, balance] of Object.entries(balances)) {
        await client.query(
          `INSERT INTO custom_market_balances (market_id, wallet, balance) VALUES ($1, $2, $3)
           ON CONFLICT (market_id, wallet) DO NOTHING`,
          [marketId, wallet, balance],
        )
      }
    } else {
      // No trades — just set initial pool states at 0/0
      for (const wid of wordIds) {
        await client.query(
          `INSERT INTO custom_market_word_pools (word_id, yes_qty, no_qty) VALUES ($1, 0, 0)
           ON CONFLICT (word_id) DO NOTHING`,
          [wid],
        )
      }
    }

    // For resolved markets: add resolution payouts to positions
    if (fm.status === 'resolved') {
      // Simulate that some users had positions and got paid out
      // Market 3: C9 vs FaZe — resolved
      if (mi === 2) {
        // mentioned_fan won on "dominant" (YES, resolved true) and lost on "upset" (YES, resolved false)
        await client.query(
          `INSERT INTO custom_market_positions (market_id, word_id, wallet, yes_shares, no_shares, tokens_spent, tokens_received)
           VALUES ($1, $2, $3, 25, 0, 200, 250)
           ON CONFLICT (word_id, wallet) DO NOTHING`,
          [marketId, wordIds[0], USERS[3].wallet],
        )
        await client.query(
          `INSERT INTO custom_market_positions (market_id, word_id, wallet, yes_shares, no_shares, tokens_spent, tokens_received)
           VALUES ($1, $2, $3, 10, 0, 100, 0)
           ON CONFLICT (word_id, wallet) DO NOTHING`,
          [marketId, wordIds[1], USERS[3].wallet],
        )
        // cryptowizard won on "momentum" (YES, resolved true)
        await client.query(
          `INSERT INTO custom_market_positions (market_id, word_id, wallet, yes_shares, no_shares, tokens_spent, tokens_received)
           VALUES ($1, $2, $3, 30, 0, 240, 300)
           ON CONFLICT (word_id, wallet) DO NOTHING`,
          [marketId, wordIds[2], USERS[0].wallet],
        )
        // moonbetter was on NO for "choking" (NO, resolved false = won)
        await client.query(
          `INSERT INTO custom_market_positions (market_id, word_id, wallet, yes_shares, no_shares, tokens_spent, tokens_received)
           VALUES ($1, $2, $3, 0, 20, 150, 200)
           ON CONFLICT (word_id, wallet) DO NOTHING`,
          [marketId, wordIds[3], USERS[1].wallet],
        )

        // Set resolved pool states
        const resolvedPools = [
          { yesQty: 55, noQty: 8 },   // dominant — resolved YES, heavy YES
          { yesQty: 10, noQty: 40 },  // upset — resolved NO, heavy NO
          { yesQty: 45, noQty: 12 },  // momentum — resolved YES
          { yesQty: 5,  noQty: 35 },  // choking — resolved NO
        ]
        for (let i = 0; i < Math.min(wordIds.length, resolvedPools.length); i++) {
          await client.query(
            `UPDATE custom_market_word_pools SET yes_qty = $2, no_qty = $3 WHERE word_id = $1`,
            [wordIds[i], resolvedPools[i].yesQty, resolvedPools[i].noQty],
          )
        }

        // Balances reflect remaining tokens after trading
        await client.query(
          `INSERT INTO custom_market_balances (market_id, wallet, balance) VALUES ($1, $2, 700)
           ON CONFLICT (market_id, wallet) DO NOTHING`,
          [marketId, USERS[3].wallet],
        )
        await client.query(
          `INSERT INTO custom_market_balances (market_id, wallet, balance) VALUES ($1, $2, 760)
           ON CONFLICT (market_id, wallet) DO NOTHING`,
          [marketId, USERS[0].wallet],
        )
        await client.query(
          `INSERT INTO custom_market_balances (market_id, wallet, balance) VALUES ($1, $2, 850)
           ON CONFLICT (market_id, wallet) DO NOTHING`,
          [marketId, USERS[1].wallet],
        )

        totalPositions += 4
      }

      // Market 7: Fnatic vs G2 — resolved
      if (mi === 6) {
        // alpha_hunter won on "rivalry" (YES, true) and "comeback" (YES, true)
        await client.query(
          `INSERT INTO custom_market_positions (market_id, word_id, wallet, yes_shares, no_shares, tokens_spent, tokens_received)
           VALUES ($1, $2, $3, 15, 0, 110, 150)
           ON CONFLICT (word_id, wallet) DO NOTHING`,
          [marketId, wordIds[0], USERS[7].wallet],
        )
        await client.query(
          `INSERT INTO custom_market_positions (market_id, word_id, wallet, yes_shares, no_shares, tokens_spent, tokens_received)
           VALUES ($1, $2, $3, 12, 0, 95, 120)
           ON CONFLICT (word_id, wallet) DO NOTHING`,
          [marketId, wordIds[3], USERS[7].wallet],
        )
        // degen_dana bet NO on "choke" (NO, resolved false = won) and YES on "stomp" (YES, resolved false = lost)
        await client.query(
          `INSERT INTO custom_market_positions (market_id, word_id, wallet, yes_shares, no_shares, tokens_spent, tokens_received)
           VALUES ($1, $2, $3, 0, 18, 130, 180)
           ON CONFLICT (word_id, wallet) DO NOTHING`,
          [marketId, wordIds[2], USERS[5].wallet],
        )
        await client.query(
          `INSERT INTO custom_market_positions (market_id, word_id, wallet, yes_shares, no_shares, tokens_spent, tokens_received)
           VALUES ($1, $2, $3, 8, 0, 70, 0)
           ON CONFLICT (word_id, wallet) DO NOTHING`,
          [marketId, wordIds[4], USERS[5].wallet],
        )
        // betsy_bets: YES on "legacy" (true = won)
        await client.query(
          `INSERT INTO custom_market_positions (market_id, word_id, wallet, yes_shares, no_shares, tokens_spent, tokens_received)
           VALUES ($1, $2, $3, 10, 0, 80, 100)
           ON CONFLICT (word_id, wallet) DO NOTHING`,
          [marketId, wordIds[1], USERS[9].wallet],
        )

        // Resolved pool states
        const resolvedPools7 = [
          { yesQty: 35, noQty: 10 },  // rivalry — YES
          { yesQty: 28, noQty: 8 },   // legacy — YES
          { yesQty: 8,  noQty: 30 },  // choke — NO
          { yesQty: 32, noQty: 6 },   // comeback — YES
          { yesQty: 12, noQty: 25 },  // stomp — NO
        ]
        for (let i = 0; i < Math.min(wordIds.length, resolvedPools7.length); i++) {
          await client.query(
            `UPDATE custom_market_word_pools SET yes_qty = $2, no_qty = $3 WHERE word_id = $1`,
            [wordIds[i], resolvedPools7[i].yesQty, resolvedPools7[i].noQty],
          )
        }

        await client.query(
          `INSERT INTO custom_market_balances (market_id, wallet, balance) VALUES ($1, $2, 395)
           ON CONFLICT (market_id, wallet) DO NOTHING`,
          [marketId, USERS[7].wallet],
        )
        await client.query(
          `INSERT INTO custom_market_balances (market_id, wallet, balance) VALUES ($1, $2, 400)
           ON CONFLICT (market_id, wallet) DO NOTHING`,
          [marketId, USERS[5].wallet],
        )
        await client.query(
          `INSERT INTO custom_market_balances (market_id, wallet, balance) VALUES ($1, $2, 520)
           ON CONFLICT (market_id, wallet) DO NOTHING`,
          [marketId, USERS[9].wallet],
        )

        totalPositions += 5
      }
    }

    console.log(`    → Market ${mi + 1}: "${fm.title.slice(0, 40)}..." [${fm.status}]`)
  }

  console.log(`    → ${FREE_MARKETS.length} free markets, ${totalTrades} trades, ${totalPositions} positions`)
}

async function seedVisitLogs(client: pg.PoolClient) {
  console.log('  Seeding visit logs...')
  const visits: Array<{ wallet: string; daysAgo: number }> = []

  // Power users: daily visits
  for (let d = 0; d < 14; d++) {
    visits.push({ wallet: USERS[0].wallet, daysAgo: d })
    if (d < 10) visits.push({ wallet: USERS[1].wallet, daysAgo: d })
  }

  // Active users: frequent visits
  for (let d = 0; d < 7; d++) {
    visits.push({ wallet: USERS[2].wallet, daysAgo: d })
    visits.push({ wallet: USERS[5].wallet, daysAgo: d })
    if (d < 5) visits.push({ wallet: USERS[3].wallet, daysAgo: d })
    if (d < 4) visits.push({ wallet: USERS[7].wallet, daysAgo: d })
  }

  // Moderate users: a few visits
  for (const u of [USERS[4], USERS[6], USERS[8], USERS[9], USERS[10], USERS[11]]) {
    const count = 2 + Math.floor(Math.random() * 3)
    for (let d = 0; d < count; d++) {
      visits.push({ wallet: u.wallet, daysAgo: d * 2 })
    }
  }

  // Light users: 1-2 visits
  for (const u of [USERS[12], USERS[14], USERS[15]]) {
    visits.push({ wallet: u.wallet, daysAgo: 0 })
    if (Math.random() > 0.5) visits.push({ wallet: u.wallet, daysAgo: 1 })
  }

  for (const v of visits) {
    const visitDate = daysAgo(v.daysAgo)
    const dateStr = visitDate.toISOString().slice(0, 10)
    // week_start = Monday of the visit's week
    const d = new Date(visitDate)
    const day = d.getUTCDay()
    const diff = day === 0 ? 6 : day - 1
    d.setUTCDate(d.getUTCDate() - diff)
    const weekStartStr = d.toISOString().slice(0, 10)

    await client.query(
      `INSERT INTO user_visit_logs (wallet, visit_date, week_start, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (wallet, visit_date) DO NOTHING`,
      [v.wallet, dateStr, weekStartStr, visitDate],
    )
  }
  console.log(`    → ${visits.length} visit logs`)
}

async function seedFollows(client: pg.PoolClient) {
  console.log('  Seeding user follows...')

  // A realistic graph: power users have many followers, lurker follows everyone,
  // some mutual relationships among active traders. Indices map to USERS[].
  const cryptowizard   = USERS[0].wallet
  const moonbetter     = USERS[1].wallet
  const tradingpete    = USERS[2].wallet
  const mentionedFan   = USERS[3].wallet
  const solanaShark    = USERS[4].wallet
  const degenDana      = USERS[5].wallet
  const whaleWatcher   = USERS[6].wallet
  const alphaHunter    = USERS[7].wallet
  const casualCarl     = USERS[8].wallet
  const betsyBets      = USERS[9].wallet
  const chartChad      = USERS[10].wallet
  const hodlQueen      = USERS[11].wallet
  const newbieNick     = USERS[12].wallet
  const lurkerLucy     = USERS[13].wallet
  const firstTimer     = USERS[14].wallet
  const weekendWarrior = USERS[15].wallet

  // [follower, followee, days ago they followed]
  const follows: Array<[string, string, number]> = [
    // cryptowizard is widely followed
    [moonbetter,     cryptowizard, 40],
    [tradingpete,    cryptowizard, 32],
    [mentionedFan,   cryptowizard, 28],
    [solanaShark,    cryptowizard, 25],
    [degenDana,      cryptowizard, 22],
    [whaleWatcher,   cryptowizard, 20],
    [alphaHunter,    cryptowizard, 18],
    [casualCarl,     cryptowizard, 15],
    [betsyBets,      cryptowizard, 12],
    [chartChad,      cryptowizard, 10],
    [hodlQueen,      cryptowizard,  8],
    [newbieNick,     cryptowizard,  6],
    [firstTimer,     cryptowizard,  4],
    [weekendWarrior, cryptowizard,  2],

    // moonbetter is popular too
    [tradingpete,    moonbetter, 30],
    [mentionedFan,   moonbetter, 26],
    [solanaShark,    moonbetter, 22],
    [whaleWatcher,   moonbetter, 18],
    [alphaHunter,    moonbetter, 14],
    [chartChad,      moonbetter, 10],
    [hodlQueen,      moonbetter,  6],

    // Mutual relationships among the active core
    [cryptowizard, moonbetter,    35],
    [cryptowizard, solanaShark,   24],
    [cryptowizard, alphaHunter,   16],
    [moonbetter,   tradingpete,   28],
    [moonbetter,   solanaShark,   20],
    [solanaShark,  alphaHunter,   12],
    [alphaHunter,  solanaShark,   11],
    [degenDana,    moonbetter,    18],
    [degenDana,    solanaShark,   14],
    [whaleWatcher, alphaHunter,    9],
    [whaleWatcher, degenDana,      7],

    // mentioned_fan follows lots of people — useful test viewer
    [mentionedFan, tradingpete,   24],
    [mentionedFan, solanaShark,   20],
    [mentionedFan, degenDana,     16],
    [mentionedFan, whaleWatcher,  12],
    [mentionedFan, alphaHunter,    8],
    [mentionedFan, chartChad,      4],

    // Lurker follows almost everyone with activity
    [lurkerLucy, cryptowizard,  7],
    [lurkerLucy, moonbetter,    7],
    [lurkerLucy, tradingpete,   7],
    [lurkerLucy, mentionedFan,  7],
    [lurkerLucy, solanaShark,   6],
    [lurkerLucy, degenDana,     6],
    [lurkerLucy, whaleWatcher,  5],
    [lurkerLucy, alphaHunter,   5],
    [lurkerLucy, chartChad,     4],
    [lurkerLucy, betsyBets,     3],

    // Casual relationships
    [casualCarl,     degenDana,     14],
    [betsyBets,      hodlQueen,      8],
    [chartChad,      solanaShark,    8],
    [hodlQueen,      moonbetter,     6],
    [newbieNick,     alphaHunter,    4],
    [firstTimer,     mentionedFan,   3],
    [weekendWarrior, tradingpete,    1],
  ]

  for (const [follower, followee, days] of follows) {
    await client.query(
      `INSERT INTO user_follows (follower_wallet, followee_wallet, created_at)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [follower, followee, daysAgo(days)],
    )
  }

  console.log(`    → ${follows.length} follow relationships`)
}

async function seedActivityEvents(client: pg.PoolClient) {
  console.log('  Seeding activity events...')

  // Just enough recent activity that any test user with a few follows sees a
  // populated feed. Mix of all four activity types. Timestamps in hours so
  // the feed shows "Xh ago" / "Xd ago" cleanly.
  type Item = {
    actor: string
    type: 'polymarket_trade' | 'onchain_trade' | 'free_trade' | 'achievement_unlocked'
    targetId: string
    metadata: Record<string, unknown>
    hoursAgo: number
  }

  const items: Item[] = []
  let seq = 0
  const next = () => ++seq

  // Helper: build a polymarket_trade item
  const poly = (actor: string, evtIdx: number, isYes: boolean, isBuy: boolean, amountUsd: string, hours: number): Item => {
    const evt = POLY_EVENTS[evtIdx % POLY_EVENTS.length]
    return {
      actor,
      type: 'polymarket_trade',
      targetId: `seed_poly:${next()}`,
      metadata: {
        eventId: evt.eventId,
        marketId: evt.marketId,
        marketTitle: evt.title,
        isYes,
        isBuy,
        side: isYes ? 'YES' : 'NO',
        amountUsd,
      },
      hoursAgo: hours,
    }
  }

  // Helper: on-chain trade
  const onchain = (actor: string, marketIdx: number, direction: 0 | 1, isBuy: boolean, cost: number, hours: number): Item => {
    const m = ONCHAIN_MARKETS[marketIdx % ONCHAIN_MARKETS.length]
    const wordIndex = Math.floor(Math.random() * m.words.length)
    return {
      actor,
      type: 'onchain_trade',
      targetId: `seed_onchain:${next()}`,
      metadata: {
        marketId: String(m.marketId),
        wordIndex,
        direction,
        isBuy,
        quantity: Math.round(cost * 10) / 10,
        cost,
        impliedPrice: 0.45 + Math.random() * 0.2,
      },
      hoursAgo: hours,
    }
  }

  // Helper: free market trade. Free markets aren't seeded with stable IDs from
  // here, so use seedable placeholder fields the renderer can display.
  const free = (actor: string, marketTitle: string, word: string, side: 'YES' | 'NO', shares: number, cost: number, hours: number): Item => ({
    actor,
    type: 'free_trade',
    targetId: `seed_free:${next()}`,
    metadata: {
      marketId: 1,
      marketTitle,
      marketSlug: null,
      wordId: 1,
      word,
      action: 'buy',
      side,
      shares,
      cost,
      yesPrice: side === 'YES' ? 0.62 : 0.38,
      noPrice: side === 'YES' ? 0.38 : 0.62,
    },
    hoursAgo: hours,
  })

  const ach = (actor: string, id: string, emoji: string, title: string, points: number, hours: number): Item => ({
    actor,
    type: 'achievement_unlocked',
    // Use a unique seed-prefixed key so this doesn't collide with the real
    // weekly-rotation dedup pattern (`ach:<id>:<weekStart>`).
    targetId: `seed_ach:${actor.slice(0, 6)}:${id}:${next()}`,
    metadata: { achievementId: id, emoji, title, points },
    hoursAgo: hours,
  })

  // cryptowizard — recent active
  items.push(
    poly(USERS[0].wallet, 5, true,  true,  '45000000', 1),
    poly(USERS[0].wallet, 5, true,  false, '55000000', 4),
    onchain(USERS[0].wallet, 0, 0, true, 0.85, 10),
    ach(USERS[0].wallet, 'free_trade', '🎮', 'Play Money', 60, 30),
  )

  // moonbetter — recent
  items.push(
    poly(USERS[1].wallet, 6, false, true, '25000000', 2),
    poly(USERS[1].wallet, 3, true,  true, '30000000', 8),
    onchain(USERS[1].wallet, 1, 1, true, 0.4, 14),
    ach(USERS[1].wallet, 'set_profile', '🏷️', 'Make It Official', 40, 26),
  )

  // tradingpete
  items.push(
    poly(USERS[2].wallet, 7, true, true, '12000000', 3),
    poly(USERS[2].wallet, 5, true, true, '10000000', 24),
    free(USERS[2].wallet, 'Will the analyst say "bull market"?', 'bull market', 'YES', 50, 25, 6),
  )

  // mentioned_fan
  items.push(
    poly(USERS[3].wallet, 6, true, true, '11000000',  5),
    free(USERS[3].wallet, 'Will the CEO say "AI"?', 'AI', 'YES', 80, 50, 18),
    ach(USERS[3].wallet, 'send_chat', '💬', 'Say Something', 40, 40),
  )

  // solana_shark — big bets
  items.push(
    poly(USERS[4].wallet, 7, true, true, '80000000', 6),
    onchain(USERS[4].wallet, 2, 0, true, 1.2, 16),
    poly(USERS[4].wallet, 2, false, true, '60000000', 36),
  )

  // degen_dana — high frequency, smaller amounts
  for (let i = 0; i < 6; i++) {
    items.push(poly(USERS[5].wallet, i, i % 2 === 0, true, String(3000000 + i * 1500000), 2 + i * 4))
  }
  items.push(ach(USERS[5].wallet, 'free_trade', '🎮', 'Play Money', 60, 50))

  // whale_watcher
  items.push(
    poly(USERS[6].wallet, 1, true, true, '18000000', 9),
    free(USERS[6].wallet, 'Will the host say "GG"?', 'GG', 'NO', 30, 18, 22),
  )

  // alpha_hunter
  items.push(
    poly(USERS[7].wallet, 4, false, true, '22000000', 7),
    onchain(USERS[7].wallet, 0, 1, true, 0.65, 28),
    ach(USERS[7].wallet, 'free_trade', '🎮', 'Play Money', 60, 60),
  )

  // chart_chad, hodl_queen, betsy_bets — light recent activity
  items.push(
    poly(USERS[10].wallet, 2, true, true, '6000000', 11),
    poly(USERS[11].wallet, 3, false, true, '8000000', 13),
    poly(USERS[9].wallet,  4, true, true, '4500000', 15),
  )

  for (const item of items) {
    await client.query(
      `INSERT INTO activity_events (actor_wallet, activity_type, target_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (activity_type, target_id, actor_wallet) WHERE target_id IS NOT NULL DO NOTHING`,
      [item.actor, item.type, item.targetId, JSON.stringify(item.metadata), hoursAgo(item.hoursAgo)],
    )
  }

  console.log(`    → ${items.length} activity events`)
}

async function seedAdminAuditLog(client: pg.PoolClient) {
  console.log('  Seeding admin audit log...')
  const adminWallet = USERS[0].wallet // cryptowizard as admin

  const entries = [
    { action: 'create_market',  targetId: 'GG-stg001',     payload: { title: 'Will "GG" be said...' },           hoursAgo: 72 },
    { action: 'create_market',  targetId: 'NAVI-stg002',   payload: { title: 'NaVi vs Vitality...' },             hoursAgo: 24 },
    { action: 'update_market',  targetId: 'SENLOUD-stg004', payload: { status: 'locked', reason: 'event started' }, hoursAgo: 6 },
    { action: 'resolve_market', targetId: 'C9FAZE-stg003', payload: { words_resolved: 4 },                         hoursAgo: 48 },
    { action: 'resolve_market', targetId: 'FNG2-stg007',   payload: { words_resolved: 5 },                         hoursAgo: 96 },
    { action: 'feature_market', targetId: 'GG-stg001',     payload: { is_featured: true },                         hoursAgo: 70 },
  ]

  for (const e of entries) {
    const ts = hoursAgo(e.hoursAgo)
    await client.query(
      `INSERT INTO admin_audit_log (wallet, action, target_id, payload, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [adminWallet, e.action, e.targetId, JSON.stringify(e.payload), ts],
    )
  }
  console.log(`    → ${entries.length} admin audit entries`)
}

// ── Main ──────────────────────────────────────────────────────────────────

async function seed() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await seedUserProfiles(client)
    await seedPolymarketTrades(client)
    await seedTradeEvents(client)
    await seedMarketMetadata(client)
    await seedEventStreams(client)
    await seedGlobalChat(client)
    await seedEventChat(client)
    await seedPointEvents(client)
    await seedAchievements(client)
    await seedVisitLogs(client)
    await seedFreeMarkets(client)
    await seedFollows(client)
    await seedActivityEvents(client)
    await seedAdminAuditLog(client)

    await client.query('COMMIT')
    console.log('\n  Staging seed complete.')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function main() {
  console.log('Running staging seed...')
  console.log(`  Database: ${dbUrl.replace(/\/\/[^@]+@/, '//***@')}`)
  await seed()
  console.log('Done.')
  await pool.end()
}

main().catch((err) => {
  console.error('Staging seed failed:', err)
  process.exit(1)
})
