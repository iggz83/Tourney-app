import { SEEDED_EVENTS } from './constants'
import type { ClubId, DivisionId, Match, TournamentStateV2 } from './types'

function matchId(parts: {
  divisionId: DivisionId
  round: number
  matchupIndex: number
  clubA: ClubId
  clubB: ClubId
  eventType: Match['eventType']
  seed: number
}) {
  // Deterministic: stable across regenerations.
  const { divisionId, round, matchupIndex, clubA, clubB, eventType, seed } = parts
  // Use a canonical pair ordering so ids don't change if home/away order changes.
  const [a, b] = [clubA, clubB].sort()
  return `m:${divisionId}:r${round}:u${matchupIndex}:${a}-vs-${b}:${eventType}:s${seed}`
}

function roundRobinPairs(clubIds: ClubId[]): Array<Array<[ClubId, ClubId]>> {
  const ids = clubIds.slice()
  if (ids.length < 2) return []

  // For odd counts, add a BYE placeholder.
  const BYE = '__BYE__' as ClubId
  if (ids.length % 2 === 1) ids.push(BYE)

  const n = ids.length
  const rounds = n - 1
  const arr = ids.slice()
  const res: Array<Array<[ClubId, ClubId]>> = []

  for (let r = 0; r < rounds; r++) {
    const pairs: Array<[ClubId, ClubId]> = []
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i]!
      const b = arr[n - 1 - i]!
      if (a === BYE || b === BYE) continue
      // Canonicalize ordering to keep IDs stable and display consistent.
      const [x, y] = [a, b].sort()
      pairs.push([x, y])
    }
    res.push(pairs)

    // Rotate all but first
    const fixed = arr[0]!
    const rest = arr.slice(1)
    rest.unshift(rest.pop()!)
    arr.splice(0, arr.length, fixed, ...rest)
  }

  return res
}

export function generateSchedule(
  state: Pick<TournamentStateV2, 'divisions' | 'clubs' | 'divisionConfigs'>,
): Match[] {
  const matches: Match[] = []

  for (const division of state.divisions) {
    const dc = state.divisionConfigs.find((d) => d.divisionId === division.id)
    const enabled = dc?.clubEnabled ?? {}
    const participating = state.clubs
      .map((c) => c.id)
      .filter((clubId) => enabled[clubId] !== false)

    const rounds = roundRobinPairs(participating)
    for (let r = 0; r < rounds.length; r++) {
      const pairs = rounds[r]!
      for (let matchupIndex = 0; matchupIndex < pairs.length; matchupIndex++) {
        const [clubA, clubB] = pairs[matchupIndex]!
        for (const seededEvent of SEEDED_EVENTS) {
          matches.push({
            id: matchId({
              divisionId: division.id,
              round: r + 1,
              matchupIndex,
              clubA,
              clubB,
              eventType: seededEvent.eventType,
              seed: seededEvent.seed,
            }),
            divisionId: division.id,
            round: r + 1,
            matchupIndex,
            eventType: seededEvent.eventType,
            seed: seededEvent.seed,
            court: 0, // unassigned; can be filled in manually on printouts
            clubA,
            clubB,
          })
        }
      }
    }
  }

  return matches
}

