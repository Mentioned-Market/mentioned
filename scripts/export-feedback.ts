import 'dotenv/config'
import pg from 'pg'
import fs from 'fs'
import path from 'path'

const dbUrl = process.env.DATABASE_URL ?? ''
const sslDisabled = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')
  || dbUrl.includes('sslmode=disable') || process.env.DB_SSL === 'false'

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: sslDisabled ? false : { rejectUnauthorized: false },
})

const SAD_IF_GONE_LABELS: Record<string, string> = {
  very_disappointed:      'Very disappointed',
  somewhat_disappointed:  'Somewhat disappointed',
  not_disappointed:       'Not disappointed',
}

const REAL_MONEY_LABELS: Record<string, string> = {
  definitely:  'Definitely',
  maybe:       'Maybe',
  not_likely:  'Not likely',
}

function escapeCsv(value: string | null | undefined): string {
  if (value == null) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

async function main() {
  const result = await pool.query(`
    SELECT
      fs.id,
      fs.wallet,
      up.username,
      fs.honest_thoughts,
      fs.sad_if_gone,
      fs.improvements,
      fs.real_money,
      fs.extra,
      fs.created_at
    FROM feedback_submissions fs
    LEFT JOIN user_profiles up ON up.wallet = fs.wallet
    ORDER BY fs.created_at ASC
  `)

  const headers = [
    'id',
    'wallet',
    'username',
    'honest_thoughts',
    'sad_if_gone',
    'improvements',
    'real_money',
    'extra',
    'submitted_at',
  ]

  const rows = result.rows.map((r) => [
    r.id,
    r.wallet,
    r.username ?? '',
    r.honest_thoughts,
    SAD_IF_GONE_LABELS[r.sad_if_gone] ?? r.sad_if_gone,
    r.improvements,
    REAL_MONEY_LABELS[r.real_money] ?? r.real_money,
    r.extra ?? '',
    new Date(r.created_at).toISOString(),
  ])

  const csv = [
    headers.map(escapeCsv).join(','),
    ...rows.map((row) => row.map(escapeCsv).join(',')),
  ].join('\n')

  const outPath = path.join(process.cwd(), 'feedback-export.csv')
  fs.writeFileSync(outPath, csv, 'utf8')

  console.log(`Exported ${rows.length} row(s) to ${outPath}`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
