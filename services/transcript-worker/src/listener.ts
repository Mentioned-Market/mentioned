import { Client } from 'pg'
import { log } from './log'

export type ChannelName = 'stream_added' | 'stream_canceled'

export interface NotificationHandler {
  (channel: ChannelName, payload: string): void | Promise<void>
}

const RECONNECT_DELAY_MS = [1_000, 3_000, 9_000, 30_000] as const

export class StreamListener {
  private client: Client | null = null
  private stopping = false
  private attempt = 0

  constructor(
    private databaseUrl: string,
    private channels: ChannelName[],
    private onNotify: NotificationHandler,
  ) {}

  async start(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.connectOnce()
        this.attempt = 0
        // Block until connection error/close. The Promise resolves only when
        // the client disconnects, which surfaces as an error event below.
        await new Promise<void>((resolve, reject) => {
          if (!this.client) return reject(new Error('client missing'))
          this.client.on('error', (err) => reject(err))
          this.client.on('end', () => resolve())
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.warn('listener disconnected', { err: msg, attempt: this.attempt })
      }

      if (this.stopping) break

      const delay = RECONNECT_DELAY_MS[Math.min(this.attempt, RECONNECT_DELAY_MS.length - 1)]
      this.attempt++
      log.info('listener reconnecting', { delayMs: delay, attempt: this.attempt })
      await sleep(delay)
    }
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.client) {
      try {
        await this.client.end()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.warn('listener stop error', { err: msg })
      }
      this.client = null
    }
  }

  private async connectOnce(): Promise<void> {
    const client = new Client({
      connectionString: this.databaseUrl,
      ssl: process.env.PGSSL === 'require' || this.databaseUrl.includes('sslmode=require')
        ? { rejectUnauthorized: false }
        : undefined,
    })
    await client.connect()
    for (const channel of this.channels) {
      await client.query(`LISTEN ${channel}`)
    }
    client.on('notification', (msg) => {
      const channel = msg.channel as ChannelName
      const payload = msg.payload ?? ''
      log.debug('notification received', { channel, payload })
      Promise.resolve(this.onNotify(channel, payload)).catch((err) => {
        const m = err instanceof Error ? err.message : String(err)
        log.error('notification handler error', { channel, err: m })
      })
    })
    this.client = client
    log.info('listener connected', { channels: this.channels })
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
