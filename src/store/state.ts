import { SKILL_DIVISIONS } from '../domain/constants'
import type { DivisionConfig, TournamentStateV2 } from '../domain/types'

function createDefaultPlayers(): TournamentStateV2['players'] {
  // Default tournament starts with no clubs, so no roster slots are precreated.
  return []
}

function createEmptyDivisionConfig(divisionId: string): DivisionConfig {
  // Start empty: clubs added later will extend these configs.
  const seedsByClub: DivisionConfig['seedsByClub'] = {} as DivisionConfig['seedsByClub']
  const clubEnabled: Record<string, boolean> = {}
  return { divisionId, seedsByClub, clubEnabled }
}

export function createInitialTournamentState(): TournamentStateV2 {
  const divisions = SKILL_DIVISIONS
  const players = createDefaultPlayers()
  const divisionConfigs = divisions.map((d) => createEmptyDivisionConfig(d.id))

  return {
    version: 2,
    tournamentName: '',
    clubs: [],
    divisions,
    players,
    divisionConfigs,
    matches: [],
    tournamentLockedAt: null,
    tournamentLockRev: 0,
    tournamentPasswordSalt: null,
    tournamentPasswordHash: null,
    updatedAt: new Date().toISOString(),
  } satisfies TournamentStateV2
}

