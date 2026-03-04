import { SEEDED_EVENTS, SKILL_DIVISIONS } from '../domain/constants'
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
  const defaultProfileId = 'lp-default'
  const seededEventsByDivision = Object.fromEntries(divisions.map((d) => [d.id, SEEDED_EVENTS])) as TournamentStateV2['seededEventsByDivision']
  const defaultEventScheduleModes: TournamentStateV2['eventScheduleModes'] = {
    WOMENS_DOUBLES: 'SAME_SEED',
    MENS_DOUBLES: 'SAME_SEED',
    MIXED_DOUBLES: 'SAME_SEED',
  }
  const eventScheduleModesByDivision = Object.fromEntries(
    divisions.map((d) => [d.id, { ...defaultEventScheduleModes }]),
  ) as TournamentStateV2['eventScheduleModesByDivision']

  return {
    version: 2,
    tournamentName: '',
    clubs: [],
    divisions,
    seededEvents: SEEDED_EVENTS,
    seededEventsByDivision,
    eventScheduleModes: defaultEventScheduleModes,
    eventScheduleModesByDivision,
    players,
    lineupProfiles: [{ id: defaultProfileId, name: 'Default', divisionConfigs }],
    defaultLineupProfileId: defaultProfileId,
    divisionConfigs,
    matches: [],
    tournamentLockedAt: null,
    tournamentLockRev: 0,
    tournamentPasswordSalt: null,
    tournamentPasswordHash: null,
    updatedAt: new Date().toISOString(),
  } satisfies TournamentStateV2
}

