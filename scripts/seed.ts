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
    pfpEmoji: '🏆',
    joinedDaysAgo: 45,
  },
  {
    wallet: 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH',
    username: 'moonbetter',
    pfpEmoji: '🎮',
    joinedDaysAgo: 30,
  },
  {
    wallet: '9WzDXwBMT6XuaTHM4KvXRhbhLs1nYXENAuvgKNNBYRRh',
    username: 'tradingpete',
    pfpEmoji: null,
    joinedDaysAgo: 14,
  },
  {
    wallet: '6sp2ZFAjNYGbHnMtFJB3yGvdq8x7KjLwCfPeS4mNDAKT',
    username: 'mentioned_fan',
    pfpEmoji: null,
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
        `INSERT INTO user_profiles (wallet, username, pfp_emoji, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (wallet) DO NOTHING`,
        [u.wallet, u.username, u.pfpEmoji, joinedAt],
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

    // ── User achievements ────────────────────────────────────────────────────
    // IDs must match lib/achievements.ts (current week's set).
    // week_start is the Monday of the current ISO week (UTC) — matches getWeekStart().
    console.log('  Seeding achievements...')
    const achievements = [
      // cryptowizard: active user, many achievements this week
      { wallet: USERS[0].wallet, id: 'set_profile',    pts: 40,  hoursAgo: 60 },
      { wallet: USERS[0].wallet, id: 'send_chat',      pts: 40,  hoursAgo: 50 },
      { wallet: USERS[0].wallet, id: 'free_trade',     pts: 60,  hoursAgo: 48 },
      { wallet: USERS[0].wallet, id: 'win_free_trade', pts: 100, hoursAgo: 20 },
      { wallet: USERS[0].wallet, id: 'daily_login_3',  pts: 50,  hoursAgo: 10 },
      // moonbetter: some achievements
      { wallet: USERS[1].wallet, id: 'set_profile',    pts: 40,  hoursAgo: 70 },
      { wallet: USERS[1].wallet, id: 'send_chat',      pts: 40,  hoursAgo: 65 },
      { wallet: USERS[1].wallet, id: 'free_trade',     pts: 60,  hoursAgo: 40 },
      { wallet: USERS[1].wallet, id: 'daily_login_3',  pts: 50,  hoursAgo: 15 },
      // tradingpete: new, few achievements
      { wallet: USERS[2].wallet, id: 'set_profile',    pts: 40,  hoursAgo: 80 },
      { wallet: USERS[2].wallet, id: 'send_chat',      pts: 40,  hoursAgo: 30 },
      // mentioned_fan: just started
      { wallet: USERS[3].wallet, id: 'set_profile',    pts: 40,  hoursAgo: 25 },
      { wallet: USERS[3].wallet, id: 'free_trade',     pts: 60,  hoursAgo: 15 },
      { wallet: USERS[3].wallet, id: 'win_free_trade', pts: 100, hoursAgo: 10 },
    ]

    for (const a of achievements) {
      const ts = hoursAgo(a.hoursAgo)
      await client.query(
        `INSERT INTO user_achievements (wallet, achievement_id, points_awarded, unlocked_at, week_start)
         VALUES ($1, $2, $3, $4, date_trunc('week', NOW())::date)
         ON CONFLICT (wallet, achievement_id, week_start) DO NOTHING`,
        [a.wallet, a.id, a.pts, ts],
      )
    }

    // ── User visit logs (for login streak achievements) ─────────────────────
    console.log('  Seeding user visit logs...')
    // cryptowizard: visited every day this week so far (first 3 days → daily_login_3 unlocked)
    // moonbetter: visited 3 of the last 3 days
    // tradingpete: visited yesterday only
    const visitLogs = [
      { wallet: USERS[0].wallet, daysAgo: 0 },
      { wallet: USERS[0].wallet, daysAgo: 1 },
      { wallet: USERS[0].wallet, daysAgo: 2 },
      { wallet: USERS[1].wallet, daysAgo: 0 },
      { wallet: USERS[1].wallet, daysAgo: 1 },
      { wallet: USERS[1].wallet, daysAgo: 2 },
      { wallet: USERS[2].wallet, daysAgo: 1 },
    ]
    for (const v of visitLogs) {
      const visitDate = daysAgo(v.daysAgo)
      await client.query(
        `INSERT INTO user_visit_logs (wallet, visit_date, week_start)
         VALUES ($1, $2::date, date_trunc('week', $2::date)::date)
         ON CONFLICT (wallet, visit_date) DO NOTHING`,
        [v.wallet, visitDate],
      )
    }

    // ── Free market point events (custom_market_win) ──────────────────────────
    console.log('  Seeding free market point events...')
    const freePoints = [
      { wallet: USERS[0].wallet, action: 'custom_market_win', pts: 25, refId: 'seed_freewin_w0_1', hoursAgo: 50 },
      { wallet: USERS[0].wallet, action: 'custom_market_win', pts: 40, refId: 'seed_freewin_w0_2', hoursAgo: 30 },
      { wallet: USERS[1].wallet, action: 'custom_market_win', pts: 15, refId: 'seed_freewin_w1_1', hoursAgo: 25 },
      { wallet: USERS[3].wallet, action: 'custom_market_win', pts: 50, refId: 'seed_freewin_w3_1', hoursAgo: 10 },
    ]

    for (const p of freePoints) {
      const ts = hoursAgo(p.hoursAgo)
      await client.query(
        `INSERT INTO point_events (wallet, action, points, ref_id, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (wallet, action, ref_id) WHERE ref_id IS NOT NULL DO NOTHING`,
        [p.wallet, p.action, p.pts, p.refId, ts],
      )
    }

    // ── Free markets (custom markets with virtual LMSR) ──────────────────────
    console.log('  Seeding free markets...')

    // Market 1: Open, active trading
    const { rows: [fm1] } = await client.query(
      `INSERT INTO custom_markets (title, description, status, b_parameter, play_tokens, lock_time, slug, created_at)
       VALUES ($1, $2, 'open', 100, 1000, $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        'Will "GG" be said in the T1 vs Gen.G post-match interview?',
        'Predict which words or phrases will be mentioned during the post-match interview. Market locks 5 minutes before the interview starts.',
        hoursAgo(-48), // lock_time 48 hours from now
        't1-gen-g-seed01',
        daysAgo(3),
      ],
    )

    // Market 2: Open, fresh (no trades yet)
    const { rows: [fm2] } = await client.query(
      `INSERT INTO custom_markets (title, description, status, b_parameter, play_tokens, lock_time, slug, created_at)
       VALUES ($1, $2, 'open', 150, 500, $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        'NaVi vs Vitality — caster word bingo',
        'Which words will the casters say during the grand final? Trade on your predictions before the match starts.',
        hoursAgo(-72), // lock_time 72 hours from now
        'navi-vitality-seed02',
        daysAgo(1),
      ],
    )

    // Market 3: Resolved
    const { rows: [fm3] } = await client.query(
      `INSERT INTO custom_markets (title, description, status, b_parameter, play_tokens, lock_time, slug, created_at)
       VALUES ($1, $2, 'resolved', 100, 1000, $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        'Cloud9 vs FaZe — analyst desk predictions',
        'Which phrases will the analyst desk use when breaking down this match?',
        daysAgo(1), // already past
        'c9-faze-seed03',
        daysAgo(5),
      ],
    )

    if (fm1) {
      // Words for market 1
      const fm1Words = ['GG', 'well played', 'outplayed', 'clutch', 'draft diff']
      const fm1WordIds: number[] = []
      for (const w of fm1Words) {
        const { rows: [row] } = await client.query(
          `INSERT INTO custom_market_words (market_id, word) VALUES ($1, $2)
           ON CONFLICT DO NOTHING RETURNING id`,
          [fm1.id, w],
        )
        if (row) fm1WordIds.push(row.id)
      }

      // Pools with some trading activity (unequal quantities = shifted prices)
      const fm1Pools = [
        { yesQty: 25, noQty: 10 },   // GG — leaning YES ~82%
        { yesQty: 15, noQty: 18 },   // well played — slight NO ~53%
        { yesQty: 8,  noQty: 12 },   // outplayed — slight NO ~60%
        { yesQty: 30, noQty: 5 },    // clutch — heavy YES ~92%
        { yesQty: 10, noQty: 10 },   // draft diff — balanced 50/50
      ]

      for (let i = 0; i < fm1WordIds.length; i++) {
        const pool = fm1Pools[i]
        await client.query(
          `INSERT INTO custom_market_word_pools (word_id, yes_qty, no_qty)
           VALUES ($1, $2, $3)
           ON CONFLICT (word_id) DO NOTHING`,
          [fm1WordIds[i], pool.yesQty, pool.noQty],
        )
      }

      // Positions + balances for users who traded
      // cryptowizard: bought YES on "GG" and "clutch"
      await client.query(
        `INSERT INTO custom_market_positions (market_id, word_id, wallet, yes_shares, no_shares, tokens_spent, tokens_received)
         VALUES ($1, $2, $3, 15, 0, 120, 0)
         ON CONFLICT (word_id, wallet) DO NOTHING`,
        [fm1.id, fm1WordIds[0], USERS[0].wallet],
      )
      await client.query(
        `INSERT INTO custom_market_positions (market_id, word_id, wallet, yes_shares, no_shares, tokens_spent, tokens_received)
         VALUES ($1, $2, $3, 20, 0, 180, 0)
         ON CONFLICT (word_id, wallet) DO NOTHING`,
        [fm1.id, fm1WordIds[3], USERS[0].wallet],
      )
      await client.query(
        `INSERT INTO custom_market_balances (market_id, wallet, balance) VALUES ($1, $2, 700)
         ON CONFLICT (market_id, wallet) DO NOTHING`,
        [fm1.id, USERS[0].wallet],
      )

      // moonbetter: bought NO on "well played", YES on "draft diff"
      await client.query(
        `INSERT INTO custom_market_positions (market_id, word_id, wallet, yes_shares, no_shares, tokens_spent, tokens_received)
         VALUES ($1, $2, $3, 0, 12, 85, 0)
         ON CONFLICT (word_id, wallet) DO NOTHING`,
        [fm1.id, fm1WordIds[1], USERS[1].wallet],
      )
      await client.query(
        `INSERT INTO custom_market_positions (market_id, word_id, wallet, yes_shares, no_shares, tokens_spent, tokens_received)
         VALUES ($1, $2, $3, 8, 0, 55, 0)
         ON CONFLICT (word_id, wallet) DO NOTHING`,
        [fm1.id, fm1WordIds[4], USERS[1].wallet],
      )
      await client.query(
        `INSERT INTO custom_market_balances (market_id, wallet, balance) VALUES ($1, $2, 860)
         ON CONFLICT (market_id, wallet) DO NOTHING`,
        [fm1.id, USERS[1].wallet],
      )

      // Some trade history + price history for charting
      const fm1Trades = [
        { wordIdx: 0, wallet: USERS[0].wallet, action: 'buy', side: 'YES', shares: 15, cost: 120, yesPrice: 0.82, noPrice: 0.18, hoursAgo: 48 },
        { wordIdx: 3, wallet: USERS[0].wallet, action: 'buy', side: 'YES', shares: 20, cost: 180, yesPrice: 0.92, noPrice: 0.08, hoursAgo: 36 },
        { wordIdx: 1, wallet: USERS[1].wallet, action: 'buy', side: 'NO',  shares: 12, cost: 85,  yesPrice: 0.47, noPrice: 0.53, hoursAgo: 24 },
        { wordIdx: 4, wallet: USERS[1].wallet, action: 'buy', side: 'YES', shares: 8,  cost: 55,  yesPrice: 0.50, noPrice: 0.50, hoursAgo: 12 },
        { wordIdx: 2, wallet: USERS[2].wallet, action: 'buy', side: 'NO',  shares: 5,  cost: 40,  yesPrice: 0.40, noPrice: 0.60, hoursAgo: 6  },
      ]

      for (const t of fm1Trades) {
        const ts = hoursAgo(t.hoursAgo)
        await client.query(
          `INSERT INTO custom_market_trades (market_id, word_id, wallet, action, side, shares, cost, yes_price, no_price, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [fm1.id, fm1WordIds[t.wordIdx], t.wallet, t.action, t.side, t.shares, t.cost, t.yesPrice, t.noPrice, ts],
        )
        await client.query(
          `INSERT INTO custom_market_price_history (word_id, yes_price, no_price, recorded_at)
           VALUES ($1, $2, $3, $4)`,
          [fm1WordIds[t.wordIdx], t.yesPrice, t.noPrice, ts],
        )
      }

      // tradingpete: bought NO on "outplayed"
      await client.query(
        `INSERT INTO custom_market_positions (market_id, word_id, wallet, yes_shares, no_shares, tokens_spent, tokens_received)
         VALUES ($1, $2, $3, 0, 5, 40, 0)
         ON CONFLICT (word_id, wallet) DO NOTHING`,
        [fm1.id, fm1WordIds[2], USERS[2].wallet],
      )
      await client.query(
        `INSERT INTO custom_market_balances (market_id, wallet, balance) VALUES ($1, $2, 960)
         ON CONFLICT (market_id, wallet) DO NOTHING`,
        [fm1.id, USERS[2].wallet],
      )
    }

    if (fm2) {
      // Words for market 2 (fresh, no trades — just pools at 50/50)
      const fm2Words = ['insane', 'unbelievable', 'what a play', 'economy', 'ace']
      for (const w of fm2Words) {
        const { rows: [row] } = await client.query(
          `INSERT INTO custom_market_words (market_id, word) VALUES ($1, $2)
           ON CONFLICT DO NOTHING RETURNING id`,
          [fm2.id, w],
        )
        if (row) {
          await client.query(
            `INSERT INTO custom_market_word_pools (word_id, yes_qty, no_qty)
             VALUES ($1, 0, 0) ON CONFLICT (word_id) DO NOTHING`,
            [row.id],
          )
        }
      }
    }

    if (fm3) {
      // Words for market 3 (resolved — some YES, some NO)
      const fm3Words = [
        { word: 'dominant', outcome: true },
        { word: 'upset', outcome: false },
        { word: 'momentum', outcome: true },
        { word: 'choking', outcome: false },
      ]
      const fm3WordIds: number[] = []
      for (const w of fm3Words) {
        const { rows: [row] } = await client.query(
          `INSERT INTO custom_market_words (market_id, word, resolved_outcome) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING RETURNING id`,
          [fm3.id, w.word, w.outcome],
        )
        if (row) fm3WordIds.push(row.id)
      }

      // Pools at final state
      const fm3Pools = [
        { yesQty: 40, noQty: 5 },   // dominant — resolved YES
        { yesQty: 5,  noQty: 35 },  // upset — resolved NO
        { yesQty: 30, noQty: 8 },   // momentum — resolved YES
        { yesQty: 3,  noQty: 28 },  // choking — resolved NO
      ]
      for (let i = 0; i < fm3WordIds.length; i++) {
        await client.query(
          `INSERT INTO custom_market_word_pools (word_id, yes_qty, no_qty)
           VALUES ($1, $2, $3) ON CONFLICT (word_id) DO NOTHING`,
          [fm3WordIds[i], fm3Pools[i].yesQty, fm3Pools[i].noQty],
        )
      }

      // mentioned_fan had positions in this resolved market
      if (fm3WordIds.length >= 4) {
        await client.query(
          `INSERT INTO custom_market_positions (market_id, word_id, wallet, yes_shares, no_shares, tokens_spent, tokens_received)
           VALUES ($1, $2, $3, 25, 0, 200, 250)
           ON CONFLICT (word_id, wallet) DO NOTHING`,
          [fm3.id, fm3WordIds[0], USERS[3].wallet],
        )
        await client.query(
          `INSERT INTO custom_market_positions (market_id, word_id, wallet, yes_shares, no_shares, tokens_spent, tokens_received)
           VALUES ($1, $2, $3, 10, 0, 100, 0)
           ON CONFLICT (word_id, wallet) DO NOTHING`,
          [fm3.id, fm3WordIds[1], USERS[3].wallet],
        )
        await client.query(
          `INSERT INTO custom_market_balances (market_id, wallet, balance) VALUES ($1, $2, 950)
           ON CONFLICT (market_id, wallet) DO NOTHING`,
          [fm3.id, USERS[3].wallet],
        )
      }
    }

    const freeMarketCount = [fm1, fm2, fm3].filter(Boolean).length

    await client.query('COMMIT')
    console.log(`  Done. Seeded ${USERS.length} users, ${trades.length} trades, ${points.length + freePoints.length} point events, ${achievements.length} achievements, ${visitLogs.length} visit logs, ${chats.length} chat messages, ${freeMarketCount} free markets.`)
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
