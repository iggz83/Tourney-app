import type { TournamentStateV2 } from '../domain/types'
import { normalizeTournamentState } from './tournamentStore'

export type SyncStatus = 'disabled' | 'connecting' | 'connected' | 'error'

export function getDefaultSyncUrl(): string {
  // If the TV hits http://SCORE-PC:5173, then ws://SCORE-PC:8787 will work by default.
  return `ws://${window.location.hostname}:8787`
}

export function shouldEnableSync(): boolean {
  // Enable if explicitly asked via query param: ?sync=1
  const sp = new URLSearchParams(window.location.search)
  return sp.get('sync') === '1'
}

export function connectSync(args: {
  url: string
  onStatus: (s: SyncStatus) => void
  onRemoteState: (s: TournamentStateV2) => void
}): { sendState: (s: TournamentStateV2) => void; close: () => void } {
  const { url, onStatus, onRemoteState } = args

  let ws: WebSocket | null = null
  let closed = false

  const open = () => {
    if (closed) return
    onStatus('connecting')
    ws = new WebSocket(url)

    ws.onopen = () => {
      onStatus('connected')
    }

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data))
        if (msg?.type === 'state') {
          const normalized = normalizeTournamentState(msg.state)
          if (normalized) onRemoteState(normalized)
        }
      } catch {
        // ignore
      }
    }

    ws.onerror = () => {
      onStatus('error')
    }

    ws.onclose = () => {
      onStatus('error')
      ws = null
      // Simple retry
      if (!closed) setTimeout(open, 1500)
    }
  }

  open()

  return {
    sendState: (s) => {
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'state', state: s }))
        }
      } catch {
        // ignore
      }
    },
    close: () => {
      closed = true
      try {
        ws?.close()
      } catch {
        // ignore
      }
    },
  }
}

