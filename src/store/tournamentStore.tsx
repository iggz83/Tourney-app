import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { generateSchedule } from '../domain/scheduler'
import { SEEDED_EVENTS } from '../domain/constants'
import { seedKey } from '../domain/keys'
import type { PlayerId, TournamentStateV2 } from '../domain/types'
import { createInitialTournamentState } from './state'
import { normalizeTournamentState } from './normalizeTournamentState'
import { TournamentStoreContext } from './useTournamentStore'
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
import type { TournamentStore, TournamentStoreAction } from './tournamentStoreTypes'

const STORAGE_KEY_V2 = 'ictpt_state_v2'
const STORAGE_KEY_V1 = 'ictpt_state_v1'

type Action = TournamentStoreAction

function touch(state: TournamentStateV2): TournamentStateV2 {
  return { ...state, updatedAt: new Date().toISOString() }
}

function stripLegacyNameFieldsForPersist(s: TournamentStateV2): TournamentStateV2 {
  return {
    ...s,
    players: s.players.map((p) => {
      // Ensure we don't write legacy firstName/lastName anymore.
      const { firstName: _firstName, lastName: _lastName, ...rest } = p as unknown as {
        firstName?: unknown
        lastName?: unknown
      } & typeof p
      return rest
    }),
  }
}

function reducer(state: TournamentStateV2, action: Action): TournamentStateV2 {
  if (
    state.tournamentLockedAt &&
    action.type !== 'import' &&
    action.type !== 'tournament.unlock' &&
    action.type !== 'tournament.lock'
  ) {
    return state
  }

  switch (action.type) {
    case 'reset':
      return createInitialTournamentState()
    case 'import':
      // IMPORTANT: Don't "touch" remote imports; otherwise we treat remote updates as local edits and
      // will immediately re-push back to Supabase (causing schedule churn / delete+reinsert loops).
      return action.source === 'remote' ? action.state : touch(action.state)
    case 'tournament.lock': {
      if (state.tournamentLockedAt) return state
      const nextRev = (state.tournamentLockRev ?? 0) + 1
      return touch({ ...state, tournamentLockedAt: new Date().toISOString(), tournamentLockRev: nextRev })
    }
    case 'tournament.unlock': {
      if (!state.tournamentLockedAt) return state
      const nextRev = (state.tournamentLockRev ?? 0) + 1
      return touch({ ...state, tournamentLockedAt: null, tournamentLockRev: nextRev })
    }
    case 'tournament.password.set': {
      return touch({ ...state, tournamentPasswordSalt: action.salt, tournamentPasswordHash: action.hash })
    }
    case 'tournament.password.clear': {
      return touch({ ...state, tournamentPasswordSalt: null, tournamentPasswordHash: null })
    }
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
            name: '',
          })
        }
        for (let i = 1; i <= 4; i++) {
          players.push({
            id: `${division.id}:${clubId}:M${i}`,
            clubId,
            divisionId: division.id,
            gender: 'M',
            // Don't prepopulate roster player names.
            name: '',
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
        const seedsByClub = { ...dc.seedsByClub }
        delete (seedsByClub as Record<string, unknown>)[clubId]
        const enabled: Record<string, boolean> = { ...(dc.clubEnabled ?? {}) }
        delete enabled[clubId]
        return { ...dc, seedsByClub, clubEnabled: enabled }
      })
      const matches = state.matches.filter((m) => m.clubA !== clubId && m.clubB !== clubId)
      return touch({ ...state, clubs, players, divisionConfigs, matches })
    }
    case 'club.name.set': {
      const clubs = state.clubs.map((c) => (c.id === action.clubId ? { ...c, name: action.name } : c))
      return touch({ ...state, clubs })
    }
    case 'player.name.set': {
      const players = state.players.map((p) =>
        p.id === action.playerId ? { ...p, name: action.name } : p,
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
      // Safety: if config would generate 0 matches, do nothing (prevents accidental cloud wipe).
      if (nextMatches.length === 0) return state
      return touch({ ...state, matches: nextMatches })
    }
    case 'schedule.regenerate': {
      // Hard reset: replace schedule and drop all scores.
      const nextMatches = generateSchedule(state)
      // Safety: if config would generate 0 matches, do nothing (prevents accidental cloud wipe).
      if (nextMatches.length === 0) return state
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
    case 'matches.deleteMany': {
      if (!action.matchIds.length) return state
      const toDelete = new Set(action.matchIds)
      const matches = state.matches.filter((m) => !toDelete.has(m.id))
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

export function TournamentStoreProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const [state, dispatch] = useReducer(reducer, undefined, loadState)
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>('disabled')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [inFlight, setInFlight] = useState(0)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [lastSyncedUpdatedAt, setLastSyncedUpdatedAt] = useState<string | null>(null)
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

  function trackCloudWrite(updatedAt: string, p: Promise<unknown>) {
    setInFlight((n) => n + 1)
    void p
      .then(() => {
        setSyncError(null)
        setLastSyncedAt(new Date().toISOString())
        setLastSyncedUpdatedAt(updatedAt)
      })
      .catch((e) => {
        setSyncError(e instanceof Error ? e.message : 'Cloud sync failed')
      })
      .finally(() => {
        setInFlight((n) => Math.max(0, n - 1))
      })
  }

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(stripLegacyNameFieldsForPersist(state)))
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
      setSyncStatus('disabled')
      setSyncError(null)
      setInFlight(0)
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
      setSyncError(null)
      setInFlight(0)
      setLastSyncedAt(null)
      setLastSyncedUpdatedAt(null)
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
              // IMPORTANT: device clocks can be skewed, so use a monotonic lock revision to
              // resolve lock/unlock conflicts deterministically (prevents flicker / thrash).
              const localRev = stateRef.current.tournamentLockRev ?? 0
              const remoteRev = remote.tournamentLockRev ?? 0
              if (remoteRev < localRev) return
              if (remoteRev === localRev) {
                if (remote.updatedAt && stateUpdatedAtRef.current && remote.updatedAt <= stateUpdatedAtRef.current) return
              }
            }
            isApplyingRemote.current = true
            // Preserve current match scores (they come from match rows) but only after we've hydrated for this tid.
            const safeMatches = hydratedTidRef.current === tid ? stateRef.current.matches : []
            const merged: TournamentStateV2 = { ...remote, matches: safeMatches }
            dispatch({ type: 'import', state: merged, source: 'remote' })
            hydratedTidRef.current = tid
            // Remote is now authoritative for this tid; treat local as "in sync" at this point.
            setLastSyncedAt(new Date().toISOString())
            setLastSyncedUpdatedAt(merged.updatedAt ?? null)
            setTimeout(() => {
              isApplyingRemote.current = false
            }, 0)
          },
          onRemoteMatchChange: (m) => {
            // Apply match row changes without touching core state (prevents overwriting club/player edits while typing).
            isApplyingRemote.current = true
            dispatch({ type: 'matches.upsert', match: m, source: 'remote' })
            hydratedTidRef.current = tid
            setLastSyncedAt(new Date().toISOString())
            setTimeout(() => {
              isApplyingRemote.current = false
            }, 0)
          },
          onRemoteMatchDelete: (matchId) => {
            isApplyingRemote.current = true
            dispatch({ type: 'match.delete', matchId, source: 'remote' })
            hydratedTidRef.current = tid
            setLastSyncedAt(new Date().toISOString())
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
          setLastSyncedAt(new Date().toISOString())
          setLastSyncedUpdatedAt(chosenCore.updatedAt ?? null)
          setTimeout(() => {
            isApplyingRemote.current = false
          }, 0)

          // Ensure cloud has core; if remote core is missing, push local core.
          if (!remoteCore) {
            trackCloudWrite(local.updatedAt, upsertTournamentCoreState(tid, { ...stripLegacyNameFieldsForPersist(local), matches: [] }))
          }

          // Ensure cloud has schedule rows; ONLY do this for a brand-new tournament row.
          // (Otherwise, switching tids could accidentally push the previous tournament's schedule.)
          if (!remoteCore && remoteMatches.length === 0 && local.matches.length > 0) {
            trackCloudWrite(local.updatedAt, upsertTournamentMatches(tid, local.matches))
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
    return JSON.stringify({
      clubs: s.clubs,
      divisions: s.divisions,
      players: s.players,
      divisionConfigs: s.divisionConfigs,
      tournamentLockedAt: s.tournamentLockedAt ?? null,
      tournamentLockRev: typeof s.tournamentLockRev === 'number' ? s.tournamentLockRev : 0,
      tournamentPasswordSalt: s.tournamentPasswordSalt ?? null,
      tournamentPasswordHash: s.tournamentPasswordHash ?? null,
    })
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
      trackCloudWrite(state.updatedAt, upsertTournamentCoreState(tid, { ...stripLegacyNameFieldsForPersist(state), matches: [] }))
    }

    // Schedule updates (upsert all matches when schedule structure changes)
    const schedSig = scheduleSignature(state.matches)
    if (prevScheduleSigRef.current !== schedSig) {
      prevScheduleSigRef.current = schedSig
      trackCloudWrite(state.updatedAt, upsertTournamentMatches(tid, state.matches))
    }

    // Score updates (per match row)
    const prevScores = prevScoresRef.current
    const nextScores = new Map<string, string>()
    const scoreWrites: Promise<void>[] = []
    for (const m of state.matches) {
      const sig = scoreSignature(m)
      nextScores.set(m.id, sig)
      const prev = prevScores.get(m.id) ?? ''
      if (prev !== sig) {
        scoreWrites.push(setTournamentMatchScore({ tid, matchId: m.id, score: m.score }))
      }
    }
    prevScoresRef.current = nextScores
    if (scoreWrites.length) {
      trackCloudWrite(
        state.updatedAt,
        Promise.all(scoreWrites).then(() => {}),
      )
    }
  }, [state])

  const actions = useMemo<TournamentStore['actions']>(() => {
    return {
      reset: () => dispatch({ type: 'reset' }),
      lockTournament: () => dispatch({ type: 'tournament.lock' }),
      unlockTournament: () => dispatch({ type: 'tournament.unlock' }),
      setTournamentPassword: (password) => dispatch({ type: 'tournament.password.set', salt: password.salt, hash: password.hash }),
      clearTournamentPassword: () => dispatch({ type: 'tournament.password.clear' }),
      importState: (s) => dispatch({ type: 'import', state: s }),
      addClub: (clubId, name) => dispatch({ type: 'club.add', clubId, name }),
      removeClub: (clubId) => dispatch({ type: 'club.remove', clubId }),
      setClubName: (clubId, name) => dispatch({ type: 'club.name.set', clubId, name }),
      setDivisionClubEnabled: (divisionId, clubId, enabled) =>
        dispatch({ type: 'division.club.enabled.set', divisionId, clubId, enabled }),
      setPlayerName: (playerId, name) => dispatch({ type: 'player.name.set', playerId, name }),
      autoSeed: (divisionId, clubId) => dispatch({ type: 'division.autoseed', divisionId, clubId }),
      unlockMatch: (matchId) => dispatch({ type: 'match.unlock', matchId }),
      clearAllScores: () => dispatch({ type: 'matches.scores.clearAll' }),
      setSeed: (divisionId, clubId, eventType, seed, playerIds) =>
        dispatch({ type: 'division.seed.set', divisionId, clubId, eventType, seed, playerIds }),
      generateSchedule: () => dispatch({ type: 'schedule.generate' }),
      regenerateSchedule: () => dispatch({ type: 'schedule.regenerate' }),
      setScore: (matchId, score) => dispatch({ type: 'match.score.set', matchId, score }),
      deleteMatches: (matchIds) => dispatch({ type: 'matches.deleteMany', matchIds }),
      exportJson: () => JSON.stringify(stripLegacyNameFieldsForPersist(state), null, 2),
    }
  }, [state])

  const cloudEnabled = shouldEnableCloudSync()
  const tid = tidRef.current
  const hydrated = !!tid && hydratedTidRef.current === tid
  const store = useMemo<TournamentStore>(
    () => ({
      state,
      dispatch,
      cloud: {
        enabled: cloudEnabled,
        tid,
        hydrated,
        status: cloudEnabled ? syncStatus : 'disabled',
        inFlight,
        lastSyncedAt,
        lastSyncedUpdatedAt,
        error: syncError,
      },
      actions,
    }),
    [actions, cloudEnabled, dispatch, hydrated, inFlight, lastSyncedAt, lastSyncedUpdatedAt, state, syncError, syncStatus, tid],
  )
  return <TournamentStoreContext.Provider value={store}>{children}</TournamentStoreContext.Provider>
}

