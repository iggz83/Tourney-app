import { SEEDED_EVENTS } from '../domain/constants'
import { seedKey } from '../domain/keys'
import { getPlayerName } from '../domain/playerName'
import type { TournamentState, TournamentStateV1, TournamentStateV2 } from '../domain/types'
import { createInitialTournamentState } from './state'

function normalizeSeededEvents(raw: unknown): TournamentStateV2['seededEvents'] {
  if (!Array.isArray(raw)) return SEEDED_EVENTS
  const out: TournamentStateV2['seededEvents'] = []
  const seen = new Set<string>()
  for (const x of raw as Array<unknown>) {
    const o = x as { eventType?: unknown; seed?: unknown; label?: unknown }
    const eventType = String(o.eventType ?? '')
    const seed = Math.max(1, Math.floor(Number(o.seed ?? 0)))
    const label = String(o.label ?? '').trim()
    if (eventType !== 'WOMENS_DOUBLES' && eventType !== 'MENS_DOUBLES' && eventType !== 'MIXED_DOUBLES') continue
    if (!Number.isFinite(seed) || seed <= 0) continue
    const k = `${eventType}:${seed}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ eventType: eventType as TournamentStateV2['seededEvents'][number]['eventType'], seed, label: label || `${eventType} #${seed}` })
  }
  if (out.length === 0) return SEEDED_EVENTS
  out.sort((a, b) => {
    const eo = (t: string) => (t === 'WOMENS_DOUBLES' ? 0 : t === 'MENS_DOUBLES' ? 1 : 2)
    const d = eo(a.eventType) - eo(b.eventType)
    if (d !== 0) return d
    return a.seed - b.seed
  })
  return out
}

function normalizeEventScheduleModes(raw: unknown): TournamentStateV2['eventScheduleModes'] {
  const base: TournamentStateV2['eventScheduleModes'] = {
    WOMENS_DOUBLES: 'SAME_SEED',
    MENS_DOUBLES: 'SAME_SEED',
    MIXED_DOUBLES: 'SAME_SEED',
  }
  if (!raw || typeof raw !== 'object') return base
  const obj = raw as Record<string, unknown>
  const normalizeOne = (v: unknown): TournamentStateV2['eventScheduleModes'][keyof TournamentStateV2['eventScheduleModes']] =>
    v === 'ALL_VS_ALL' ? 'ALL_VS_ALL' : 'SAME_SEED'
  return {
    WOMENS_DOUBLES: normalizeOne(obj.WOMENS_DOUBLES),
    MENS_DOUBLES: normalizeOne(obj.MENS_DOUBLES),
    MIXED_DOUBLES: normalizeOne(obj.MIXED_DOUBLES),
  }
}

function normalizeEventScheduleModesByDivision(args: {
  divisions: TournamentStateV2['divisions']
  globalModes: TournamentStateV2['eventScheduleModes']
  raw: unknown
}): TournamentStateV2['eventScheduleModesByDivision'] {
  const { divisions, globalModes, raw } = args
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: TournamentStateV2['eventScheduleModesByDivision'] = {} as TournamentStateV2['eventScheduleModesByDivision']
  for (const d of divisions) {
    out[d.id] = normalizeEventScheduleModes(obj[d.id] ?? globalModes)
  }
  return out
}

function normalizeSeededEventsByDivision(args: {
  divisions: TournamentStateV2['divisions']
  seededEvents: TournamentStateV2['seededEvents']
  raw: unknown
}): TournamentStateV2['seededEventsByDivision'] {
  const { divisions, seededEvents, raw } = args
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: TournamentStateV2['seededEventsByDivision'] = {} as TournamentStateV2['seededEventsByDivision']
  for (const d of divisions) {
    out[d.id] = normalizeSeededEvents(obj[d.id] ?? seededEvents)
  }
  return out
}

function createEmptyDivisionConfigLikeInitial(args: { divisionId: string }): TournamentStateV2['divisionConfigs'][number] {
  return { divisionId: args.divisionId, seedsByClub: {}, clubEnabled: {} }
}

function normalizeDivisionConfigs(args: {
  divisions: TournamentStateV2['divisions']
  divisionConfigs: unknown
}): TournamentStateV2['divisionConfigs'] {
  const divisions = args.divisions ?? []
  const raw = Array.isArray(args.divisionConfigs) ? (args.divisionConfigs as TournamentStateV2['divisionConfigs']) : []
  const byId = new Map(raw.map((dc) => [dc.divisionId, dc] as const))
  return divisions.map((d) => {
    const dc = byId.get(d.id)
    if (!dc) return createEmptyDivisionConfigLikeInitial({ divisionId: d.id })
    return {
      divisionId: d.id,
      seedsByClub: dc.seedsByClub ?? ({} as TournamentStateV2['divisionConfigs'][number]['seedsByClub']),
      clubEnabled: dc.clubEnabled ?? {},
    }
  })
}

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
    tournamentName: String(v1.tournamentName ?? '').trim(),
    clubs,
    divisions: base.divisions,
    seededEvents: SEEDED_EVENTS,
    seededEventsByDivision: Object.fromEntries(base.divisions.map((d) => [d.id, SEEDED_EVENTS])) as TournamentStateV2['seededEventsByDivision'],
    eventScheduleModes: base.eventScheduleModes,
    eventScheduleModesByDivision: Object.fromEntries(
      base.divisions.map((d) => [d.id, base.eventScheduleModes]),
    ) as TournamentStateV2['eventScheduleModesByDivision'],
    players: players.map((p) => ({ ...p, name: getPlayerName(p) })),
    lineupProfiles: base.lineupProfiles.map((lp) => ({ ...lp, divisionConfigs })),
    defaultLineupProfileId: base.defaultLineupProfileId,
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
    const base = createInitialTournamentState()
    const v2 = parsed as Partial<TournamentStateV2>

    const divisions = Array.isArray(v2.divisions) && v2.divisions.length ? (v2.divisions as TournamentStateV2['divisions']) : base.divisions
    const divisionConfigs = normalizeDivisionConfigs({ divisions, divisionConfigs: v2.divisionConfigs })
    const seededEvents = normalizeSeededEvents((v2 as { seededEvents?: unknown }).seededEvents)
    const globalModes = normalizeEventScheduleModes((v2 as { eventScheduleModes?: unknown }).eventScheduleModes)
    const seededEventsByDivision = normalizeSeededEventsByDivision({
      divisions,
      seededEvents,
      raw: (v2 as { seededEventsByDivision?: unknown }).seededEventsByDivision,
    })
    const eventScheduleModesByDivision = normalizeEventScheduleModesByDivision({
      divisions,
      globalModes,
      raw: (v2 as { eventScheduleModesByDivision?: unknown }).eventScheduleModesByDivision,
    })

    // Lineup profiles: if missing, create a single default from legacy divisionConfigs.
    const defaultProfileId = String((v2 as { defaultLineupProfileId?: unknown }).defaultLineupProfileId ?? '').trim() || base.defaultLineupProfileId
    const rawProfiles = Array.isArray((v2 as { lineupProfiles?: unknown }).lineupProfiles)
      ? ((v2 as { lineupProfiles?: unknown }).lineupProfiles as TournamentStateV2['lineupProfiles'])
      : null
    const lineupProfiles =
      rawProfiles && rawProfiles.length
        ? rawProfiles.map((p) => ({
            id: String((p as { id?: unknown }).id ?? '').trim() || crypto.randomUUID(),
            name: String((p as { name?: unknown }).name ?? '').trim() || 'Profile',
            divisionConfigs: normalizeDivisionConfigs({ divisions, divisionConfigs: (p as { divisionConfigs?: unknown }).divisionConfigs }),
          }))
        : [{ id: defaultProfileId, name: 'Default', divisionConfigs }]

    const resolvedDefaultProfileId = lineupProfiles.some((p) => p.id === defaultProfileId) ? defaultProfileId : lineupProfiles[0]!.id
    const defaultProfile = lineupProfiles.find((p) => p.id === resolvedDefaultProfileId) ?? lineupProfiles[0]!

    return {
      ...base,
      ...v2,
      tournamentName: String((v2 as { tournamentName?: unknown }).tournamentName ?? ''),
      divisions,
      seededEvents,
      seededEventsByDivision,
      eventScheduleModes: globalModes,
      eventScheduleModesByDivision,
      lineupProfiles,
      defaultLineupProfileId: resolvedDefaultProfileId,
      // Legacy/default: always mirror the default profile for back-compat.
      divisionConfigs: defaultProfile.divisionConfigs,
      matches: (v2.matches ?? []).map((m) => ({
        ...m,
        seed: Math.max(1, Math.floor(Number((m as { seed?: unknown }).seed ?? 1))),
        seedA: Math.max(1, Math.floor(Number((m as { seedA?: unknown }).seedA ?? (m as { seed?: unknown }).seed ?? 1))),
        seedB: Math.max(1, Math.floor(Number((m as { seedB?: unknown }).seedB ?? (m as { seed?: unknown }).seed ?? 1))),
        lineupProfileId: String((m as { lineupProfileId?: unknown }).lineupProfileId ?? '').trim() || resolvedDefaultProfileId,
        stage: (m as { stage?: unknown }).stage === 'PLAYOFF' ? 'PLAYOFF' : 'REGULAR',
      })),
      players: (v2.players ?? []).map((p) => {
        const { firstName: _firstName, lastName: _lastName, ...rest } = p as unknown as {
          firstName?: unknown
          lastName?: unknown
        } & typeof p
        return { ...rest, name: getPlayerName(p) }
      }),
      tournamentLockedAt: (v2 as TournamentStateV2).tournamentLockedAt ?? null,
      tournamentLockRev:
        typeof (v2 as TournamentStateV2).tournamentLockRev === 'number'
          ? (v2 as TournamentStateV2).tournamentLockRev
          : (v2 as TournamentStateV2).tournamentLockedAt
            ? 1
            : 0,
      tournamentPasswordSalt: (v2 as TournamentStateV2).tournamentPasswordSalt ?? null,
      tournamentPasswordHash: (v2 as TournamentStateV2).tournamentPasswordHash ?? null,
    }
  }
  if (parsed.version === 1) return migrateV1toV2(parsed)
  return null
}

