import pg from 'pg'

const dbUrl = process.env.DATABASE_URL ?? ''
const sslDisabled = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')
  || dbUrl.includes('sslmode=disable') || process.env.DB_SSL === 'false'

export interface ChatNotification {
  channel: string
  id: number
  wallet: string
  username: string
  message: string
  created_at: string
  event_id?: string
  pfp_emoji?: string | null
}

type ChatCallback = (payload: ChatNotification) => void

class ChatStreamManager {
  private client: pg.Client | null = null
  private connecting = false
  private listeners = new Map<string, Set<ChatCallback>>()
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
        console.error('[chatStream] Client error:', err.message)
        this.handleDisconnect()
      })

      client.on('end', () => {
        this.handleDisconnect()
      })

      client.on('notification', (msg) => {
        if (msg.channel !== 'chat_new' || !msg.payload) return
        try {
          const data = JSON.parse(msg.payload) as ChatNotification
          const callbacks = this.listeners.get(data.channel)
          if (callbacks) {
            for (const cb of callbacks) {
              try { cb(data) } catch {}
            }
          }
        } catch {
          console.error('[chatStream] Failed to parse notification payload')
        }
      })

      await client.connect()
      await client.query('LISTEN chat_new')
      this.client = client
      console.log('[chatStream] Connected and listening')
    } catch (err) {
      console.error('[chatStream] Connection failed:', (err as Error).message)
      // Clean up partially-connected client to avoid leaks
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
    if (this.listeners.size === 0) return // No subscribers, don't reconnect
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.reconnectDelay)
  }

  subscribe(channel: string, callback: ChatCallback): () => void {
    let set = this.listeners.get(channel)
    if (!set) {
      set = new Set()
      this.listeners.set(channel, set)
    }
    set.add(callback)

    // Ensure connected
    if (!this.client && !this.connecting) {
      this.connect()
    }

    return () => {
      const s = this.listeners.get(channel)
      if (s) {
        s.delete(callback)
        if (s.size === 0) this.listeners.delete(channel)
      }
    }
  }

  /** Number of active subscriptions across all channels */
  get subscriberCount(): number {
    let count = 0
    for (const set of this.listeners.values()) count += set.size
    return count
  }
}

// Singleton — survives Next.js hot reloads in dev
const globalForChat = globalThis as unknown as { _chatStream?: ChatStreamManager }
export const chatStream = globalForChat._chatStream ?? (globalForChat._chatStream = new ChatStreamManager())
