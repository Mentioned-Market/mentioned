import 'dotenv/config'
import pg from 'pg'

// ── Guard: local DB only ───────────────────────────────────────────────────

const dbUrl = process.env.DATABASE_URL ?? ''

if (!dbUrl.includes('localhost') && !dbUrl.includes('127.0.0.1')) {
  console.error('Seed script refused: DATABASE_URL does not point to localhost.')
  console.error('This script is for local development only.')
  process.exit(1)
}

// ── DB connection ──────────────────────────────────────────────────────────

const pool = new pg.Pool({ connectionString: dbUrl, ssl: false })

// ── Test users ────────────────────────────────────────────────────────────
//
// Solana-style base58 addresses (fake, for local dev only).

const USERS = [
  {
    wallet: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    username: 'cryptowizard',
    joinedDaysAgo: 45,
  },
  {
    wallet: 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH',
    username: 'moonbetter',
    joinedDaysAgo: 30,
  },
  {
    wallet: '9WzDXwBMT6XuaTHM4KvXRhbhLs1nYXENAuvgKNNBYRRh',
    username: 'tradingpete',
    joinedDaysAgo: 14,
  },
  {
    wallet: '6sp2ZFAjNYGbHnMtFJB3yGvdq8x7KjLwCfPeS4mNDAKT',
    username: 'mentioned_fan',
    joinedDaysAgo: 7,
  },
]

// Fake Polymarket market / event IDs (hex format matching Polymarket's convention)
const MARKETS = [
  { marketId: '0xa1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2', eventId: 'evt-001-local', marketTitle: 'T1 vs Gen.G — World Finals' },
  { marketId: '0xb2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3', eventId: 'evt-002-local', marketTitle: 'NaVi vs Vitality — ESL Major' },
  { marketId: '0xc3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4', eventId: 'evt-003-local', marketTitle: 'Cloud9 vs FaZe — IEM Katowice' },
]

// ── Helpers ────────────────────────────────────────────────────────────────

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

// ── Seed ──────────────────────────────────────────────────────────────────

async function seed() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // ── User profiles ──────────────────────────────────────────────────────
    console.log('  Seeding user profiles...')
    for (const u of USERS) {
      const joinedAt = daysAgo(u.joinedDaysAgo)
      await client.query(
        `INSERT INTO user_profiles (wallet, username, created_at, updated_at)
         VALUES ($1, $2, $3, $3)
         ON CONFLICT (wallet) DO NOTHING`,
        [u.wallet, u.username, joinedAt],
      )
    }

    // ── Polymarket trades ──────────────────────────────────────────────────
    // Used for points and for recording trading activity.
    // Amount is in micro-USD (millionths of a dollar), matching Jupiter's format.
    console.log('  Seeding polymarket trades...')
    const trades = [
      // cryptowizard — active trader, this week + older
      { wallet: USERS[0].wallet, ...MARKETS[0], isYes: true,  isBuy: true,  side: 'YES', amount: '15000000', daysAgo: 2 },
      { wallet: USERS[0].wallet, ...MARKETS[0], isYes: true,  isBuy: false, side: 'YES', amount: '18500000', daysAgo: 1 },
      { wallet: USERS[0].wallet, ...MARKETS[1], isYes: false, isBuy: true,  side: 'NO',  amount: '8000000',  daysAgo: 20 },
      { wallet: USERS[0].wallet, ...MARKETS[2], isYes: true,  isBuy: true,  side: 'YES', amount: '22000000', daysAgo: 30 },
      // moonbetter — moderate, mostly this week
      { wallet: USERS[1].wallet, ...MARKETS[0], isYes: false, isBuy: true,  side: 'NO',  amount: '9500000',  daysAgo: 3 },
      { wallet: USERS[1].wallet, ...MARKETS[1], isYes: true,  isBuy: true,  side: 'YES', amount: '12000000', daysAgo: 5 },
      { wallet: USERS[1].wallet, ...MARKETS[1], isYes: true,  isBuy: false, side: 'YES', amount: '14000000', daysAgo: 4 },
      // tradingpete — new user, small trades
      { wallet: USERS[2].wallet, ...MARKETS[2], isYes: true,  isBuy: true,  side: 'YES', amount: '3000000',  daysAgo: 1 },
      { wallet: USERS[2].wallet, ...MARKETS[0], isYes: false, isBuy: true,  side: 'NO',  amount: '2500000',  daysAgo: 2 },
      // mentioned_fan — single trade
      { wallet: USERS[3].wallet, ...MARKETS[1], isYes: true,  isBuy: true,  side: 'YES', amount: '5000000',  daysAgo: 1 },
    ]

    for (const t of trades) {
      const tradeTime = daysAgo(t.daysAgo)
      const sig = `seed_${t.wallet.slice(0, 6)}_${t.marketId.slice(-6)}_${t.daysAgo}d`
      await client.query(
        `INSERT INTO polymarket_trades
           (wallet, market_id, event_id, is_yes, is_buy, side, amount_usd, tx_signature, market_title, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT DO NOTHING`,
        [t.wallet, t.marketId, t.eventId, t.isYes, t.isBuy, t.side, t.amount, sig, t.marketTitle, tradeTime],
      )
    }

    // ── Point events ───────────────────────────────────────────────────────
    console.log('  Seeding point events...')
    const points = [
      // cryptowizard: lots of activity
      { wallet: USERS[0].wallet, action: 'trade_placed', pts: 10, refId: 'seed_trade_w0_1', hoursAgo: 48 },
      { wallet: USERS[0].wallet, action: 'trade_placed', pts: 10, refId: 'seed_trade_w0_2', hoursAgo: 36 },
      { wallet: USERS[0].wallet, action: 'trade_placed', pts: 10, refId: 'seed_trade_w0_3', hoursAgo: 24 },
      { wallet: USERS[0].wallet, action: 'claim_won',    pts: 50, refId: 'seed_win_w0_1',   hoursAgo: 20 },
      { wallet: USERS[0].wallet, action: 'chat_message', pts: 1,  refId: 'seed_chat_w0_1',  hoursAgo: 10 },
      { wallet: USERS[0].wallet, action: 'chat_message', pts: 1,  refId: 'seed_chat_w0_2',  hoursAgo: 8  },
      { wallet: USERS[0].wallet, action: 'chat_message', pts: 1,  refId: 'seed_chat_w0_3',  hoursAgo: 6  },
      { wallet: USERS[0].wallet, action: 'hold_4h',      pts: 5,  refId: 'seed_hold_w0_1',  hoursAgo: 5  },
      // moonbetter: good win rate
      { wallet: USERS[1].wallet, action: 'trade_placed', pts: 10, refId: 'seed_trade_w1_1', hoursAgo: 72 },
      { wallet: USERS[1].wallet, action: 'trade_placed', pts: 10, refId: 'seed_trade_w1_2', hoursAgo: 60 },
      { wallet: USERS[1].wallet, action: 'claim_won',    pts: 50, refId: 'seed_win_w1_1',   hoursAgo: 50 },
      { wallet: USERS[1].wallet, action: 'claim_won',    pts: 50, refId: 'seed_win_w1_2',   hoursAgo: 30 },
      { wallet: USERS[1].wallet, action: 'chat_message', pts: 1,  refId: 'seed_chat_w1_1',  hoursAgo: 12 },
      { wallet: USERS[1].wallet, action: 'hold_1h',      pts: 2,  refId: 'seed_hold_w1_1',  hoursAgo: 4  },
      { wallet: USERS[1].wallet, action: 'hold_24h',     pts: 10, refId: 'seed_hold_w1_2',  hoursAgo: 2  },
      // tradingpete: new, small points
      { wallet: USERS[2].wallet, action: 'trade_placed', pts: 10, refId: 'seed_trade_w2_1', hoursAgo: 30 },
      { wallet: USERS[2].wallet, action: 'chat_message', pts: 1,  refId: 'seed_chat_w2_1',  hoursAgo: 5  },
      // mentioned_fan: just started
      { wallet: USERS[3].wallet, action: 'trade_placed', pts: 10, refId: 'seed_trade_w3_1', hoursAgo: 20 },
      { wallet: USERS[3].wallet, action: 'chat_message', pts: 1,  refId: 'seed_chat_w3_1',  hoursAgo: 3  },
    ]

    for (const p of points) {
      const ts = hoursAgo(p.hoursAgo)
      await client.query(
        `INSERT INTO point_events (wallet, action, points, ref_id, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (wallet, action, ref_id) WHERE ref_id IS NOT NULL DO NOTHING`,
        [p.wallet, p.action, p.pts, p.refId, ts],
      )
    }

    // ── Chat messages ──────────────────────────────────────────────────────
    console.log('  Seeding chat messages...')
    const chats = [
      { user: USERS[0], msg: 'gm everyone, who caught the speech market?', hoursAgo: 10 },
      { user: USERS[1], msg: 'already up 40% on YES for "economy"',         hoursAgo: 9  },
      { user: USERS[2], msg: 'just joined, what markets are hot rn?',        hoursAgo: 8  },
      { user: USERS[0], msg: 'check the earnings call market dropping soon', hoursAgo: 7  },
      { user: USERS[3], msg: 'this is actually genius lol',                  hoursAgo: 6  },
      { user: USERS[1], msg: 'closing my NO position before the call',       hoursAgo: 4  },
      { user: USERS[2], msg: 'how do deposits work?',                        hoursAgo: 3  },
      { user: USERS[0], msg: 'hit the deposit button top right, SOL only',   hoursAgo: 2  },
    ]

    for (const c of chats) {
      const ts = hoursAgo(c.hoursAgo)
      await client.query(
        `INSERT INTO chat_messages (wallet, username, message, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [c.user.wallet, c.user.username, c.msg, ts],
      )
    }

    await client.query('COMMIT')
    console.log(`  Done. Seeded ${USERS.length} users, ${trades.length} trades, ${points.length} point events, ${chats.length} chat messages.`)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function main() {
  console.log('Running seed...')
  await seed()
  console.log('Seed complete.')
  await pool.end()
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
