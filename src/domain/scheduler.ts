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

function eventOrder(eventType: Match['eventType']): number {
  if (eventType === 'WOMENS_DOUBLES') return 0
  if (eventType === 'MENS_DOUBLES') return 1
  return 2
}

/**
 * Repack generated matches into the fewest possible rounds while ensuring
 * a "sub-team" (club + event + seed) appears at most once per round.
 */
function packDivisionMatches(matches: Match[]): Match[] {
  const ordered = [...matches].sort((a, b) => {
    // Keep generation's rough opponent cadence first, then stable event/seed ordering.
    if (a.round !== b.round) return a.round - b.round
    if (a.matchupIndex !== b.matchupIndex) return a.matchupIndex - b.matchupIndex
    const eo = eventOrder(a.eventType) - eventOrder(b.eventType)
    if (eo !== 0) return eo
    const [aSeedA, aSeedB] = getMatchSeedPair(a)
    const [bSeedA, bSeedB] = getMatchSeedPair(b)
    if (aSeedA !== bSeedA) return aSeedA - bSeedA
    if (aSeedB !== bSeedB) return aSeedB - bSeedB
    if (a.clubA !== b.clubA) return a.clubA.localeCompare(b.clubA)
    if (a.clubB !== b.clubB) return a.clubB.localeCompare(b.clubB)
    return a.id.localeCompare(b.id)
  })

  const rounds: Array<{ used: Set<string>; matches: Match[] }> = []

  for (const match of ordered) {
    const [seedA, seedB] = getMatchSeedPair(match)
    const tokenA = `${match.clubA}|${match.eventType}|${seedA}`
    const tokenB = `${match.clubB}|${match.eventType}|${seedB}`

    let placed = false
    for (const r of rounds) {
      if (r.used.has(tokenA) || r.used.has(tokenB)) continue
      r.matches.push(match)
      r.used.add(tokenA)
      r.used.add(tokenB)
      placed = true
      break
    }
    if (!placed) {
      rounds.push({
        used: new Set([tokenA, tokenB]),
        matches: [match],
      })
    }
  }

  const packed: Match[] = []
  for (let ri = 0; ri < rounds.length; ri++) {
    const roundMatches = rounds[ri]!.matches
    for (let mi = 0; mi < roundMatches.length; mi++) {
      packed.push({
        ...roundMatches[mi]!,
        round: ri + 1,
        matchupIndex: mi,
      })
    }
  }
  return packed
}

/**
 * Repack existing matches by division (regular stage only) so that a sub-team
 * (club + event + seed) does not appear twice in the same round.
 * Preserves non-regular matches as-is.
 */
export function optimizeRoundsForMatches(matches: Match[]): Match[] {
  const byDivision = new Map<string, Match[]>()
  const out: Match[] = []

  for (const m of matches) {
    if ((m.stage ?? 'REGULAR') !== 'REGULAR') {
      out.push(m)
      continue
    }
    const arr = byDivision.get(m.divisionId) ?? []
    arr.push(m)
    byDivision.set(m.divisionId, arr)
  }

  for (const ms of byDivision.values()) {
    out.push(...packDivisionMatches(ms))
  }

  return out
}

export function optimizeRoundsForFiltered(args: {
  allMatches: Match[]
  targetMatchIds: string[]
  targetCourts?: number
}): Match[] {
  const { allMatches, targetMatchIds, targetCourts } = args
  const idSet = new Set(targetMatchIds)
  if (idSet.size === 0) return allMatches

  const cap = Number.isFinite(targetCourts) && Number(targetCourts) > 0 ? Math.max(1, Math.floor(Number(targetCourts))) : Number.POSITIVE_INFINITY

  const selected = allMatches.filter((m) => idSet.has(m.id) && (m.stage ?? 'REGULAR') === 'REGULAR')
  if (selected.length === 0) return allMatches

  const byDivision = new Map<string, Match[]>()
  for (const m of selected) {
    const arr = byDivision.get(m.divisionId) ?? []
    arr.push(m)
    byDivision.set(m.divisionId, arr)
  }

  const updates = new Map<string, Match>()

  for (const [divisionId, divisionMatches] of byDivision) {
    const startRound = Math.max(1, Math.min(...divisionMatches.map((m) => Number(m.round) || 1)))
    const ordered = [...divisionMatches]
      .sort((a, b) => {
        if (a.round !== b.round) return a.round - b.round
        if (a.matchupIndex !== b.matchupIndex) return a.matchupIndex - b.matchupIndex
        const eo = eventOrder(a.eventType) - eventOrder(b.eventType)
        if (eo !== 0) return eo
        const [aSeedA, aSeedB] = getMatchSeedPair(a)
        const [bSeedA, bSeedB] = getMatchSeedPair(b)
        if (aSeedA !== bSeedA) return aSeedA - bSeedA
        if (aSeedB !== bSeedB) return aSeedB - bSeedB
        if (a.clubA !== b.clubA) return a.clubA.localeCompare(b.clubA)
        if (a.clubB !== b.clubB) return a.clubB.localeCompare(b.clubB)
        return a.id.localeCompare(b.id)
      })
      .map((m) => {
        const [seedA, seedB] = getMatchSeedPair(m)
        return {
          match: m,
          tokenA: `${m.clubA}|${m.eventType}|${seedA}`,
          tokenB: `${m.clubB}|${m.eventType}|${seedB}`,
        }
      })

    const maxAttempts = Math.min(1700, Math.max(120, ordered.length * 50))
    let bestRounds: number[][] | null = null
    let bestObjective: [number, number, number] | null = null // [rounds, underfilledRounds, slackSq]

    const rand01 = (attempt: number, idx: number) => {
      let x = (attempt + 1) * 1103515245 + (idx + 1) * 12345
      x ^= x << 13
      x ^= x >>> 17
      x ^= x << 5
      return (x >>> 0) / 4294967295
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const remaining = new Set<number>(ordered.map((_, i) => i))
      const rounds: number[][] = []

      while (remaining.size > 0) {
        const used = new Set<string>()
        const round: number[] = []
        const tokenCount = new Map<string, number>()
        for (const i of remaining) {
          const it = ordered[i]!
          tokenCount.set(it.tokenA, (tokenCount.get(it.tokenA) ?? 0) + 1)
          tokenCount.set(it.tokenB, (tokenCount.get(it.tokenB) ?? 0) + 1)
        }

        while (round.length < cap && remaining.size > 0) {
          let bestIdx = -1
          let bestScore = Number.NEGATIVE_INFINITY

          for (const i of remaining) {
            const it = ordered[i]!
            if (used.has(it.tokenA) || used.has(it.tokenB)) continue
            const cA = tokenCount.get(it.tokenA) ?? 0
            const cB = tokenCount.get(it.tokenB) ?? 0
            const conflictScore = cA + cB
            const jitter = rand01(attempt, i)
            const score = conflictScore * 1000 + jitter
            if (score > bestScore) {
              bestScore = score
              bestIdx = i
            }
          }

          if (bestIdx < 0) break
          const it = ordered[bestIdx]!
          round.push(bestIdx)
          remaining.delete(bestIdx)
          used.add(it.tokenA)
          used.add(it.tokenB)
          tokenCount.set(it.tokenA, Math.max(0, (tokenCount.get(it.tokenA) ?? 0) - 1))
          tokenCount.set(it.tokenB, Math.max(0, (tokenCount.get(it.tokenB) ?? 0) - 1))
        }

        rounds.push(round)
      }

      const roundsCount = rounds.length
      const underfilledRounds = Number.isFinite(cap) ? rounds.reduce((n, r) => n + (r.length < cap ? 1 : 0), 0) : 0
      const slackSq = Number.isFinite(cap)
        ? rounds.reduce((n, r) => {
            const slack = Math.max(0, cap - r.length)
            return n + slack * slack
          }, 0)
        : 0
      const objective: [number, number, number] = [roundsCount, underfilledRounds, slackSq]
      if (
        !bestObjective ||
        objective[0] < bestObjective[0] ||
        (objective[0] === bestObjective[0] && objective[1] < bestObjective[1]) ||
        (objective[0] === bestObjective[0] && objective[1] === bestObjective[1] && objective[2] < bestObjective[2])
      ) {
        bestObjective = objective
        bestRounds = rounds
      }
    }

    const rounds = bestRounds ?? [ordered.map((_, i) => i)]

    for (let ri = 0; ri < rounds.length; ri++) {
      const roundIdxs = rounds[ri]!
      for (let mi = 0; mi < roundIdxs.length; mi++) {
        const match = ordered[roundIdxs[mi]!]!.match
        updates.set(match.id, {
          ...match,
          divisionId,
          round: startRound + ri,
          matchupIndex: mi,
        })
      }
    }
  }

  return allMatches.map((m) => updates.get(m.id) ?? m)
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
    const divisionMatches: Match[] = []
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
                divisionMatches.push({
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
              divisionMatches.push({
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

    matches.push(...packDivisionMatches(divisionMatches))
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

