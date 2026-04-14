// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**
// // **DO NOT RUN THIS**

// import 'dotenv/config'
// import pg from 'pg'
// import readline from 'readline'

// const dbUrl = process.env.DATABASE_URL ?? ''
// const pool = new pg.Pool({ connectionString: dbUrl })

// function confirm(question: string): Promise<boolean> {
//   const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
//   return new Promise((resolve) => {
//     rl.question(question, (answer) => {
//       rl.close()
//       resolve(answer.trim().toLowerCase() === 'yes')
//     })
//   })
// }

// async function main() {
//   // const host = new URL(dbUrl).hostname
//   console.log(`Database host: ${host}`)
//   console.log('')
//   console.log('This will DELETE all trades, positions, balances, points,')
//   console.log('achievements, chat messages, and visit logs.')
//   console.log('It will RESET free market pools to zero and reopen resolved markets.')
//   console.log('Profiles and market definitions will be preserved.')
//   console.log('')

//   const ok = await confirm('Type "yes" to proceed: ')
//   if (!ok) {
//     console.log('Aborted.')
//     await pool.end()
//     process.exit(0)
//   }

//   console.log('')

//   // const client = await pool.connect()
//   try {
//     await client.query('BEGIN')

//     // Clear trades
//     await client.query('TRUNCATE trade_events')
//     console.log('  Cleared trade_events')

//     await client.query('TRUNCATE polymarket_trades')
//     console.log('  Cleared polymarket_trades')

//     await client.query('TRUNCATE custom_market_trades')
//     console.log('  Cleared custom_market_trades')

//     // Clear positions & balances
//     await client.query('TRUNCATE custom_market_positions')
//     console.log('  Cleared custom_market_positions')

//     await client.query('TRUNCATE custom_market_balances')
//     console.log('  Cleared custom_market_balances')

//     await client.query('TRUNCATE custom_market_price_history')
//     console.log('  Cleared custom_market_price_history')

//     // Clear points & achievements
//     await client.query('TRUNCATE point_events')
//     console.log('  Cleared point_events')

//     await client.query('TRUNCATE user_achievements')
//     console.log('  Cleared user_achievements')

//     await client.query('TRUNCATE user_visit_logs')
//     console.log('  Cleared user_visit_logs')

//     // Clear chat
//     await client.query('TRUNCATE chat_messages')
//     console.log('  Cleared chat_messages')

//     await client.query('TRUNCATE event_chat_messages')
//     console.log('  Cleared event_chat_messages')

//     // Reset free market pool state (keep rows, zero out quantities)
//     const pools = await client.query(
//       'UPDATE custom_market_word_pools SET yes_qty = 0, no_qty = 0, updated_at = NOW()'
//     )
//     console.log(`  Reset ${pools.rowCount} word pool(s) to zero`)

//     // Reset resolved/locked markets back to open
//     const markets = await client.query(
//       "UPDATE custom_markets SET status = 'open' WHERE status IN ('locked', 'resolved')"
//     )
//     console.log(`  Reset ${markets.rowCount} market(s) back to open`)

//     const words = await client.query(
//       'UPDATE custom_market_words SET resolved_outcome = NULL WHERE resolved_outcome IS NOT NULL'
//     )
//     console.log(`  Cleared ${words.rowCount} resolved outcome(s)`)

//     await client.query('COMMIT')
//     console.log('\nDone. All activity data cleared. Profiles and markets intact.')
//   } catch (err) {
//     await client.query('ROLLBACK')
//     console.error('Failed, rolled back:', err)
//     process.exit(1)
//   } finally {
//     client.release()
//     await pool.end()
//   }
// }

// main()
