import { Pool, PoolConfig } from 'pg'
import { log } from './log'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required')
}

const config: PoolConfig = {
  connectionString: databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
}

// Railway internal Postgres uses TLS but with a self-signed cert by default.
// SSL is enabled on hosted DBs (Railway, Supabase, etc.) — opt-in via env to keep
// local Docker setups simple.
if (process.env.PGSSL === 'require' || databaseUrl.includes('sslmode=require')) {
  config.ssl = { rejectUnauthorized: false }
}

export const pool = new Pool(config)

pool.on('error', (err) => {
  log.error('pg pool error', { err: err.message })
})

export async function ping(): Promise<void> {
  await pool.query('SELECT 1')
}
