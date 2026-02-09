import type React from 'react'
import type { ClubId, EventType, MatchId, PlayerId, TournamentStateV2 } from '../domain/types'
import type { CloudSyncStatus } from './cloudSync'

export type TournamentStoreAction =
  | { type: 'reset' }
  | { type: 'import'; state: TournamentStateV2; source?: 'local' | 'remote' }
  | { type: 'tournament.lock' }
  | { type: 'tournament.unlock' }
  | { type: 'tournament.password.set'; salt: string; hash: string }
  | { type: 'tournament.password.clear' }
  | { type: 'club.add'; clubId: ClubId; name: string }
  | { type: 'club.remove'; clubId: ClubId }
  | { type: 'club.name.set'; clubId: ClubId; name: string }
  | { type: 'player.name.set'; playerId: PlayerId; name: string }
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
  | { type: 'matches.deleteMany'; matchIds: MatchId[]; source?: 'local' | 'remote' }
  | { type: 'matches.scores.clearAll' }
  | {
      type: 'matches.courts.assign'
      assignments: Array<{ matchId: MatchId; court: number }>
      overwrite: boolean
    }
  | { type: 'match.unlock'; matchId: MatchId }
  | { type: 'match.score.set'; matchId: MatchId; score?: { a: number; b: number } }

export type TournamentStore = {
  state: TournamentStateV2
  dispatch: React.Dispatch<TournamentStoreAction>
  cloud: {
    enabled: boolean
    tid: string | null
    hydrated: boolean
    status: CloudSyncStatus
    inFlight: number
    lastSyncedAt: string | null
    lastSyncedUpdatedAt: string | null
    error: string | null
  }
  actions: {
    reset(): void
    lockTournament(): void
    unlockTournament(): void
    setTournamentPassword(password: { salt: string; hash: string }): void
    clearTournamentPassword(): void
    importState(state: TournamentStateV2): void
    addClub(clubId: ClubId, name: string): void
    removeClub(clubId: ClubId): void
    setClubName(clubId: ClubId, name: string): void
    setDivisionClubEnabled(divisionId: string, clubId: ClubId, enabled: boolean): void
    setPlayerName(playerId: PlayerId, name: string): void
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
    deleteMatches(matchIds: MatchId[]): void
    assignCourts(assignments: Array<{ matchId: MatchId; court: number }>, overwrite: boolean): void
    exportJson(): string
  }
}

