import { useEffect, useMemo, useRef, useState } from 'react'
import { computeMatch } from '../domain/analytics'
import { getPlayerName, getPlayerNameOr } from '../domain/playerName'
import { getPlayersById, getMatchPlayerIdsForClub, getSeededEventsForDivision } from '../domain/selectors'
import { makeMatchId } from '../domain/scheduler'
import type { Match } from '../domain/types'
import { useTournamentStore } from '../store/useTournamentStore'

function displayPlayerName(p?: { name?: string | null; firstName?: string | null; lastName?: string | null }) {
  return getPlayerNameOr(p, '—')
}

function fallbackEventLabel(eventType: Match['eventType'], seed: number) {
  if (eventType === 'WOMENS_DOUBLES') return `Women #${seed}`
  if (eventType === 'MENS_DOUBLES') return `Men #${seed}`
  return `Mixed #${seed}`
}

function eventLabel(match: Match, seededEvents: Array<{ eventType: Match['eventType']; seed: number; label: string }>) {
  const seedA = Math.max(1, Math.floor(Number(match.seedA ?? match.seed) || 1))
  const seedB = Math.max(1, Math.floor(Number(match.seedB ?? match.seed) || 1))
  const labelA = seededEvents.find((e) => e.eventType === match.eventType && e.seed === seedA)?.label ?? fallbackEventLabel(match.eventType, seedA)
  if (seedA === seedB) return labelA
  const labelB = seededEvents.find((e) => e.eventType === match.eventType && e.seed === seedB)?.label ?? `#${seedB}`
  return `${labelA} vs ${labelB}`
}

function byMatchOrder(a: Match, b: Match) {
  // group by round, matchupIndex, then a stable event ordering
  if (a.round !== b.round) return a.round - b.round
  if (a.matchupIndex !== b.matchupIndex) return a.matchupIndex - b.matchupIndex
  const eventOrder = (m: Match) => {
    if (m.eventType === 'WOMENS_DOUBLES') return 0
    if (m.eventType === 'MENS_DOUBLES') return 1
    return 2
  }
  const eo = eventOrder(a) - eventOrder(b)
  if (eo !== 0) return eo
  const saA = Number(a.seedA ?? a.seed)
  const saB = Number(b.seedA ?? b.seed)
  if (saA !== saB) return saA - saB
  return Number(a.seedB ?? a.seed) - Number(b.seedB ?? b.seed)
}

function parseScore(v: string): number | undefined {
  if (!v.trim().length) return undefined
  const n = Number(v)
  if (!Number.isFinite(n)) return undefined
  if (n < 0) return undefined
  return Math.floor(n)
}

function isEventType(v: string): v is Match['eventType'] {
  return v === 'WOMENS_DOUBLES' || v === 'MENS_DOUBLES' || v === 'MIXED_DOUBLES'
}

type SortKey = 'id' | 'round' | 'court' | 'division' | 'event' | 'match' | 'players' | 'score'
type SortDir = 'asc' | 'desc'

function cmp(a: string | number, b: string | number) {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

function escapeHtml(v: string) {
  return v
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function stableServeFirstIsA(matchId: string): boolean {
  // Deterministic "random": stable across devices/prints as long as matchId is stable.
  // Simple string hash (djb2-ish) -> pick A/B based on parity.
  let h = 5381
  for (let i = 0; i < matchId.length; i++) h = ((h << 5) + h + matchId.charCodeAt(i)) | 0
  return (h & 1) === 0
}

function highlightText(text: string, needleRaw: string) {
  const needle = needleRaw.trim()
  if (!needle.length) return text
  const hay = String(text)
  const hayLower = hay.toLowerCase()
  const needleLower = needle.toLowerCase()
  if (!hayLower.includes(needleLower)) return hay

  const out: Array<{ s: string; hit: boolean }> = []
  let i = 0
  while (i < hay.length) {
    const hit = hayLower.indexOf(needleLower, i)
    if (hit === -1) break
    if (hit > i) out.push({ s: hay.slice(i, hit), hit: false })
    out.push({ s: hay.slice(hit, hit + needle.length), hit: true })
    i = hit + needle.length
  }
  if (i < hay.length) out.push({ s: hay.slice(i), hit: false })

  return (
    <>
      {out.map((p, idx) =>
        p.hit ? (
          <span
            key={idx}
            className="rounded bg-amber-400/25 px-0.5 font-semibold text-amber-100 ring-1 ring-amber-400/30"
          >
            {p.s}
          </span>
        ) : (
          <span key={idx}>{p.s}</span>
        ),
      )}
    </>
  )
}

export function ScoreEntryPage() {
  const { state, actions, dispatch } = useTournamentStore()
  const [divisionFilters, setDivisionFilters] = useState<string[]>([])
  const [divisionFilterOpen, setDivisionFilterOpen] = useState<boolean>(false)
  const [roundFilters, setRoundFilters] = useState<string[]>([])
  const [roundFilterOpen, setRoundFilterOpen] = useState<boolean>(false)
  const [eventFilters, setEventFilters] = useState<string[]>([])
  const [eventFilterOpen, setEventFilterOpen] = useState<boolean>(false)
  const [needsScoresOnly, setNeedsScoresOnly] = useState<boolean>(false)
  const [team1, setTeam1] = useState<string>('all')
  const [team2, setTeam2] = useState<string>('all')
  const [quickSearch, setQuickSearch] = useState<string>('')
  const [fullLineupsOnly, setFullLineupsOnly] = useState<boolean>(false)
  const [courtList, setCourtList] = useState<string>('')
  const [courtOverwrite, setCourtOverwrite] = useState<boolean>(false)
  const [drafts, setDrafts] = useState<Record<string, { a: string; b: string }>>({})
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null)
  const divisionFilterRef = useRef<HTMLDetailsElement | null>(null)
  const roundFilterRef = useRef<HTMLDetailsElement | null>(null)
  const eventFilterRef = useRef<HTMLDetailsElement | null>(null)
  const totalMatches = state.matches.length
  const tournamentLocked = Boolean(state.tournamentLockedAt)
  const hasPlayoffs = useMemo(() => state.matches.some((m) => (m.stage ?? 'REGULAR') === 'PLAYOFF'), [state.matches])

  const playersById = useMemo(() => getPlayersById(state), [state])
  const eventOptions = useMemo(() => {
    const all: Array<{ eventType: Match['eventType']; seed: number; label: string }> = []
    const byKey = new Map<string, { eventType: Match['eventType']; seed: number; label: string }>()
    for (const d of state.divisions) {
      for (const ev of getSeededEventsForDivision(state, d.id)) {
        const k = `${ev.eventType}:${ev.seed}`
        if (byKey.has(k)) continue
        byKey.set(k, ev)
      }
    }
    all.push(...byKey.values())
    all.sort((a, b) => {
      const eo = (t: string) => (t === 'WOMENS_DOUBLES' ? 0 : t === 'MENS_DOUBLES' ? 1 : 2)
      const d = eo(a.eventType) - eo(b.eventType)
      if (d !== 0) return d
      return a.seed - b.seed
    })
    return all
  }, [state])

  const isNamedPlayer = useMemo(() => {
    return (playerId: string | undefined) => {
      if (!playerId) return false
      const p = playersById.get(playerId)
      if (!p) return false
      return Boolean(getPlayerName(p).trim().length)
    }
  }, [playersById])

  const hasFullLineup = useMemo(() => {
    return (m: Match) => {
      const aPair = getMatchPlayerIdsForClub({ state, match: m, clubId: m.clubA })
      const bPair = getMatchPlayerIdsForClub({ state, match: m, clubId: m.clubB })
      if (!aPair || !bPair) return false
      return isNamedPlayer(aPair[0]) && isNamedPlayer(aPair[1]) && isNamedPlayer(bPair[0]) && isNamedPlayer(bPair[1])
    }
  }, [isNamedPlayer, state])

  const baseFiltered = useMemo(() => {
    let ms = state.matches
    if (divisionFilters.length) {
      const allowedDivisions = new Set(divisionFilters)
      ms = ms.filter((m) => allowedDivisions.has(m.divisionId))
    }
    if (eventFilters.length) {
      const allowed = new Set<string>()
      for (const v of eventFilters) {
        const [eventType, seedRaw] = v.split(':')
        const seed = Number(seedRaw)
        if (!isEventType(eventType) || !Number.isFinite(seed)) continue
        allowed.add(`${eventType}:${seed}`)
      }
      if (allowed.size === 0) return []
      ms = ms.filter((m) => allowed.has(`${m.eventType}:${m.seed}`))
    }
    if (team1 !== 'all' || team2 !== 'all') {
      const t1 = team1 !== 'all' ? team1 : null
      const t2 = team2 !== 'all' ? team2 : null
      ms = ms.filter((m) => {
        const hasT1 = t1 ? m.clubA === t1 || m.clubB === t1 : true
        const hasT2 = t2 ? m.clubA === t2 || m.clubB === t2 : true
        if (!hasT1 || !hasT2) return false
        if (t1 && t2) {
          return (m.clubA === t1 && m.clubB === t2) || (m.clubA === t2 && m.clubB === t1)
        }
        return true
      })
    }
    if (needsScoresOnly) {
      ms = ms.filter((m) => !m.score || !m.completedAt)
    }
    if (fullLineupsOnly) {
      ms = ms.filter(hasFullLineup)
    }
    const q = quickSearch.trim().toLowerCase()
    if (q.length) {
      const divisionNameById = new Map(state.divisions.map((d) => [d.id, d.name]))
      const divisionCodeById = new Map(state.divisions.map((d) => [d.id, d.code]))
      const clubCodeById = new Map(state.clubs.map((c) => [c.id, c.code || c.id]))
      ms = ms.filter((m) => {
        const aPair = getMatchPlayerIdsForClub({ state, match: m, clubId: m.clubA })
        const bPair = getMatchPlayerIdsForClub({ state, match: m, clubId: m.clubB })
        const aNames = aPair ? aPair.map((id) => displayPlayerName(playersById.get(id))).join(' / ') : '—'
        const bNames = bPair ? bPair.map((id) => displayPlayerName(playersById.get(id))).join(' / ') : '—'
        const aTeam = clubCodeById.get(m.clubA) ?? m.clubA
        const bTeam = clubCodeById.get(m.clubB) ?? m.clubB
        const playersLineA = `${aTeam}: ${aNames}`
        const playersLineB = `${bTeam}: ${bNames}`
        const hay = [
          divisionNameById.get(m.divisionId) ?? m.divisionId,
          divisionCodeById.get(m.divisionId) ?? '',
          String(m.round),
          String(m.court),
          eventLabel(m, getSeededEventsForDivision(state, m.divisionId)),
          m.clubA,
          m.clubB,
          clubCodeById.get(m.clubA) ?? '',
          clubCodeById.get(m.clubB) ?? '',
          `${m.clubA} vs ${m.clubB}`,
          `${clubCodeById.get(m.clubA) ?? m.clubA} vs ${clubCodeById.get(m.clubB) ?? m.clubB}`,
          aNames,
          bNames,
          playersLineA,
          playersLineB,
          `${aNames} | ${bNames}`,
          m.score ? `${m.score.a}-${m.score.b}` : '',
        ]
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      })
    }
    return [...ms].sort(byMatchOrder)
  }, [
    state,
    divisionFilters,
    eventFilters,
    team1,
    team2,
    needsScoresOnly,
    fullLineupsOnly,
    quickSearch,
    playersById,
    hasFullLineup,
  ])

  const availableRounds = useMemo(() => {
    const s = new Set<number>()
    for (const m of baseFiltered) s.add(m.round)
    return [...s].filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  }, [baseFiltered])

  const filtered = useMemo(() => {
    if (!roundFilters.length) return baseFiltered
    const allowed = new Set<number>()
    for (const r of roundFilters) {
      const n = Number(r)
      if (Number.isFinite(n)) allowed.add(n)
    }
    if (!allowed.size) return baseFiltered
    return baseFiltered.filter((m) => allowed.has(m.round))
  }, [baseFiltered, roundFilters])

  const divisionNameById = useMemo(() => new Map(state.divisions.map((d) => [d.id, d.name])), [state.divisions])
  const divisionCodeById = useMemo(() => new Map(state.divisions.map((d) => [d.id, d.code])), [state.divisions])
  // Non-TV view uses club acronyms (codes) even if full names are configured for TV.
  const clubLabel = useMemo(() => new Map(state.clubs.map((c) => [c.id, c.code || c.id])), [state.clubs])
  const highlightNeedle = useMemo(() => quickSearch.trim(), [quickSearch])

  const sorted = useMemo(() => {
    if (!sort) return filtered

    const dirMul = sort.dir === 'asc' ? 1 : -1

    const withIdx = filtered.map((m, idx) => ({ m, idx }))
    withIdx.sort((x, y) => {
      const a = x.m
      const b = y.m

      const divCodeA = divisionCodeById.get(a.divisionId) ?? a.divisionId
      const divCodeB = divisionCodeById.get(b.divisionId) ?? b.divisionId
      const evA = eventLabel(a, getSeededEventsForDivision(state, a.divisionId))
      const evB = eventLabel(b, getSeededEventsForDivision(state, b.divisionId))
      const idA = `${divCodeA}-R${a.round}-C${a.court}-${evA.replace(/\s+/g, '')}`
      const idB = `${divCodeB}-R${b.round}-C${b.court}-${evB.replace(/\s+/g, '')}`

      const matchA = `${clubLabel.get(a.clubA) ?? a.clubA} vs ${clubLabel.get(a.clubB) ?? a.clubB}`
      const matchB = `${clubLabel.get(b.clubA) ?? b.clubA} vs ${clubLabel.get(b.clubB) ?? b.clubB}`

      const scoreA = a.score ? a.score.a * 100 + a.score.b : -1
      const scoreB = b.score ? b.score.a * 100 + b.score.b : -1

      let res = 0
      switch (sort.key) {
        case 'id':
          res = cmp(idA, idB)
          break
        case 'round':
          res = cmp(a.round, b.round)
          break
        case 'court':
          res = cmp(a.court, b.court)
          break
        case 'division':
          res = cmp(divisionNameById.get(a.divisionId) ?? a.divisionId, divisionNameById.get(b.divisionId) ?? b.divisionId)
          break
        case 'event':
          res = cmp(evA, evB)
          break
        case 'match':
          res = cmp(matchA, matchB)
          break
        case 'players': {
          // Sort by the rendered players string (cheap + stable enough)
          const aPairA = getMatchPlayerIdsForClub({ state, match: a, clubId: a.clubA })
          const bPairA = getMatchPlayerIdsForClub({ state, match: a, clubId: a.clubB })
          const aPairB = getMatchPlayerIdsForClub({ state, match: b, clubId: b.clubA })
          const bPairB = getMatchPlayerIdsForClub({ state, match: b, clubId: b.clubB })
          const aNamesA = aPairA ? aPairA.map((id) => displayPlayerName(playersById.get(id))).join(' / ') : '—'
          const bNamesA = bPairA ? bPairA.map((id) => displayPlayerName(playersById.get(id))).join(' / ') : '—'
          const aNamesB = aPairB ? aPairB.map((id) => displayPlayerName(playersById.get(id))).join(' / ') : '—'
          const bNamesB = bPairB ? bPairB.map((id) => displayPlayerName(playersById.get(id))).join(' / ') : '—'
          const playersA = `${clubLabel.get(a.clubA) ?? a.clubA}: ${aNamesA} | ${clubLabel.get(a.clubB) ?? a.clubB}: ${bNamesA}`
          const playersB = `${clubLabel.get(b.clubA) ?? b.clubA}: ${aNamesB} | ${clubLabel.get(b.clubB) ?? b.clubB}: ${bNamesB}`
          res = cmp(playersA, playersB)
          break
        }
        case 'score':
          res = cmp(scoreA, scoreB)
          break
      }

      if (res !== 0) return res * dirMul
      // Stable fallback
      return (x.idx - y.idx) * dirMul
    })

    return withIdx.map((x) => x.m)
  }, [filtered, sort, divisionCodeById, divisionNameById, clubLabel, playersById, state])

  const scheduleMissing = state.matches.length === 0
  const optimizableFiltered = useMemo(
    () => sorted.filter((m) => (m.stage ?? 'REGULAR') === 'REGULAR'),
    [sorted],
  )
  const filteredRegularMatches = useMemo(() => sorted.filter((m) => (m.stage ?? 'REGULAR') !== 'PLAYOFF'), [sorted])
  const allFilteredRegularScored = useMemo(() => {
    if (filteredRegularMatches.length === 0) return false
    return filteredRegularMatches.every((m) => Boolean(m.score) && Boolean(m.completedAt))
  }, [filteredRegularMatches])
  const pendingFilteredDraftIds = useMemo(() => {
    const visible = new Set(sorted.map((m) => m.id))
    const visibleMatchesById = new Map(sorted.map((m) => [m.id, m] as const))
    return Object.entries(drafts)
      .filter(([id, d]) => {
        if (!visible.has(id)) return false
        const m = visibleMatchesById.get(id)
        if (!m) return false

        const savedA = m.score?.a?.toString() ?? ''
        const savedB = m.score?.b?.toString() ?? ''
        const draftA = d?.a ?? ''
        const draftB = d?.b ?? ''

        const aHas = (d?.a ?? '').trim().length > 0
        const bHas = (d?.b ?? '').trim().length > 0
        const differsFromSaved = draftA !== savedA || draftB !== savedB
        return (aHas || bHas) && differsFromSaved
      })
      .map(([id]) => id)
  }, [drafts, sorted])

  // Manual match UI (Add match)
  const [addMatchOpen, setAddMatchOpen] = useState<boolean>(false)
  const defaultAddRound = useMemo(() => {
    let filteredMax = 0
    for (const m of sorted) filteredMax = Math.max(filteredMax, Number(m.round) || 0)
    if (filteredMax > 0) return filteredMax + 1
    let globalMax = 0
    for (const m of state.matches) globalMax = Math.max(globalMax, Number(m.round) || 0)
    return Math.max(1, globalMax + 1)
  }, [sorted, state.matches])
  const [addDivisionId, setAddDivisionId] = useState<string>('')
  const [addRound, setAddRound] = useState<string>('')
  const [addClubA, setAddClubA] = useState<string>('')
  const [addClubB, setAddClubB] = useState<string>('')
  const [addA1, setAddA1] = useState<string>('')
  const [addA2, setAddA2] = useState<string>('')
  const [addB1, setAddB1] = useState<string>('')
  const [addB2, setAddB2] = useState<string>('')

  useEffect(() => {
    if (!addMatchOpen) return
    const div = divisionFilters[0] ?? state.divisions[0]?.id ?? ''
    const a = state.clubs[0]?.id ?? ''
    const b = state.clubs[1]?.id ?? a
    setAddDivisionId(div)
    setAddRound(String(defaultAddRound))
    setAddClubA(a)
    setAddClubB(b)
    setAddA1('')
    setAddA2('')
    setAddB1('')
    setAddB2('')
  }, [addMatchOpen, defaultAddRound, divisionFilters, state.clubs, state.divisions])

  const addPlayersForClub = useMemo(() => {
    const byClub = new Map<string, Array<(typeof state.players)[number]>>()
    if (!addDivisionId) return byClub
    for (const p of state.players) {
      if (p.divisionId !== addDivisionId) continue
      const arr = byClub.get(p.clubId) ?? []
      arr.push(p)
      byClub.set(p.clubId, arr)
    }
    for (const [k, arr] of byClub) {
      arr.sort((x, y) => {
        if (x.gender !== y.gender) return x.gender === 'F' ? -1 : 1
        return x.id.localeCompare(y.id)
      })
      byClub.set(k, arr)
    }
    return byClub
  }, [addDivisionId, state])

  // Close filter dropdowns when clicking outside (or pressing Escape).
  useEffect(() => {
    if (!eventFilterOpen && !divisionFilterOpen && !roundFilterOpen) return

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      const divEl = divisionFilterRef.current
      const rndEl = roundFilterRef.current
      const evtEl = eventFilterRef.current
      if (divEl?.contains(target) || rndEl?.contains(target) || evtEl?.contains(target)) return
      setDivisionFilterOpen(false)
      setRoundFilterOpen(false)
      setEventFilterOpen(false)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setDivisionFilterOpen(false)
      setRoundFilterOpen(false)
      setEventFilterOpen(false)
    }

    // Use capture so we see the event before other handlers potentially stop propagation.
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [divisionFilterOpen, eventFilterOpen, roundFilterOpen])

  function handlePrintFiltered() {
    const divisionLabel = (() => {
      if (!divisionFilters.length) return 'All divisions'
      if (divisionFilters.length === 1) return divisionNameById.get(divisionFilters[0]!) ?? divisionFilters[0]!
      return `${divisionFilters.length} selected`
    })()
    const roundLabel = (() => {
      if (!roundFilters.length) return 'All rounds'
      if (roundFilters.length === 1) return `Round ${roundFilters[0]}`
      return `${roundFilters.length} selected`
    })()
    const eventLabelFilter = (() => {
      if (!eventFilters.length) return 'All events'
      const byKey = new Map<string, string>(eventOptions.map((ev) => [`${ev.eventType}:${ev.seed}`, ev.label]))
      const labels = eventFilters.map((v) => byKey.get(v) ?? v).filter(Boolean)
      return labels.length ? labels.join(', ') : 'All events'
    })()

    const rowsHtml = sorted
      .map((m) => {
        const aPair = getMatchPlayerIdsForClub({ state, match: m, clubId: m.clubA })
        const bPair = getMatchPlayerIdsForClub({ state, match: m, clubId: m.clubB })
        const aNames = aPair ? aPair.map((id) => displayPlayerName(playersById.get(id))).join(' / ') : '—'
        const bNames = bPair ? bPair.map((id) => displayPlayerName(playersById.get(id))).join(' / ') : '—'

        const scoreA = m.score?.a ?? null
        const scoreB = m.score?.b ?? null
        const serveA = stableServeFirstIsA(m.id)
        const matchHtml = `<span class="${serveA ? 'serveFirst' : ''}">${escapeHtml(
          clubLabel.get(m.clubA) ?? m.clubA,
        )}</span> <span class="vs">vs</span> <span class="${!serveA ? 'serveFirst' : ''}">${escapeHtml(
          clubLabel.get(m.clubB) ?? m.clubB,
        )}</span>`
        const division = divisionNameById.get(m.divisionId) ?? m.divisionId
        const event = eventLabel(m, getSeededEventsForDivision(state, m.divisionId))
        const playersLineA = `${clubLabel.get(m.clubA) ?? m.clubA}: ${aNames}`
        const playersLineB = `${clubLabel.get(m.clubB) ?? m.clubB}: ${bNames}`

        const scoreHtml = `<div class="scoreBoxes">
  <div class="boxRow">
    <span class="teamTag ${serveA ? 'serveFirst' : ''}">${escapeHtml(clubLabel.get(m.clubA) ?? m.clubA)}</span>
    <span class="box">${scoreA === null ? '&nbsp;' : escapeHtml(String(scoreA))}</span>
  </div>
  <div class="boxRow">
    <span class="teamTag ${!serveA ? 'serveFirst' : ''}">${escapeHtml(clubLabel.get(m.clubB) ?? m.clubB)}</span>
    <span class="box">${scoreB === null ? '&nbsp;' : escapeHtml(String(scoreB))}</span>
  </div>
</div>`

        const courtCell = m.court > 0 ? String(m.court) : ''

        return `<tr>
  <td style="text-align:right;">${m.round}</td>
  <td style="text-align:right;">${escapeHtml(courtCell)}</td>
  <td>${escapeHtml(division)}</td>
  <td>${escapeHtml(event)}</td>
  <td>${matchHtml}</td>
  <td><div class="playersLines"><div>${escapeHtml(playersLineA)}</div><div>${escapeHtml(playersLineB)}</div></div></td>
  <td>${scoreHtml}</td>
</tr>`
      })
      .join('\n')

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Pickleball Tournament Tracker - Scores</title>
    <style>
      :root { color-scheme: light; }
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 20px; }
      h1 { font-size: 18px; margin: 0 0 6px; }
      .meta { font-size: 12px; color: #334155; margin: 0 0 12px; }
      .hint { font-size: 12px; color: #334155; margin: 0 0 12px; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      th, td { border: 1px solid #e2e8f0; padding: 6px 8px; vertical-align: top; font-size: 12px; }
      th { background: #f1f5f9; text-align: left; }
      th:nth-child(1), td:nth-child(1) { width: 36px; }
      th:nth-child(2), td:nth-child(2) { width: 44px; }
      td:nth-child(3) { width: 120px; }
      td:nth-child(4) { width: 110px; }
      td:nth-child(5) { width: 120px; }
      th:nth-child(6), td:nth-child(6) { width: 300px; }
      td:nth-child(7) { width: 130px; }
      .small { color: #64748b; }
      .scoreBoxes { display: grid; gap: 4px; }
      .boxRow { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
      .teamTag { font-weight: 700; font-size: 11px; color: #0f172a; }
      .vs { color: #64748b; }
      .serveFirst { font-weight: 900; }
      .playersLines { line-height: 1.35; }
      .box { display: inline-block; width: 40px; height: 28px; border: 2px solid #0f172a; border-radius: 4px; text-align: center; line-height: 26px; font-weight: 700; font-size: 13px; }
      @media print { body { margin: 0.35in; } }
    </style>
  </head>
  <body>
    <h1>Scores (Filtered)</h1>
    <div class="meta">
      <div><b>Division:</b> ${escapeHtml(divisionLabel)} &nbsp; <b>Round:</b> ${escapeHtml(roundLabel)} &nbsp; <b>Event:</b> ${escapeHtml(
        eventLabelFilter,
      )}</div>
      <div class="small"><b>Printed:</b> ${escapeHtml(new Date().toLocaleString())} &nbsp; <b>Rows:</b> ${sorted.length}</div>
    </div>
    <div class="hint">
      <b>Serve:</b> The <span class="serveFirst">bold team</span> serves first. &nbsp;
      <b>Instructions:</b> Write scores in the boxes (team acronyms shown). Optional: circle the winning club in the <b>Match</b> column.
    </div>
    <table>
      <thead>
        <tr>
          <th style="text-align:right;">R</th>
          <th style="text-align:right;">Ct</th>
          <th>Division</th>
          <th>Event</th>
          <th>Match</th>
          <th>Players</th>
          <th>Score</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  </body>
</html>`

    // Print via hidden iframe (avoids popup blockers).
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.style.opacity = '0'
    iframe.setAttribute('aria-hidden', 'true')

    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
      } finally {
        // Give the print dialog a moment to open before cleanup.
        setTimeout(() => iframe.remove(), 500)
      }
    }

    // srcdoc is supported by modern browsers; this works on GitHub Pages without opening a new tab.
    iframe.srcdoc = html
    document.body.appendChild(iframe)
  }

  function headerButton(label: string, key: SortKey, alignRight = false) {
    const active = sort?.key === key
    const dir = active ? sort!.dir : undefined
    const glyph = !active ? '' : dir === 'asc' ? ' ▲' : ' ▼'
    return (
      <button
        type="button"
        className={[
          'w-full select-none text-left hover:text-white',
          alignRight ? 'text-right' : '',
          active ? 'text-slate-100' : 'text-slate-300',
        ].join(' ')}
        onClick={() => {
          setSort((prev) => {
            if (!prev || prev.key !== key) return { key, dir: 'asc' }
            return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
          })
        }}
        title="Sort"
      >
        {label}
        <span className="text-slate-500">{glyph}</span>
      </button>
    )
  }

  function parseCourtList(raw: string): number[] {
    const parts = raw
      .split(/[\s,]+/g)
      .map((s) => s.trim())
      .filter(Boolean)
    const out: number[] = []
    for (const p of parts) {
      const n = Number(p)
      if (!Number.isFinite(n)) continue
      const v = Math.floor(n)
      if (v <= 0) continue
      out.push(v)
    }
    // Keep order, but remove duplicates.
    const seen = new Set<number>()
    return out.filter((n) => (seen.has(n) ? false : (seen.add(n), true)))
  }

  function assignCourtsForVisibleMatches() {
    if (tournamentLocked) {
      alert('Tournament is locked. Re-open it to assign courts.')
      return
    }
    const courts = parseCourtList(courtList)
    if (courts.length === 0) {
      alert('Enter at least one court number (e.g. 11, 12).')
      return
    }
    if (sorted.length === 0) {
      alert('No matches in the current filter.')
      return
    }

    // Enforce grouping by (divisionId, round). Courts alternate within each group.
    const idxByGroup = new Map<string, number>()
    const assignments: Array<{ matchId: string; court: number }> = []
    for (const m of sorted) {
      if (!courtOverwrite && m.court > 0) continue
      const key = `${m.divisionId}::${m.round}`
      const i = idxByGroup.get(key) ?? 0
      const court = courts[i % courts.length]!
      assignments.push({ matchId: m.id, court })
      idxByGroup.set(key, i + 1)
    }

    if (assignments.length === 0) {
      alert(courtOverwrite ? 'No matches to assign.' : 'No unassigned matches to assign (all have courts).')
      return
    }

    const groups = idxByGroup.size
    if (
      !confirm(
        `Assign courts to ${assignments.length} match(es)?\n\nCourts will alternate within each Division+Round group.\nGroups affected: ${groups}\nCourts: ${courts.join(', ')}\n\nContinue?`,
      )
    )
      return

    actions.assignCourts(assignments, courtOverwrite)
  }

  function clearCourtsForVisibleMatches() {
    if (tournamentLocked) {
      alert('Tournament is locked. Re-open it to clear courts.')
      return
    }
    if (sorted.length === 0) {
      alert('No matches in the current filter.')
      return
    }
    const withCourts = sorted.filter((m) => m.court > 0)
    if (withCourts.length === 0) {
      alert('No assigned courts to clear in the current filter.')
      return
    }
    if (!confirm(`Clear courts for ${withCourts.length} match(es) in the current filter?\n\nThis sets Ct back to blank.\n\nContinue?`))
      return
    actions.assignCourts(
      withCourts.map((m) => ({ matchId: m.id, court: 0 })),
      true,
    )
  }

  function saveAllFilteredScores() {
    if (tournamentLocked) {
      alert('Tournament is locked.')
      return
    }
    if (sorted.length === 0) {
      alert('No matches in the current filter.')
      return
    }
    if (pendingFilteredDraftIds.length === 0) {
      alert('No entered (unsaved) scores found in the current filter.')
      return
    }

    const byId = new Map(sorted.map((m) => [m.id, m] as const))
    const toSave: Array<{ matchId: string; score: { a: number; b: number } }> = []
    const errors: string[] = []

    for (const matchId of pendingFilteredDraftIds) {
      const m = byId.get(matchId)
      if (!m) continue
      if (m.completedAt) continue
      const d = drafts[matchId]
      if (!d) continue

      const aRaw = d.a ?? ''
      const bRaw = d.b ?? ''
      const aHas = aRaw.trim().length > 0
      const bHas = bRaw.trim().length > 0
      if (!aHas && !bHas) continue

      const a = parseScore(aRaw)
      const b = parseScore(bRaw)
      if (a === undefined || b === undefined) {
        const divCode = divisionCodeById.get(m.divisionId) ?? m.divisionId
        const evShort = eventLabel(m, getSeededEventsForDivision(state, m.divisionId)).replace(/\s+/g, '')
        const rowId = `${divCode}-R${m.round}-C${m.court}-${evShort}`
        errors.push(rowId)
        continue
      }
      toSave.push({ matchId, score: { a, b } })
    }

    if (errors.length) {
      alert(
        `Cannot save all yet.\n\nThese rows have invalid or incomplete scores:\n${errors.slice(0, 10).join('\n')}${
          errors.length > 10 ? `\n… and ${errors.length - 10} more` : ''
        }`,
      )
      return
    }

    if (toSave.length === 0) {
      alert('No entered scores to save in the current filter.')
      return
    }

    if (!confirm(`Save scores for ${toSave.length} match(es) in the current filter?`)) return

    actions.setScoresMany(toSave)
    setDrafts((prev) => {
      const next = { ...prev }
      for (const x of toSave) delete next[x.matchId]
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Score Entry</h1>
          <p className="text-sm text-slate-300">Enter scores (to 11). Standings update instantly.</p>
          <div className="mt-1 text-xs text-slate-400">
            Total matches: <span className="tabular-nums font-semibold text-slate-200">{totalMatches}</span>
          </div>
          {tournamentLocked ? (
            <div className="mt-1 text-xs font-semibold text-amber-200">Tournament locked (scores are read-only)</div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tournamentLocked ? (
            <button
              className="rounded-md border border-amber-900/60 px-3 py-2 text-sm font-medium text-amber-200 hover:bg-amber-950/40"
              onClick={() => {
                if (
                  !confirm(
                    'Re-open tournament?\n\nThis will re-enable editing scores and regenerating schedules.\n\nContinue?',
                  )
                )
                  return
                actions.unlockTournament()
              }}
              title="Re-open to allow edits again"
            >
              Re-open tournament
            </button>
          ) : (
            <button
              className="rounded-md bg-amber-800 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
              onClick={() => {
                if (
                  !confirm(
                    'Complete tournament?\n\nThis will LOCK the tournament so scores cannot be edited.\nYou can re-open it later if needed.\n\nContinue?',
                  )
                )
                  return
                actions.lockTournament()
              }}
              title="Lock the tournament to prevent any score edits"
            >
              Complete tournament
            </button>
          )}
          <button
            className={[
              'rounded-md bg-slate-800 px-3 py-2 text-sm font-medium hover:bg-slate-700',
              tournamentLocked ? 'cursor-not-allowed opacity-50 hover:bg-slate-800' : '',
            ].join(' ')}
            disabled={tournamentLocked}
            onClick={() => {
              if (
                !confirm(
                  'Regenerate schedule?\n\nThis will DELETE the current schedule and CLEAR ALL SCORES.\nUse this if you want to start over.\n\nContinue?',
                )
              )
                return
              actions.regenerateSchedule()
              setDrafts({})
            }}
          >
            Generate schedule
          </button>
          <button
            className={[
              'rounded-md border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900',
              tournamentLocked || optimizableFiltered.length === 0 ? 'cursor-not-allowed opacity-50 hover:bg-transparent' : '',
            ].join(' ')}
            disabled={tournamentLocked || optimizableFiltered.length === 0}
            onClick={() => {
              if (optimizableFiltered.length === 0) {
                alert('No regular matches in the current filter to optimize.')
                return
              }
              const rawCourts = prompt(
                'Optional: target number of courts to use per round.\n\nLeave blank to maximize automatically.',
                '',
              )
              if (rawCourts == null) return
              let targetCourts: number | undefined
              const trimmed = rawCourts.trim()
              if (trimmed.length) {
                const n = Math.floor(Number(trimmed))
                if (!Number.isFinite(n) || n <= 0) {
                  alert('Courts must be a positive whole number.')
                  return
                }
                targetCourts = n
              }
              if (
                !confirm(
                  `Optimize filtered rounds?\n\nThis will reorder ${optimizableFiltered.length} currently filtered regular match(es) to reduce player conflicts.\n\n${
                    targetCourts ? `Target courts per round: ${targetCourts}\n\n` : ''
                  }Only filtered matches are changed.\nScores and matches stay intact.\n\nContinue?`,
                )
              )
                return
              actions.optimizeRounds(
                optimizableFiltered.map((m) => m.id),
                targetCourts,
              )
            }}
            title="Reorder rounds for better concurrent play"
          >
            Optimize rounds ({optimizableFiltered.length})
          </button>
          <button
            className={[
              'rounded-md bg-emerald-800 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700',
              tournamentLocked || pendingFilteredDraftIds.length === 0 ? 'cursor-not-allowed opacity-50 hover:bg-emerald-800' : '',
            ].join(' ')}
            disabled={tournamentLocked || pendingFilteredDraftIds.length === 0}
            onClick={saveAllFilteredScores}
            title="Saves only the entered scores in the current filter"
          >
            Save filtered {pendingFilteredDraftIds.length ? `(${pendingFilteredDraftIds.length})` : ''}
          </button>
          <button
            className={[
              'rounded-md border border-indigo-900/60 bg-indigo-950/30 px-3 py-2 text-sm font-medium text-indigo-200 hover:bg-indigo-950/50',
              tournamentLocked || hasPlayoffs || !allFilteredRegularScored ? 'cursor-not-allowed opacity-50 hover:bg-transparent' : '',
            ].join(' ')}
            disabled={tournamentLocked || hasPlayoffs || !allFilteredRegularScored}
            onClick={() => {
              if (tournamentLocked) return
              if (hasPlayoffs) return
              if (!allFilteredRegularScored) return
              if (
                !confirm(
                  'Add playoff round?\n\nThis will add a new round with:\n- #1 vs #2\n- #3 vs #4 (if 4+ teams)\n\nStandings will use playoff results once all playoff games are scored.\n\nContinue?',
                )
              )
                return
              actions.addPlayoffRound(filteredRegularMatches.map((m) => m.id))
            }}
            title={
              hasPlayoffs
                ? 'Playoff round already added'
                : !allFilteredRegularScored
                  ? 'Enter scores for the currently filtered matches first'
                  : 'Adds a playoff round based on current standings'
            }
          >
            {hasPlayoffs ? 'Playoff added' : 'Add playoff round'}
          </button>
          <button
            className={[
              'rounded-md border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900',
              tournamentLocked ? 'cursor-not-allowed opacity-50 hover:bg-transparent' : '',
            ].join(' ')}
            disabled={tournamentLocked}
            onClick={() => setAddMatchOpen(true)}
            title="Manually add a match (counts in standings/player stats)"
          >
            Add match
          </button>
          <button
            className={[
              'rounded-md border border-red-900/60 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-950/40',
              tournamentLocked ? 'cursor-not-allowed opacity-50 hover:bg-transparent' : '',
            ].join(' ')}
            disabled={tournamentLocked}
            onClick={() => {
              const incomplete = state.matches.filter((m) => {
                // Never delete scored/completed matches, even if they have missing/blank players.
                if (m.score || m.completedAt) return false
                return !hasFullLineup(m)
              })
              if (incomplete.length === 0) {
                alert('No games with missing players found.')
                return
              }
              if (
                !confirm(
                  `Delete games with missing players?\n\nThis will permanently delete ${incomplete.length} unscored match(es) where all 4 players are not filled (named).\n\nScored games will NOT be deleted.\n\nContinue?`,
                )
              )
                return
              actions.deleteMatches(incomplete.map((m) => m.id))
              setDrafts({})
            }}
            title="Removes unscored matches with missing players"
          >
            Delete games with missing players
          </button>
          <button
            className={[
              'rounded-md border border-red-900/60 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-950/40',
              tournamentLocked || sorted.length === 0 ? 'cursor-not-allowed opacity-50 hover:bg-transparent' : '',
            ].join(' ')}
            disabled={tournamentLocked || sorted.length === 0}
            onClick={() => {
              if (sorted.length === 0) {
                alert('No matches in the current filter.')
                return
              }
              if (
                !confirm(
                  `Delete filtered matches?\n\nThis will permanently delete ${sorted.length} match(es) currently shown by your filters.\n\nContinue?`,
                )
              )
                return
              const ids = sorted.map((m) => m.id)
              actions.deleteMatches(ids)
              setDrafts((prev) => {
                const next = { ...prev }
                for (const id of ids) delete next[id]
                return next
              })
            }}
            title="Deletes all matches currently shown by the active filters"
          >
            Delete filtered ({sorted.length})
          </button>
          <button
            className="rounded-md border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900"
            onClick={handlePrintFiltered}
            title="Print the currently filtered rows"
          >
            Print
          </button>
          <button
            className={[
              'rounded-md border border-red-900/60 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-950/40',
              tournamentLocked ? 'cursor-not-allowed opacity-50 hover:bg-transparent' : '',
            ].join(' ')}
            disabled={tournamentLocked}
            onClick={() => {
              if (
                !confirm(
                  'Reset ALL scores?\n\nThis clears every match score and unlocks all rows.\n(Your schedule and mappings will remain.)',
                )
              )
                return
              actions.clearAllScores()
              setDrafts({})
            }}
          >
            Reset all scores
          </button>
        </div>
      </div>

      {addMatchOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">Add Match</div>
                <div className="text-xs text-slate-400">Adds one manual game (counts in standings/player stats).</div>
              </div>
              <button
                className="rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-900 hover:text-white"
                onClick={() => setAddMatchOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="space-y-4 p-4">
              <div className="grid gap-3 md:grid-cols-3">
                <label className="text-sm text-slate-300">
                  <div className="mb-1 text-xs text-slate-400">Division</div>
                  <select
                    className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
                    value={addDivisionId}
                    onChange={(e) => {
                      setAddDivisionId(e.target.value)
                      setAddA1('')
                      setAddA2('')
                      setAddB1('')
                      setAddB2('')
                    }}
                  >
                    {state.divisions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm text-slate-300">
                  <div className="mb-1 text-xs text-slate-400">Round</div>
                  <input
                    inputMode="numeric"
                    className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
                    value={addRound}
                    onChange={(e) => setAddRound(e.target.value)}
                  />
                </label>

                <div className="flex items-end text-xs text-slate-500">Default: highest filtered round + 1 ({defaultAddRound}).</div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm text-slate-300">
                  <div className="mb-1 text-xs text-slate-400">Team 1</div>
                  <select
                    className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
                    value={addClubA}
                    onChange={(e) => {
                      setAddClubA(e.target.value)
                      setAddA1('')
                      setAddA2('')
                    }}
                  >
                    {state.clubs.map((c) => (
                      <option key={c.id} value={c.id}>
                        {clubLabel.get(c.id) ?? c.id}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm text-slate-300">
                  <div className="mb-1 text-xs text-slate-400">Team 2</div>
                  <select
                    className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
                    value={addClubB}
                    onChange={(e) => {
                      setAddClubB(e.target.value)
                      setAddB1('')
                      setAddB2('')
                    }}
                  >
                    {state.clubs.map((c) => (
                      <option key={c.id} value={c.id}>
                        {clubLabel.get(c.id) ?? c.id}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3">
                  <div className="mb-2 text-sm font-semibold text-slate-100">Team 1 players</div>
                  <div className="grid gap-2">
                    <select
                      className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
                      value={addA1}
                      onChange={(e) => setAddA1(e.target.value)}
                    >
                      <option value="">Select player 1…</option>
                      {(addPlayersForClub.get(addClubA) ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {displayPlayerName(p)} ({p.gender})
                        </option>
                      ))}
                    </select>
                    <select
                      className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
                      value={addA2}
                      onChange={(e) => setAddA2(e.target.value)}
                    >
                      <option value="">Select player 2…</option>
                      {(addPlayersForClub.get(addClubA) ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {displayPlayerName(p)} ({p.gender})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3">
                  <div className="mb-2 text-sm font-semibold text-slate-100">Team 2 players</div>
                  <div className="grid gap-2">
                    <select
                      className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
                      value={addB1}
                      onChange={(e) => setAddB1(e.target.value)}
                    >
                      <option value="">Select player 1…</option>
                      {(addPlayersForClub.get(addClubB) ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {displayPlayerName(p)} ({p.gender})
                        </option>
                      ))}
                    </select>
                    <select
                      className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
                      value={addB2}
                      onChange={(e) => setAddB2(e.target.value)}
                    >
                      <option value="">Select player 2…</option>
                      {(addPlayersForClub.get(addClubB) ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {displayPlayerName(p)} ({p.gender})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  className="rounded-md border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900"
                  onClick={() => setAddMatchOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium hover:bg-slate-700"
                  onClick={() => {
                    if (tournamentLocked) return
                    const divId = addDivisionId.trim()
                    if (!divId.length) {
                      alert('Please select a division.')
                      return
                    }
                    const roundNum = Math.max(1, Math.floor(Number(addRound) || 0))
                    if (!Number.isFinite(roundNum) || roundNum <= 0) {
                      alert('Round must be a positive number.')
                      return
                    }
                    const clubA = addClubA.trim()
                    const clubB = addClubB.trim()
                    if (!clubA || !clubB) {
                      alert('Please select two teams.')
                      return
                    }
                    if (clubA === clubB) {
                      alert('Teams must be different.')
                      return
                    }
                    const aAny = Boolean(addA1 || addA2)
                    const bAny = Boolean(addB1 || addB2)

                    // Players are optional, but to keep stats consistent we only allow:
                    // - no players for both teams, OR
                    // - exactly 2 players for both teams.
                    if (aAny || bAny) {
                      if (!(addA1 && addA2 && addB1 && addB2)) {
                        alert('Either leave ALL players blank, or select 2 players for BOTH teams.')
                        return
                      }
                      if (addA1 === addA2 || addB1 === addB2) {
                        alert('A team cannot use the same player twice.')
                        return
                      }
                    }

                    const playersByIdLocal = new Map(state.players.map((p) => [p.id, p] as const))
                    const pa1 = addA1 ? playersByIdLocal.get(addA1) : undefined
                    const pa2 = addA2 ? playersByIdLocal.get(addA2) : undefined
                    const pb1 = addB1 ? playersByIdLocal.get(addB1) : undefined
                    const pb2 = addB2 ? playersByIdLocal.get(addB2) : undefined

                    let eventType: Match['eventType'] = 'MIXED_DOUBLES'
                    if (pa1 && pa2 && pb1 && pb2) {
                      const all = [pa1, pa2, pb1, pb2]
                      if (all.some((p) => p.divisionId !== divId)) {
                        alert('All selected players must be in the chosen division.')
                        return
                      }
                      if (pa1.clubId !== clubA || pa2.clubId !== clubA || pb1.clubId !== clubB || pb2.clubId !== clubB) {
                        alert('Selected players must belong to their chosen teams.')
                        return
                      }

                      const aG = [pa1.gender, pa2.gender]
                      const bG = [pb1.gender, pb2.gender]
                      const isAll = (gs: Array<'M' | 'F'>, g: 'M' | 'F') => gs.every((x) => x === g)
                      if (isAll(aG, 'F') && isAll(bG, 'F')) eventType = 'WOMENS_DOUBLES'
                      else if (isAll(aG, 'M') && isAll(bG, 'M')) eventType = 'MENS_DOUBLES'
                      else {
                        const okMixed = (gs: Array<'M' | 'F'>) => gs.includes('F') && gs.includes('M')
                        if (!okMixed(aG) || !okMixed(bG)) {
                          alert('Mixed doubles requires 1 woman and 1 man on each team.')
                          return
                        }
                        eventType = 'MIXED_DOUBLES'
                      }
                    }

                    const maxSeed = Math.max(
                      0,
                      ...state.matches.filter((m) => m.divisionId === divId && m.eventType === eventType).map((m) => Number(m.seed) || 0),
                    )
                    const seed = maxSeed + 1

                    const maxMatchupIndex = Math.max(
                      -1,
                      ...state.matches.filter((m) => m.divisionId === divId && m.round === roundNum).map((m) => Number(m.matchupIndex) || 0),
                    )
                    const matchupIndex = maxMatchupIndex + 1

                    // Store the chosen lineups via a new seed mapping just for this manual match.
                    actions.setSeed(divId, clubA, eventType, seed, [pa1?.id ?? null, pa2?.id ?? null])
                    actions.setSeed(divId, clubB, eventType, seed, [pb1?.id ?? null, pb2?.id ?? null])

                    const id = makeMatchId({ divisionId: divId, clubA, clubB, eventType, seed })
                    const newMatch: Match = {
                      id,
                      divisionId: divId,
                      round: roundNum,
                      matchupIndex,
                      eventType,
                      seed,
                      court: 0,
                      clubA,
                      clubB,
                      stage: 'REGULAR',
                    }
                    dispatch({ type: 'matches.upsert', match: newMatch, source: 'local' })
                    setAddMatchOpen(false)
                  }}
                >
                  Add match
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-3">
            <div className="text-sm font-semibold text-slate-200">Filters</div>
            <div className="text-xs text-slate-400">
              Showing <span className="tabular-nums font-semibold text-slate-200">{sorted.length}</span> of{' '}
              <span className="tabular-nums font-semibold text-slate-200">{totalMatches}</span> matches
            </div>
          </div>
          <button
            type="button"
            className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-900"
            onClick={() => {
              setDivisionFilters([])
              setRoundFilters([])
              setEventFilters([])
              setTeam1('all')
              setTeam2('all')
              setNeedsScoresOnly(false)
              setFullLineupsOnly(false)
              setQuickSearch('')
            }}
            title="Reset all filters"
          >
            Reset filters
          </button>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-12">
          <div className="text-sm text-slate-300 lg:col-span-3">
            <div className="mb-1 text-xs text-slate-400">Division</div>
            <details ref={divisionFilterRef} className="group relative" open={divisionFilterOpen}>
              <summary
                className="cursor-pointer list-none rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100 hover:bg-slate-950"
                onClick={(e) => {
                  e.preventDefault()
                  setDivisionFilterOpen((v) => !v)
                }}
              >
                {divisionFilters.length === 0
                  ? 'All divisions'
                  : divisionFilters.length === 1
                    ? divisionNameById.get(divisionFilters[0]!) ?? divisionFilters[0]
                    : `${divisionFilters.length} selected`}
                <span className="float-right text-slate-400 group-open:rotate-180">▾</span>
              </summary>
              <div className="absolute z-20 mt-1 w-full min-w-55 rounded-md border border-slate-700 bg-slate-950 p-2 shadow-lg">
                <div className="max-h-56 overflow-auto pr-1">
                  {state.divisions.map((d) => {
                    const v = d.id
                    const checked = divisionFilters.includes(v)
                    return (
                      <label key={v} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-slate-200 hover:bg-slate-900">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-slate-200"
                          checked={checked}
                          onChange={(e) => {
                            const nextChecked = e.target.checked
                            setDivisionFilters((prev) => {
                              if (nextChecked) return prev.includes(v) ? prev : [...prev, v]
                              return prev.filter((x) => x !== v)
                            })
                          }}
                        />
                        <span className="truncate">{d.name}</span>
                      </label>
                    )
                  })}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-800 pt-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-900"
                    onClick={() => setDivisionFilters([])}
                  >
                    All
                  </button>
                  <div className="text-xs text-slate-400">{divisionFilters.length ? `${divisionFilters.length} selected` : 'All selected'}</div>
                </div>
              </div>
            </details>
          </div>

          <div className="text-sm text-slate-300 lg:col-span-3">
            <div className="mb-1 text-xs text-slate-400">Round</div>
            <details ref={roundFilterRef} className="group relative" open={roundFilterOpen}>
              <summary
                className="cursor-pointer list-none rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100 hover:bg-slate-950"
                onClick={(e) => {
                  e.preventDefault()
                  setRoundFilterOpen((v) => !v)
                }}
              >
                {roundFilters.length === 0
                  ? 'All rounds'
                  : roundFilters.length === 1
                    ? `Round ${roundFilters[0]}`
                    : `${roundFilters.length} selected`}
                <span className="float-right text-slate-400 group-open:rotate-180">▾</span>
              </summary>
              <div className="absolute z-20 mt-1 w-full min-w-55 rounded-md border border-slate-700 bg-slate-950 p-2 shadow-lg">
                <div className="max-h-56 overflow-auto pr-1">
                  {availableRounds.map((r) => {
                    const v = String(r)
                    const checked = roundFilters.includes(v)
                    return (
                      <label key={v} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-slate-200 hover:bg-slate-900">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-slate-200"
                          checked={checked}
                          onChange={(e) => {
                            const nextChecked = e.target.checked
                            setRoundFilters((prev) => {
                              if (nextChecked) return prev.includes(v) ? prev : [...prev, v]
                              return prev.filter((x) => x !== v)
                            })
                          }}
                        />
                        <span className="truncate">Round {r}</span>
                      </label>
                    )
                  })}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-800 pt-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-900"
                    onClick={() => setRoundFilters([])}
                  >
                    All
                  </button>
                  <div className="text-xs text-slate-400">{roundFilters.length ? `${roundFilters.length} selected` : 'All selected'}</div>
                </div>
              </div>
            </details>
          </div>

          <div className="text-sm text-slate-300 md:col-span-2 lg:col-span-6">
            <div className="mb-1 text-xs text-slate-400">Event</div>
            <details ref={eventFilterRef} className="group relative" open={eventFilterOpen}>
              <summary
                className="cursor-pointer list-none rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100 hover:bg-slate-950"
                onClick={(e) => {
                  // Prevent native <details> toggling so we can control it and support click-outside close.
                  e.preventDefault()
                  setEventFilterOpen((v) => !v)
                }}
              >
                {eventFilters.length === 0
                  ? 'All events'
                  : eventFilters.length === 1
                    ? eventOptions.find((ev) => `${ev.eventType}:${ev.seed}` === eventFilters[0])?.label ?? eventFilters[0]
                    : `${eventFilters.length} selected`}
                <span className="float-right text-slate-400 group-open:rotate-180">▾</span>
              </summary>
              <div className="absolute z-20 mt-1 w-full min-w-55 rounded-md border border-slate-700 bg-slate-950 p-2 shadow-lg">
                <div className="max-h-56 overflow-auto pr-1">
                  {eventOptions.map((ev) => {
                    const v = `${ev.eventType}:${ev.seed}`
                    const checked = eventFilters.includes(v)
                    return (
                      <label key={v} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-slate-200 hover:bg-slate-900">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-slate-200"
                          checked={checked}
                          onChange={(e) => {
                            const nextChecked = e.target.checked
                            setEventFilters((prev) => {
                              if (nextChecked) return prev.includes(v) ? prev : [...prev, v]
                              return prev.filter((x) => x !== v)
                            })
                          }}
                        />
                        <span className="truncate">{ev.label}</span>
                      </label>
                    )
                  })}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-800 pt-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-900"
                    onClick={() => setEventFilters([])}
                  >
                    All
                  </button>
                  <div className="text-xs text-slate-400">{eventFilters.length ? `${eventFilters.length} selected` : 'All selected'}</div>
                </div>
              </div>
            </details>
          </div>

          <label className="text-sm text-slate-300 lg:col-span-4">
            <div className="mb-1 text-xs text-slate-400">Team 1</div>
            <select
              className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
              value={team1}
              onChange={(e) => setTeam1(e.target.value)}
            >
              <option value="all">Any</option>
              {state.clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-300 lg:col-span-4">
            <div className="mb-1 text-xs text-slate-400">Team 2</div>
            <select
              className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
              value={team2}
              onChange={(e) => setTeam2(e.target.value)}
            >
              <option value="all">Any</option>
              {state.clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id}
                </option>
              ))}
            </select>
          </label>

          <div className="lg:col-span-4">
            <div className="mb-1 text-xs text-slate-400">Options</div>
            <div className="flex min-h-10 flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-950/40 px-2 py-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-slate-200"
                  checked={needsScoresOnly}
                  onChange={(e) => setNeedsScoresOnly(e.target.checked)}
                />
                <span className="text-sm">Needs scores</span>
              </label>
              <label className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-950/40 px-2 py-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-slate-200"
                  checked={fullLineupsOnly}
                  onChange={(e) => setFullLineupsOnly(e.target.checked)}
                />
                <span className="text-sm">Full lineups</span>
              </label>
            </div>
          </div>

          <label className="text-sm text-slate-300 md:col-span-2 lg:col-span-12">
            <div className="mb-1 text-xs text-slate-400">Quick search</div>
            <input
              className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
              value={quickSearch}
              onChange={(e) => setQuickSearch(e.target.value)}
              placeholder="Search anything (division, event, teams, players, round/court, score...)"
            />
          </label>

          <div className="md:col-span-2 lg:col-span-12">
            <div className="mb-1 text-xs text-slate-400">Court assignment (by Division + Round)</div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="w-56 max-w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                value={courtList}
                onChange={(e) => setCourtList(e.target.value)}
                placeholder="Courts (e.g. 11, 12, 13)"
              />
              <label className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-950/40 px-2 py-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-slate-200"
                  checked={courtOverwrite}
                  onChange={(e) => setCourtOverwrite(e.target.checked)}
                />
                <span className="text-sm">Overwrite existing</span>
              </label>
              <button
                type="button"
                className={[
                  'rounded-md bg-slate-800 px-3 py-2 text-sm font-medium hover:bg-slate-700',
                  tournamentLocked ? 'cursor-not-allowed opacity-50 hover:bg-slate-800' : '',
                ].join(' ')}
                disabled={tournamentLocked}
                onClick={assignCourtsForVisibleMatches}
                title="Assigns courts to the currently filtered matches, alternating within each division+round."
              >
                Assign courts
              </button>
              <button
                type="button"
                className={[
                  'rounded-md border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900',
                  tournamentLocked ? 'cursor-not-allowed opacity-50 hover:bg-transparent' : '',
                ].join(' ')}
                disabled={tournamentLocked}
                onClick={clearCourtsForVisibleMatches}
                title="Clears courts (sets Ct back to blank) for the currently filtered matches."
              >
                Clear courts
              </button>
              <div className="text-xs text-slate-500">
                Tip: filter first; courts alternate within each <b>Division+Round</b>.
              </div>
            </div>
          </div>
        </div>
      </div>

      {scheduleMissing ? (
        <div className="rounded-lg border border-amber-900/50 bg-amber-950/40 p-3 text-sm text-amber-200">
          No matches yet. Click <b>Generate schedule</b> to create matches.
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <div className="min-w-300">
          {/* ID column removed (kept here in case we want to restore it later)
            grid-cols-[120px_44px_54px_minmax(0,120px)_minmax(0,110px)_minmax(0,120px)_minmax(0,1fr)_230px]
            <div className="whitespace-nowrap">{headerButton('ID', 'id')}</div>
          */}
          <div className="grid grid-cols-[44px_54px_minmax(0,120px)_minmax(0,110px)_minmax(0,120px)_minmax(0,1fr)_320px] gap-2 bg-slate-900/60 px-3 py-2 text-xs font-semibold text-slate-300">
            <div>{headerButton('R', 'round')}</div>
            <div>{headerButton('Ct', 'court')}</div>
            <div>{headerButton('Division', 'division')}</div>
            <div>{headerButton('Event', 'event')}</div>
            <div>{headerButton('Match', 'match')}</div>
            <div>{headerButton('Players', 'players')}</div>
            <div className="text-right">{headerButton('Score', 'score', true)}</div>
          </div>

          <div className="divide-y divide-slate-800 bg-slate-950/30">
          {sorted.map((m) => {
            const computed = computeMatch(m)
            const aPair = getMatchPlayerIdsForClub({ state, match: m, clubId: m.clubA })
            const bPair = getMatchPlayerIdsForClub({ state, match: m, clubId: m.clubB })
            const aNames = aPair ? aPair.map((id) => displayPlayerName(playersById.get(id))).join(' / ') : '—'
            const bNames = bPair ? bPair.map((id) => displayPlayerName(playersById.get(id))).join(' / ') : '—'

            const aWon = computed.winnerClubId === m.clubA
            const bWon = computed.winnerClubId === m.clubB

            const locked = tournamentLocked || !!m.completedAt
            const draft = drafts[m.id] ?? { a: m.score?.a?.toString() ?? '', b: m.score?.b?.toString() ?? '' }
            const showA = locked ? (m.score?.a?.toString() ?? '') : draft.a
            const showB = locked ? (m.score?.b?.toString() ?? '') : draft.b

            const divCode = divisionCodeById.get(m.divisionId) ?? m.divisionId
            const evShort = eventLabel(m, getSeededEventsForDivision(state, m.divisionId)).replace(/\s+/g, '')
            const rowId = `${divCode}-R${m.round}-C${m.court}-${evShort}`

            const divisionText = divisionNameById.get(m.divisionId) ?? m.divisionId
            const eventText = eventLabel(m, getSeededEventsForDivision(state, m.divisionId))
            const clubAText = clubLabel.get(m.clubA) ?? m.clubA
            const clubBText = clubLabel.get(m.clubB) ?? m.clubB
            const playersLineA = `${clubAText}: ${aNames}`
            const playersLineB = `${clubBText}: ${bNames}`
            const isPlayoff = (m.stage ?? 'REGULAR') === 'PLAYOFF'

            return (
              <div key={m.id} className="grid grid-cols-[44px_54px_minmax(0,120px)_minmax(0,110px)_minmax(0,120px)_minmax(0,1fr)_320px] items-center gap-2 px-3 py-2 text-sm">
                {/* ID column removed (kept here in case we want to restore it later)
                  <div className="font-mono text-[11px] text-slate-400">{rowId}</div>
                */}
                <div className="text-slate-300">{highlightText(String(m.round), highlightNeedle)}</div>
                <div className="text-slate-300">{highlightText(m.court > 0 ? String(m.court) : '—', highlightNeedle)}</div>
                <div className="truncate text-slate-200">{highlightText(divisionText, highlightNeedle)}</div>
                <div className="text-slate-200">
                  {isPlayoff ? (
                    <span className="mr-2 rounded-full border border-indigo-900/60 bg-indigo-950/30 px-2 py-0.5 text-[10px] font-semibold text-indigo-200">
                      Playoff
                    </span>
                  ) : null}
                  {highlightText(eventText, highlightNeedle)}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-slate-100">
                    <span className={aWon ? 'font-semibold text-emerald-200' : ''}>
                      {highlightText(clubAText, highlightNeedle)}
                    </span>
                    <span className="mx-1 text-slate-500">vs</span>
                    <span className={bWon ? 'font-semibold text-emerald-200' : ''}>
                      {highlightText(clubBText, highlightNeedle)}
                    </span>
                  </div>
                </div>
                <div className="min-w-0 overflow-hidden">
                  <div className="space-y-0.5 text-xs text-slate-300">
                    <div className="truncate">{highlightText(playersLineA, highlightNeedle)}</div>
                    <div className="truncate">{highlightText(playersLineB, highlightNeedle)}</div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center justify-end gap-2">
                  <span
                    className={[
                      'max-w-18 rounded border px-1.5 py-0.5 text-center text-[11px] font-semibold',
                      aWon
                        ? 'border-emerald-800/70 bg-emerald-950/30 text-emerald-200'
                        : 'border-slate-700 bg-slate-900/60 text-slate-300',
                    ].join(' ')}
                    title={clubAText}
                  >
                    {clubAText}
                  </span>
                  <input
                    inputMode="numeric"
                    className={[
                      'w-14 rounded-md border px-2 py-1 text-right text-sm outline-none',
                      aWon ? 'border-emerald-700 bg-emerald-950/40 text-emerald-100' : 'border-slate-800 bg-slate-950/40 text-slate-100',
                      locked ? 'opacity-70' : '',
                    ].join(' ')}
                    value={showA}
                    disabled={locked}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [m.id]: { a: e.target.value, b: prev[m.id]?.b ?? draft.b } }))
                    }
                    placeholder="0"
                  />
                  <span className="text-slate-500">-</span>
                  <span
                    className={[
                      'max-w-18 rounded border px-1.5 py-0.5 text-center text-[11px] font-semibold',
                      bWon
                        ? 'border-emerald-800/70 bg-emerald-950/30 text-emerald-200'
                        : 'border-slate-700 bg-slate-900/60 text-slate-300',
                    ].join(' ')}
                    title={clubBText}
                  >
                    {clubBText}
                  </span>
                  <input
                    inputMode="numeric"
                    className={[
                      'w-14 rounded-md border px-2 py-1 text-right text-sm outline-none',
                      bWon ? 'border-emerald-700 bg-emerald-950/40 text-emerald-100' : 'border-slate-800 bg-slate-950/40 text-slate-100',
                      locked ? 'opacity-70' : '',
                    ].join(' ')}
                    value={showB}
                    disabled={locked}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [m.id]: { a: prev[m.id]?.a ?? draft.a, b: e.target.value } }))
                    }
                    placeholder="0"
                  />
                  {tournamentLocked ? (
                    <span className="rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1 text-xs font-medium text-slate-400">
                      Locked
                    </span>
                  ) : locked ? (
                    <button
                      className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-100 hover:bg-slate-700"
                      title="Unlock to edit"
                      onClick={() => {
                        actions.unlockMatch(m.id)
                        setDrafts((prev) => ({
                          ...prev,
                          [m.id]: { a: m.score?.a?.toString() ?? '', b: m.score?.b?.toString() ?? '' },
                        }))
                      }}
                    >
                      Edit
                    </button>
                  ) : (
                    <>
                      <button
                        className="rounded-md bg-emerald-800 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                        title="Commit score"
                        onClick={() => {
                          const nextA = parseScore(draft.a)
                          const nextB = parseScore(draft.b)
                          if (nextA === undefined || nextB === undefined) {
                            alert('Enter both scores before saving.')
                            return
                          }
                          actions.setScore(m.id, { a: nextA, b: nextB })
                          setDrafts((prev) => {
                            const next = { ...prev }
                            delete next[m.id]
                            return next
                          })
                        }}
                      >
                        Save
                      </button>
                    </>
                  )}
                  {tournamentLocked ? null : (
                    <button
                      className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-900 hover:text-white"
                      title="Reset score"
                      onClick={() => {
                        if (!confirm(`Reset score for ${rowId}?`)) return
                        actions.setScore(m.id, undefined)
                        setDrafts((prev) => {
                          const next = { ...prev }
                          delete next[m.id]
                          return next
                        })
                      }}
                    >
                      Reset
                    </button>
                  )}
                  {tournamentLocked ? null : (
                    <button
                      className="rounded-md px-2 py-1 text-xs font-semibold text-red-200 hover:bg-red-950/40"
                      title="Delete match"
                      onClick={() => {
                        if (!confirm(`Delete this match?\n\n${rowId}\n\nThis will remove it completely.`)) return
                        actions.deleteMatches([m.id])
                        setDrafts((prev) => {
                          const next = { ...prev }
                          delete next[m.id]
                          return next
                        })
                      }}
                    >
                      X
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          </div>
        </div>
      </div>
    </div>
  )
}

