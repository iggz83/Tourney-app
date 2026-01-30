import { useEffect, useMemo, useRef, useState } from 'react'
import { SEEDED_EVENTS } from '../domain/constants'
import { computeMatch } from '../domain/analytics'
import { getPlayerName, getPlayerNameOr } from '../domain/playerName'
import { getDivisionConfig, getPlayersById, getMatchPlayerIdsForClub } from '../domain/selectors'
import type { Match, TournamentStateV2 } from '../domain/types'
import { useTournamentStore } from '../store/useTournamentStore'

function displayPlayerName(p?: { name?: string | null; firstName?: string | null; lastName?: string | null }) {
  return getPlayerNameOr(p, '—')
}

function eventLabel(match: Match) {
  return SEEDED_EVENTS.find((e) => e.eventType === match.eventType && e.seed === match.seed)?.label ?? `${match.eventType} #${match.seed}`
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
  return a.seed - b.seed
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
  const { state, actions } = useTournamentStore()
  const [divisionId, setDivisionId] = useState<string>('all')
  const [round, setRound] = useState<'all' | string>('all')
  const [eventFilters, setEventFilters] = useState<string[]>([])
  const [eventFilterOpen, setEventFilterOpen] = useState<boolean>(false)
  const [needsScoresOnly, setNeedsScoresOnly] = useState<boolean>(false)
  const [team1, setTeam1] = useState<string>('all')
  const [team2, setTeam2] = useState<string>('all')
  const [quickSearch, setQuickSearch] = useState<string>('')
  const [fullLineupsOnly, setFullLineupsOnly] = useState<boolean>(false)
  const [drafts, setDrafts] = useState<Record<string, { a: string; b: string }>>({})
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null)
  const eventFilterRef = useRef<HTMLDetailsElement | null>(null)
  const totalMatches = state.matches.length
  const tournamentLocked = Boolean(state.tournamentLockedAt)

  const playersById = useMemo(() => getPlayersById(state), [state])

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
      const divisionConfig = getDivisionConfig({ divisionConfigs: state.divisionConfigs } as TournamentStateV2, m.divisionId)
      const aPair = getMatchPlayerIdsForClub({ match: m, clubId: m.clubA, divisionConfig })
      const bPair = getMatchPlayerIdsForClub({ match: m, clubId: m.clubB, divisionConfig })
      if (!aPair || !bPair) return false
      return isNamedPlayer(aPair[0]) && isNamedPlayer(aPair[1]) && isNamedPlayer(bPair[0]) && isNamedPlayer(bPair[1])
    }
  }, [isNamedPlayer, state.divisionConfigs])

  const baseFiltered = useMemo(() => {
    let ms = state.matches
    if (divisionId !== 'all') ms = ms.filter((m) => m.divisionId === divisionId)
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
      ms = ms.filter((m) => {
        const divisionConfig = getDivisionConfig({ divisionConfigs: state.divisionConfigs } as TournamentStateV2, m.divisionId)
        const aPair = getMatchPlayerIdsForClub({ match: m, clubId: m.clubA, divisionConfig })
        const bPair = getMatchPlayerIdsForClub({ match: m, clubId: m.clubB, divisionConfig })
        const aNames = aPair ? aPair.map((id) => displayPlayerName(playersById.get(id))).join(' / ') : '—'
        const bNames = bPair ? bPair.map((id) => displayPlayerName(playersById.get(id))).join(' / ') : '—'
        const hay = [
          divisionNameById.get(m.divisionId) ?? m.divisionId,
          divisionCodeById.get(m.divisionId) ?? '',
          String(m.round),
          String(m.court),
          eventLabel(m),
          m.clubA,
          m.clubB,
          `${m.clubA} vs ${m.clubB}`,
          aNames,
          bNames,
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
    state.matches,
    state.divisionConfigs,
    state.divisions,
    divisionId,
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
    if (round === 'all') return baseFiltered
    const n = Number(round)
    if (!Number.isFinite(n)) return baseFiltered
    return baseFiltered.filter((m) => m.round === n)
  }, [baseFiltered, round])

  const divisionNameById = useMemo(() => new Map(state.divisions.map((d) => [d.id, d.name])), [state.divisions])
  const divisionCodeById = useMemo(() => new Map(state.divisions.map((d) => [d.id, d.code])), [state.divisions])
  // Non-TV view uses acronyms (club ids) even if full names are configured for TV.
  const clubLabel = useMemo(() => new Map(state.clubs.map((c) => [c.id, c.id])), [state.clubs])
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
      const evA = eventLabel(a)
      const evB = eventLabel(b)
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
          const divisionConfigA = getDivisionConfig(state as TournamentStateV2, a.divisionId)
          const divisionConfigB = getDivisionConfig(state as TournamentStateV2, b.divisionId)
          const aPairA = getMatchPlayerIdsForClub({ match: a, clubId: a.clubA, divisionConfig: divisionConfigA })
          const bPairA = getMatchPlayerIdsForClub({ match: a, clubId: a.clubB, divisionConfig: divisionConfigA })
          const aPairB = getMatchPlayerIdsForClub({ match: b, clubId: b.clubA, divisionConfig: divisionConfigB })
          const bPairB = getMatchPlayerIdsForClub({ match: b, clubId: b.clubB, divisionConfig: divisionConfigB })
          const aNamesA = aPairA ? aPairA.map((id) => displayPlayerName(playersById.get(id))).join(' / ') : '—'
          const bNamesA = bPairA ? bPairA.map((id) => displayPlayerName(playersById.get(id))).join(' / ') : '—'
          const aNamesB = aPairB ? aPairB.map((id) => displayPlayerName(playersById.get(id))).join(' / ') : '—'
          const bNamesB = bPairB ? bPairB.map((id) => displayPlayerName(playersById.get(id))).join(' / ') : '—'
          res = cmp(`${aNamesA} | ${bNamesA}`, `${aNamesB} | ${bNamesB}`)
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

  // Close the Event dropdown when clicking outside (or pressing Escape).
  useEffect(() => {
    if (!eventFilterOpen) return

    const onPointerDown = (e: PointerEvent) => {
      const el = eventFilterRef.current
      if (!el) return
      const target = e.target
      if (!(target instanceof Node)) return
      if (el.contains(target)) return
      setEventFilterOpen(false)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEventFilterOpen(false)
    }

    // Use capture so we see the event before other handlers potentially stop propagation.
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [eventFilterOpen])

  function handlePrintFiltered() {
    const divisionLabel =
      divisionId === 'all' ? 'All divisions' : divisionNameById.get(divisionId) ?? divisionId
    const roundLabel = round === 'all' ? 'All rounds' : `Round ${round}`
    const eventLabelFilter = (() => {
      if (!eventFilters.length) return 'All events'
      const labels = eventFilters
        .map((v) => SEEDED_EVENTS.find((ev) => `${ev.eventType}:${ev.seed}` === v)?.label ?? v)
        .filter(Boolean)
      return labels.length ? labels.join(', ') : 'All events'
    })()

    const rowsHtml = sorted
      .map((m) => {
        const divisionConfig = getDivisionConfig(state as TournamentStateV2, m.divisionId)
        const aPair = getMatchPlayerIdsForClub({ match: m, clubId: m.clubA, divisionConfig })
        const bPair = getMatchPlayerIdsForClub({ match: m, clubId: m.clubB, divisionConfig })
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
        const event = eventLabel(m)
        const players = `${aNames} | ${bNames}`

        const scoreHtml = `<div class="scoreBoxes">
  <div class="boxRow">
    <span class="teamTag ${serveA ? 'serveFirst' : ''}">${escapeHtml(m.clubA)}</span>
    <span class="box">${scoreA === null ? '&nbsp;' : escapeHtml(String(scoreA))}</span>
  </div>
  <div class="boxRow">
    <span class="teamTag ${!serveA ? 'serveFirst' : ''}">${escapeHtml(m.clubB)}</span>
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
  <td>${escapeHtml(players)}</td>
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
      td:nth-child(1) { width: 44px; }
      td:nth-child(2) { width: 56px; }
      td:nth-child(3) { width: 120px; }
      td:nth-child(4) { width: 110px; }
      td:nth-child(5) { width: 120px; }
      td:nth-child(7) { width: 130px; }
      .small { color: #64748b; }
      .scoreBoxes { display: grid; gap: 4px; }
      .boxRow { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
      .teamTag { font-weight: 700; font-size: 11px; color: #0f172a; }
      .vs { color: #64748b; }
      .serveFirst { font-weight: 900; }
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
              'rounded-md border border-red-900/60 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-950/40',
              tournamentLocked ? 'cursor-not-allowed opacity-50 hover:bg-transparent' : '',
            ].join(' ')}
            disabled={tournamentLocked}
            onClick={() => {
              const incomplete = state.matches.filter((m) => !hasFullLineup(m))
              if (incomplete.length === 0) {
                alert('No games with missing players found.')
                return
              }
              if (
                !confirm(
                  `Delete games with missing players?\n\nThis will permanently delete ${incomplete.length} match(es) where all 4 players are not filled (named).\n\nContinue?`,
                )
              )
                return
              actions.deleteMatches(incomplete.map((m) => m.id))
              setDrafts({})
            }}
            title="Removes matches with missing players"
          >
            Delete games with missing players
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
              setDivisionId('all')
              setRound('all')
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
          <label className="text-sm text-slate-300 lg:col-span-3">
            <div className="mb-1 text-xs text-slate-400">Division</div>
            <select
              className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
              value={divisionId}
              onChange={(e) => setDivisionId(e.target.value)}
            >
              <option value="all">All</option>
              {state.divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-300 lg:col-span-3">
            <div className="mb-1 text-xs text-slate-400">Round</div>
            <select
              className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
              value={round}
              onChange={(e) => setRound(e.target.value)}
            >
              <option value="all">All</option>
              {availableRounds.map((r) => (
                <option key={r} value={String(r)}>
                  {r}
                </option>
              ))}
            </select>
          </label>

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
                    ? SEEDED_EVENTS.find((ev) => `${ev.eventType}:${ev.seed}` === eventFilters[0])?.label ?? eventFilters[0]
                    : `${eventFilters.length} selected`}
                <span className="float-right text-slate-400 group-open:rotate-180">▾</span>
              </summary>
              <div className="absolute z-20 mt-1 w-full min-w-[220px] rounded-md border border-slate-700 bg-slate-950 p-2 shadow-lg">
                <div className="max-h-56 overflow-auto pr-1">
                  {SEEDED_EVENTS.map((ev) => {
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
            <div className="flex min-h-[40px] flex-wrap items-center gap-2">
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
        </div>
      </div>

      {scheduleMissing ? (
        <div className="rounded-lg border border-amber-900/50 bg-amber-950/40 p-3 text-sm text-amber-200">
          No matches yet. Click <b>Generate schedule</b> to create matches.
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <div className="min-w-[1200px]">
          {/* ID column removed (kept here in case we want to restore it later)
            grid-cols-[120px_44px_54px_minmax(0,120px)_minmax(0,110px)_minmax(0,120px)_minmax(0,1fr)_230px]
            <div className="whitespace-nowrap">{headerButton('ID', 'id')}</div>
          */}
          <div className="grid grid-cols-[44px_54px_minmax(0,120px)_minmax(0,110px)_minmax(0,120px)_minmax(0,1fr)_230px] gap-2 bg-slate-900/60 px-3 py-2 text-xs font-semibold text-slate-300">
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
            const divisionConfig = getDivisionConfig(state as TournamentStateV2, m.divisionId)
            const aPair = getMatchPlayerIdsForClub({ match: m, clubId: m.clubA, divisionConfig })
            const bPair = getMatchPlayerIdsForClub({ match: m, clubId: m.clubB, divisionConfig })
            const aNames = aPair ? aPair.map((id) => displayPlayerName(playersById.get(id))).join(' / ') : '—'
            const bNames = bPair ? bPair.map((id) => displayPlayerName(playersById.get(id))).join(' / ') : '—'

            const aWon = computed.winnerClubId === m.clubA
            const bWon = computed.winnerClubId === m.clubB

            const locked = tournamentLocked || !!m.completedAt
            const draft = drafts[m.id] ?? { a: m.score?.a?.toString() ?? '', b: m.score?.b?.toString() ?? '' }
            const showA = locked ? (m.score?.a?.toString() ?? '') : draft.a
            const showB = locked ? (m.score?.b?.toString() ?? '') : draft.b

            const divCode = divisionCodeById.get(m.divisionId) ?? m.divisionId
            const evShort = eventLabel(m).replace(/\s+/g, '')
            const rowId = `${divCode}-R${m.round}-C${m.court}-${evShort}`

            const divisionText = divisionNameById.get(m.divisionId) ?? m.divisionId
            const eventText = eventLabel(m)
            const clubAText = clubLabel.get(m.clubA) ?? m.clubA
            const clubBText = clubLabel.get(m.clubB) ?? m.clubB
            const playersText = `${aNames} | ${bNames}`

            return (
              <div key={m.id} className="grid grid-cols-[44px_54px_minmax(0,120px)_minmax(0,110px)_minmax(0,120px)_minmax(0,1fr)_230px] items-center gap-2 px-3 py-2 text-sm">
                {/* ID column removed (kept here in case we want to restore it later)
                  <div className="font-mono text-[11px] text-slate-400">{rowId}</div>
                */}
                <div className="text-slate-300">{highlightText(String(m.round), highlightNeedle)}</div>
                <div className="text-slate-300">{highlightText(m.court > 0 ? String(m.court) : '—', highlightNeedle)}</div>
                <div className="truncate text-slate-200">{highlightText(divisionText, highlightNeedle)}</div>
                <div className="text-slate-200">{highlightText(eventText, highlightNeedle)}</div>
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
                  <div className="truncate text-xs text-slate-300">
                    {highlightText(playersText, highlightNeedle)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center justify-end gap-2">
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
                        setDrafts((prev) => ({ ...prev, [m.id]: { a: '', b: '' } }))
                      }}
                    >
                      Reset
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

