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
  const playerStandingByPlayerId = useMemo(
    () => new Map(playerStandings.map((row) => [row.playerId, row] as const)),
    [playerStandings],
  )

  const topByDivision = useMemo(() => {
    const compare = (a: (typeof playerStandings)[number], b: (typeof playerStandings)[number]) => {
      if (b.wins !== a.wins) return b.wins - a.wins
      if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff
      return b.pointsFor - a.pointsFor
    }

    return state.divisions.map((d) => {
      const women = state.players
        .filter((p) => p.divisionId === d.id && p.gender === 'F')
        .map((p) => ({ p, s: playerStandingByPlayerId.get(p.id)! }))
        .sort((x, y) => compare(x.s, y.s))
        .slice(0, 3)

      const men = state.players
        .filter((p) => p.divisionId === d.id && p.gender === 'M')
        .map((p) => ({ p, s: playerStandingByPlayerId.get(p.id)! }))
        .sort((x, y) => compare(x.s, y.s))
        .slice(0, 3)

      return { division: d, women, men }
    })
  }, [playerStandingByPlayerId, playerStandings, state.divisions, state.players])

  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex justify-end text-xs text-slate-500 tabular-nums">
        Updated {new Date(state.updatedAt).toLocaleTimeString()}
      </div>

      <div className="grid grid-cols-12 gap-3">
        <section className="col-span-5 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-semibold">Club Standings</h2>
            <div className="text-xs text-slate-500">W-L • Diff</div>
          </div>

          <div className="space-y-2">
            {clubStandings.map((row, idx) => (
              <div
                key={row.clubId}
                className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-7 text-center text-lg font-bold text-slate-200">{idx + 1}</div>
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold">{clubNameById.get(row.clubId) ?? row.clubId}</div>
                  </div>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <div className="text-xl font-bold">
                    {row.wins}
                    <span className="text-slate-500">-{row.losses}</span>
                  </div>
                  <div className="text-sm font-semibold text-slate-200">
                    {row.pointDiff >= 0 ? `+${row.pointDiff}` : row.pointDiff}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="col-span-7 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-semibold">Top Individuals</h2>
            <div className="text-xs text-slate-500">Top 3 Women + Top 3 Men per division</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {topByDivision.map(({ division, women, men }) => (
              <div key={division.id} className="rounded-lg border border-slate-800 bg-slate-950/20 p-3">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-100 truncate">{division.name}</div>
                  <div className="text-xs text-slate-500">{division.code}</div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-300">Women</div>
                    <div className="space-y-1">
                      {women.map(({ p, s }, idx) => (
                        <div key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-950/30 px-2 py-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-5 text-center text-sm font-bold text-slate-300">{idx + 1}</div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-slate-100">
                                {displayPlayerName(p)}{' '}
                                <span className="text-slate-500 font-medium">
                                  ({clubNameById.get(p.clubId) ?? p.clubId})
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="shrink-0 text-right tabular-nums text-xs text-slate-200 whitespace-nowrap">
                            {s.wins}-{s.losses} • {s.pointDiff >= 0 ? `+${s.pointDiff}` : s.pointDiff}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-300">Men</div>
                    <div className="space-y-1">
                      {men.map(({ p, s }, idx) => (
                        <div key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-950/30 px-2 py-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-5 text-center text-sm font-bold text-slate-300">{idx + 1}</div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-slate-100">
                                {displayPlayerName(p)}{' '}
                                <span className="text-slate-500 font-medium">
                                  ({clubNameById.get(p.clubId) ?? p.clubId})
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="shrink-0 text-right tabular-nums text-xs text-slate-200 whitespace-nowrap">
                            {s.wins}-{s.losses} • {s.pointDiff >= 0 ? `+${s.pointDiff}` : s.pointDiff}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

