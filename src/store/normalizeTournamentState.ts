import { SEEDED_EVENTS } from '../domain/constants'
import { seedKey } from '../domain/keys'
import { getPlayerName } from '../domain/playerName'
import type { TournamentState, TournamentStateV1, TournamentStateV2 } from '../domain/types'
import { createInitialTournamentState } from './state'

function migrateV1toV2(v1: TournamentStateV1): TournamentStateV2 {
  // v1 stored 8 roster slots per club total; v2 stores 8 roster slots per club per division.
  // We replicate each old club slot into *each division* and migrate seed mappings accordingly.
  const base = createInitialTournamentState()
  const clubs = v1.clubs ?? []

  const legacyById = new Map(v1.players.map((p) => [p.id, p] as const))

  const getLegacyForSlot = (clubId: string, slot: 'W' | 'M', n: number) => {
    // Accept multiple historical id patterns defensively.
    const candidates =
      slot === 'W'
        ? [`${clubId}-W${n}`, `${clubId}-F${n}`, `${clubId}-F${n}`, `${clubId}-W${n}`]
        : [`${clubId}-M${n}`, `${clubId}-M${n}`]
    for (const id of candidates) {
      const p = legacyById.get(id)
      if (p) return p
    }
    return undefined
  }

  const players: TournamentStateV2['players'] = []
  for (const division of base.divisions) {
    for (const club of clubs) {
      for (let i = 1; i <= 4; i++) {
        const legacy = getLegacyForSlot(club.id, 'W', i)
        players.push({
          id: `${division.id}:${club.id}:W${i}`,
          clubId: club.id,
          divisionId: division.id,
          gender: 'F',
          name: legacy ? `${legacy.firstName} ${legacy.lastName}`.trim() : '',
        })
      }
      for (let i = 1; i <= 4; i++) {
        const legacy = getLegacyForSlot(club.id, 'M', i)
        players.push({
          id: `${division.id}:${club.id}:M${i}`,
          clubId: club.id,
          divisionId: division.id,
          gender: 'M',
          name: legacy ? `${legacy.firstName} ${legacy.lastName}`.trim() : '',
        })
      }
    }
  }

  // Build empty seed config per club, then migrate any existing seed mappings.
  const oldToNewByDivision = new Map<string, Map<string, string>>() // divisionId -> oldPlayerId -> newPlayerId
  for (const division of base.divisions) {
    const m = new Map<string, string>()
    for (const club of clubs) {
      for (let i = 1; i <= 4; i++) {
        m.set(`${club.id}-W${i}`, `${division.id}:${club.id}:W${i}`)
        m.set(`${club.id}-F${i}`, `${division.id}:${club.id}:W${i}`)
        m.set(`${club.id}-M${i}`, `${division.id}:${club.id}:M${i}`)
      }
    }
    oldToNewByDivision.set(division.id, m)
  }

  const divisionConfigs: TournamentStateV2['divisionConfigs'] = base.divisions.map((d) => {
    const prev = v1.divisionConfigs.find((x) => x.divisionId === d.id)
    const seedsByClub: TournamentStateV2['divisionConfigs'][number]['seedsByClub'] = {}

    for (const club of clubs) {
      const clubRecord: Record<string, { playerIds: [string | null, string | null] }> = {}
      for (const ev of SEEDED_EVENTS) {
        clubRecord[seedKey(ev.eventType, ev.seed)] = { playerIds: [null, null] }
      }

      if (prev?.seedsByClub?.[club.id]) {
        const map = oldToNewByDivision.get(d.id)!
        const prevClub = prev.seedsByClub[club.id]
        for (const k of Object.keys(clubRecord)) {
          const legacy = (prevClub as Record<string, { playerIds?: [string | null, string | null] }>)[k]?.playerIds
          if (!legacy) continue
          const a = legacy[0] ? map.get(legacy[0]) : undefined
          const b = legacy[1] ? map.get(legacy[1]) : undefined
          if (a && b) clubRecord[k] = { playerIds: [a, b] }
        }
      }

      seedsByClub[club.id] = clubRecord
    }

    return {
      divisionId: d.id,
      seedsByClub,
      clubEnabled: prev?.clubEnabled ?? {},
    }
  })

  const matches = v1.matches ?? []

  return {
    version: 2,
    clubs,
    divisions: base.divisions,
    players: players.map((p) => ({ ...p, name: getPlayerName(p) })),
    divisionConfigs,
    matches,
    tournamentLockedAt: v1.tournamentLockedAt ?? null,
    tournamentLockRev: typeof v1.tournamentLockRev === 'number' ? v1.tournamentLockRev : v1.tournamentLockedAt ? 1 : 0,
    tournamentPasswordSalt: v1.tournamentPasswordSalt ?? null,
    tournamentPasswordHash: v1.tournamentPasswordHash ?? null,
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
      players: (v2.players ?? []).map((p) => {
        const { firstName: _firstName, lastName: _lastName, ...rest } = p as unknown as {
          firstName?: unknown
          lastName?: unknown
        } & typeof p
        return { ...rest, name: getPlayerName(p) }
      }),
      tournamentLockedAt: v2.tournamentLockedAt ?? null,
      tournamentLockRev: typeof v2.tournamentLockRev === 'number' ? v2.tournamentLockRev : v2.tournamentLockedAt ? 1 : 0,
      tournamentPasswordSalt: v2.tournamentPasswordSalt ?? null,
      tournamentPasswordHash: v2.tournamentPasswordHash ?? null,
    }
  }
  if (parsed.version === 1) return migrateV1toV2(parsed)
  return null
}

