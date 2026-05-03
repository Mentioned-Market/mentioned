/**
 * Seed 20 test teams into any DB (including staging).
 * Pulls existing wallets from user_profiles to use as captains/members.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx ts-node -r tsconfig-paths/register scripts/seed-teams.ts
 */

import 'dotenv/config'
import pg from 'pg'

const dbUrl = process.env.DATABASE_URL ?? ''
if (!dbUrl) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')
    ? false
    : { rejectUnauthorized: false },
})

// ── Team names ─────────────────────────────────────────────────────────────

const TEAM_NAMES = [
  'Superteam Ireland',
  'Superteam Germany',
  'Superteam UK',
  'Superteam USA',
  'Superteam India',
  'Superteam Nigeria',
  'Superteam France',
  'Superteam Turkey',
  'Superteam Brazil',
  'Superteam Japan',
  'Superteam Canada',
  'Superteam Australia',
  'Superteam Spain',
  'Superteam Netherlands',
  'Superteam Poland',
  'Superteam UAE',
  'Superteam Korea',
  'Superteam Italy',
  'Superteam Mexico',
  'Superteam Singapore',
]

// ── Helpers ────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function generateCode(seed: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  let n = seed * 31 + 17
  for (let i = 0; i < 6; i++) {
    n = (n * 1664525 + 1013904223) & 0x7fffffff
    code += chars[n % chars.length]
  }
  return code
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const client = await pool.connect()
  try {
    // Grab wallets that are NOT already in a real (non-seed) team
    const { rows: profileRows } = await client.query<{ wallet: string }>(
      `SELECT up.wallet FROM user_profiles up
       WHERE up.wallet NOT IN (
         SELECT tm.wallet FROM team_members tm
         JOIN teams t ON t.id = tm.team_id
         WHERE t.slug NOT LIKE 'superteam-%'
           AND t.slug NOT IN ('alpha-strike','beta-force','gamma-squad','delta-unit','epsilon-rising',
                              'zeta-warriors','theta-crew','iota-collective','kappa-order','lambda-pack',
                              'sigma-division','omicron-band','rho-syndicate','tau-alliance','phi-faction',
                              'chi-legion','psi-core','omega-hunters','apex-vortex','nova-squad')
       )
       ORDER BY created_at DESC LIMIT 60`,
    )
    const wallets = profileRows.map(r => r.wallet)

    if (wallets.length < 3) {
      console.error(`Only ${wallets.length} user profiles found — need at least 3.`)
      process.exit(1)
    }

    console.log(`Found ${wallets.length} user profiles — creating 20 teams...`)

    const COMP_START = new Date('2026-05-04T00:00:00.000Z')

    await client.query('BEGIN')

    // Clean up previous seed data so we can re-run idempotently
    await client.query(`DELETE FROM point_events WHERE ref_id LIKE 'seed_team_%'`)
    // Remove seed team members and teams (slugs match 'superteam-*' or old alpha/beta/etc slugs)
    await client.query(`
      DELETE FROM team_members WHERE team_id IN (
        SELECT id FROM teams WHERE slug LIKE 'superteam-%'
          OR slug IN ('alpha-strike','beta-force','gamma-squad','delta-unit','epsilon-rising',
                      'zeta-warriors','theta-crew','iota-collective','kappa-order','lambda-pack',
                      'sigma-division','omicron-band','rho-syndicate','tau-alliance','phi-faction',
                      'chi-legion','psi-core','omega-hunters','apex-vortex','nova-squad')
      )
    `)
    await client.query(`
      DELETE FROM teams WHERE slug LIKE 'superteam-%'
        OR slug IN ('alpha-strike','beta-force','gamma-squad','delta-unit','epsilon-rising',
                    'zeta-warriors','theta-crew','iota-collective','kappa-order','lambda-pack',
                    'sigma-division','omicron-band','rho-syndicate','tau-alliance','phi-faction',
                    'chi-legion','psi-core','omega-hunters','apex-vortex','nova-squad')
    `)

    let walletCursor = 0

    for (let i = 0; i < 20; i++) {
      const name = TEAM_NAMES[i]
      const slug = slugify(name)
      const code = generateCode(i + 100)

      // Pick a captain
      const captainWallet = wallets[walletCursor % wallets.length]
      walletCursor++

      // Upsert team (skip if slug already exists)
      const { rows: [team] } = await client.query<{ id: number }>(
        `INSERT INTO teams (name, slug, join_code, created_by, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (slug) WHERE slug IS NOT NULL DO UPDATE SET name = EXCLUDED.name, join_code = EXCLUDED.join_code
         RETURNING id`,
        [name, slug, code, captainWallet],
      )

      // Add captain (skip if wallet already in a team)
      await client.query(
        `INSERT INTO team_members (team_id, wallet, role, joined_at)
         VALUES ($1, $2, 'captain', NOW())
         ON CONFLICT (wallet) DO NOTHING`,
        [team.id, captainWallet],
      )

      // Add 0, 1, or 2 more members — rotate through team sizes
      const extraMembers = i % 3  // 0 → solo, 1 → 2-person, 2 → full squad
      for (let j = 0; j < extraMembers; j++) {
        const memberWallet = wallets[walletCursor % wallets.length]
        walletCursor++
        await client.query(
          `INSERT INTO team_members (team_id, wallet, role, joined_at)
           VALUES ($1, $2, 'member', NOW())
           ON CONFLICT (wallet) DO NOTHING`,
          [team.id, memberWallet],
        )
      }

      // Fetch the members actually inserted (respects conflicts)
      const { rows: memberRows } = await client.query<{ wallet: string }>(
        `SELECT wallet FROM team_members WHERE team_id = $1`,
        [team.id],
      )

      // Award deterministic points after comp start so standings show up
      // Higher-ranked teams (lower i) get more points — creates a realistic spread
      const teamBasePoints = (20 - i) * 250
      for (let m = 0; m < memberRows.length; m++) {
        const memberWallet = memberRows[m].wallet
        // Each member gets a slightly different share of the team base
        const memberPoints = Math.floor(teamBasePoints * (1 - m * 0.25) / memberRows.length)
        if (memberPoints <= 0) continue

        const refId = `seed_team_${i}_m${m}`
        await client.query(
          `INSERT INTO point_events (wallet, action, points, ref_id, created_at)
           VALUES ($1, 'trade_placed', $2, $3, $4)`,
          [memberWallet, memberPoints, refId, COMP_START],
        )
      }

      const memberCount = memberRows.length
      console.log(`  [${i + 1}/20] ${name} (${code}) — ${memberCount} member${memberCount === 1 ? '' : 's'}, ~${teamBasePoints} pts`)
    }

    await client.query('COMMIT')
    console.log('\nDone. 20 teams seeded successfully.')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Seed failed:', err)
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
