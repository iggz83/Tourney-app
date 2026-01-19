import { COURTS_BY_EVENT_AND_SEED, ROUND_ROBIN_ROUNDS, SEEDED_EVENTS } from './constants'
import type { ClubId, DivisionId, Match, TournamentStateV2 } from './types'

function matchId(parts: {
  divisionId: DivisionId
  round: 1 | 2 | 3
  matchupIndex: 0 | 1
  clubA: ClubId
  clubB: ClubId
  eventType: Match['eventType']
  seed: number
}) {
  // Deterministic: stable across regenerations.
  const { divisionId, round, matchupIndex, clubA, clubB, eventType, seed } = parts
  return `m:${divisionId}:r${round}:u${matchupIndex}:${clubA}-vs-${clubB}:${eventType}:s${seed}`
}

export function generateSchedule(state: Pick<TournamentStateV2, 'divisions'>): Match[] {
  const matches: Match[] = []

  for (const division of state.divisions) {
    for (const roundSpec of ROUND_ROBIN_ROUNDS) {
      for (let matchupIndex = 0; matchupIndex < roundSpec.matchups.length; matchupIndex++) {
        const [clubA, clubB] = roundSpec.matchups[matchupIndex]!

        for (const seededEvent of SEEDED_EVENTS) {
          const courts = COURTS_BY_EVENT_AND_SEED[seededEvent.eventType][seededEvent.seed]
          if (!courts) continue

          const court = courts[matchupIndex as 0 | 1]
          matches.push({
            id: matchId({
              divisionId: division.id,
              round: roundSpec.round,
              matchupIndex: matchupIndex as 0 | 1,
              clubA,
              clubB,
              eventType: seededEvent.eventType,
              seed: seededEvent.seed,
            }),
            divisionId: division.id,
            round: roundSpec.round,
            matchupIndex: matchupIndex as 0 | 1,
            eventType: seededEvent.eventType,
            seed: seededEvent.seed,
            court,
            clubA,
            clubB,
          })
        }
      }
    }
  }

  return matches
}

