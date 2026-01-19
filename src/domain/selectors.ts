import { seedKey } from './keys'
import type { DivisionConfig, Match, Player, PlayerId, TournamentStateV2 } from './types'

export function getDivisionConfig(state: Pick<TournamentStateV2, 'divisionConfigs'>, divisionId: string): DivisionConfig | undefined {
  return state.divisionConfigs.find((d) => d.divisionId === divisionId)
}

export function getPlayersById(state: Pick<TournamentStateV2, 'players'>): Map<PlayerId, Player> {
  return new Map(state.players.map((p) => [p.id, p]))
}

export function getMatchPlayerIdsForClub(args: {
  match: Match
  clubId: Match['clubA']
  divisionConfig?: DivisionConfig
}): [PlayerId, PlayerId] | null {
  const { match, clubId, divisionConfig } = args
  if (!divisionConfig) return null
  const entry = divisionConfig.seedsByClub?.[clubId]?.[seedKey(match.eventType, match.seed)]
  const ids = entry?.playerIds
  if (!ids) return null
  if (!ids[0] || !ids[1]) return null
  return [ids[0], ids[1]]
}

