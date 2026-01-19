import { useMemo } from 'react'
import { computeClubStandings, computePlayerStandings } from '../domain/analytics'
import { useTournamentStore } from '../store/tournamentStore'

function fullName(p: { firstName: string; lastName: string }) {
  const s = `${p.firstName} ${p.lastName}`.trim()
  return s.length ? s : '(unnamed)'
}

function displayPlayerName(p: { firstName: string; lastName: string; clubId: string }) {
  if (p.firstName.trim() === p.clubId) {
    const last = p.lastName.trim()
    return last.length ? last : '(unnamed)'
  }
  return fullName(p)
}

export function TvPage() {
  const { state } = useTournamentStore()

  const clubStandings = useMemo(() => computeClubStandings(state), [state])
  const playerStandings = useMemo(() => computePlayerStandings(state), [state])

  // TV should use the full club names (configured in Setup -> Club Directory).
  const clubNameById = useMemo(() => new Map(state.clubs.map((c) => [c.id, c.name || c.id])), [state.clubs])
  const playerById = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players])

  return (
    <div className="space-y-6 px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-wide">Live Standings</h1>
          <div className="text-sm text-slate-300">Wins → Point Differential</div>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="rounded-md border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900"
            onClick={async () => {
              try {
                if (document.fullscreenElement) await document.exitFullscreen()
                else await document.documentElement.requestFullscreen()
              } catch {
                // ignore
              }
            }}
          >
            Fullscreen
          </button>
          <div className="text-sm text-slate-400">{new Date(state.updatedAt).toLocaleTimeString()}</div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="mb-4 text-lg font-semibold">Club Standings</h2>
          <div className="space-y-3">
            {clubStandings.map((row, idx) => (
              <div
                key={row.clubId}
                className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/30 px-4 py-3"
              >
                <div className="flex items-center gap-4">
                  <div className="w-8 text-center text-xl font-bold text-slate-200">{idx + 1}</div>
                  <div>
                    <div className="text-xl font-semibold">{clubNameById.get(row.clubId) ?? row.clubId}</div>
                    <div className="text-sm text-slate-400">
                      PF {row.pointsFor} • PA {row.pointsAgainst}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold">
                    {row.wins}
                    <span className="text-slate-500">-{row.losses}</span>
                  </div>
                  <div className="text-lg font-semibold text-slate-200">
                    {row.pointDiff >= 0 ? `+${row.pointDiff}` : row.pointDiff}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="mb-4 text-lg font-semibold">Top Individuals</h2>
          <div className="space-y-2">
            {playerStandings.slice(0, 10).map((row, idx) => {
              const p = playerById.get(row.playerId)
              return (
                <div
                  key={row.playerId}
                  className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/30 px-4 py-3"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-8 text-center text-lg font-bold text-slate-300">{idx + 1}</div>
                    <div className="min-w-0">
                      <div className="truncate text-lg font-semibold">{p ? displayPlayerName(p) : row.playerId}</div>
                      <div className="text-sm text-slate-400">{clubNameById.get(row.clubId) ?? row.clubId}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold">
                      {row.wins}
                      <span className="text-slate-500">-{row.losses}</span>
                    </div>
                    <div className="text-sm font-semibold text-slate-200">
                      {row.pointDiff >= 0 ? `+${row.pointDiff}` : row.pointDiff}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}

