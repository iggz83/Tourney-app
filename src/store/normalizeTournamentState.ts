import type { ClubId, TournamentState, TournamentStateV1, TournamentStateV2 } from '../domain/types'
import { createInitialTournamentState } from './state'

function migrateV1toV2(v1: TournamentStateV1): TournamentStateV2 {
  // The old model had 8 players per club total; new model is 8 players per club per division.
  // We replicate each old club/gender slot into *each division* and update seed mappings accordingly.
  const fresh = createInitialTournamentState()
  const nameByOldId = new Map(v1.players.map((p) => [p.id, p]))

  const newPlayers = fresh.players.map((p) => {
    const n = Number(p.id.slice(-1))
    const legacyId = Number.isFinite(n) ? `${p.clubId}-${p.gender}${n}` : null
    const legacy = legacyId ? nameByOldId.get(legacyId) : undefined
    if (!legacy) return p
    return { ...p, firstName: legacy.firstName, lastName: legacy.lastName }
  })

  const oldToNewByDivision = new Map<string, Map<string, string>>() // divisionId -> oldPlayerId -> newPlayerId
  for (const division of fresh.divisions) {
    const m = new Map<string, string>()
    for (const club of fresh.clubs) {
      for (let i = 1; i <= 4; i++) {
        m.set(`${club.id}-W${i}`, `${division.id}:${club.id}:W${i}`)
        m.set(`${club.id}-M${i}`, `${division.id}:${club.id}:M${i}`)
      }
    }
    oldToNewByDivision.set(division.id, m)
  }

  const divisionConfigs = fresh.divisionConfigs.map((dc) => {
    const prev = v1.divisionConfigs.find((x) => x.divisionId === dc.divisionId)
    if (!prev) return dc
    const map = oldToNewByDivision.get(dc.divisionId)!
    const seedsByClub: TournamentStateV2['divisionConfigs'][number]['seedsByClub'] = { ...dc.seedsByClub }
    for (const clubId of Object.keys(seedsByClub) as ClubId[]) {
      const prevClub = prev.seedsByClub?.[clubId]
      if (!prevClub) continue
      const nextClub = { ...seedsByClub[clubId] }
      for (const k of Object.keys(nextClub) as Array<keyof typeof nextClub>) {
        const legacy = (prevClub as typeof nextClub)[k]?.playerIds
        if (!legacy) continue
        // Legacy (v1) was always a 2-tuple of strings, but guard defensively.
        const legacy0 = legacy[0]
        const legacy1 = legacy[1]
        if (!legacy0 || !legacy1) continue
        const a = map.get(legacy0)
        const b = map.get(legacy1)
        if (a && b) nextClub[k] = { playerIds: [a, b] }
      }
      seedsByClub[clubId] = nextClub
    }
    return { ...dc, seedsByClub }
  })

  const matches = v1.matches ?? []

  return {
    version: 2,
    clubs: fresh.clubs,
    divisions: fresh.divisions,
    players: newPlayers,
    divisionConfigs,
    matches,
    tournamentLockedAt: v1.tournamentLockedAt ?? null,
    tournamentLockRev: typeof v1.tournamentLockRev === 'number' ? v1.tournamentLockRev : v1.tournamentLockedAt ? 1 : 0,
    updatedAt: new Date().toISOString(),
  }
}

export function normalizeTournamentState(candidate: unknown): TournamentStateV2 | null {
  const parsed = candidate as TournamentState
  if (!parsed) return null
  if (parsed.version === 2) {
    const v2 = parsed as TournamentStateV2
    return {
      ...v2,
      tournamentLockedAt: v2.tournamentLockedAt ?? null,
      tournamentLockRev: typeof v2.tournamentLockRev === 'number' ? v2.tournamentLockRev : v2.tournamentLockedAt ? 1 : 0,
    }
  }
  if (parsed.version === 1) return migrateV1toV2(parsed)
  return null
}

