/**
 * Simple LAN sync server for the tournament state.
 *
 * - Stores ONE tournament state in memory (last-write-wins by updatedAt)
 * - WebSocket broadcast to all connected clients
 * - HTTP endpoints for health and snapshot
 *
 * Usage:
 *   node server/sync-server.cjs
 *
 * Env:
 *   PORT=8787
 */

const express = require('express')
const cors = require('cors')
const http = require('http')
const { WebSocketServer } = require('ws')

const PORT = Number(process.env.PORT || 8787)

const app = express()
app.use(cors())
app.use(express.json({ limit: '5mb' }))

/** @type {any | null} */
let state = null

function isNewer(a, b) {
  // Compare ISO strings safely; fall back to Date parsing.
  if (!a || !b) return false
  if (typeof a === 'string' && typeof b === 'string') return a > b
  return new Date(a).getTime() > new Date(b).getTime()
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, hasState: !!state, updatedAt: state?.updatedAt ?? null })
})

app.get('/state', (_req, res) => {
  if (!state) return res.status(204).end()
  res.json(state)
})

app.post('/state', (req, res) => {
  const next = req.body
  if (!next || typeof next !== 'object') return res.status(400).json({ ok: false, error: 'Invalid body' })

  if (!state || isNewer(next.updatedAt, state.updatedAt)) {
    state = next
    broadcast({ type: 'state', state })
  }
  res.json({ ok: true, updatedAt: state?.updatedAt ?? null })
})

const server = http.createServer(app)
const wss = new WebSocketServer({ server })

/** @type {Set<any>} */
const sockets = new Set()

function broadcast(msg) {
  const payload = JSON.stringify(msg)
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(payload)
  }
}

wss.on('connection', (ws) => {
  sockets.add(ws)

  // Send current snapshot on connect
  if (state) {
    ws.send(JSON.stringify({ type: 'state', state }))
  } else {
    ws.send(JSON.stringify({ type: 'hello' }))
  }

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(String(data))
      if (msg?.type === 'state' && msg.state) {
        const next = msg.state
        if (!state || isNewer(next.updatedAt, state.updatedAt)) {
          state = next
          broadcast({ type: 'state', state })
        }
      }
    } catch {
      // ignore
    }
  })

  ws.on('close', () => {
    sockets.delete(ws)
  })
})

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[sync] listening on http://0.0.0.0:${PORT} (ws://0.0.0.0:${PORT})`)
})

