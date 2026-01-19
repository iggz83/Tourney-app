import { CLUBS, SEEDED_EVENTS, SKILL_DIVISIONS } from '../domain/constants'
import { seedKey } from '../domain/keys'
import type { ClubId, DivisionConfig, Player, TournamentStateV2 } from '../domain/types'

function createDefaultPlayers(): Player[] {
  const players: Player[] = []
  for (const division of SKILL_DIVISIONS) {
    for (const club of CLUBS) {
      // 8 players per club per division: 4 Women, 4 Men
      for (let i = 1; i <= 4; i++) {
        players.push({
          id: `${division.id}:${club.id}:W${i}`,
          clubId: club.id,
          divisionId: division.id,
          gender: 'F',
          firstName: club.id,
          lastName: `${division.code} Woman ${i}`,
        })
      }
      for (let i = 1; i <= 4; i++) {
        players.push({
          id: `${division.id}:${club.id}:M${i}`,
          clubId: club.id,
          divisionId: division.id,
          gender: 'M',
          firstName: club.id,
          lastName: `${division.code} Man ${i}`,
        })
      }
    }
  }
  return players
}

function createEmptyDivisionConfig(divisionId: string): DivisionConfig {
  const seedsByClub: DivisionConfig['seedsByClub'] = {} as DivisionConfig['seedsByClub']
  for (const club of CLUBS) {
    const record: DivisionConfig['seedsByClub'][ClubId] = {} as DivisionConfig['seedsByClub'][ClubId]
    for (const ev of SEEDED_EVENTS) {
      record[seedKey(ev.eventType, ev.seed)] = { playerIds: [null, null] }
    }
    seedsByClub[club.id] = record
  }
  const clubEnabled: Record<string, boolean> = {}
  for (const club of CLUBS) clubEnabled[club.id] = true
  return { divisionId, seedsByClub, clubEnabled }
}

export function createInitialTournamentState(): TournamentStateV2 {
  const divisions = SKILL_DIVISIONS
  const players = createDefaultPlayers()
  const divisionConfigs = divisions.map((d) => createEmptyDivisionConfig(d.id))

  return {
    version: 2,
    clubs: CLUBS,
    divisions,
    players,
    divisionConfigs,
    matches: [],
    updatedAt: new Date().toISOString(),
  } satisfies TournamentStateV2
}

