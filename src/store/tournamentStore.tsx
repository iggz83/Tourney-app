import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { generateSchedule } from '../domain/scheduler'
import { SEEDED_EVENTS } from '../domain/constants'
import { seedKey } from '../domain/keys'
import type { ClubId, EventType, MatchId, PlayerId, TournamentState, TournamentStateV1, TournamentStateV2 } from '../domain/types'
import { createInitialTournamentState } from './state'
import {
  connectCloudSync,
  ensureTournamentRow,
  ensureTournamentIdInUrl,
  fetchTournamentCoreState,
  fetchTournamentMatches,
  getTournamentIdFromUrl,
  setTournamentMatchScore,
  shouldEnableCloudSync,
  type CloudSyncStatus,
  upsertTournamentCoreState,
  upsertTournamentMatches,
} from './cloudSync'

const STORAGE_KEY_V2 = 'ictpt_state_v2'
const STORAGE_KEY_V1 = 'ictpt_state_v1'

type Action =
  | { type: 'reset' }
  | { type: 'import'; state: TournamentStateV2; source?: 'local' | 'remote' }
  | { type: 'club.add'; clubId: ClubId; name: string }
  | { type: 'club.remove'; clubId: ClubId }
  | { type: 'club.name.set'; clubId: ClubId; name: string }
  | { type: 'player.update'; playerId: PlayerId; firstName: string; lastName: string }
  | { type: 'division.autoseed'; divisionId: string; clubId?: ClubId }
  | { type: 'division.club.enabled.set'; divisionId: string; clubId: ClubId; enabled: boolean }
  | {
      type: 'division.seed.set'
      divisionId: string
      clubId: ClubId
      eventType: EventType
      seed: number
      playerIds: [PlayerId | null, PlayerId | null]
    }
  | { type: 'schedule.generate' }
  | { type: 'schedule.regenerate' }
  | { type: 'matches.upsert'; match: TournamentStateV2['matches'][number]; source?: 'local' | 'remote' }
  | { type: 'match.delete'; matchId: MatchId; source?: 'local' | 'remote' }
  | { type: 'matches.scores.clearAll' }
  | { type: 'match.unlock'; matchId: MatchId }
  | { type: 'match.score.set'; matchId: MatchId; score?: { a: number; b: number } }

function touch(state: TournamentStateV2): TournamentStateV2 {
  return { ...state, updatedAt: new Date().toISOString() }
}

function reducer(state: TournamentStateV2, action: Action): TournamentStateV2 {
  switch (action.type) {
    case 'reset':
      return createInitialTournamentState()
    case 'import':
      // IMPORTANT: Don't "touch" remote imports; otherwise we treat remote updates as local edits and
      // will immediately re-push back to Supabase (causing schedule churn / delete+reinsert loops).
      return action.source === 'remote' ? action.state : touch(action.state)
    case 'club.add': {
      const clubId = action.clubId.trim()
      if (!clubId.length) return state
      if (state.clubs.some((c) => c.id === clubId)) return state

      // Don't prepopulate club full name; default to blank unless user provided one.
      const clubs = [...state.clubs, { id: clubId, code: clubId, name: action.name }]

      // Add default roster slots (4W/4M) per division for this new club.
      const players = [...state.players]
      for (const division of state.divisions) {
        for (let i = 1; i <= 4; i++) {
          players.push({
            id: `${division.id}:${clubId}:W${i}`,
            clubId,
            divisionId: division.id,
            gender: 'F',
            // Don't prepopulate roster player names.
            firstName: '',
            lastName: '',
          })
        }
        for (let i = 1; i <= 4; i++) {
          players.push({
            id: `${division.id}:${clubId}:M${i}`,
            clubId,
            divisionId: division.id,
            gender: 'M',
            // Don't prepopulate roster player names.
            firstName: '',
            lastName: '',
          })
        }
      }

      // Extend division configs with empty seed mappings + enabled flag.
      const divisionConfigs = state.divisionConfigs.map((dc) => {
        if (dc.seedsByClub[clubId]) return dc
        const clubRecord: Record<string, { playerIds: [PlayerId | null, PlayerId | null] }> = {}
        for (const ev of SEEDED_EVENTS) {
          clubRecord[seedKey(ev.eventType, ev.seed)] = { playerIds: [null, null] }
        }
        return {
          ...dc,
          seedsByClub: { ...dc.seedsByClub, [clubId]: clubRecord },
          clubEnabled: { ...(dc.clubEnabled ?? {}), [clubId]: true },
        }
      })

      // Remove any existing matches (schedule depends on club set); keep scores table clean.
      const matches = state.matches.filter((m) => m.clubA !== clubId && m.clubB !== clubId)
      return touch({ ...state, clubs, players, divisionConfigs, matches })
    }
    case 'club.remove': {
      const clubId = action.clubId
      const clubs = state.clubs.filter((c) => c.id !== clubId)
      const players = state.players.filter((p) => p.clubId !== clubId)
      const divisionConfigs = state.divisionConfigs.map((dc) => {
        const { [clubId]: _, ...restSeeds } = dc.seedsByClub as Record<string, any>
        const enabled = { ...(dc.clubEnabled ?? {}) }
        delete enabled[clubId]
        return { ...dc, seedsByClub: restSeeds, clubEnabled: enabled }
      })
      const matches = state.matches.filter((m) => m.clubA !== clubId && m.clubB !== clubId)
      return touch({ ...state, clubs, players, divisionConfigs, matches })
    }
    case 'club.name.set': {
      const clubs = state.clubs.map((c) => (c.id === action.clubId ? { ...c, name: action.name } : c))
      return touch({ ...state, clubs })
    }
    case 'player.update': {
      const players = state.players.map((p) =>
        p.id === action.playerId ? { ...p, firstName: action.firstName, lastName: action.lastName } : p,
      )
      return touch({ ...state, players })
    }
    case 'division.autoseed': {
      const divisionConfigs = state.divisionConfigs.map((dc) => {
        if (dc.divisionId !== action.divisionId) return dc

        const applyToClubIds = action.clubId ? [action.clubId] : state.clubs.map((c) => c.id)
        const nextSeedsByClub = { ...dc.seedsByClub }

        for (const clubId of applyToClubIds) {
          const clubRecord = { ...nextSeedsByClub[clubId] }

          const wid = (n: 1 | 2 | 3 | 4) => `${action.divisionId}:${clubId}:W${n}` as PlayerId
          const mid = (n: 1 | 2 | 3 | 4) => `${action.divisionId}:${clubId}:M${n}` as PlayerId

          // Women
          clubRecord[seedKey('WOMENS_DOUBLES', 1)] = { playerIds: [wid(1), wid(2)] }
          clubRecord[seedKey('WOMENS_DOUBLES', 2)] = { playerIds: [wid(3), wid(4)] }

          // Men
          clubRecord[seedKey('MENS_DOUBLES', 1)] = { playerIds: [mid(1), mid(2)] }
          clubRecord[seedKey('MENS_DOUBLES', 2)] = { playerIds: [mid(3), mid(4)] }

          // Mixed (UI expects [Woman, Man])
          clubRecord[seedKey('MIXED_DOUBLES', 1)] = { playerIds: [wid(1), mid(1)] }
          clubRecord[seedKey('MIXED_DOUBLES', 2)] = { playerIds: [wid(2), mid(2)] }
          clubRecord[seedKey('MIXED_DOUBLES', 3)] = { playerIds: [wid(3), mid(3)] }
          clubRecord[seedKey('MIXED_DOUBLES', 4)] = { playerIds: [wid(4), mid(4)] }

          nextSeedsByClub[clubId] = clubRecord
        }

        return { ...dc, seedsByClub: nextSeedsByClub }
      })

      return touch({ ...state, divisionConfigs })
    }
    case 'division.club.enabled.set': {
      const divisionConfigs = state.divisionConfigs.map((dc) => {
        if (dc.divisionId !== action.divisionId) return dc
        return {
          ...dc,
          clubEnabled: { ...(dc.clubEnabled ?? {}), [action.clubId]: action.enabled },
        }
      })
      return touch({ ...state, divisionConfigs })
    }
    case 'division.seed.set': {
      const divisionConfigs = state.divisionConfigs.map((dc) => {
        if (dc.divisionId !== action.divisionId) return dc
        const clubRecord = dc.seedsByClub[action.clubId]
        const k = seedKey(action.eventType, action.seed)
        return {
          ...dc,
          seedsByClub: {
            ...dc.seedsByClub,
            [action.clubId]: {
              ...clubRecord,
              [k]: { playerIds: action.playerIds },
            },
          },
        }
      })
      return touch({ ...state, divisionConfigs })
    }
    case 'schedule.generate': {
      // Simple: replace schedule and drop all scores.
      const nextMatches = generateSchedule(state)
      return touch({ ...state, matches: nextMatches })
    }
    case 'schedule.regenerate': {
      // Hard reset: replace schedule and drop all scores.
      const nextMatches = generateSchedule(state)
      return touch({ ...state, matches: nextMatches })
    }
    case 'matches.upsert': {
      const incoming = action.match
      const exists = state.matches.some((x) => x.id === incoming.id)
      const matches = exists
        ? state.matches.map((x) => {
            if (x.id !== incoming.id) return x
            // Never let missing/empty incoming fields clobber an existing match's structural identity.
            return {
              ...x,
              divisionId: incoming.divisionId ? incoming.divisionId : x.divisionId,
              round: Number.isFinite(incoming.round) ? incoming.round : x.round,
              matchupIndex: Number.isFinite(incoming.matchupIndex) ? incoming.matchupIndex : x.matchupIndex,
              eventType: incoming.eventType ? incoming.eventType : x.eventType,
              seed: incoming.seed > 0 ? incoming.seed : x.seed,
              court: Number.isFinite(incoming.court) ? incoming.court : x.court,
              clubA: incoming.clubA ? incoming.clubA : x.clubA,
              clubB: incoming.clubB ? incoming.clubB : x.clubB,
              score: incoming.score,
              completedAt: incoming.completedAt,
            }
          })
        : [...state.matches, incoming]
      return action.source === 'remote' ? { ...state, matches } : touch({ ...state, matches })
    }
    case 'match.delete': {
      const matches = state.matches.filter((m) => m.id !== action.matchId)
      return action.source === 'remote' ? { ...state, matches } : touch({ ...state, matches })
    }
    case 'matches.scores.clearAll': {
      const matches = state.matches.map((m) => ({ ...m, score: undefined, completedAt: undefined }))
      return touch({ ...state, matches })
    }
    case 'match.unlock': {
      const matches = state.matches.map((m) => (m.id === action.matchId ? { ...m, completedAt: undefined } : m))
      return touch({ ...state, matches })
    }
    case 'match.score.set': {
      const matches = state.matches.map((m) => {
        if (m.id !== action.matchId) return m
        if (!action.score) return { ...m, score: undefined, completedAt: undefined }
        return { ...m, score: action.score, completedAt: new Date().toISOString() }
      })
      return touch({ ...state, matches })
    }
    default:
      return state
  }
}

function migrateV1toV2(v1: TournamentStateV1): TournamentStateV2 {
  // The old model had 8 players per club total; new model is 8 players per club per division.
  // We replicate each old club/gender slot into *each division* and update seed mappings accordingly.
  const fresh = createInitialTournamentState()
  const nameByOldId = new Map(v1.players.map((p) => [p.id, p]))

  const newPlayers = fresh.players.map((p) => {
    const n = Number(p.id.slice(-1))
    const legacyId = Number.isFinite(n) ? `${p.clubId}-${p.gender}${n}` : null
    const legacy = legacyId ? nameByOldId.get(legacyId) : undefined
    if (!legacy) return p
    return { ...p, firstName: legacy.firstName, lastName: legacy.lastName }
  })

  const oldToNewByDivision = new Map<string, Map<string, string>>() // divisionId -> oldPlayerId -> newPlayerId
  for (const division of fresh.divisions) {
    const m = new Map<string, string>()
    for (const club of fresh.clubs) {
      for (let i = 1; i <= 4; i++) {
        m.set(`${club.id}-W${i}`, `${division.id}:${club.id}:W${i}`)
        m.set(`${club.id}-M${i}`, `${division.id}:${club.id}:M${i}`)
      }
    }
    oldToNewByDivision.set(division.id, m)
  }

  const divisionConfigs = fresh.divisionConfigs.map((dc) => {
    const prev = v1.divisionConfigs.find((x) => x.divisionId === dc.divisionId)
    if (!prev) return dc
    const map = oldToNewByDivision.get(dc.divisionId)!
    const seedsByClub: TournamentStateV2['divisionConfigs'][number]['seedsByClub'] = { ...dc.seedsByClub }
    for (const clubId of Object.keys(seedsByClub) as ClubId[]) {
      const prevClub = prev.seedsByClub?.[clubId]
      if (!prevClub) continue
      const nextClub = { ...seedsByClub[clubId] }
      for (const k of Object.keys(nextClub) as Array<keyof typeof nextClub>) {
        const legacy = (prevClub as typeof nextClub)[k]?.playerIds
        if (!legacy) continue
        // Legacy (v1) was always a 2-tuple of strings, but guard defensively.
        const legacy0 = legacy[0]
        const legacy1 = legacy[1]
        if (!legacy0 || !legacy1) continue
        const a = map.get(legacy0)
        const b = map.get(legacy1)
        if (a && b) nextClub[k] = { playerIds: [a, b] }
      }
      seedsByClub[clubId] = nextClub
    }
    return { ...dc, seedsByClub }
  })

  const matches = v1.matches ?? []

  return {
    version: 2,
    clubs: fresh.clubs,
    divisions: fresh.divisions,
    players: newPlayers,
    divisionConfigs,
    matches,
    updatedAt: new Date().toISOString(),
  }
}

export function normalizeTournamentState(candidate: unknown): TournamentStateV2 | null {
  const parsed = candidate as TournamentState
  if (!parsed) return null
  if (parsed.version === 2) return parsed
  if (parsed.version === 1) return migrateV1toV2(parsed)
  return null
}

function parseAndNormalize(raw: string): TournamentStateV2 | null {
  try {
    return normalizeTournamentState(JSON.parse(raw))
  } catch {
    return null
  }
}

function loadState(): TournamentStateV2 {
  try {
    const rawV2 = localStorage.getItem(STORAGE_KEY_V2)
    if (rawV2) return parseAndNormalize(rawV2) ?? createInitialTournamentState()

    const rawV1 = localStorage.getItem(STORAGE_KEY_V1)
    if (rawV1) return parseAndNormalize(rawV1) ?? createInitialTournamentState()

    // Important for cloud sync: a brand-new browser (incognito / new device) should not
    // "win" against an existing cloud tournament just because it was created later.
    // Use epoch so any real tournament state (with real edits) will be newer.
    return { ...createInitialTournamentState(), updatedAt: new Date(0).toISOString() }
  } catch {
    return { ...createInitialTournamentState(), updatedAt: new Date(0).toISOString() }
  }
}

type Store = {
  state: TournamentStateV2
  dispatch: React.Dispatch<Action>
  actions: {
    reset(): void
    importState(state: TournamentStateV2): void
    addClub(clubId: ClubId, name: string): void
    removeClub(clubId: ClubId): void
    setClubName(clubId: ClubId, name: string): void
    setDivisionClubEnabled(divisionId: string, clubId: ClubId, enabled: boolean): void
    updatePlayer(playerId: PlayerId, firstName: string, lastName: string): void
    autoSeed(divisionId: string, clubId?: ClubId): void
    unlockMatch(matchId: MatchId): void
    clearAllScores(): void
    setSeed(
      divisionId: string,
      clubId: ClubId,
      eventType: EventType,
      seed: number,
      playerIds: [PlayerId | null, PlayerId | null],
    ): void
    generateSchedule(): void
    regenerateSchedule(): void
    setScore(matchId: MatchId, score?: { a: number; b: number }): void
    exportJson(): string
  }
}

const Ctx = createContext<Store | null>(null)

export function TournamentStoreProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const [state, dispatch] = useReducer(reducer, undefined, loadState)
  const [, setSyncStatus] = useState<CloudSyncStatus>('disabled')
  const isApplyingRemote = useRef(false)
  const lastSentAt = useRef<string | null>(null)
  const connRef = useRef<ReturnType<typeof connectCloudSync> | null>(null)
  const stateUpdatedAtRef = useRef<string>(state.updatedAt)
  const stateRef = useRef<TournamentStateV2>(state)
  const tidRef = useRef<string | null>(null)
  // Tracks which tid the in-memory state currently corresponds to (for cloud hydration).
  // This prevents "load tournament" from incorrectly keeping the previous tournament's clubs/matches.
  const hydratedTidRef = useRef<string | null>(null)
  const prevCoreSigRef = useRef<string | null>(null)
  const prevScheduleSigRef = useRef<string | null>(null)
  const prevScoresRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(state))
  }, [state])

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    stateUpdatedAtRef.current = state.updatedAt
  }, [state.updatedAt])

  // Optional cloud sync (Supabase): enabled when ?tid=<uuid> (or cloud=1) is present.
  useEffect(() => {
    const enabled = shouldEnableCloudSync()
    const tidFromUrl = getTournamentIdFromUrl()

    // If sync disabled, teardown any existing connection.
    if (!enabled) {
      connRef.current?.close()
      connRef.current = null
      tidRef.current = null
      return
    }

    const tid = tidFromUrl ?? ensureTournamentIdInUrl()

    // If switching tournaments, reset sync bookkeeping and close old channel.
    if (tidRef.current && tidRef.current !== tid) {
      connRef.current?.close()
      connRef.current = null
      lastSentAt.current = null
      prevCoreSigRef.current = null
      prevScheduleSigRef.current = null
      prevScoresRef.current = new Map()
      hydratedTidRef.current = null
    }
    tidRef.current = tid

    // If already connected for this tid, nothing to do.
    if (connRef.current && tidRef.current === tid) return

    let cancelled = false

    ;(async () => {
      try {
        await ensureTournamentRow(tid)
        if (cancelled) return
        const conn = connectCloudSync({
          tid,
          onStatus: setSyncStatus,
          onRemoteCoreState: (remote) => {
            // last-write-wins for core config (only once we've hydrated for this tid).
            // When switching tid, we MUST allow older tournaments to overwrite the current in-memory state.
            if (hydratedTidRef.current === tid) {
              if (remote.updatedAt && stateUpdatedAtRef.current && remote.updatedAt <= stateUpdatedAtRef.current) return
            }
            isApplyingRemote.current = true
            // Preserve current match scores (they come from match rows) but only after we've hydrated for this tid.
            const safeMatches = hydratedTidRef.current === tid ? stateRef.current.matches : []
            const merged: TournamentStateV2 = { ...remote, matches: safeMatches }
            dispatch({ type: 'import', state: merged, source: 'remote' })
            hydratedTidRef.current = tid
            setTimeout(() => {
              isApplyingRemote.current = false
            }, 0)
          },
          onRemoteMatchChange: (m) => {
            // Apply match row changes without touching core state (prevents overwriting club/player edits while typing).
            isApplyingRemote.current = true
            dispatch({ type: 'matches.upsert', match: m, source: 'remote' })
            hydratedTidRef.current = tid
            setTimeout(() => {
              isApplyingRemote.current = false
            }, 0)
          },
          onRemoteMatchDelete: (matchId) => {
            isApplyingRemote.current = true
            dispatch({ type: 'match.delete', matchId, source: 'remote' })
            hydratedTidRef.current = tid
            setTimeout(() => {
              isApplyingRemote.current = false
            }, 0)
          },
        })
        connRef.current = conn

        // Load core + match rows. If core is missing, initialize it from local.
        try {
          const remoteCore = await fetchTournamentCoreState(tid)
          const remoteMatches = await fetchTournamentMatches(tid)
          if (cancelled) return
          const local = stateRef.current

          // IMPORTANT: When a tournament exists in Supabase (remoteCore != null),
          // always treat it as authoritative for this tid, even if its updatedAt is older than
          // whatever state happens to be in-memory from a different tid.
          //
          // Local state is only used to initialize a brand-new tournament (remoteCore == null).
          const chosenCore = remoteCore ?? local
          const chosenMatches = remoteCore ? remoteMatches : remoteMatches.length > 0 ? remoteMatches : local.matches

          isApplyingRemote.current = true
          dispatch({ type: 'import', state: { ...chosenCore, matches: chosenMatches }, source: 'remote' })
          hydratedTidRef.current = tid
          setTimeout(() => {
            isApplyingRemote.current = false
          }, 0)

          // Ensure cloud has core; if remote core is missing, push local core.
          if (!remoteCore) {
            void upsertTournamentCoreState(tid, { ...local, matches: [] })
          }

          // Ensure cloud has schedule rows; ONLY do this for a brand-new tournament row.
          // (Otherwise, switching tids could accidentally push the previous tournament's schedule.)
          if (!remoteCore && remoteMatches.length === 0 && local.matches.length > 0) {
            void upsertTournamentMatches(tid, local.matches)
          }
        } catch {
          // ignore fetch/init issues; realtime may still work
        }
      } catch {
        setSyncStatus('error')
      }
    })()

    return () => {
      cancelled = true
      connRef.current?.close()
      connRef.current = null
      tidRef.current = null
    }
  }, [location.key, location.search, location.hash])

  function coreSignature(s: TournamentStateV2) {
    return JSON.stringify({ clubs: s.clubs, divisions: s.divisions, players: s.players, divisionConfigs: s.divisionConfigs })
  }

  function scheduleSignature(matches: TournamentStateV2['matches']) {
    const stripped = matches
      .map((m) => ({
        id: m.id,
        divisionId: m.divisionId,
        round: m.round,
        matchupIndex: m.matchupIndex,
        eventType: m.eventType,
        seed: m.seed,
        court: m.court,
        clubA: m.clubA,
        clubB: m.clubB,
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
    return JSON.stringify(stripped)
  }

  function scoreSignature(m: TournamentStateV2['matches'][number]) {
    if (!m.score) return ''
    return `${m.score.a}-${m.score.b}`
  }

  // Push local changes to Supabase: core config separately from match rows & scores.
  useEffect(() => {
    if (!shouldEnableCloudSync()) return
    if (isApplyingRemote.current) return
    if (lastSentAt.current === state.updatedAt) return
    lastSentAt.current = state.updatedAt
    const tid = tidRef.current
    if (!tid) return
    // CRITICAL: Don't push anything until we've hydrated at least once for this tid.
    // Otherwise a fresh browser (incognito/new device) can "win" with an empty schedule and wipe remote matches.
    if (hydratedTidRef.current !== tid) return

    // Core config updates
    const coreSig = coreSignature(state)
    if (prevCoreSigRef.current !== coreSig) {
      prevCoreSigRef.current = coreSig
      // keep cloud core small; matches are in tournament_matches
      void upsertTournamentCoreState(tid, { ...state, matches: [] })
    }

    // Schedule updates (upsert all matches when schedule structure changes)
    const schedSig = scheduleSignature(state.matches)
    if (prevScheduleSigRef.current !== schedSig) {
      prevScheduleSigRef.current = schedSig
      void upsertTournamentMatches(tid, state.matches)
    }

    // Score updates (per match row)
    const prevScores = prevScoresRef.current
    const nextScores = new Map<string, string>()
    for (const m of state.matches) {
      const sig = scoreSignature(m)
      nextScores.set(m.id, sig)
      const prev = prevScores.get(m.id) ?? ''
      if (prev !== sig) {
        void setTournamentMatchScore({ tid, matchId: m.id, score: m.score })
      }
    }
    prevScoresRef.current = nextScores
  }, [state])

  const actions = useMemo<Store['actions']>(() => {
    return {
      reset: () => dispatch({ type: 'reset' }),
      importState: (s) => dispatch({ type: 'import', state: s }),
      addClub: (clubId, name) => dispatch({ type: 'club.add', clubId, name }),
      removeClub: (clubId) => dispatch({ type: 'club.remove', clubId }),
      setClubName: (clubId, name) => dispatch({ type: 'club.name.set', clubId, name }),
      setDivisionClubEnabled: (divisionId, clubId, enabled) =>
        dispatch({ type: 'division.club.enabled.set', divisionId, clubId, enabled }),
      updatePlayer: (playerId, firstName, lastName) => dispatch({ type: 'player.update', playerId, firstName, lastName }),
      autoSeed: (divisionId, clubId) => dispatch({ type: 'division.autoseed', divisionId, clubId }),
      unlockMatch: (matchId) => dispatch({ type: 'match.unlock', matchId }),
      clearAllScores: () => dispatch({ type: 'matches.scores.clearAll' }),
      setSeed: (divisionId, clubId, eventType, seed, playerIds) =>
        dispatch({ type: 'division.seed.set', divisionId, clubId, eventType, seed, playerIds }),
      generateSchedule: () => dispatch({ type: 'schedule.generate' }),
      regenerateSchedule: () => dispatch({ type: 'schedule.regenerate' }),
      setScore: (matchId, score) => dispatch({ type: 'match.score.set', matchId, score }),
      exportJson: () => JSON.stringify(state, null, 2),
    }
  }, [state])

  const store = useMemo<Store>(() => ({ state, dispatch, actions }), [state, actions])
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export function useTournamentStore(): Store {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTournamentStore must be used within TournamentStoreProvider')
  return v
}

