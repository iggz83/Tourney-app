import { useMemo, useState } from 'react'
import { computeClubStandings, computeIndividualCoverage, computePlayerStandings } from '../domain/analytics'
import { useTournamentStore } from '../store/tournamentStore'

function fullName(p: { firstName: string; lastName: string }) {
  const s = `${p.firstName} ${p.lastName}`.trim()
  return s.length ? s : '(unnamed)'
}

function displayPlayerName(p: { firstName: string; lastName: string; clubId: string }) {
  // If firstName is the club acronym, hide it here.
  if (p.firstName.trim() === p.clubId) {
    const last = p.lastName.trim()
    return last.length ? last : '(unnamed)'
  }
  return fullName(p)
}

export function StandingsPage() {
  const { state } = useTournamentStore()
  const [showAll, setShowAll] = useState(false)

  const clubStandings = useMemo(() => computeClubStandings(state), [state])
  const playerStandings = useMemo(() => computePlayerStandings(state), [state])
  const coverage = useMemo(() => computeIndividualCoverage(state), [state])

  // Standings should use full club names (fallback to id).
  const clubNameById = useMemo(() => new Map(state.clubs.map((c) => [c.id, c.name || c.id])), [state.clubs])

  const playerStandingByPlayerId = useMemo(
    () => new Map(playerStandings.map((row) => [row.playerId, row] as const)),
    [playerStandings],
  )

  const performersByDivision = useMemo(() => {
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

      const men = state.players
        .filter((p) => p.divisionId === d.id && p.gender === 'M')
        .map((p) => ({ p, s: playerStandingByPlayerId.get(p.id)! }))
        .sort((x, y) => compare(x.s, y.s))

      return {
        division: d,
        women: showAll ? women : women.slice(0, 3),
        men: showAll ? men : men.slice(0, 3),
      }
    })
  }, [playerStandingByPlayerId, showAll, state.divisions, state.players])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Standings</h1>
        <p className="text-sm text-slate-300">
          Tie-breakers: total match wins, then point differential (points for − points against).
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Club Standings</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <div className="min-w-[720px]">
          <div className="grid grid-cols-12 gap-2 bg-slate-900/60 px-3 py-2 text-xs font-semibold text-slate-300">
            <div className="col-span-1">#</div>
            <div className="col-span-3">Club</div>
            <div className="col-span-2 text-right">W</div>
            <div className="col-span-2 text-right">L</div>
            <div className="col-span-2 text-right whitespace-nowrap">PF / PA</div>
            <div className="col-span-2 text-right whitespace-nowrap">Diff</div>
          </div>
          <div className="divide-y divide-slate-800 bg-slate-950/30">
            {clubStandings.map((row, idx) => (
              <div key={row.clubId} className="grid grid-cols-12 items-center gap-2 px-3 py-2 text-sm">
                <div className="col-span-1 text-slate-400">{idx + 1}</div>
                <div className="col-span-3 font-semibold text-slate-100">{clubNameById.get(row.clubId) ?? row.clubId}</div>
                <div className="col-span-2 text-right text-slate-100">{row.wins}</div>
                <div className="col-span-2 text-right text-slate-300">{row.losses}</div>
                <div className="col-span-2 text-right tabular-nums text-slate-300 whitespace-nowrap">
                  {row.pointsFor} / {row.pointsAgainst}
                </div>
                <div className="col-span-2 text-right tabular-nums font-semibold text-slate-100 whitespace-nowrap">
                  {row.pointDiff >= 0 ? `+${row.pointDiff}` : row.pointDiff}
                </div>
              </div>
            ))}
          </div>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-base font-semibold">
            {showAll ? 'All Individual Performers (by division)' : 'Top Individuals (Top 3 Women + Top 3 Men by division)'}
          </h2>
          <div className="flex items-center gap-2">
            <button
              className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-900"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? 'Show top 3 / division' : `Show all (${playerStandings.length})`}
            </button>
          </div>
        </div>
        {coverage.scoredMatches > 0 && coverage.scoredMatchesWithPlayerMapping < coverage.scoredMatches ? (
          <div className="rounded-lg border border-amber-900/50 bg-amber-950/40 p-3 text-sm text-amber-200">
            Individual stats are only computed for matches where <b>both clubs</b> have a full team mapping (2 players) for
            that seed/division. Currently counted:{' '}
            <b>
              {coverage.scoredMatchesWithPlayerMapping}/{coverage.scoredMatches}
            </b>{' '}
            scored matches.
          </div>
        ) : null}
        <div className="space-y-4">
          {performersByDivision.map(({ division, women, men }) => (
            <div key={division.id} className="rounded-xl border border-slate-800 bg-slate-900/20 p-4">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <div className="text-sm font-semibold text-slate-100">{division.name}</div>
                <div className="text-xs text-slate-500">{division.code}</div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="overflow-x-auto rounded-xl border border-slate-800">
                  <div className="min-w-[520px]">
                    <div className="flex items-center justify-between bg-slate-900/60 px-3 py-2 text-xs font-semibold text-slate-300">
                      <div>Top Women</div>
                      <div className="text-slate-500">{showAll ? 'All' : 'Top 3'}</div>
                    </div>
                    <div className="divide-y divide-slate-800 bg-slate-950/30">
                      {women.map(({ p, s }, idx) => (
                        <div key={p.id} className="grid grid-cols-12 items-center gap-2 px-3 py-2 text-sm">
                          <div className="col-span-1 text-slate-400">{idx + 1}</div>
                          <div className="col-span-5 min-w-0 truncate font-semibold text-slate-100">
                            {displayPlayerName(p)}
                          </div>
                          <div className="col-span-3 min-w-0 truncate text-slate-300">{clubNameById.get(p.clubId) ?? p.clubId}</div>
                          <div className="col-span-2 text-right tabular-nums text-slate-100 whitespace-nowrap">
                            {s.wins}
                            <span className="text-slate-500">-{s.losses}</span>
                          </div>
                          <div className="col-span-1 text-right tabular-nums font-semibold text-slate-100 whitespace-nowrap">
                            {s.pointDiff >= 0 ? `+${s.pointDiff}` : s.pointDiff}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-800">
                  <div className="min-w-[520px]">
                    <div className="flex items-center justify-between bg-slate-900/60 px-3 py-2 text-xs font-semibold text-slate-300">
                      <div>Top Men</div>
                      <div className="text-slate-500">{showAll ? 'All' : 'Top 3'}</div>
                    </div>
                    <div className="divide-y divide-slate-800 bg-slate-950/30">
                      {men.map(({ p, s }, idx) => (
                        <div key={p.id} className="grid grid-cols-12 items-center gap-2 px-3 py-2 text-sm">
                          <div className="col-span-1 text-slate-400">{idx + 1}</div>
                          <div className="col-span-5 min-w-0 truncate font-semibold text-slate-100">
                            {displayPlayerName(p)}
                          </div>
                          <div className="col-span-3 min-w-0 truncate text-slate-300">{clubNameById.get(p.clubId) ?? p.clubId}</div>
                          <div className="col-span-2 text-right tabular-nums text-slate-100 whitespace-nowrap">
                            {s.wins}
                            <span className="text-slate-500">-{s.losses}</span>
                          </div>
                          <div className="col-span-1 text-right tabular-nums font-semibold text-slate-100 whitespace-nowrap">
                            {s.pointDiff >= 0 ? `+${s.pointDiff}` : s.pointDiff}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="text-xs text-slate-500">Updated: {new Date(state.updatedAt).toLocaleString()}</div>
    </div>
  )
}

