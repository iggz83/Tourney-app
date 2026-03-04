import { seedKey } from './keys'
import { getMatchSeedForClub } from './scheduler'
import type { DivisionConfig, LineupProfile, Match, Player, PlayerId, TournamentStateV2 } from './types'

export function getSeededEventsForDivision(
  state: Pick<TournamentStateV2, 'seededEventsByDivision' | 'seededEvents'>,
  divisionId: string,
): TournamentStateV2['seededEvents'] {
  const fromDivision = state.seededEventsByDivision?.[divisionId]
  if (Array.isArray(fromDivision) && fromDivision.length) return fromDivision
  return state.seededEvents ?? []
}

export function getEventScheduleModesForDivision(
  state: Pick<TournamentStateV2, 'eventScheduleModesByDivision' | 'eventScheduleModes'>,
  divisionId: string,
): TournamentStateV2['eventScheduleModes'] {
  const fromDivision = state.eventScheduleModesByDivision?.[divisionId]
  if (fromDivision) return fromDivision
  return state.eventScheduleModes
}

export function getDivisionConfig(state: Pick<TournamentStateV2, 'divisionConfigs'>, divisionId: string): DivisionConfig | undefined {
  return state.divisionConfigs.find((d) => d.divisionId === divisionId)
}

export function getLineupProfileById(
  state: Pick<TournamentStateV2, 'lineupProfiles' | 'defaultLineupProfileId'>,
  profileId: string | null | undefined,
): LineupProfile | null {
  const id = String(profileId ?? '').trim()
  const direct = id ? state.lineupProfiles.find((p) => p.id === id) : undefined
  if (direct) return direct
  const def = state.lineupProfiles.find((p) => p.id === state.defaultLineupProfileId)
  return def ?? state.lineupProfiles[0] ?? null
}

export function getDivisionConfigForMatch(
  state: Pick<TournamentStateV2, 'lineupProfiles' | 'defaultLineupProfileId' | 'divisionConfigs'>,
  match: Match,
): DivisionConfig | undefined {
  // Back-compat: if profiles missing or malformed, fall back to legacy divisionConfigs.
  if (!Array.isArray((state as TournamentStateV2).lineupProfiles) || !(state as TournamentStateV2).lineupProfiles.length) {
    return getDivisionConfig(state, match.divisionId)
  }
  const lp = getLineupProfileById(state as TournamentStateV2, match.lineupProfileId)
  return lp?.divisionConfigs.find((d) => d.divisionId === match.divisionId)
}

export function getPlayersById(state: Pick<TournamentStateV2, 'players'>): Map<PlayerId, Player> {
  return new Map(state.players.map((p) => [p.id, p]))
}

export function getMatchPlayerIdsForClub(args: {
  state: Pick<TournamentStateV2, 'lineupProfiles' | 'defaultLineupProfileId' | 'divisionConfigs'>
  match: Match
  clubId: Match['clubA']
}): [PlayerId, PlayerId] | null {
  const { state, match, clubId } = args
  const divisionConfig = getDivisionConfigForMatch(state, match)
  if (!divisionConfig) return null
  const seed = getMatchSeedForClub(match, clubId)
  const entry = divisionConfig.seedsByClub?.[clubId]?.[seedKey(match.eventType, seed)]
  const ids = entry?.playerIds
  if (!ids) return null
  if (!ids[0] || !ids[1]) return null
  return [ids[0], ids[1]]
}

