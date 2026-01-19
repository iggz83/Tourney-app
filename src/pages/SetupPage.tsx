import { SEEDED_EVENTS, SKILL_DIVISIONS } from '../domain/constants'
import type { ClubId, EventType, PlayerId } from '../domain/types'
import { seedKey } from '../domain/keys'
import { useMemo, useState } from 'react'
import { useTournamentStore } from '../store/tournamentStore'
import { normalizeTournamentState } from '../store/tournamentStore'

function playerLabel(p: { firstName: string; lastName: string }) {
  const full = `${p.firstName} ${p.lastName}`.trim()
  return full.length ? full : '(unnamed)'
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function SetupPage() {
  const { state, actions } = useTournamentStore()
  const [divisionId, setDivisionId] = useState(state.divisions[0]?.id ?? SKILL_DIVISIONS[0].id)
  const [clubId, setClubId] = useState<ClubId>(state.clubs[0]?.id ?? 'NPC')
  const [importError, setImportError] = useState<string | null>(null)

  const playersForClub = useMemo(
    () => state.players.filter((p) => p.clubId === clubId && p.divisionId === divisionId),
    [state.players, clubId, divisionId],
  )

  const divisionConfig = useMemo(
    () => state.divisionConfigs.find((d) => d.divisionId === divisionId),
    [state.divisionConfigs, divisionId],
  )

  const seedsForClub = divisionConfig?.seedsByClub?.[clubId]

  function importFromFile(file: File) {
    setImportError(null)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const raw = String(reader.result ?? '')
        const parsed = JSON.parse(raw)
        const normalized = normalizeTournamentState(parsed)
        if (!normalized) throw new Error('Unsupported file format/version')
        actions.importState(normalized)
      } catch (e) {
        setImportError(e instanceof Error ? e.message : 'Import failed')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Setup</h1>
          <p className="text-sm text-slate-300">
            Edit rosters, map seeded teams for each division, then generate the schedule.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium hover:bg-slate-700"
            onClick={() => actions.generateSchedule()}
          >
            Generate schedule
          </button>
          <button
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium hover:bg-slate-700"
            onClick={() => download(`tourney-export-${new Date().toISOString().slice(0, 10)}.json`, actions.exportJson())}
          >
            Export JSON
          </button>
          <label className="cursor-pointer rounded-md bg-slate-800 px-3 py-2 text-sm font-medium hover:bg-slate-700">
            Import JSON
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) importFromFile(f)
                e.currentTarget.value = ''
              }}
            />
          </label>
          <button
            className="rounded-md border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900"
            onClick={() => {
              if (confirm('Reset everything? This clears rosters, mapping, and scores.')) actions.reset()
            }}
          >
            Reset
          </button>
        </div>
      </div>

      {importError ? (
        <div className="rounded-lg border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-200">
          {importError}
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Club Rosters</h2>
            <p className="text-sm text-slate-400">
              8 per club <span className="text-slate-500">(per division)</span> — 4 women, 4 men. Names are editable.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-300">
              <span className="mr-2 text-xs text-slate-400">Roster division</span>
              <select
                className="rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1 text-sm"
                value={divisionId}
                onChange={(e) => setDivisionId(e.target.value)}
              >
                {state.divisions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {state.clubs.map((club) => {
            const players = state.players.filter((p) => p.clubId === club.id && p.divisionId === divisionId)
            return (
              <div key={club.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-semibold">{club.name}</div>
                  <div className="text-xs text-slate-400">{players.length} players</div>
                </div>
                <div className="space-y-2">
                  {players.map((p) => (
                    <div key={p.id} className="grid grid-cols-12 gap-2">
                      <div className="col-span-2 rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1 text-xs text-slate-300">
                        {p.gender}
                      </div>
                      <input
                        className="col-span-5 rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1 text-sm text-slate-100 outline-none focus:border-slate-600"
                        value={p.firstName}
                        onChange={(e) => actions.updatePlayer(p.id, e.target.value, p.lastName)}
                        placeholder="First"
                      />
                      <input
                        className="col-span-5 rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1 text-sm text-slate-100 outline-none focus:border-slate-600"
                        value={p.lastName}
                        onChange={(e) => actions.updatePlayer(p.id, p.firstName, e.target.value)}
                        placeholder="Last"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Seeded Team Mapping</h2>
            <p className="text-sm text-slate-400">
              Select a division and club, then assign which two players represent each seed (Women #1/#2, Men #1/#2,
              Mixed #1–#4).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-slate-300">
              <span className="mr-2 text-xs text-slate-400">Division</span>
              <select
                className="rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1 text-sm"
                value={divisionId}
                onChange={(e) => setDivisionId(e.target.value)}
              >
                {state.divisions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-300">
              <span className="mr-2 text-xs text-slate-400">Club</span>
              <select
                className="rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1 text-sm"
                value={clubId}
                onChange={(e) => setClubId(e.target.value as ClubId)}
              >
                {state.clubs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="grid grid-cols-12 gap-2 bg-slate-900/60 px-3 py-2 text-xs font-semibold text-slate-300">
            <div className="col-span-3">Seed</div>
            <div className="col-span-4">Player 1</div>
            <div className="col-span-4">Player 2</div>
            <div className="col-span-1 text-right">Clear</div>
          </div>

          <div className="divide-y divide-slate-800 bg-slate-950/30">
            {SEEDED_EVENTS.map((ev) => {
              const k = seedKey(ev.eventType, ev.seed)
              const selected = seedsForClub?.[k]?.playerIds ?? [null, null]

              let allowed1 = playersForClub
              let allowed2 = playersForClub
              if (ev.eventType === 'WOMENS_DOUBLES') {
                allowed1 = playersForClub.filter((p) => p.gender === 'F')
                allowed2 = allowed1
              } else if (ev.eventType === 'MENS_DOUBLES') {
                allowed1 = playersForClub.filter((p) => p.gender === 'M')
                allowed2 = allowed1
              } else if (ev.eventType === 'MIXED_DOUBLES') {
                allowed1 = playersForClub.filter((p) => p.gender === 'F')
                allowed2 = playersForClub.filter((p) => p.gender === 'M')
              }

              const player1Id = selected[0] ?? ''
              const player2Id = selected[1] ?? ''

              return (
                <div key={k} className="grid grid-cols-12 items-center gap-2 px-3 py-2">
                  <div className="col-span-3 text-sm text-slate-100">{ev.label}</div>
                  <div className="col-span-4">
                    <select
                      className="w-full rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1 text-sm"
                      value={player1Id}
                      onChange={(e) => {
                        const next1 = (e.target.value || null) as PlayerId | null
                        const next2 = (player2Id || null) as PlayerId | null
                        actions.setSeed(
                          divisionId,
                          clubId,
                          ev.eventType as EventType,
                          ev.seed,
                          [next1, next2],
                        )
                      }}
                    >
                      <option value="">—</option>
                      {allowed1.map((p) => (
                        <option key={p.id} value={p.id}>
                          {playerLabel(p)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-4">
                    <select
                      className="w-full rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1 text-sm"
                      value={player2Id}
                      onChange={(e) => {
                        const next2 = (e.target.value || null) as PlayerId | null
                        const next1 = (player1Id || null) as PlayerId | null
                        actions.setSeed(
                          divisionId,
                          clubId,
                          ev.eventType as EventType,
                          ev.seed,
                          [next1, next2],
                        )
                      }}
                    >
                      <option value="">—</option>
                      {allowed2.map((p) => (
                        <option key={p.id} value={p.id}>
                          {playerLabel(p)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-1 text-right">
                    <button
                      className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-900 hover:text-white"
                      onClick={() => actions.setSeed(divisionId, clubId, ev.eventType as EventType, ev.seed, [null, null])}
                      title="Clear"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <div className="text-xs text-slate-500">
        <div>
          Matches generated: <span className="font-semibold text-slate-300">{state.matches.length}</span>
        </div>
        <div>Last updated: {new Date(state.updatedAt).toLocaleString()}</div>
      </div>
    </div>
  )
}

