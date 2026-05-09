// Daily cost watchdog. Periodically sums cost_cents across today's
// monitored_streams and:
//
//   - Posts a Discord alert when the daily total first crosses
//     DAILY_COST_CENTS_ALERT (~$20 default).
//   - Stops accepting new spawns once the total crosses
//     DAILY_COST_CENTS_HALT (~$50 default). Existing streams continue.
//
// "Today" is UTC. The crossing-state is keyed by date so each day gets a
// fresh chance to alert/halt; once the day rolls over the flags reset.
//
// The cost figure is drawn from `monitored_streams.cost_cents`, which each
// StreamWorker updates every minute. So the watchdog lags real cost by up
// to 60 seconds — fine for a budget alarm, not fine for billing.

import { pool } from './db'
import { log } from './log'
import { isWebhookConfigured, postWebhook } from './discord'

export interface CostGuardOptions {
  alertCents: number
  haltCents: number
  /** How often to recompute the daily total. Defaults to 5 min. */
  tickIntervalMs?: number
}

const DEFAULT_TICK_MS = 5 * 60_000

export class CostGuard {
  private timer: NodeJS.Timeout | null = null
  private alertedDates = new Set<string>()
  private haltedDates = new Set<string>()
  private latestDailyCents = 0
  private stopped = false

  constructor(private readonly opts: CostGuardOptions) {}

  start(): void {
    if (this.timer) return
    if (this.stopped) return
    // First check immediately so a worker that boots into an over-budget day
    // doesn't accept new spawns.
    void this.tick().catch(() => {})
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err)
        log.warn('cost guard tick failed', { err: msg })
      })
    }, this.opts.tickIntervalMs ?? DEFAULT_TICK_MS)
    this.timer.unref()
    log.info('cost guard started', {
      alertCents: this.opts.alertCents,
      haltCents: this.opts.haltCents,
    })
  }

  stop(): void {
    this.stopped = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** True if today's spend has crossed the halt threshold. */
  isHalted(): boolean {
    return this.haltedDates.has(todayUtc())
  }

  /** Latest known daily total (cents). For diagnostics. */
  dailyCents(): number {
    return this.latestDailyCents
  }

  private async tick(): Promise<void> {
    const date = todayUtc()
    const cents = await this.fetchDailyCents()
    this.latestDailyCents = cents

    if (this.opts.haltCents > 0 && cents >= this.opts.haltCents && !this.haltedDates.has(date)) {
      this.haltedDates.add(date)
      log.warn('cost guard: HALT threshold crossed', {
        date,
        dailyCents: cents,
        haltCents: this.opts.haltCents,
      })
      if (isWebhookConfigured()) {
        void postWebhook(
          [
            '🛑 **Transcript-worker daily cost halt**',
            '',
            `Today (UTC ${date}) Deepgram cost has reached **${formatCents(cents)}** ` +
              `(halt threshold ${formatCents(this.opts.haltCents)}). Worker is no longer ` +
              `accepting new streams. Existing streams continue to completion.`,
            '',
            'Investigate which streams are running and either let them finish or end them manually.',
          ].join('\n'),
        )
      }
      return
    }

    if (this.opts.alertCents > 0 && cents >= this.opts.alertCents && !this.alertedDates.has(date)) {
      this.alertedDates.add(date)
      log.warn('cost guard: ALERT threshold crossed', {
        date,
        dailyCents: cents,
        alertCents: this.opts.alertCents,
      })
      if (isWebhookConfigured()) {
        void postWebhook(
          [
            '⚠️ **Transcript-worker daily cost alert**',
            '',
            `Today (UTC ${date}) Deepgram cost is **${formatCents(cents)}** ` +
              `(alert threshold ${formatCents(this.opts.alertCents)}, halt threshold ${formatCents(this.opts.haltCents)}).`,
            '',
            'No action required yet. Monitor the dashboard.',
          ].join('\n'),
        )
      }
    }
  }

  private async fetchDailyCents(): Promise<number> {
    // Sum cost_cents for streams created today UTC. Multi-day streams are
    // counted on the day they were created, which slightly under-counts on
    // day N+1 but is good enough for a budget alarm.
    const res = await pool.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(cost_cents), 0)::TEXT AS total
         FROM monitored_streams
        WHERE created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    )
    const raw = res.rows[0]?.total ?? '0'
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  }
}

function todayUtc(): string {
  // YYYY-MM-DD in UTC.
  return new Date().toISOString().slice(0, 10)
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
