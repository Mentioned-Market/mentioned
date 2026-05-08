import http from 'node:http'
import { ping } from './db'
import { log } from './log'

interface HealthState {
  ready: () => boolean
  startedAt: number
  activeStreams: () => number
}

export function startHealthServer(state: HealthState): http.Server {
  const port = Number(process.env.PORT) || 3001
  const server = http.createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(400).end()
      return
    }

    if (req.url === '/health') {
      try {
        await ping()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        res.writeHead(503, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'db', detail: msg }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        ok: true,
        ready: state.ready(),
        uptimeSeconds: Math.floor((Date.now() - state.startedAt) / 1000),
        activeStreams: state.activeStreams(),
      }))
      return
    }

    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('mentioned transcript-worker\n')
      return
    }

    res.writeHead(404).end()
  })

  server.listen(port, () => {
    log.info('health server listening', { port })
  })

  return server
}
