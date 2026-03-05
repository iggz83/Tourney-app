import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { generateSchedule, optimizeRoundsForFiltered } from '../domain/scheduler'
import { seedKey } from '../domain/keys'
import type { ClubId, Match, PlayerId, TournamentStateV2 } from '../domain/types'
import { computeMatch } from '../domain/analytics'
import { getEventScheduleModesForDivision, getSeededEventsForDivision } from '../domain/selectors'
import { createInitialTournamentState } from './state'
import { normalizeTournamentState } from './normalizeTournamentState'
import { TournamentStoreContext } from './useTournamentStore'
import {
  connectCloudSync,
  ensureTournamentRow,
  ensureTournamentIdInUrl,
  fetchTournamentCoreState,
  fetchTournamentMatches,
  fetchTournamentName,
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

function makePlayoffMatchId(parts: {
  slot: '12' | '34'
  divisionId: string
  clubA: ClubId
  clubB: ClubId
  eventType: string
  seed: number
}) {
  const { slot, divisionId, clubA, clubB, eventType, seed } = parts
  const [a, b] = [clubA, clubB].sort()
  return `p:${slot}:${divisionId}:${eventType}:s${seed}:${a}-vs-${b}`
}

function computeClubOrderFromMatches(args: { clubs: ClubId[]; matches: TournamentStateV2['matches'] }): ClubId[] {
  const { clubs, matches } = args
  const byClub = new Map<ClubId, { clubId: ClubId; wins: number; losses: number; pointDiff: number; pointsFor: number }>()
  for (const c of clubs) byClub.set(c, { clubId: c, wins: 0, losses: 0, pointDiff: 0, pointsFor: 0 })

  for (const m of matches) {
    if (!m.score) continue
    const computed = computeMatch(m)
    if (!computed.winnerClubId) continue
    const a = byClub.get(m.clubA)
    const b = byClub.get(m.clubB)
    if (!a || !b) continue

    a.pointsFor += m.score.a
    a.pointDiff += m.score.a - m.score.b
    b.pointsFor += m.score.b
    b.pointDiff += m.score.b - m.score.a

    if (computed.winnerClubId === m.clubA) {
      a.wins++
      b.losses++
    } else {
      b.wins++
      a.losses++
    }
  }

  return [...byClub.values()]
    .sort((x, y) => {
      if (y.wins !== x.wins) return y.wins - x.wins
      if (y.pointDiff !== x.pointDiff) return y.pointDiff - x.pointDiff
      return y.pointsFor - x.pointsFor
    })
    .map((x) => x.clubId)
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
    case 'tournament.name.set': {
      return touch({ ...state, tournamentName: action.name })
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

      const extendDivisionConfigsForClub = (divisionConfigs: TournamentStateV2['divisionConfigs']) =>
        divisionConfigs.map((dc) => {
          if (dc.seedsByClub?.[clubId]) return dc
          const clubRecord: Record<string, { playerIds: [PlayerId | null, PlayerId | null] }> = {}
          for (const ev of getSeededEventsForDivision(state, dc.divisionId)) {
            clubRecord[seedKey(ev.eventType, ev.seed)] = { playerIds: [null, null] }
          }
          return {
            ...dc,
            seedsByClub: { ...(dc.seedsByClub ?? {}), [clubId]: clubRecord },
            clubEnabled: { ...(dc.clubEnabled ?? {}), [clubId]: true },
          }
        })

      // Extend ALL lineup profiles (and legacy default divisionConfigs) for this new club.
      const lineupProfiles = state.lineupProfiles.map((lp) => ({ ...lp, divisionConfigs: extendDivisionConfigsForClub(lp.divisionConfigs) }))
      const defaultProfile = lineupProfiles.find((p) => p.id === state.defaultLineupProfileId) ?? lineupProfiles[0]!
      const divisionConfigs = extendDivisionConfigsForClub(defaultProfile.divisionConfigs)

      // Remove any existing matches (schedule depends on club set); keep scores table clean.
      const matches = state.matches.filter((m) => m.clubA !== clubId && m.clubB !== clubId)
      return touch({ ...state, clubs, players, lineupProfiles, divisionConfigs, matches })
    }
    case 'club.remove': {
      const clubId = action.clubId
      const clubs = state.clubs.filter((c) => c.id !== clubId)
      const players = state.players.filter((p) => p.clubId !== clubId)
      const pruneDivisionConfigsForClub = (divisionConfigs: TournamentStateV2['divisionConfigs']) =>
        divisionConfigs.map((dc) => {
          const seedsByClub = { ...(dc.seedsByClub ?? {}) }
          delete (seedsByClub as Record<string, unknown>)[clubId]
          const enabled: Record<string, boolean> = { ...(dc.clubEnabled ?? {}) }
          delete enabled[clubId]
          return { ...dc, seedsByClub, clubEnabled: enabled }
        })

      const lineupProfiles = state.lineupProfiles.map((lp) => ({ ...lp, divisionConfigs: pruneDivisionConfigsForClub(lp.divisionConfigs) }))
      const defaultProfile = lineupProfiles.find((p) => p.id === state.defaultLineupProfileId) ?? lineupProfiles[0]!
      const divisionConfigs = pruneDivisionConfigsForClub(defaultProfile.divisionConfigs)
      const matches = state.matches.filter((m) => m.clubA !== clubId && m.clubB !== clubId)
      return touch({ ...state, clubs, players, lineupProfiles, divisionConfigs, matches })
    }
    case 'club.name.set': {
      const clubs = state.clubs.map((c) => (c.id === action.clubId ? { ...c, name: action.name } : c))
      return touch({ ...state, clubs })
    }
    case 'club.code.set': {
      const nextCode = action.code.trim()
      if (!nextCode.length) return state
      if (state.clubs.some((c) => c.id !== action.clubId && c.code === nextCode)) return state
      const clubs = state.clubs.map((c) => (c.id === action.clubId ? { ...c, code: nextCode } : c))
      return touch({ ...state, clubs })
    }
    case 'division.add': {
      const d = action.division
      const id = String(d.id ?? '').trim()
      const code = String(d.code ?? '').trim()
      const name = String(d.name ?? '').trim()
      if (!id.length || !name.length) return state
      if (state.divisions.some((x) => x.id === id)) return state
      const divisions = [...state.divisions, { id, code, name }]

      const addDivisionConfig = (divisionConfigs: TournamentStateV2['divisionConfigs']) => [
        ...divisionConfigs,
        { divisionId: id, seedsByClub: {}, clubEnabled: {} },
      ]
      const lineupProfiles = state.lineupProfiles.map((lp) => ({ ...lp, divisionConfigs: addDivisionConfig(lp.divisionConfigs) }))
      const defaultProfile = lineupProfiles.find((p) => p.id === state.defaultLineupProfileId) ?? lineupProfiles[0]!
      const divisionConfigs = addDivisionConfig(defaultProfile.divisionConfigs)

      // For backwards compatibility with the old roster model, precreate 4W/4M empty slots per club for the new division.
      const players = [...state.players]
      for (const club of state.clubs) {
        for (let i = 1; i <= 4; i++) {
          players.push({ id: `${id}:${club.id}:W${i}`, clubId: club.id, divisionId: id, gender: 'F', name: '' })
          players.push({ id: `${id}:${club.id}:M${i}`, clubId: club.id, divisionId: id, gender: 'M', name: '' })
        }
      }

      return touch({
        ...state,
        divisions,
        players,
        lineupProfiles,
        divisionConfigs,
        seededEventsByDivision: { ...state.seededEventsByDivision, [id]: state.seededEvents },
        eventScheduleModesByDivision: { ...state.eventScheduleModesByDivision, [id]: state.eventScheduleModes },
      })
    }
    case 'division.update': {
      const divisionId = action.divisionId
      if (!divisionId) return state
      const divisions = state.divisions.map((d) => {
        if (d.id !== divisionId) return d
        return {
          ...d,
          code: action.code != null ? String(action.code) : d.code,
          name: action.name != null ? String(action.name) : d.name,
        }
      })
      return touch({ ...state, divisions })
    }
    case 'division.delete': {
      const divisionId = action.divisionId
      if (!divisionId) return state
      const divisions = state.divisions.filter((d) => d.id !== divisionId)
      const players = state.players.filter((p) => p.divisionId !== divisionId)
      const matches = state.matches.filter((m) => m.divisionId !== divisionId)
      const dropDivisionConfig = (divisionConfigs: TournamentStateV2['divisionConfigs']) =>
        divisionConfigs.filter((dc) => dc.divisionId !== divisionId)
      const lineupProfiles = state.lineupProfiles.map((lp) => ({ ...lp, divisionConfigs: dropDivisionConfig(lp.divisionConfigs) }))
      const defaultProfile = lineupProfiles.find((p) => p.id === state.defaultLineupProfileId) ?? lineupProfiles[0]!
      const divisionConfigs = dropDivisionConfig(defaultProfile.divisionConfigs)
      const seededEventsByDivision = { ...state.seededEventsByDivision }
      delete seededEventsByDivision[divisionId]
      const eventScheduleModesByDivision = { ...state.eventScheduleModesByDivision }
      delete eventScheduleModesByDivision[divisionId]
      return touch({ ...state, divisions, players, matches, lineupProfiles, divisionConfigs, seededEventsByDivision, eventScheduleModesByDivision })
    }
    case 'lineup.profile.add': {
      const profileId = action.profileId.trim()
      const name = action.name.trim()
      if (!profileId.length) return state
      if (state.lineupProfiles.some((p) => p.id === profileId)) return state
      const baseId = action.baseProfileId?.trim() || state.defaultLineupProfileId
      const baseProfile = state.lineupProfiles.find((p) => p.id === baseId) ?? state.lineupProfiles[0]
      const divisionConfigs = (baseProfile?.divisionConfigs ?? state.divisionConfigs).map((dc) => ({
        ...dc,
        seedsByClub: { ...(dc.seedsByClub ?? {}) },
        clubEnabled: { ...(dc.clubEnabled ?? {}) },
      }))
      const lineupProfiles = [...state.lineupProfiles, { id: profileId, name: name || 'Profile', divisionConfigs }]
      return touch({ ...state, lineupProfiles })
    }
    case 'lineup.profile.rename': {
      const profileId = action.profileId.trim()
      const name = action.name.trim()
      if (!profileId.length) return state
      const lineupProfiles = state.lineupProfiles.map((p) => (p.id === profileId ? { ...p, name: name || p.name } : p))
      return touch({ ...state, lineupProfiles })
    }
    case 'lineup.profile.delete': {
      const profileId = action.profileId.trim()
      if (!profileId.length) return state
      if (profileId === state.defaultLineupProfileId) return state
      const lineupProfiles = state.lineupProfiles.filter((p) => p.id !== profileId)
      if (lineupProfiles.length === 0) return state
      const matches = state.matches.map((m) =>
        (m.lineupProfileId ?? state.defaultLineupProfileId) === profileId
          ? { ...m, lineupProfileId: state.defaultLineupProfileId }
          : m,
      )
      return touch({ ...state, lineupProfiles, matches })
    }
    case 'lineup.profile.default.set': {
      const profileId = action.profileId.trim()
      if (!profileId.length) return state
      if (!state.lineupProfiles.some((p) => p.id === profileId)) return state
      const defaultProfile = state.lineupProfiles.find((p) => p.id === profileId) ?? state.lineupProfiles[0]!
      return touch({ ...state, defaultLineupProfileId: profileId, divisionConfigs: defaultProfile.divisionConfigs })
    }
    case 'player.add': {
      const divisionId = action.divisionId
      const clubId = action.clubId
      const gender = action.gender
      if (!divisionId || !clubId) return state
      if (!state.divisions.some((d) => d.id === divisionId)) return state
      if (!state.clubs.some((c) => c.id === clubId)) return state
      if (gender !== 'F' && gender !== 'M') return state

      const prefix = gender === 'F' ? 'W' : 'M'
      let maxN = 0
      for (const p of state.players) {
        if (p.divisionId !== divisionId) continue
        if (p.clubId !== clubId) continue
        if (p.gender !== gender) continue
        const label = (p as { slotLabel?: unknown }).slotLabel
        const txt = typeof label === 'string' ? label : ''
        const m1 = new RegExp(`^${prefix}(\\d+)$`).exec(txt)
        if (m1) maxN = Math.max(maxN, Number(m1[1]) || 0)
        const m2 = /:(W|M)(\d+)$/.exec(p.id)
        if (m2 && m2[1] === prefix) maxN = Math.max(maxN, Number(m2[2]) || 0)
      }
      const n = maxN + 1
      const slotLabel = `${prefix}${n}`
      const sortOrder = (gender === 'F' ? 0 : 1) * 1000 + n
      const id = `p:${crypto.randomUUID()}`
      const players = [
        ...state.players,
        {
          id,
          clubId,
          divisionId,
          gender,
          slotLabel,
          sortOrder,
          name: '',
        },
      ]
      return touch({ ...state, players })
    }
    case 'player.remove': {
      const playerId = action.playerId
      const players = state.players.filter((p) => p.id !== playerId)

      // Clear references from seed mappings so we don't point at deleted players.
      const cleanDivisionConfigs = (divisionConfigs: TournamentStateV2['divisionConfigs']) =>
        divisionConfigs.map((dc) => {
          const nextSeedsByClub: typeof dc.seedsByClub = {}
          for (const [clubId, clubRecord] of Object.entries(dc.seedsByClub ?? {})) {
            const nextClubRecord: typeof clubRecord = { ...(clubRecord as typeof clubRecord) }
            for (const [k, v] of Object.entries(clubRecord ?? {})) {
              const ids = (v as { playerIds?: [PlayerId | null, PlayerId | null] }).playerIds
              if (!ids) continue
              const a = ids[0] === playerId ? null : ids[0]
              const b = ids[1] === playerId ? null : ids[1]
              if (a !== ids[0] || b !== ids[1]) nextClubRecord[k as keyof typeof nextClubRecord] = { playerIds: [a, b] }
            }
            nextSeedsByClub[clubId as keyof typeof nextSeedsByClub] = nextClubRecord
          }
          return { ...dc, seedsByClub: nextSeedsByClub }
        })

      const divisionConfigs = cleanDivisionConfigs(state.divisionConfigs)
      const lineupProfiles = state.lineupProfiles.map((lp) => ({ ...lp, divisionConfigs: cleanDivisionConfigs(lp.divisionConfigs) }))
      return touch({ ...state, players, divisionConfigs, lineupProfiles })
    }
    case 'player.name.set': {
      const players = state.players.map((p) =>
        p.id === action.playerId ? { ...p, name: action.name } : p,
      )
      return touch({ ...state, players })
    }
    case 'seeded.events.set': {
      const divisionId = action.divisionId
      if (!divisionId) return state
      const raw = Array.isArray(action.seededEvents) ? action.seededEvents : []
      const next = raw
        .map((x) => ({
          eventType: x.eventType,
          seed: Math.max(1, Math.floor(Number(x.seed) || 0)),
          label: String(x.label ?? '').trim() || `${x.eventType} #${x.seed}`,
        }))
        .filter((x) => (x.eventType === 'WOMENS_DOUBLES' || x.eventType === 'MENS_DOUBLES' || x.eventType === 'MIXED_DOUBLES') && x.seed > 0)
      if (next.length === 0) return state
      const uniq = new Map<string, typeof next[number]>()
      for (const x of next) uniq.set(`${x.eventType}:${x.seed}`, x)
      const seededEvents = [...uniq.values()].sort((a, b) => {
        const eo = (t: string) => (t === 'WOMENS_DOUBLES' ? 0 : t === 'MENS_DOUBLES' ? 1 : 2)
        const d = eo(a.eventType) - eo(b.eventType)
        if (d !== 0) return d
        return a.seed - b.seed
      })
      const seededEventsByDivision = { ...state.seededEventsByDivision, [divisionId]: seededEvents }
      // Keep legacy `seededEvents` mirrored to selected division for older paths/back-compat.
      return touch({ ...state, seededEventsByDivision, seededEvents })
    }
    case 'event.scheduleMode.set': {
      const divisionId = action.divisionId
      if (!divisionId) return state
      const eventType = action.eventType
      const mode = action.mode === 'ALL_VS_ALL' ? 'ALL_VS_ALL' : 'SAME_SEED'
      const currentByDivision = getEventScheduleModesForDivision(state, divisionId)
      if (currentByDivision[eventType] === mode) return state
      const eventScheduleModesByDivision = {
        ...state.eventScheduleModesByDivision,
        [divisionId]: { ...currentByDivision, [eventType]: mode },
      }
      return touch({
        ...state,
        eventScheduleModesByDivision,
        // Keep legacy top-level in sync for compatibility.
        eventScheduleModes: { ...state.eventScheduleModes, [eventType]: mode },
      })
    }
    case 'division.autoseed': {
      const targetProfileId = action.profileId?.trim() || state.defaultLineupProfileId

      const autoSeedDivisionConfigs = (divisionConfigs: TournamentStateV2['divisionConfigs']) =>
        divisionConfigs.map((dc) => {
          if (dc.divisionId !== action.divisionId) return dc

          const applyToClubIds = action.clubId ? [action.clubId] : state.clubs.map((c) => c.id)
          const nextSeedsByClub = { ...(dc.seedsByClub ?? {}) }

          for (const clubId of applyToClubIds) {
            const clubRecord = { ...(nextSeedsByClub[clubId] ?? {}) } as Record<string, { playerIds: [PlayerId | null, PlayerId | null] }>

            const women = state.players.filter((p) => p.divisionId === action.divisionId && p.clubId === clubId && p.gender === 'F').slice()
            const men = state.players.filter((p) => p.divisionId === action.divisionId && p.clubId === clubId && p.gender === 'M').slice()
            women.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
            men.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))

            const seedsByType = new Map<Match['eventType'], number[]>()
            for (const ev of getSeededEventsForDivision(state, action.divisionId)) {
              const arr = seedsByType.get(ev.eventType) ?? []
              arr.push(ev.seed)
              seedsByType.set(ev.eventType, arr)
            }
            for (const [eventType, seeds] of seedsByType) {
              const uniq = [...new Set(seeds)].sort((a, b) => a - b)
              for (let idx = 0; idx < uniq.length; idx++) {
                const seed = uniq[idx]!
                if (eventType === 'WOMENS_DOUBLES') {
                  clubRecord[seedKey(eventType, seed)] = { playerIds: [women[idx * 2]?.id ?? null, women[idx * 2 + 1]?.id ?? null] }
                } else if (eventType === 'MENS_DOUBLES') {
                  clubRecord[seedKey(eventType, seed)] = { playerIds: [men[idx * 2]?.id ?? null, men[idx * 2 + 1]?.id ?? null] }
                } else {
                  // Mixed seed N defaults to woman N + man N.
                  clubRecord[seedKey(eventType, seed)] = { playerIds: [women[idx]?.id ?? null, men[idx]?.id ?? null] }
                }
              }
            }

            nextSeedsByClub[clubId] = clubRecord
          }

          return { ...dc, seedsByClub: nextSeedsByClub }
        })

      const lineupProfiles = state.lineupProfiles.map((lp) =>
        lp.id === targetProfileId ? { ...lp, divisionConfigs: autoSeedDivisionConfigs(lp.divisionConfigs) } : lp,
      )
      const defaultProfile = lineupProfiles.find((p) => p.id === state.defaultLineupProfileId) ?? lineupProfiles[0]!
      const divisionConfigs =
        state.defaultLineupProfileId === targetProfileId ? autoSeedDivisionConfigs(state.divisionConfigs) : defaultProfile.divisionConfigs
      return touch({ ...state, lineupProfiles, divisionConfigs })
    }
    case 'division.club.enabled.set': {
      const updateEnabled = (divisionConfigs: TournamentStateV2['divisionConfigs']) =>
        divisionConfigs.map((dc) => {
          if (dc.divisionId !== action.divisionId) return dc
          return { ...dc, clubEnabled: { ...(dc.clubEnabled ?? {}), [action.clubId]: action.enabled } }
        })
      const lineupProfiles = state.lineupProfiles.map((lp) => ({ ...lp, divisionConfigs: updateEnabled(lp.divisionConfigs) }))
      const defaultProfile = lineupProfiles.find((p) => p.id === state.defaultLineupProfileId) ?? lineupProfiles[0]!
      const divisionConfigs = updateEnabled(defaultProfile.divisionConfigs)
      return touch({ ...state, lineupProfiles, divisionConfigs })
    }
    case 'division.seed.set': {
      const targetProfileId = action.profileId?.trim() || state.defaultLineupProfileId
      const applySeed = (divisionConfigs: TournamentStateV2['divisionConfigs']) =>
        divisionConfigs.map((dc) => {
          if (dc.divisionId !== action.divisionId) return dc
          const clubRecord = (dc.seedsByClub ?? {})[action.clubId] ?? {}
          const k = seedKey(action.eventType, action.seed)
          return {
            ...dc,
            seedsByClub: {
              ...(dc.seedsByClub ?? {}),
              [action.clubId]: {
                ...clubRecord,
                [k]: { playerIds: action.playerIds },
              },
            },
          }
        })
      const lineupProfiles = state.lineupProfiles.map((lp) =>
        lp.id === targetProfileId ? { ...lp, divisionConfigs: applySeed(lp.divisionConfigs) } : lp,
      )
      const defaultProfile = lineupProfiles.find((p) => p.id === state.defaultLineupProfileId) ?? lineupProfiles[0]!
      const divisionConfigs = targetProfileId === state.defaultLineupProfileId ? applySeed(state.divisionConfigs) : defaultProfile.divisionConfigs
      return touch({ ...state, lineupProfiles, divisionConfigs })
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
    case 'matches.rounds.optimize': {
      if (state.matches.length === 0 || action.matchIds.length === 0) return state
      const nextMatches = optimizeRoundsForFiltered({
        allMatches: state.matches,
        targetMatchIds: action.matchIds,
        targetCourts: action.targetCourts,
      })
      return touch({ ...state, matches: nextMatches })
    }
    case 'playoff.round.add': {
      if (state.matches.some((m) => (m.stage ?? 'REGULAR') === 'PLAYOFF')) return state

      const idSet = new Set(action.matchIds)
      const subset = state.matches.filter((m) => idSet.has(m.id) && (m.stage ?? 'REGULAR') !== 'PLAYOFF')
      const allSubsetScored = subset.length > 0 && subset.every((m) => Boolean(m.score) && Boolean(m.completedAt))
      if (!allSubsetScored) return state

      const participatingClubs = [...new Set(subset.flatMap((m) => [m.clubA, m.clubB]))]
      const order = computeClubOrderFromMatches({ clubs: participatingClubs, matches: subset })
      if (order.length < 2) return state

      const pairings: Array<[ClubId, ClubId, '12' | '34']> = []
      pairings.push([order[0]!, order[1]!, '12'])
      if (order.length >= 4) pairings.push([order[2]!, order[3]!, '34'])

      const divisionIds = [...new Set(subset.map((m) => m.divisionId))]
      const maxRoundByDivision = new Map<string, number>()
      for (const m of state.matches) {
        if (!divisionIds.includes(m.divisionId)) continue
        const prev = maxRoundByDivision.get(m.divisionId) ?? 0
        maxRoundByDivision.set(m.divisionId, Math.max(prev, Number(m.round) || 0))
      }

      const existingIds = new Set(state.matches.map((m) => m.id))
      const additions: TournamentStateV2['matches'] = []
      for (const divisionId of divisionIds) {
        const divisionEvents = getSeededEventsForDivision(state, divisionId)
        const nextRound = (maxRoundByDivision.get(divisionId) ?? 0) + 1
        for (let matchupIndex = 0; matchupIndex < pairings.length; matchupIndex++) {
          const [clubA, clubB, slot] = pairings[matchupIndex]!
          for (const ev of divisionEvents) {
            const id = makePlayoffMatchId({
              slot,
              divisionId,
              clubA,
              clubB,
              eventType: ev.eventType,
              seed: ev.seed,
            })
            if (existingIds.has(id)) continue
            additions.push({
              id,
              divisionId,
              round: nextRound,
              matchupIndex,
              eventType: ev.eventType,
              seed: ev.seed,
              court: 0,
              clubA,
              clubB,
              stage: 'PLAYOFF',
            })
            existingIds.add(id)
          }
        }
      }

      if (additions.length === 0) return state
      return touch({ ...state, matches: [...state.matches, ...additions] })
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
              seedA: incoming.seedA && incoming.seedA > 0 ? incoming.seedA : x.seedA,
              seedB: incoming.seedB && incoming.seedB > 0 ? incoming.seedB : x.seedB,
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
    case 'matches.scores.setMany': {
      if (!action.scores.length) return state
      const now = new Date().toISOString()
      const byId = new Map(action.scores.map((x) => [x.matchId, x.score] as const))
      const matches = state.matches.map((m) => {
        const s = byId.get(m.id)
        if (!s) return m
        return { ...m, score: s, completedAt: now }
      })
      return touch({ ...state, matches })
    }
    case 'matches.courts.assign': {
      if (!action.assignments.length) return state
      const byId = new Map(action.assignments.map((a) => [a.matchId, a.court] as const))
      const matches = state.matches.map((m) => {
        const nextCourt = byId.get(m.id)
        if (nextCourt == null) return m
        if (!action.overwrite && m.court > 0) return m
        return { ...m, court: nextCourt }
      })
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
  // Tracks whether we've hydrated match rows for this tid at least once.
  // This prevents a partially-hydrated client from pushing an empty schedule and wiping remote matches.
  const hydratedMatchesTidRef = useRef<string | null>(null)
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
      hydratedMatchesTidRef.current = null
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
            const safeMatches = hydratedMatchesTidRef.current === tid ? stateRef.current.matches : []
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
            hydratedMatchesTidRef.current = tid
            setLastSyncedAt(new Date().toISOString())
            setTimeout(() => {
              isApplyingRemote.current = false
            }, 0)
          },
          onRemoteMatchDelete: (matchId) => {
            isApplyingRemote.current = true
            dispatch({ type: 'match.delete', matchId, source: 'remote' })
            hydratedTidRef.current = tid
            hydratedMatchesTidRef.current = tid
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
          const remoteName = await fetchTournamentName(tid).catch(() => '')
          if (cancelled) return

          const local = stateRef.current

          // IMPORTANT: When a tournament exists in Supabase (remoteCore != null),
          // always treat it as authoritative for this tid, even if its updatedAt is older than
          // whatever state happens to be in-memory from a different tid.
          //
          // Local state is only used to initialize a brand-new tournament (remoteCore == null).
          const chosenCore = remoteCore ?? local
          const chosenMatches = remoteCore ? remoteMatches : remoteMatches.length > 0 ? remoteMatches : local.matches
          const chosenNameRaw = String((chosenCore as unknown as { tournamentName?: unknown }).tournamentName ?? '').trim()
          const chosenName = chosenNameRaw.length ? chosenNameRaw : String(remoteName ?? '').trim()

          isApplyingRemote.current = true
          dispatch({ type: 'import', state: { ...chosenCore, tournamentName: chosenName, matches: chosenMatches }, source: 'remote' })
          hydratedTidRef.current = tid
          hydratedMatchesTidRef.current = tid
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
      tournamentName: s.tournamentName ?? '',
      clubs: s.clubs,
      divisions: s.divisions,
      seededEvents: s.seededEvents ?? [],
      seededEventsByDivision: s.seededEventsByDivision ?? {},
      eventScheduleModes: s.eventScheduleModes,
      eventScheduleModesByDivision: s.eventScheduleModesByDivision ?? {},
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
        seedA: m.seedA ?? m.seed,
        seedB: m.seedB ?? m.seed,
        court: m.court,
        stage: m.stage ?? 'REGULAR',
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
    // CRITICAL: Don't push schedules/scores until we've hydrated match rows at least once for this tid.
    // Otherwise realtime "core" events can mark the tid as hydrated while matches are still empty, causing a delete-all.
    if (hydratedMatchesTidRef.current !== tid) return
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
      setTournamentName: (name) => dispatch({ type: 'tournament.name.set', name }),
      setTournamentPassword: (password) => dispatch({ type: 'tournament.password.set', salt: password.salt, hash: password.hash }),
      clearTournamentPassword: () => dispatch({ type: 'tournament.password.clear' }),
      importState: (s) => dispatch({ type: 'import', state: s }),
      addClub: (clubId, name) => dispatch({ type: 'club.add', clubId, name }),
      removeClub: (clubId) => dispatch({ type: 'club.remove', clubId }),
      setClubName: (clubId, name) => dispatch({ type: 'club.name.set', clubId, name }),
      setClubCode: (clubId, code) => dispatch({ type: 'club.code.set', clubId, code }),
      addDivision: (division) => dispatch({ type: 'division.add', division }),
      updateDivision: (divisionId, patch) => dispatch({ type: 'division.update', divisionId, ...patch }),
      deleteDivision: (divisionId) => dispatch({ type: 'division.delete', divisionId }),
      addLineupProfile: (profileId, name, baseProfileId) =>
        dispatch({ type: 'lineup.profile.add', profileId, name, baseProfileId }),
      renameLineupProfile: (profileId, name) => dispatch({ type: 'lineup.profile.rename', profileId, name }),
      deleteLineupProfile: (profileId) => dispatch({ type: 'lineup.profile.delete', profileId }),
      setDefaultLineupProfile: (profileId) => dispatch({ type: 'lineup.profile.default.set', profileId }),
      setDivisionClubEnabled: (divisionId, clubId, enabled) =>
        dispatch({ type: 'division.club.enabled.set', divisionId, clubId, enabled }),
      addPlayer: (divisionId, clubId, gender) => dispatch({ type: 'player.add', divisionId, clubId, gender }),
      removePlayer: (playerId) => dispatch({ type: 'player.remove', playerId }),
      setPlayerName: (playerId, name) => dispatch({ type: 'player.name.set', playerId, name }),
      setSeededEvents: (divisionId, seededEvents) => dispatch({ type: 'seeded.events.set', divisionId, seededEvents }),
      setEventScheduleMode: (divisionId, eventType, mode) =>
        dispatch({ type: 'event.scheduleMode.set', divisionId, eventType, mode }),
      autoSeed: (divisionId, clubId, profileId) => dispatch({ type: 'division.autoseed', divisionId, clubId, profileId }),
      unlockMatch: (matchId) => dispatch({ type: 'match.unlock', matchId }),
      clearAllScores: () => dispatch({ type: 'matches.scores.clearAll' }),
      setSeed: (divisionId, clubId, eventType, seed, playerIds, profileId) =>
        dispatch({ type: 'division.seed.set', divisionId, clubId, eventType, seed, playerIds, profileId }),
      generateSchedule: () => dispatch({ type: 'schedule.generate' }),
      regenerateSchedule: () => dispatch({ type: 'schedule.regenerate' }),
      optimizeRounds: (matchIds, targetCourts) => dispatch({ type: 'matches.rounds.optimize', matchIds, targetCourts }),
      addPlayoffRound: (matchIds) => dispatch({ type: 'playoff.round.add', matchIds }),
      setScore: (matchId, score) => dispatch({ type: 'match.score.set', matchId, score }),
      setScoresMany: (scores) => dispatch({ type: 'matches.scores.setMany', scores }),
      deleteMatches: (matchIds) => dispatch({ type: 'matches.deleteMany', matchIds }),
      assignCourts: (assignments, overwrite) => dispatch({ type: 'matches.courts.assign', assignments, overwrite }),
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

