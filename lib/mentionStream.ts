import pg from 'pg'

const dbUrl = process.env.DATABASE_URL ?? ''
const sslDisabled = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')
  || dbUrl.includes('sslmode=disable') || process.env.DB_SSL === 'false'

// Worker NOTIFY payload (fat — see streamWorker.ts:persistMention). Field
// shape is forward-compatible: missing fields are tolerated, unknown
// fields are ignored. Both 'mention' (new hit) and 'dismiss' (admin
// flagged false positive) ride the same channel keyed by streamId.
export interface MentionNotification {
  type: 'mention' | 'dismiss'
  streamId: number
  mentionId: number
  wordIndex: number
  // The remaining fields are present on type='mention'. type='dismiss'
  // only needs the dedupe keys above so the client can decrement counters
  // and remove the snippet from its recent list.
  eventId?: string
  word?: string
  matchedText?: string
  streamOffsetMs?: number
  snippet?: string
  confidence?: number | null
  createdAt?: string
}

type MentionCallback = (payload: MentionNotification) => void

class MentionStreamManager {
  private client: pg.Client | null = null
  private connecting = false
  // streamId → callbacks. Multiple admins on the same stream share fanout.
  private listeners = new Map<number, Set<MentionCallback>>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 5000

  async connect(): Promise<void> {
    if (this.client || this.connecting) return
    this.connecting = true

    let client: pg.Client | null = null
    try {
      client = new pg.Client({
        connectionString: dbUrl,
        ssl: sslDisabled ? false : { rejectUnauthorized: false },
      })

      client.on('error', (err) => {
        console.error('[mentionStream] Client error:', err.message)
        this.handleDisconnect()
      })

      client.on('end', () => {
        this.handleDisconnect()
      })

      client.on('notification', (msg) => {
        if (msg.channel !== 'word_mention' || !msg.payload) return
        let data: MentionNotification
        try {
          const parsed = JSON.parse(msg.payload) as Partial<MentionNotification>
          if (typeof parsed.streamId !== 'number') return
          // Default missing type to 'mention' for forward-compat with any
          // pre-fat-payload worker still in rotation during a deploy.
          data = { type: parsed.type ?? 'mention', ...parsed } as MentionNotification
        } catch {
          console.error('[mentionStream] Failed to parse notification payload')
          return
        }

        const callbacks = this.listeners.get(data.streamId)
        if (!callbacks) return
        for (const cb of callbacks) {
          try { cb(data) } catch {}
        }
      })

      await client.connect()
      await client.query('LISTEN word_mention')
      this.client = client
      console.log('[mentionStream] Connected and listening')
    } catch (err) {
      console.error('[mentionStream] Connection failed:', (err as Error).message)
      if (client) {
        try { await client.end() } catch {}
      }
      this.scheduleReconnect()
    } finally {
      this.connecting = false
    }
  }

  private handleDisconnect(): void {
    this.client = null
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    if (this.listeners.size === 0) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.reconnectDelay)
  }

  subscribe(streamId: number, callback: MentionCallback): () => void {
    let set = this.listeners.get(streamId)
    if (!set) {
      set = new Set()
      this.listeners.set(streamId, set)
    }
    set.add(callback)

    if (!this.client && !this.connecting) {
      this.connect()
    }

    return () => {
      const s = this.listeners.get(streamId)
      if (s) {
        s.delete(callback)
        if (s.size === 0) this.listeners.delete(streamId)
      }
    }
  }

  get subscriberCount(): number {
    let count = 0
    for (const set of this.listeners.values()) count += set.size
    return count
  }
}

const globalForMentions = globalThis as unknown as { _mentionStream?: MentionStreamManager }
export const mentionStream = globalForMentions._mentionStream
  ?? (globalForMentions._mentionStream = new MentionStreamManager())
