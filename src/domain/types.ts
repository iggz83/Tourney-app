export type ClubCode = 'NPC' | 'IPG' | 'PR' | 'PUP'
export type ClubId = ClubCode
export type DivisionId = string
export type PlayerId = string
export type MatchId = string

export type SkillDivisionCode = '3U' | '3035' | '3540' | '4043'

export type Gender = 'M' | 'F'

export type EventType = 'WOMENS_DOUBLES' | 'MENS_DOUBLES' | 'MIXED_DOUBLES'

export type SeedKey = `${EventType}:${number}`

export interface Club {
  id: ClubId
  code: ClubCode
  name: string
}

export interface Division {
  id: DivisionId
  code: SkillDivisionCode
  name: string
}

export interface Player {
  id: PlayerId
  clubId: ClubId
  divisionId: DivisionId
  gender: Gender
  firstName: string
  lastName: string
}

export interface SeededEvent {
  eventType: EventType
  seed: number
  label: string
}

export interface SeedAssignment {
  /**
   * Allow partial selection in the UI.
   * A seed is considered "mapped" only when BOTH slots are non-null.
   */
  playerIds: [PlayerId | null, PlayerId | null]
}

export interface DivisionConfig {
  divisionId: DivisionId
  /** Per-club seed assignments for this division (e.g. Women #1 pair, Mixed #3 pair, etc.) */
  seedsByClub: Record<ClubId, Record<SeedKey, SeedAssignment>>
}

export interface MatchScore {
  a: number
  b: number
}

export interface Match {
  id: MatchId
  divisionId: DivisionId
  round: 1 | 2 | 3
  matchupIndex: 0 | 1
  eventType: EventType
  seed: number
  court: number
  clubA: ClubId
  clubB: ClubId
  score?: MatchScore
  completedAt?: string
}

export interface TournamentStateV1 {
  version: 1
  clubs: Club[]
  divisions: Division[]
  players: Array<Omit<Player, 'divisionId'>>
  divisionConfigs: DivisionConfig[]
  matches: Match[]
  updatedAt: string
}

export interface TournamentStateV2 {
  version: 2
  clubs: Club[]
  divisions: Division[]
  players: Player[]
  divisionConfigs: DivisionConfig[]
  matches: Match[]
  updatedAt: string
}

export type TournamentState = TournamentStateV1 | TournamentStateV2

