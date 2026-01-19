import type { TournamentStateV2 } from '../domain/types'
import { normalizeTournamentState } from './tournamentStore'
import { supabase } from './supabaseClient'

export type CloudSyncStatus = 'disabled' | 'connecting' | 'connected' | 'error'

export function getTournamentIdFromUrl(): string | null {
  // Supports both:
  // - Browser URLs: /path?tid=...
  // - HashRouter URLs on GitHub Pages: /#/route?tid=...
  const u = new URL(window.location.href)
  const direct = u.searchParams.get('tid')
  if (direct) return direct

  const hash = u.hash || ''
  const idx = hash.indexOf('?')
  if (idx === -1) return null
  const qs = hash.slice(idx + 1)
  return new URLSearchParams(qs).get('tid')
}

export function setTournamentIdInUrl(tid: string) {
  const u = new URL(window.location.href)

  // If we're on HashRouter and already have a hash route, keep tid in the hash query.
  if (u.hash.includes('#/')) {
    const [pathPart, queryPart] = u.hash.split('?')
    const sp = new URLSearchParams(queryPart ?? '')
    sp.set('tid', tid)
    u.hash = `${pathPart}?${sp.toString()}`
    window.history.replaceState({}, '', u.toString())
    return
  }

  // Otherwise set it as normal query param.
  u.searchParams.set('tid', tid)
  window.history.replaceState({}, '', u.toString())
}

export function shouldEnableCloudSync(): boolean {
  // enable when tid is present, or when explicitly requested via ?cloud=1
  const u = new URL(window.location.href)
  const direct = u.searchParams.get('cloud') === '1'
  const hash = u.hash || ''
  const idx = hash.indexOf('?')
  const hashParams = idx === -1 ? new URLSearchParams('') : new URLSearchParams(hash.slice(idx + 1))
  const hashCloud = hashParams.get('cloud') === '1'
  return !!getTournamentIdFromUrl() || direct || hashCloud
}

export function ensureTournamentIdInUrl(): string {
  const existing = getTournamentIdFromUrl()
  if (existing) return existing
  const tid = crypto.randomUUID()
  setTournamentIdInUrl(tid)
  return tid
}

export async function ensureTournamentRow(tid: string) {
  if (!supabase) throw new Error('Supabase not configured')

  // Check if exists
  const { data, error } = await supabase.from('tournaments').select('id').eq('id', tid).maybeSingle()
  if (error) throw error
  if (data?.id) return

  // Create empty row
  const { error: insErr } = await supabase.from('tournaments').insert({ id: tid, state: null })
  if (insErr) throw insErr
}

export function connectCloudSync(args: {
  tid: string
  onStatus: (s: CloudSyncStatus) => void
  onRemoteState: (s: TournamentStateV2) => void
}): { pushState: (s: TournamentStateV2) => Promise<void>; close: () => void } {
  const { tid, onStatus, onRemoteState } = args

  const sb = supabase
  if (!sb) {
    onStatus('disabled')
    return {
      pushState: async () => {},
      close: () => {},
    }
  }

  onStatus('connecting')

  const channel = sb
    .channel(`tournaments:${tid}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${tid}` },
      (payload) => {
        const next = (payload.new as any)?.state
        const normalized = normalizeTournamentState(next)
        if (normalized) onRemoteState(normalized)
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onStatus('connected')
      else onStatus('error')
    })

  return {
    pushState: async (s) => {
      // Store state JSON into the row; updatedAt is inside state and drives last-write-wins.
      const { error } = await sb
        .from('tournaments')
        .update({ state: s, updated_at: new Date().toISOString() })
        .eq('id', tid)
      if (error) throw error
    },
    close: () => {
      sb.removeChannel(channel)
    },
  }
}

