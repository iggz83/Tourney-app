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
    <div className="px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-4">
      <div className="mb-3 flex justify-end text-xs text-slate-500 tabular-nums sm:text-sm">
        Updated {new Date(state.updatedAt).toLocaleTimeString()}
      </div>

      <div className="grid gap-3">
        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 sm:p-4">
          {/* 2-column layout; keep all standings in the LEFT column and leave the RIGHT column empty */}
          <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-lg font-semibold sm:text-xl lg:text-2xl">Club Standings</h2>
                <div className="text-xs text-slate-500 sm:text-sm">W-L • Diff</div>
              </div>

              <div className="space-y-2">
              {clubStandings.map((row, idx) => (
                <div
                  key={row.clubId}
                  className="grid w-full grid-cols-[28px_minmax(0,1fr)_72px_60px] items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2 sm:grid-cols-[34px_minmax(0,1fr)_88px_72px] sm:gap-3 sm:px-4 sm:py-3 lg:grid-cols-[40px_minmax(0,1fr)_110px_90px]"
                >
                  <div className="text-center text-lg font-bold text-slate-200 sm:text-2xl lg:text-3xl">{idx + 1}</div>
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold sm:text-xl lg:text-3xl">
                      {clubNameById.get(row.clubId) ?? row.clubId}
                    </div>
                  </div>
                  <div className="text-right tabular-nums text-lg font-bold sm:text-2xl lg:text-3xl">
                    {row.wins}
                    <span className="text-slate-500">-{row.losses}</span>
                  </div>
                  <div className="text-right tabular-nums text-sm font-semibold text-slate-200 whitespace-nowrap sm:text-lg lg:text-2xl">
                    {row.pointDiff >= 0 ? `+${row.pointDiff}` : row.pointDiff}
                  </div>
                </div>
              ))}
              </div>
            </div>
            <div className="hidden lg:block" />
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 sm:p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">Top Individuals</h2>
            <div className="text-xs text-slate-500 sm:text-sm">Top 3 Women + Top 3 Men per division</div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {topByDivision.map(({ division, women, men }) => (
              <div key={division.id} className="rounded-lg border border-slate-800 bg-slate-950/20 p-3 sm:p-4">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <div className="text-base font-semibold text-slate-100 truncate">{division.name}</div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-sm font-semibold text-slate-300">Women</div>
                    <div className="space-y-1">
                      {women.map(({ p, s }, idx) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between gap-2 rounded-md bg-slate-950/30 px-2 py-1"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-5 text-center text-sm font-bold text-slate-300 sm:w-6 sm:text-base">
                              {idx + 1}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-slate-100 sm:text-base">
                                {displayPlayerName(p)}{' '}
                                <span className="text-slate-500 font-medium">({p.clubId})</span>
                              </div>
                            </div>
                          </div>
                          <div className="shrink-0 text-right tabular-nums text-xs text-slate-200 whitespace-nowrap sm:text-sm">
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
                        <div
                          key={p.id}
                          className="flex items-center justify-between gap-2 rounded-md bg-slate-950/30 px-2 py-1"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-5 text-center text-sm font-bold text-slate-300 sm:w-6 sm:text-base">
                              {idx + 1}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-slate-100 sm:text-base">
                                {displayPlayerName(p)}{' '}
                                <span className="text-slate-500 font-medium">({p.clubId})</span>
                              </div>
                            </div>
                          </div>
                          <div className="shrink-0 text-right tabular-nums text-xs text-slate-200 whitespace-nowrap sm:text-sm">
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

