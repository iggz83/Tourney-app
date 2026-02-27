import type { ClubId, Match, PlayerId, TournamentStateV2 } from './types'
import { getDivisionConfig, getMatchPlayerIdsForClub } from './selectors'

export interface ClubStanding {
  clubId: ClubId
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  pointDiff: number
  matchesPlayed: number
}

export interface PlayerStanding {
  playerId: PlayerId
  clubId: ClubId
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  pointDiff: number
  matchesPlayed: number
}

export interface MatchComputed {
  winnerClubId?: ClubId
  pointDiffForClubA?: number
}

export function computeMatch(match: Match): MatchComputed {
  if (!match.score) return {}
  const { a, b } = match.score
  if (a === b) return {}
  return {
    winnerClubId: a > b ? match.clubA : match.clubB,
    pointDiffForClubA: a - b,
  }
}

export function computeClubStandings(state: TournamentStateV2): ClubStanding[] {
  const byClub = new Map<ClubId, ClubStanding>()
  for (const club of state.clubs) {
    byClub.set(club.id, {
      clubId: club.id,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDiff: 0,
      matchesPlayed: 0,
    })
  }

  for (const match of state.matches) {
    if (!match.score) continue
    const computed = computeMatch(match)
    if (!computed.winnerClubId) continue

    const a = byClub.get(match.clubA)!
    const b = byClub.get(match.clubB)!

    a.matchesPlayed++
    b.matchesPlayed++

    a.pointsFor += match.score.a
    a.pointsAgainst += match.score.b
    a.pointDiff += match.score.a - match.score.b

    b.pointsFor += match.score.b
    b.pointsAgainst += match.score.a
    b.pointDiff += match.score.b - match.score.a

    if (computed.winnerClubId === match.clubA) {
      a.wins++
      b.losses++
    } else {
      b.wins++
      a.losses++
    }
  }

  const baseSorted = [...byClub.values()].sort((x, y) => {
    if (y.wins !== x.wins) return y.wins - x.wins
    if (y.pointDiff !== x.pointDiff) return y.pointDiff - x.pointDiff
    return y.pointsFor - x.pointsFor
  })

  // If a playoff round exists AND all playoff games are scored, use playoff results to decide final ordering
  // for the top 2 (or top 4) while keeping the displayed record/PD from all games.
  const playoffMatches = state.matches.filter((m) => (m.stage ?? 'REGULAR') === 'PLAYOFF')
  if (playoffMatches.length === 0) return baseSorted
  if (!playoffMatches.every((m) => Boolean(m.score) && Boolean(m.completedAt))) return baseSorted

  const baseOrder = baseSorted.map((x) => x.clubId)
  if (baseOrder.length < 2) return baseSorted

  const top2: [ClubId, ClubId] = [baseOrder[0]!, baseOrder[1]!]
  const hasTop4 = baseOrder.length >= 4
  const top4: [ClubId, ClubId, ClubId, ClubId] = hasTop4
    ? [baseOrder[0]!, baseOrder[1]!, baseOrder[2]!, baseOrder[3]!]
    : [baseOrder[0]!, baseOrder[1]!, baseOrder[0]!, baseOrder[1]!]

  function playoffResultBetween(a: ClubId, b: ClubId): { winner: ClubId; loser: ClubId } | null {
    const ms = playoffMatches.filter((m) => {
      return (m.clubA === a && m.clubB === b) || (m.clubA === b && m.clubB === a)
    })
    if (ms.length === 0) return null
    let winsA = 0
    let winsB = 0
    let pdA = 0
    let pfA = 0
    for (const m of ms) {
      if (!m.score) continue
      const c = computeMatch(m)
      if (c.winnerClubId === a) winsA++
      else if (c.winnerClubId === b) winsB++
      if (m.clubA === a) {
        pdA += m.score.a - m.score.b
        pfA += m.score.a
      } else {
        pdA += m.score.b - m.score.a
        pfA += m.score.b
      }
    }
    if (winsA !== winsB) return winsA > winsB ? { winner: a, loser: b } : { winner: b, loser: a }
    if (pdA !== 0) return pdA > 0 ? { winner: a, loser: b } : { winner: b, loser: a }
    if (pfA !== 0) return pfA > 0 ? { winner: a, loser: b } : { winner: b, loser: a }
    // fall back to base order
    return baseOrder.indexOf(a) < baseOrder.indexOf(b) ? { winner: a, loser: b } : { winner: b, loser: a }
  }

  const res12 = playoffResultBetween(top2[0], top2[1])
  if (!res12) return baseSorted

  const overrides: ClubId[] = []
  overrides.push(res12.winner, res12.loser)
  if (hasTop4) {
    const res34 = playoffResultBetween(top4[2], top4[3])
    if (res34) overrides.push(res34.winner, res34.loser)
  }

  const overrideSet = new Set(overrides)
  const rest = baseSorted.filter((x) => !overrideSet.has(x.clubId))
  const byId = new Map(baseSorted.map((x) => [x.clubId, x] as const))
  const head = overrides.map((id) => byId.get(id)!).filter(Boolean)
  return [...head, ...rest]
}

export function computePlayerStandings(state: TournamentStateV2): PlayerStanding[] {
  const byPlayer = new Map<PlayerId, PlayerStanding>()

  for (const player of state.players) {
    byPlayer.set(player.id, {
      playerId: player.id,
      clubId: player.clubId,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDiff: 0,
      matchesPlayed: 0,
    })
  }

  for (const match of state.matches) {
    if (!match.score) continue
    const computed = computeMatch(match)
    if (!computed.winnerClubId) continue

    const divisionConfig = getDivisionConfig(state, match.divisionId)
    const aPlayers = getMatchPlayerIdsForClub({ match, clubId: match.clubA, divisionConfig })
    const bPlayers = getMatchPlayerIdsForClub({ match, clubId: match.clubB, divisionConfig })

    const aIds = aPlayers ?? null
    const bIds = bPlayers ?? null
    if (!aIds || !bIds) continue

    const aWon = computed.winnerClubId === match.clubA

    for (const playerId of aIds) {
      const row = byPlayer.get(playerId)
      if (!row) continue
      row.matchesPlayed++
      row.pointsFor += match.score.a
      row.pointsAgainst += match.score.b
      row.pointDiff += match.score.a - match.score.b
      if (aWon) row.wins++
      else row.losses++
    }

    for (const playerId of bIds) {
      const row = byPlayer.get(playerId)
      if (!row) continue
      row.matchesPlayed++
      row.pointsFor += match.score.b
      row.pointsAgainst += match.score.a
      row.pointDiff += match.score.b - match.score.a
      if (!aWon) row.wins++
      else row.losses++
    }
  }

  return [...byPlayer.values()].sort((x, y) => {
    if (y.wins !== x.wins) return y.wins - x.wins
    if (y.pointDiff !== x.pointDiff) return y.pointDiff - x.pointDiff
    return y.pointsFor - x.pointsFor
  })
}

export function computeIndividualCoverage(state: TournamentStateV2): {
  scoredMatches: number
  scoredMatchesWithPlayerMapping: number
} {
  let scoredMatches = 0
  let scoredMatchesWithPlayerMapping = 0

  for (const match of state.matches) {
    if (!match.score) continue
    scoredMatches++
    const divisionConfig = getDivisionConfig(state, match.divisionId)
    const aPlayers = getMatchPlayerIdsForClub({ match, clubId: match.clubA, divisionConfig })
    const bPlayers = getMatchPlayerIdsForClub({ match, clubId: match.clubB, divisionConfig })
    if (aPlayers && bPlayers) scoredMatchesWithPlayerMapping++
  }

  return { scoredMatches, scoredMatchesWithPlayerMapping }
}

