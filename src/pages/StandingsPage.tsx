import { useMemo } from 'react'
import { computeClubStandings, computeIndividualCoverage, computePlayerStandings } from '../domain/analytics'
import { useTournamentStore } from '../store/tournamentStore'

function fullName(p: { firstName: string; lastName: string }) {
  const s = `${p.firstName} ${p.lastName}`.trim()
  return s.length ? s : '(unnamed)'
}

export function StandingsPage() {
  const { state } = useTournamentStore()

  const clubStandings = useMemo(() => computeClubStandings(state), [state])
  const playerStandings = useMemo(() => computePlayerStandings(state), [state])
  const coverage = useMemo(() => computeIndividualCoverage(state), [state])

  const clubNameById = useMemo(() => new Map(state.clubs.map((c) => [c.id, c.name])), [state.clubs])
  const playerById = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players])

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
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="grid grid-cols-12 gap-2 bg-slate-900/60 px-3 py-2 text-xs font-semibold text-slate-300">
            <div className="col-span-1">#</div>
            <div className="col-span-3">Club</div>
            <div className="col-span-2 text-right">W</div>
            <div className="col-span-2 text-right">L</div>
            <div className="col-span-2 text-right">Diff</div>
            <div className="col-span-2 text-right">PF / PA</div>
          </div>
          <div className="divide-y divide-slate-800 bg-slate-950/30">
            {clubStandings.map((row, idx) => (
              <div key={row.clubId} className="grid grid-cols-12 items-center gap-2 px-3 py-2 text-sm">
                <div className="col-span-1 text-slate-400">{idx + 1}</div>
                <div className="col-span-3 font-semibold text-slate-100">{clubNameById.get(row.clubId) ?? row.clubId}</div>
                <div className="col-span-2 text-right text-slate-100">{row.wins}</div>
                <div className="col-span-2 text-right text-slate-300">{row.losses}</div>
                <div className="col-span-2 text-right font-semibold text-slate-100">
                  {row.pointDiff >= 0 ? `+${row.pointDiff}` : row.pointDiff}
                </div>
                <div className="col-span-2 text-right text-slate-300">
                  {row.pointsFor} / {row.pointsAgainst}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-base font-semibold">Top Individual Performers</h2>
          <div className="text-xs text-slate-400">Showing top 16 by wins, then point diff</div>
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
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="grid grid-cols-12 gap-2 bg-slate-900/60 px-3 py-2 text-xs font-semibold text-slate-300">
            <div className="col-span-1">#</div>
            <div className="col-span-6">
              <div>Player</div>
              <div className="mt-0.5 text-[11px] font-medium text-slate-400">PF / PA</div>
            </div>
            <div className="col-span-2">Club</div>
            <div className="col-span-1 text-right">W</div>
            <div className="col-span-1 text-right">L</div>
            <div className="col-span-2 text-right">Diff</div>
          </div>
          <div className="divide-y divide-slate-800 bg-slate-950/30">
            {playerStandings.slice(0, 16).map((row, idx) => {
              const p = playerById.get(row.playerId)
              return (
                <div key={row.playerId} className="grid grid-cols-12 items-center gap-2 px-3 py-2 text-sm">
                  <div className="col-span-1 text-slate-400">{idx + 1}</div>
                  <div className="col-span-6 min-w-0">
                    <div className="truncate font-semibold text-slate-100">{p ? fullName(p) : row.playerId}</div>
                    <div className="mt-0.5 text-xs tabular-nums text-slate-400">
                      {row.pointsFor} / {row.pointsAgainst}
                    </div>
                  </div>
                  <div className="col-span-2 text-slate-300">{clubNameById.get(row.clubId) ?? row.clubId}</div>
                  <div className="col-span-1 text-right tabular-nums text-slate-100">{row.wins}</div>
                  <div className="col-span-1 text-right tabular-nums text-slate-300">{row.losses}</div>
                  <div className="col-span-2 text-right tabular-nums font-semibold text-slate-100">
                    {row.pointDiff >= 0 ? `+${row.pointDiff}` : row.pointDiff}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <div className="text-xs text-slate-500">Updated: {new Date(state.updatedAt).toLocaleString()}</div>
    </div>
  )
}

