import type React from 'react'
import type { ClubId, EventType, MatchId, PlayerId, TournamentStateV2 } from '../domain/types'
import type { CloudSyncStatus } from './cloudSync'

export type TournamentStoreAction =
  | { type: 'reset' }
  | { type: 'import'; state: TournamentStateV2; source?: 'local' | 'remote' }
  | { type: 'tournament.lock' }
  | { type: 'tournament.unlock' }
  | { type: 'tournament.name.set'; name: string }
  | { type: 'tournament.password.set'; salt: string; hash: string }
  | { type: 'tournament.password.clear' }
  | { type: 'club.add'; clubId: ClubId; name: string }
  | { type: 'club.remove'; clubId: ClubId }
  | { type: 'club.name.set'; clubId: ClubId; name: string }
  | { type: 'club.code.set'; clubId: ClubId; code: string }
  | { type: 'division.add'; division: { id: string; code: string; name: string } }
  | { type: 'division.update'; divisionId: string; code?: string; name?: string }
  | { type: 'division.delete'; divisionId: string }
  | { type: 'lineup.profile.add'; profileId: string; name: string; baseProfileId?: string }
  | { type: 'lineup.profile.rename'; profileId: string; name: string }
  | { type: 'lineup.profile.delete'; profileId: string }
  | { type: 'lineup.profile.default.set'; profileId: string }
  | { type: 'player.add'; divisionId: string; clubId: ClubId; gender: 'M' | 'F' }
  | { type: 'player.remove'; playerId: PlayerId }
  | { type: 'player.name.set'; playerId: PlayerId; name: string }
  | { type: 'seeded.events.set'; divisionId: string; seededEvents: TournamentStateV2['seededEvents'] }
  | {
      type: 'event.scheduleMode.set'
      divisionId: string
      eventType: EventType
      mode: TournamentStateV2['eventScheduleModes'][EventType]
    }
  | { type: 'division.autoseed'; divisionId: string; clubId?: ClubId; profileId?: string }
  | { type: 'division.club.enabled.set'; divisionId: string; clubId: ClubId; enabled: boolean }
  | {
      type: 'division.seed.set'
      divisionId: string
      clubId: ClubId
      eventType: EventType
      seed: number
      playerIds: [PlayerId | null, PlayerId | null]
      profileId?: string
    }
  | { type: 'schedule.generate' }
  | { type: 'schedule.regenerate' }
  | { type: 'playoff.round.add'; matchIds: MatchId[] }
  | { type: 'matches.upsert'; match: TournamentStateV2['matches'][number]; source?: 'local' | 'remote' }
  | { type: 'match.delete'; matchId: MatchId; source?: 'local' | 'remote' }
  | { type: 'matches.deleteMany'; matchIds: MatchId[]; source?: 'local' | 'remote' }
  | { type: 'matches.scores.clearAll' }
  | { type: 'matches.scores.setMany'; scores: Array<{ matchId: MatchId; score: { a: number; b: number } }> }
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
    setTournamentName(name: string): void
    setTournamentPassword(password: { salt: string; hash: string }): void
    clearTournamentPassword(): void
    importState(state: TournamentStateV2): void
    addClub(clubId: ClubId, name: string): void
    removeClub(clubId: ClubId): void
    setClubName(clubId: ClubId, name: string): void
    setClubCode(clubId: ClubId, code: string): void
    addDivision(division: { id: string; code: string; name: string }): void
    updateDivision(divisionId: string, patch: { code?: string; name?: string }): void
    deleteDivision(divisionId: string): void
    addLineupProfile(profileId: string, name: string, baseProfileId?: string): void
    renameLineupProfile(profileId: string, name: string): void
    deleteLineupProfile(profileId: string): void
    setDefaultLineupProfile(profileId: string): void
    setDivisionClubEnabled(divisionId: string, clubId: ClubId, enabled: boolean): void
    addPlayer(divisionId: string, clubId: ClubId, gender: 'M' | 'F'): void
    removePlayer(playerId: PlayerId): void
    setPlayerName(playerId: PlayerId, name: string): void
    setSeededEvents(divisionId: string, seededEvents: TournamentStateV2['seededEvents']): void
    setEventScheduleMode(
      divisionId: string,
      eventType: EventType,
      mode: TournamentStateV2['eventScheduleModes'][EventType],
    ): void
    autoSeed(divisionId: string, clubId?: ClubId, profileId?: string): void
    unlockMatch(matchId: MatchId): void
    clearAllScores(): void
    setSeed(
      divisionId: string,
      clubId: ClubId,
      eventType: EventType,
      seed: number,
      playerIds: [PlayerId | null, PlayerId | null],
      profileId?: string,
    ): void
    generateSchedule(): void
    regenerateSchedule(): void
    addPlayoffRound(matchIds: MatchId[]): void
    setScore(matchId: MatchId, score?: { a: number; b: number }): void
    setScoresMany(scores: Array<{ matchId: MatchId; score: { a: number; b: number } }>): void
    deleteMatches(matchIds: MatchId[]): void
    assignCourts(assignments: Array<{ matchId: MatchId; court: number }>, overwrite: boolean): void
    exportJson(): string
  }
}

