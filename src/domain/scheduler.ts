import { SEEDED_EVENTS } from './constants'
import type { ClubId, DivisionId, Match, TournamentStateV2 } from './types'

export function makeMatchId(parts: {
  divisionId: DivisionId
  clubA: ClubId
  clubB: ClubId
  eventType: Match['eventType']
  seed: number
}) {
  // Deterministic + stable even if we later re-pack rounds/matchupIndexes.
  const { divisionId, clubA, clubB, eventType, seed } = parts
  const [a, b] = [clubA, clubB].sort()
  return `m:${divisionId}:${eventType}:s${seed}:${a}-vs-${b}`
}

export function makeMatchKey(parts: {
  divisionId: DivisionId
  clubA: ClubId
  clubB: ClubId
  eventType: Match['eventType']
  seed: number
}) {
  const { divisionId, clubA, clubB, eventType, seed } = parts
  const [a, b] = [clubA, clubB].sort()
  return `${divisionId}|${eventType}|${seed}|${a}|${b}`
}

export function matchKeyFromMatch(m: Match): string {
  return makeMatchKey({ divisionId: m.divisionId, clubA: m.clubA, clubB: m.clubB, eventType: m.eventType, seed: m.seed })
}

function roundRobinPairs(clubIds: ClubId[]): Array<Array<[ClubId, ClubId]>> {
  const ids = clubIds.slice()
  if (ids.length < 2) return []

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

export function generateSchedule(state: Pick<TournamentStateV2, 'divisions' | 'clubs' | 'divisionConfigs'>): Match[] {
  const matches: Match[] = []

  for (const division of state.divisions) {
    const dc = state.divisionConfigs.find((d) => d.divisionId === division.id)
    const enabled = dc?.clubEnabled ?? {}
    const participating = state.clubs.map((c) => c.id).filter((clubId) => enabled[clubId] !== false)

    const rounds = roundRobinPairs(participating)
    for (let r = 0; r < rounds.length; r++) {
      const pairs = rounds[r]!
      for (let matchupIndex = 0; matchupIndex < pairs.length; matchupIndex++) {
        const [clubA, clubB] = pairs[matchupIndex]!
        for (const seededEvent of SEEDED_EVENTS) {
          matches.push({
            id: makeMatchId({
              divisionId: division.id,
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
            court: 0,
            clubA,
            clubB,
          })
        }
      }
    }
  }

  return matches
}

export function generateScheduleAddMissing(args: {
  state: Pick<TournamentStateV2, 'divisions' | 'clubs' | 'divisionConfigs'>
  existingMatches: Match[]
}): Match[] {
  const { state, existingMatches } = args

  const existingKeys = new Set<string>()
  const maxRoundByDivision = new Map<DivisionId, number>()

  for (const m of existingMatches) {
    existingKeys.add(matchKeyFromMatch(m))
    const prev = maxRoundByDivision.get(m.divisionId) ?? 0
    maxRoundByDivision.set(m.divisionId, Math.max(prev, Number(m.round) || 0))
  }

  const additions: Match[] = []

  for (const division of state.divisions) {
    const dc = state.divisionConfigs.find((d) => d.divisionId === division.id)
    const enabled = dc?.clubEnabled ?? {}
    const participating = state.clubs.map((c) => c.id).filter((clubId) => enabled[clubId] !== false)

    const rounds = roundRobinPairs(participating)
    let nextRound = (maxRoundByDivision.get(division.id) ?? 0) + 1

    for (const pairs of rounds) {
      const missingForRound: Match[] = []
      let nextMatchupIndex = 0

      for (let idx = 0; idx < pairs.length; idx++) {
        const [clubA, clubB] = pairs[idx]!
        let addedThisPair = false

        for (const seededEvent of SEEDED_EVENTS) {
          const key = makeMatchKey({
            divisionId: division.id,
            clubA,
            clubB,
            eventType: seededEvent.eventType,
            seed: seededEvent.seed,
          })
          if (existingKeys.has(key)) continue

          missingForRound.push({
            id: makeMatchId({
              divisionId: division.id,
              clubA,
              clubB,
              eventType: seededEvent.eventType,
              seed: seededEvent.seed,
            }),
            divisionId: division.id,
            round: nextRound,
            matchupIndex: nextMatchupIndex,
            eventType: seededEvent.eventType,
            seed: seededEvent.seed,
            court: 0,
            clubA,
            clubB,
          })
          existingKeys.add(key)
          addedThisPair = true
        }

        if (addedThisPair) nextMatchupIndex++
      }

      if (missingForRound.length === 0) continue
      additions.push(...missingForRound)
      nextRound++
    }
  }

  return [...existingMatches, ...additions]
}

