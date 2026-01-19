import type { TournamentStateV2 } from '../domain/types'
import { normalizeTournamentState } from './tournamentStore'
import { supabase } from './supabaseClient'

export type CloudSyncStatus = 'disabled' | 'connecting' | 'connected' | 'error'

export function getTournamentIdFromUrl(): string | null {
  const u = new URL(window.location.href)
  return u.searchParams.get('tid')
}

export function setTournamentIdInUrl(tid: string) {
  const u = new URL(window.location.href)
  u.searchParams.set('tid', tid)
  window.history.replaceState({}, '', u.toString())
}

export function shouldEnableCloudSync(): boolean {
  // enable when tid is present (and env vars exist)
  return !!getTournamentIdFromUrl()
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

