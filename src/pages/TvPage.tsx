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
  }, [playerStandingByPlayerId, state.divisions, state.players])

  return (
    <div className="px-6 py-4">
      <div className="mb-3 flex justify-end text-sm text-slate-500 tabular-nums">
        Updated {new Date(state.updatedAt).toLocaleTimeString()}
      </div>

      <div className="grid gap-3">
        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Club Standings</h2>
            <div className="text-sm text-slate-500">W-L • Diff</div>
          </div>

          {/* Keep Club Standings rows to ~half the screen width so it visually aligns with the 2-column performers layout */}
          <div className="w-full max-w-[50vw] space-y-2">
            {clubStandings.map((row, idx) => (
              <div
                key={row.clubId}
                className="grid grid-cols-[40px_minmax(0,520px)_100px_80px] items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/30 px-4 py-3"
              >
                <div className="text-center text-xl font-bold text-slate-200">{idx + 1}</div>
                <div className="min-w-0">
                  <div className="truncate text-lg font-semibold">{clubNameById.get(row.clubId) ?? row.clubId}</div>
                </div>
                <div className="text-right tabular-nums text-2xl font-bold">
                  {row.wins}
                  <span className="text-slate-500">-{row.losses}</span>
                </div>
                <div className="text-right tabular-nums text-base font-semibold text-slate-200 whitespace-nowrap">
                  {row.pointDiff >= 0 ? `+${row.pointDiff}` : row.pointDiff}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Top Individuals</h2>
            <div className="text-sm text-slate-500">Top 3 Women + Top 3 Men per division</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {topByDivision.map(({ division, women, men }) => (
              <div key={division.id} className="rounded-lg border border-slate-800 bg-slate-950/20 p-4">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <div className="text-base font-semibold text-slate-100 truncate">{division.name}</div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="mb-1 text-sm font-semibold text-slate-300">Women</div>
                    <div className="space-y-1">
                      {women.map(({ p, s }, idx) => (
                        <div key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-950/30 px-2 py-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 text-center text-base font-bold text-slate-300">{idx + 1}</div>
                            <div className="min-w-0">
                              <div className="truncate text-base font-semibold text-slate-100">
                                {displayPlayerName(p)}{' '}
                                <span className="text-slate-500 font-medium">({p.clubId})</span>
                              </div>
                            </div>
                          </div>
                          <div className="shrink-0 text-right tabular-nums text-sm text-slate-200 whitespace-nowrap">
                            {s.wins}-{s.losses} • {s.pointDiff >= 0 ? `+${s.pointDiff}` : s.pointDiff}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 text-sm font-semibold text-slate-300">Men</div>
                    <div className="space-y-1">
                      {men.map(({ p, s }, idx) => (
                        <div key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-950/30 px-2 py-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 text-center text-base font-bold text-slate-300">{idx + 1}</div>
                            <div className="min-w-0">
                              <div className="truncate text-base font-semibold text-slate-100">
                                {displayPlayerName(p)}{' '}
                                <span className="text-slate-500 font-medium">({p.clubId})</span>
                              </div>
                            </div>
                          </div>
                          <div className="shrink-0 text-right tabular-nums text-sm text-slate-200 whitespace-nowrap">
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

