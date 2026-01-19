import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { generateSchedule } from '../domain/scheduler'
import { seedKey } from '../domain/keys'
import type { ClubId, EventType, MatchId, PlayerId, TournamentState, TournamentStateV1, TournamentStateV2 } from '../domain/types'
import { createInitialTournamentState } from './state'
import {
  connectCloudSync,
  ensureTournamentRow,
  ensureTournamentIdInUrl,
  getTournamentIdFromUrl,
  shouldEnableCloudSync,
  type CloudSyncStatus,
} from './cloudSync'

const STORAGE_KEY_V2 = 'ictpt_state_v2'
const STORAGE_KEY_V1 = 'ictpt_state_v1'

type Action =
  | { type: 'reset' }
  | { type: 'import'; state: TournamentStateV2 }
  | { type: 'player.update'; playerId: PlayerId; firstName: string; lastName: string }
  | { type: 'division.autoseed'; divisionId: string; clubId?: ClubId }
  | {
      type: 'division.seed.set'
      divisionId: string
      clubId: ClubId
      eventType: EventType
      seed: number
      playerIds: [PlayerId | null, PlayerId | null]
    }
  | { type: 'schedule.generate' }
  | { type: 'match.score.set'; matchId: MatchId; score?: { a: number; b: number } }

function touch(state: TournamentStateV2): TournamentStateV2 {
  return { ...state, updatedAt: new Date().toISOString() }
}

function reducer(state: TournamentStateV2, action: Action): TournamentStateV2 {
  switch (action.type) {
    case 'reset':
      return createInitialTournamentState()
    case 'import':
      return touch(action.state)
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
      const nextMatches = generateSchedule(state)
      // Preserve any existing scores by match id
      const prevById = new Map(state.matches.map((m) => [m.id, m]))
      const merged = nextMatches.map((m) => {
        const prev = prevById.get(m.id)
        return prev?.score ? { ...m, score: prev.score, completedAt: prev.completedAt } : m
      })
      return touch({ ...state, matches: merged })
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

    return createInitialTournamentState()
  } catch {
    return createInitialTournamentState()
  }
}

type Store = {
  state: TournamentStateV2
  dispatch: React.Dispatch<Action>
  actions: {
    reset(): void
    importState(state: TournamentStateV2): void
    updatePlayer(playerId: PlayerId, firstName: string, lastName: string): void
    autoSeed(divisionId: string, clubId?: ClubId): void
    setSeed(
      divisionId: string,
      clubId: ClubId,
      eventType: EventType,
      seed: number,
      playerIds: [PlayerId | null, PlayerId | null],
    ): void
    generateSchedule(): void
    setScore(matchId: MatchId, score?: { a: number; b: number }): void
    exportJson(): string
  }
}

const Ctx = createContext<Store | null>(null)

export function TournamentStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState)
  const [, setSyncStatus] = useState<CloudSyncStatus>('disabled')
  const isApplyingRemote = useRef(false)
  const lastSentAt = useRef<string | null>(null)
  const connRef = useRef<ReturnType<typeof connectCloudSync> | null>(null)
  const stateUpdatedAtRef = useRef<string>(state.updatedAt)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(state))
  }, [state])

  useEffect(() => {
    stateUpdatedAtRef.current = state.updatedAt
  }, [state.updatedAt])

  // Optional cloud sync (Supabase): enabled when ?tid=<uuid> is present.
  useEffect(() => {
    if (!shouldEnableCloudSync()) return

    let cancelled = false
    const tidFromUrl = getTournamentIdFromUrl()
    const tid = tidFromUrl ?? ensureTournamentIdInUrl()

    ;(async () => {
      try {
        await ensureTournamentRow(tid)
        if (cancelled) return
        const conn = connectCloudSync({
          tid,
          onStatus: setSyncStatus,
          onRemoteState: (remote) => {
            // last-write-wins
            if (remote.updatedAt && stateUpdatedAtRef.current && remote.updatedAt <= stateUpdatedAtRef.current) return
            isApplyingRemote.current = true
            dispatch({ type: 'import', state: remote })
            setTimeout(() => {
              isApplyingRemote.current = false
            }, 0)
          },
        })
        connRef.current = conn
      } catch {
        setSyncStatus('error')
      }
    })()

    return () => {
      cancelled = true
      connRef.current?.close()
      connRef.current = null
    }
    // Intentionally do not include `state` in deps; connection lifetime is per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push local changes to sync server (debounced by updatedAt)
  useEffect(() => {
    if (!shouldEnableCloudSync()) return
    if (isApplyingRemote.current) return
    if (lastSentAt.current === state.updatedAt) return
    lastSentAt.current = state.updatedAt

    // Fire-and-forget
    void connRef.current?.pushState(state)
  }, [state])

  const actions = useMemo<Store['actions']>(() => {
    return {
      reset: () => dispatch({ type: 'reset' }),
      importState: (s) => dispatch({ type: 'import', state: s }),
      updatePlayer: (playerId, firstName, lastName) => dispatch({ type: 'player.update', playerId, firstName, lastName }),
      autoSeed: (divisionId, clubId) => dispatch({ type: 'division.autoseed', divisionId, clubId }),
      setSeed: (divisionId, clubId, eventType, seed, playerIds) =>
        dispatch({ type: 'division.seed.set', divisionId, clubId, eventType, seed, playerIds }),
      generateSchedule: () => dispatch({ type: 'schedule.generate' }),
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

