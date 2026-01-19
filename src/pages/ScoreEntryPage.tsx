import { useMemo, useState } from 'react'
import { SEEDED_EVENTS } from '../domain/constants'
import { computeMatch } from '../domain/analytics'
import { getDivisionConfig, getPlayersById, getMatchPlayerIdsForClub } from '../domain/selectors'
import type { Match, TournamentStateV2 } from '../domain/types'
import { useTournamentStore } from '../store/tournamentStore'

function fullName(p?: { firstName: string; lastName: string }) {
  if (!p) return '—'
  const s = `${p.firstName} ${p.lastName}`.trim()
  return s.length ? s : '—'
}

function displayPlayerName(p?: { firstName: string; lastName: string; clubId?: string }) {
  if (!p) return '—'
  if (p.clubId && p.firstName.trim() === p.clubId) {
    return p.lastName.trim().length ? p.lastName.trim() : '—'
  }
  return fullName(p)
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

export function ScoreEntryPage() {
  const { state, actions } = useTournamentStore()
  const [divisionId, setDivisionId] = useState<string>('all')
  const [round, setRound] = useState<'all' | string>('all')
  const [eventFilter, setEventFilter] = useState<string>('all')
  const [drafts, setDrafts] = useState<Record<string, { a: string; b: string }>>({})
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null)

  const playersById = useMemo(() => getPlayersById(state), [state])

  const baseFiltered = useMemo(() => {
    let ms = state.matches
    if (divisionId !== 'all') ms = ms.filter((m) => m.divisionId === divisionId)
    if (eventFilter !== 'all') {
      const [eventType, seedRaw] = eventFilter.split(':')
      const seed = Number(seedRaw)
      if (!isEventType(eventType) || !Number.isFinite(seed)) return []
      ms = ms.filter((m) => m.eventType === eventType && m.seed === seed)
    }
    return [...ms].sort(byMatchOrder)
  }, [state.matches, divisionId, eventFilter])

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

  function handlePrintFiltered() {
    const divisionLabel =
      divisionId === 'all' ? 'All divisions' : divisionNameById.get(divisionId) ?? divisionId
    const roundLabel = round === 'all' ? 'All rounds' : `Round ${round}`
    const eventLabelFilter =
      eventFilter === 'all'
        ? 'All events'
        : SEEDED_EVENTS.find((ev) => `${ev.eventType}:${ev.seed}` === eventFilter)?.label ?? eventFilter

    const rowsHtml = sorted
      .map((m) => {
        const divisionConfig = getDivisionConfig(state as TournamentStateV2, m.divisionId)
        const aPair = getMatchPlayerIdsForClub({ match: m, clubId: m.clubA, divisionConfig })
        const bPair = getMatchPlayerIdsForClub({ match: m, clubId: m.clubB, divisionConfig })
        const aNames = aPair ? aPair.map((id) => displayPlayerName(playersById.get(id))).join(' / ') : '—'
        const bNames = bPair ? bPair.map((id) => displayPlayerName(playersById.get(id))).join(' / ') : '—'

        const scoreA = m.score?.a ?? null
        const scoreB = m.score?.b ?? null
        const match = `${clubLabel.get(m.clubA) ?? m.clubA} vs ${clubLabel.get(m.clubB) ?? m.clubB}`
        const division = divisionNameById.get(m.divisionId) ?? m.divisionId
        const event = eventLabel(m)
        const players = `${aNames} | ${bNames}`

        const scoreHtml = `<div class="scoreBoxes">
  <div class="boxRow">
    <span class="teamTag">${escapeHtml(m.clubA)}</span>
    <span class="box">${scoreA === null ? '&nbsp;' : escapeHtml(String(scoreA))}</span>
  </div>
  <div class="boxRow">
    <span class="teamTag">${escapeHtml(m.clubB)}</span>
    <span class="box">${scoreB === null ? '&nbsp;' : escapeHtml(String(scoreB))}</span>
  </div>
</div>`

        const courtCell = m.court > 0 ? String(m.court) : ''

        return `<tr>
  <td style="text-align:right;">${m.round}</td>
  <td style="text-align:right;">${escapeHtml(courtCell)}</td>
  <td>${escapeHtml(division)}</td>
  <td>${escapeHtml(event)}</td>
  <td>${escapeHtml(match)}</td>
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
    <div class="hint"><b>Instructions:</b> Write scores in the boxes (team acronyms shown). Optional: circle the winning club in the <b>Match</b> column.</div>
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
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-slate-300">
            <span className="mr-2 text-xs text-slate-400">Division</span>
            <select
              className="rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-sm text-slate-100"
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
          <label className="text-sm text-slate-300">
            <span className="mr-2 text-xs text-slate-400">Round</span>
            <select
              className="rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-sm text-slate-100"
              value={round}
              onChange={(e) => {
                const v = e.target.value
                setRound(v)
              }}
            >
              <option value="all">All</option>
              {availableRounds.map((r) => (
                <option key={r} value={String(r)}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-300">
            <span className="mr-2 text-xs text-slate-400">Event</span>
            <select
              className="rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-sm text-slate-100"
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
            >
              <option value="all">All</option>
              {SEEDED_EVENTS.map((ev) => (
                <option key={`${ev.eventType}:${ev.seed}`} value={`${ev.eventType}:${ev.seed}`}>
                  {ev.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium hover:bg-slate-700"
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
            className="rounded-md border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900"
            onClick={handlePrintFiltered}
            title="Print the currently filtered rows"
          >
            Print
          </button>
          <button
            className="rounded-md border border-red-900/60 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-950/40"
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

            const locked = !!m.completedAt
            const draft = drafts[m.id] ?? { a: m.score?.a?.toString() ?? '', b: m.score?.b?.toString() ?? '' }
            const showA = locked ? (m.score?.a?.toString() ?? '') : draft.a
            const showB = locked ? (m.score?.b?.toString() ?? '') : draft.b

            const divCode = divisionCodeById.get(m.divisionId) ?? m.divisionId
            const evShort = eventLabel(m).replace(/\s+/g, '')
            const rowId = `${divCode}-R${m.round}-C${m.court}-${evShort}`

            return (
              <div key={m.id} className="grid grid-cols-[44px_54px_minmax(0,120px)_minmax(0,110px)_minmax(0,120px)_minmax(0,1fr)_230px] items-center gap-2 px-3 py-2 text-sm">
                {/* ID column removed (kept here in case we want to restore it later)
                  <div className="font-mono text-[11px] text-slate-400">{rowId}</div>
                */}
                <div className="text-slate-300">{m.round}</div>
                <div className="text-slate-300">{m.court > 0 ? m.court : '—'}</div>
                <div className="truncate text-slate-200">{divisionNameById.get(m.divisionId) ?? m.divisionId}</div>
                <div className="text-slate-200">{eventLabel(m)}</div>
                <div className="min-w-0">
                  <div className="truncate text-slate-100">
                    <span className={aWon ? 'font-semibold text-emerald-200' : ''}>{clubLabel.get(m.clubA)}</span>
                    <span className="mx-1 text-slate-500">vs</span>
                    <span className={bWon ? 'font-semibold text-emerald-200' : ''}>{clubLabel.get(m.clubB)}</span>
                  </div>
                </div>
                <div className="min-w-0 overflow-hidden">
                  <div className="truncate text-xs text-slate-300">
                    {aNames} <span className="text-slate-600">|</span> {bNames}
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
                  {locked ? (
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

