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

  return [...byClub.values()].sort((x, y) => {
    if (y.wins !== x.wins) return y.wins - x.wins
    if (y.pointDiff !== x.pointDiff) return y.pointDiff - x.pointDiff
    return y.pointsFor - x.pointsFor
  })
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

