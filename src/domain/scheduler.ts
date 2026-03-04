import type { ClubId, DivisionId, Match, TournamentStateV2 } from './types'

export function getMatchSeedForClub(match: Pick<Match, 'clubA' | 'clubB' | 'seed' | 'seedA' | 'seedB'>, clubId: ClubId): number {
  if (clubId === match.clubA) return Number(match.seedA ?? match.seed)
  if (clubId === match.clubB) return Number(match.seedB ?? match.seed)
  return Number(match.seed)
}

function getMatchSeedPair(match: Pick<Match, 'seed' | 'seedA' | 'seedB'>): [number, number] {
  const a = Math.max(1, Math.floor(Number(match.seedA ?? match.seed ?? 1)))
  const b = Math.max(1, Math.floor(Number(match.seedB ?? match.seed ?? 1)))
  return [a, b]
}

function getSeededEventsForDivision(
  state: Pick<TournamentStateV2, 'seededEventsByDivision' | 'seededEvents'>,
  divisionId: string,
): TournamentStateV2['seededEvents'] {
  const fromDivision = state.seededEventsByDivision?.[divisionId]
  if (Array.isArray(fromDivision) && fromDivision.length) return fromDivision
  return state.seededEvents ?? []
}

function getEventScheduleModesForDivision(
  state: Pick<TournamentStateV2, 'eventScheduleModesByDivision' | 'eventScheduleModes'>,
  divisionId: string,
): TournamentStateV2['eventScheduleModes'] {
  const fromDivision = state.eventScheduleModesByDivision?.[divisionId]
  if (fromDivision) return fromDivision
  return state.eventScheduleModes
}

export function makeMatchId(parts: {
  divisionId: DivisionId
  clubA: ClubId
  clubB: ClubId
  eventType: Match['eventType']
  seed: number
  seedA?: number
  seedB?: number
}) {
  // Deterministic + stable even if we later re-pack rounds/matchupIndexes.
  const { divisionId, clubA, clubB, eventType, seed } = parts
  const sa = Math.max(1, Math.floor(Number(parts.seedA ?? seed)))
  const sb = Math.max(1, Math.floor(Number(parts.seedB ?? seed)))
  const [a, b] = [clubA, clubB].sort()
  const seedSuffix = sa === sb ? `s${sa}` : `sa${sa}:sb${sb}`
  return `m:${divisionId}:${eventType}:${seedSuffix}:${a}-vs-${b}`
}

export function makeMatchKey(parts: {
  divisionId: DivisionId
  clubA: ClubId
  clubB: ClubId
  eventType: Match['eventType']
  seed: number
  seedA?: number
  seedB?: number
}) {
  const { divisionId, clubA, clubB, eventType, seed } = parts
  const sa = Math.max(1, Math.floor(Number(parts.seedA ?? seed)))
  const sb = Math.max(1, Math.floor(Number(parts.seedB ?? seed)))
  const [a, b] = [clubA, clubB].sort()
  return `${divisionId}|${eventType}|${sa}|${sb}|${a}|${b}`
}

export function matchKeyFromMatch(m: Match): string {
  const [seedA, seedB] = getMatchSeedPair(m)
  return makeMatchKey({ divisionId: m.divisionId, clubA: m.clubA, clubB: m.clubB, eventType: m.eventType, seed: m.seed, seedA, seedB })
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

export function generateSchedule(
  state: Pick<
    TournamentStateV2,
    | 'divisions'
    | 'clubs'
    | 'divisionConfigs'
    | 'seededEvents'
    | 'seededEventsByDivision'
    | 'eventScheduleModes'
    | 'eventScheduleModesByDivision'
  >,
): Match[] {
  const matches: Match[] = []

  for (const division of state.divisions) {
    const divisionEvents = getSeededEventsForDivision(state, division.id)
    const divisionModes = getEventScheduleModesForDivision(state, division.id)
    const seedsByEvent = new Map<Match['eventType'], number[]>()
    for (const ev of divisionEvents) {
      const arr = seedsByEvent.get(ev.eventType) ?? []
      arr.push(ev.seed)
      seedsByEvent.set(ev.eventType, arr)
    }
    for (const [k, arr] of seedsByEvent) {
      seedsByEvent.set(k, [...new Set(arr)].sort((a, b) => a - b))
    }

    const dc = state.divisionConfigs.find((d) => d.divisionId === division.id)
    const enabled = dc?.clubEnabled ?? {}
    const participating = state.clubs.map((c) => c.id).filter((clubId) => enabled[clubId] !== false)

    const rounds = roundRobinPairs(participating)
    for (let r = 0; r < rounds.length; r++) {
      const pairs = rounds[r]!
      for (let matchupIndex = 0; matchupIndex < pairs.length; matchupIndex++) {
        const [clubA, clubB] = pairs[matchupIndex]!
        for (const eventType of ['WOMENS_DOUBLES', 'MENS_DOUBLES', 'MIXED_DOUBLES'] as const) {
          const seeds = seedsByEvent.get(eventType) ?? []
          const mode = divisionModes[eventType] ?? 'SAME_SEED'
          if (mode === 'ALL_VS_ALL') {
            for (const seedA of seeds) {
              for (const seedB of seeds) {
                matches.push({
                  id: makeMatchId({
                    divisionId: division.id,
                    clubA,
                    clubB,
                    eventType,
                    seed: seedA,
                    seedA,
                    seedB,
                  }),
                  divisionId: division.id,
                  round: r + 1,
                  matchupIndex,
                  eventType,
                  seed: seedA,
                  seedA,
                  seedB,
                  court: 0,
                  clubA,
                  clubB,
                  stage: 'REGULAR',
                })
              }
            }
          } else {
            for (const seed of seeds) {
              matches.push({
                id: makeMatchId({
                  divisionId: division.id,
                  clubA,
                  clubB,
                  eventType,
                  seed,
                }),
                divisionId: division.id,
                round: r + 1,
                matchupIndex,
                eventType,
                seed,
                seedA: seed,
                seedB: seed,
                court: 0,
                clubA,
                clubB,
                stage: 'REGULAR',
              })
            }
          }
        }
      }
    }
  }

  return matches
}

export function generateScheduleAddMissing(args: {
  state: Pick<
    TournamentStateV2,
    | 'divisions'
    | 'clubs'
    | 'divisionConfigs'
    | 'seededEvents'
    | 'seededEventsByDivision'
    | 'eventScheduleModes'
    | 'eventScheduleModesByDivision'
  >
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
    const divisionEvents = getSeededEventsForDivision(state, division.id)
    const divisionModes = getEventScheduleModesForDivision(state, division.id)
    const seedsByEvent = new Map<Match['eventType'], number[]>()
    for (const ev of divisionEvents) {
      const arr = seedsByEvent.get(ev.eventType) ?? []
      arr.push(ev.seed)
      seedsByEvent.set(ev.eventType, arr)
    }
    for (const [k, arr] of seedsByEvent) {
      seedsByEvent.set(k, [...new Set(arr)].sort((a, b) => a - b))
    }

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

        for (const eventType of ['WOMENS_DOUBLES', 'MENS_DOUBLES', 'MIXED_DOUBLES'] as const) {
          const seeds = seedsByEvent.get(eventType) ?? []
          const mode = divisionModes[eventType] ?? 'SAME_SEED'
          if (mode === 'ALL_VS_ALL') {
            for (const seedA of seeds) {
              for (const seedB of seeds) {
                const key = makeMatchKey({
                  divisionId: division.id,
                  clubA,
                  clubB,
                  eventType,
                  seed: seedA,
                  seedA,
                  seedB,
                })
                if (existingKeys.has(key)) continue
                missingForRound.push({
                  id: makeMatchId({
                    divisionId: division.id,
                    clubA,
                    clubB,
                    eventType,
                    seed: seedA,
                    seedA,
                    seedB,
                  }),
                  divisionId: division.id,
                  round: nextRound,
                  matchupIndex: nextMatchupIndex,
                  eventType,
                  seed: seedA,
                  seedA,
                  seedB,
                  court: 0,
                  clubA,
                  clubB,
                  stage: 'REGULAR',
                })
                existingKeys.add(key)
                addedThisPair = true
              }
            }
          } else {
            for (const seed of seeds) {
              const key = makeMatchKey({
                divisionId: division.id,
                clubA,
                clubB,
                eventType,
                seed,
              })
              if (existingKeys.has(key)) continue
              missingForRound.push({
                id: makeMatchId({
                  divisionId: division.id,
                  clubA,
                  clubB,
                  eventType,
                  seed,
                }),
                divisionId: division.id,
                round: nextRound,
                matchupIndex: nextMatchupIndex,
                eventType,
                seed,
                seedA: seed,
                seedB: seed,
                court: 0,
                clubA,
                clubB,
                stage: 'REGULAR',
              })
              existingKeys.add(key)
              addedThisPair = true
            }
          }
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

