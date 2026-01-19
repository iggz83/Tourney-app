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

export function ScoreEntryPage() {
  const { state, actions } = useTournamentStore()
  const [divisionId, setDivisionId] = useState<string>('all')
  const [round, setRound] = useState<'all' | '1' | '2' | '3'>('all')
  const [drafts, setDrafts] = useState<Record<string, { a: string; b: string }>>({})

  const playersById = useMemo(() => getPlayersById(state), [state])

  const filtered = useMemo(() => {
    let ms = state.matches
    if (divisionId !== 'all') ms = ms.filter((m) => m.divisionId === divisionId)
    if (round !== 'all') ms = ms.filter((m) => String(m.round) === round)
    return [...ms].sort(byMatchOrder)
  }, [state.matches, divisionId, round])

  const divisionNameById = useMemo(() => new Map(state.divisions.map((d) => [d.id, d.name])), [state.divisions])
  // Non-TV view uses acronyms (club ids) even if full names are configured for TV.
  const clubLabel = useMemo(() => new Map(state.clubs.map((c) => [c.id, c.id])), [state.clubs])

  const scheduleMissing = state.matches.length === 0

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
              className="rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1 text-sm"
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
              className="rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1 text-sm"
              value={round}
              onChange={(e) => setRound(e.target.value as any)}
            >
              <option value="all">All</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </label>
          <button
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium hover:bg-slate-700"
            onClick={() => actions.generateSchedule()}
          >
            Generate schedule
          </button>
        </div>
      </div>

      {scheduleMissing ? (
        <div className="rounded-lg border border-amber-900/50 bg-amber-950/40 p-3 text-sm text-amber-200">
          No matches yet. Click <b>Generate schedule</b> to create matches.
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-800">
        <div className="grid grid-cols-12 gap-2 bg-slate-900/60 px-3 py-2 text-xs font-semibold text-slate-300">
          <div className="col-span-1">R</div>
          <div className="col-span-1">Ct</div>
          <div className="col-span-2">Division</div>
          <div className="col-span-2">Event</div>
          <div className="col-span-2">Match</div>
          <div className="col-span-2">Players</div>
          <div className="col-span-2 text-right">Score</div>
        </div>

        <div className="divide-y divide-slate-800 bg-slate-950/30">
          {filtered.map((m) => {
            const computed = computeMatch(m)
            const divisionConfig = getDivisionConfig(state as TournamentStateV2, m.divisionId)
            const aPair = getMatchPlayerIdsForClub({ match: m, clubId: m.clubA, divisionConfig })
            const bPair = getMatchPlayerIdsForClub({ match: m, clubId: m.clubB, divisionConfig })
            const aNames = aPair ? aPair.map((id) => fullName(playersById.get(id))).join(' / ') : '—'
            const bNames = bPair ? bPair.map((id) => fullName(playersById.get(id))).join(' / ') : '—'

            const aWon = computed.winnerClubId === m.clubA
            const bWon = computed.winnerClubId === m.clubB

            const locked = !!m.completedAt
            const draft = drafts[m.id] ?? { a: m.score?.a?.toString() ?? '', b: m.score?.b?.toString() ?? '' }
            const showA = locked ? (m.score?.a?.toString() ?? '') : draft.a
            const showB = locked ? (m.score?.b?.toString() ?? '') : draft.b

            return (
              <div key={m.id} className="grid grid-cols-12 items-center gap-2 px-3 py-2 text-sm">
                <div className="col-span-1 text-slate-300">{m.round}</div>
                <div className="col-span-1 text-slate-300">{m.court}</div>
                <div className="col-span-2 truncate text-slate-200">{divisionNameById.get(m.divisionId) ?? m.divisionId}</div>
                <div className="col-span-2 text-slate-200">{eventLabel(m)}</div>
                <div className="col-span-2">
                  <div className="truncate text-slate-100">
                    <span className={aWon ? 'font-semibold text-emerald-200' : ''}>{clubLabel.get(m.clubA)}</span>
                    <span className="mx-1 text-slate-500">vs</span>
                    <span className={bWon ? 'font-semibold text-emerald-200' : ''}>{clubLabel.get(m.clubB)}</span>
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="truncate text-xs text-slate-300">
                    {aNames} <span className="text-slate-600">|</span> {bNames}
                  </div>
                </div>
                <div className="col-span-2 flex items-center justify-end gap-2">
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
                            const { [m.id]: _, ...rest } = prev
                            return rest
                          })
                        }}
                      >
                        Save
                      </button>
                      <button
                        className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-900 hover:text-white"
                        title="Clear draft"
                        onClick={() => setDrafts((prev) => ({ ...prev, [m.id]: { a: '', b: '' } }))}
                      >
                        Clear
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

