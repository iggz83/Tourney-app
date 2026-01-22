/**
 * Clubs are user-defined. We use a short acronym-like id (e.g. "NPC") as the stable identifier.
 * This was previously a fixed union ('NPC' | 'IPG' | 'PR' | 'PUP').
 */
export type ClubId = string
export type ClubCode = string
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
  /** Single display name used throughout the UI. */
  name: string
  /** Legacy fields kept for backwards compatibility with older saved tournaments. */
  firstName?: string
  lastName?: string
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
  /**
   * Per-division participation toggle.
   * If a club is false here, it is considered "no team for this division" and excluded from schedule generation.
   * Missing keys default to true.
   */
  clubEnabled?: Record<ClubId, boolean>
}

export interface MatchScore {
  a: number
  b: number
}

export interface Match {
  id: MatchId
  divisionId: DivisionId
  round: number
  matchupIndex: number
  eventType: EventType
  seed: number
  /** 0 means "unassigned" (printouts can be filled manually) */
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
  // Legacy player shape (pre "divisionId per player" model).
  players: Array<{
    id: PlayerId
    clubId: ClubId
    gender: Gender
    firstName: string
    lastName: string
  }>
  divisionConfigs: DivisionConfig[]
  matches: Match[]
  /** When set, the tournament is locked (read-only) across the app. */
  tournamentLockedAt?: string | null
  /**
   * Monotonic lock revision. Incremented on every lock/unlock to resolve cloud conflicts without relying on client clocks.
   * Missing values default to 0.
   */
  tournamentLockRev?: number
  updatedAt: string
}

export interface TournamentStateV2 {
  version: 2
  clubs: Club[]
  divisions: Division[]
  players: Player[]
  divisionConfigs: DivisionConfig[]
  matches: Match[]
  /** When set, the tournament is locked (read-only) across the app. */
  tournamentLockedAt?: string | null
  /**
   * Monotonic lock revision. Incremented on every lock/unlock to resolve cloud conflicts without relying on client clocks.
   * Missing values default to 0.
   */
  tournamentLockRev?: number
  updatedAt: string
}

export type TournamentState = TournamentStateV1 | TournamentStateV2

