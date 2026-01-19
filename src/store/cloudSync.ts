import type { Match, TournamentStateV2 } from '../domain/types'
import { normalizeTournamentState } from './tournamentStore'
import { supabase } from './supabaseClient'

export type CloudSyncStatus = 'disabled' | 'connecting' | 'connected' | 'error'

export type TournamentListItem = {
  id: string
  name: string
  created_at: string
  updated_at: string
}

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
    // Trigger HashRouter navigation (replaceState does not).
    window.location.hash = u.hash
    return
  }

  // Otherwise set it as normal query param.
  u.searchParams.set('tid', tid)
  window.history.replaceState({}, '', u.toString())
}

export function clearTournamentIdFromUrl() {
  const u = new URL(window.location.href)
  u.searchParams.delete('tid')
  u.searchParams.delete('cloud')

  if (u.hash.includes('#/')) {
    const [pathPart, queryPart] = u.hash.split('?')
    const sp = new URLSearchParams(queryPart ?? '')
    sp.delete('tid')
    sp.delete('cloud')
    const qs = sp.toString()
    u.hash = qs ? `${pathPart}?${qs}` : pathPart
    window.location.hash = u.hash
    return
  }

  window.history.replaceState({}, '', u.toString())
}

export function setCloudEnabledInUrl(enabled: boolean) {
  const u = new URL(window.location.href)
  if (u.hash.includes('#/')) {
    const [pathPart, queryPart] = u.hash.split('?')
    const sp = new URLSearchParams(queryPart ?? '')
    if (enabled) sp.set('cloud', '1')
    else sp.delete('cloud')
    const qs = sp.toString()
    u.hash = qs ? `${pathPart}?${qs}` : pathPart
    window.location.hash = u.hash
    return
  }
  if (enabled) u.searchParams.set('cloud', '1')
  else u.searchParams.delete('cloud')
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

export async function fetchTournamentCoreState(tid: string): Promise<TournamentStateV2 | null> {
  if (!supabase) throw new Error('Supabase not configured')
  const { data, error } = await supabase.from('tournaments').select('state').eq('id', tid).maybeSingle()
  if (error) throw error
  return normalizeTournamentState(data?.state ?? null)
}

export async function listTournaments(limit = 25): Promise<TournamentListItem[]> {
  if (!supabase) throw new Error('Supabase not configured')
  // If the DB hasn't been migrated yet, `name` might not exist; fall back gracefully.
  const first = await supabase
    .from('tournaments')
    .select('id,name,created_at,updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (!first.error) return (first.data ?? []) as TournamentListItem[]
  if (String(first.error.message).includes('name')) {
    const fallback = await supabase
      .from('tournaments')
      .select('id,created_at,updated_at')
      .order('updated_at', { ascending: false })
      .limit(limit)
    if (fallback.error) throw fallback.error
    return ((fallback.data ?? []) as Array<{ id: string; created_at: string; updated_at: string }>).map((t) => ({
      ...t,
      name: '',
    }))
  }
  throw first.error
}

export async function fetchTournamentName(tid: string): Promise<string> {
  if (!supabase) throw new Error('Supabase not configured')
  const { data, error } = await supabase.from('tournaments').select('name').eq('id', tid).maybeSingle()
  if (error) {
    if (String(error.message).includes('name')) return ''
    throw error
  }
  return (data?.name as string | undefined) ?? ''
}

export async function updateTournamentName(tid: string, name: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured')
  const { error } = await supabase.from('tournaments').update({ name }).eq('id', tid)
  if (error) {
    if (String(error.message).includes('name')) return
    throw error
  }
}

export async function deleteTournament(tid: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured')
  const { error } = await supabase.from('tournaments').delete().eq('id', tid)
  if (error) throw error
}

type MatchRow = {
  tournament_id: string
  match_id: string
  division_id: string
  round: number
  matchup_index: number
  event_type: string
  seed: number
  court: number
  club_a: string
  club_b: string
  score_a: number | null
  score_b: number | null
  completed_at: string | null
  updated_at: string
}

export async function fetchTournamentMatches(tid: string): Promise<Match[]> {
  if (!supabase) throw new Error('Supabase not configured')
  const { data, error } = await supabase
    .from('tournament_matches')
    .select(
      'tournament_id,match_id,division_id,round,matchup_index,event_type,seed,court,club_a,club_b,score_a,score_b,completed_at,updated_at',
    )
    .eq('tournament_id', tid)
  if (error) throw error
  const rows = (data ?? []) as MatchRow[]
  return rows.map((r) => {
    const score = r.score_a == null || r.score_b == null ? undefined : { a: r.score_a, b: r.score_b }
    return {
      id: r.match_id,
      divisionId: r.division_id,
      round: r.round,
      matchupIndex: r.matchup_index,
      eventType: r.event_type as Match['eventType'],
      seed: r.seed,
      court: r.court,
      clubA: r.club_a as Match['clubA'],
      clubB: r.club_b as Match['clubB'],
      score,
      completedAt: r.completed_at ?? undefined,
    }
  })
}

export async function upsertTournamentCoreState(tid: string, core: TournamentStateV2): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured')
  const { error } = await supabase.from('tournaments').update({ state: core }).eq('id', tid)
  if (error) throw error
}

export async function upsertTournamentMatches(tid: string, matches: Match[]): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured')
  // Important: we replace the schedule rows so stale matches from previous schedules
  // don't linger in Supabase and "come back" on other devices.
  const { error: delErr } = await supabase.from('tournament_matches').delete().eq('tournament_id', tid)
  if (delErr) throw delErr
  if (matches.length === 0) return
  const payload = matches.map((m) => ({
    tournament_id: tid,
    match_id: m.id,
    division_id: m.divisionId,
    round: m.round,
    matchup_index: m.matchupIndex,
    event_type: m.eventType,
    seed: m.seed,
    court: m.court,
    club_a: m.clubA,
    club_b: m.clubB,
    score_a: m.score?.a ?? null,
    score_b: m.score?.b ?? null,
    completed_at: m.completedAt ?? null,
  }))
  const { error } = await supabase.from('tournament_matches').upsert(payload, { onConflict: 'tournament_id,match_id' })
  if (error) throw error
}

export async function setTournamentMatchScore(args: {
  tid: string
  matchId: string
  score?: { a: number; b: number }
}): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured')
  const { tid, matchId, score } = args
  const update = score
    ? { score_a: score.a, score_b: score.b, completed_at: new Date().toISOString() }
    : { score_a: null, score_b: null, completed_at: null }

  const { error } = await supabase
    .from('tournament_matches')
    .update(update)
    .eq('tournament_id', tid)
    .eq('match_id', matchId)
  if (error) throw error
}

export function connectCloudSync(args: {
  tid: string
  onStatus: (s: CloudSyncStatus) => void
  onRemoteCoreState: (s: TournamentStateV2) => void
  onRemoteMatchChange: (m: Match) => void
  onRemoteMatchDelete?: (matchId: string) => void
}): { close: () => void } {
  const { tid, onStatus, onRemoteCoreState, onRemoteMatchChange, onRemoteMatchDelete } = args

  const sb = supabase
  if (!sb) {
    onStatus('disabled')
    return {
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
        const next = (payload.new as { state?: unknown } | null)?.state
        const normalized = normalizeTournamentState(next)
        if (normalized) onRemoteCoreState(normalized)
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tournament_matches', filter: `tournament_id=eq.${tid}` },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          const old = payload.old as Partial<MatchRow> | null
          const mid = old?.match_id
          if (typeof mid === 'string') onRemoteMatchDelete?.(mid)
          return
        }

        const r = payload.new as Partial<MatchRow> | null
        if (!r || typeof r.match_id !== 'string') return
        const score =
          r.score_a == null || r.score_b == null || typeof r.score_a !== 'number' || typeof r.score_b !== 'number'
            ? undefined
            : { a: r.score_a, b: r.score_b }
        const m: Match = {
          id: r.match_id,
          divisionId: String(r.division_id ?? ''),
          round: Number(r.round ?? 1),
          matchupIndex: Number(r.matchup_index ?? 0),
          eventType: String(r.event_type ?? '') as Match['eventType'],
          seed: Number(r.seed ?? 0),
          court: Number(r.court ?? 0),
          clubA: String(r.club_a ?? '') as Match['clubA'],
          clubB: String(r.club_b ?? '') as Match['clubB'],
          score,
          completedAt: r.completed_at ?? undefined,
        }
        onRemoteMatchChange(m)
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onStatus('connected')
      else onStatus('error')
    })

  return {
    close: () => {
      sb.removeChannel(channel)
    },
  }
}

