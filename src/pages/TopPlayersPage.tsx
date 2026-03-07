import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { computePlayerStandings } from '../domain/analytics'
import { getPlayerName } from '../domain/playerName'
import { useTournamentStore } from '../store/useTournamentStore'

function hasPlayerName(p: { name?: string | null; firstName?: string | null; lastName?: string | null }) {
  return getPlayerName(p).trim().length > 0
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export function TopPlayersPage() {
  const { state, cloud } = useTournamentStore()
  const location = useLocation()
  const search = location.search || ''
  const scoresHref = search && search.startsWith('?') ? `/scores${search}` : '/scores'
  const TOP_N = 5
  const BASE_INIT = 18
  const BASE_MIN = 12
  const clubCodeById = useMemo(() => new Map(state.clubs.map((c) => [c.id, c.code || c.id])), [state.clubs])
  const hasTeamInDivision = useMemo(() => {
    return (divisionId: string, clubId: string) => {
      const dc = state.divisionConfigs.find((d) => d.divisionId === divisionId)
      return (dc?.clubEnabled?.[clubId] ?? true) !== false
    }
  }, [state.divisionConfigs])

  const playerStandings = useMemo(() => computePlayerStandings(state), [state])
  const playerStandingByPlayerId = useMemo(
    () => new Map(playerStandings.map((row) => [row.playerId, row] as const)),
    [playerStandings],
  )

  const [fitTopN, setFitTopN] = useState<number>(TOP_N)

  const topByDivision = useMemo(() => {
    const compare = (a: (typeof playerStandings)[number], b: (typeof playerStandings)[number]) => {
      if (b.wins !== a.wins) return b.wins - a.wins
      if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff
      return b.pointsFor - a.pointsFor
    }

    return state.divisions
      .map((d) => {
      const women = state.players
        .filter((p) => p.divisionId === d.id && p.gender === 'F' && hasPlayerName(p) && hasTeamInDivision(d.id, p.clubId))
        .map((p) => ({ p, s: playerStandingByPlayerId.get(p.id) }))
        .filter((x): x is { p: (typeof x)['p']; s: NonNullable<(typeof x)['s']> } => Boolean(x.s))
        .sort((x, y) => compare(x.s, y.s))
        .slice(0, fitTopN)

      const men = state.players
        .filter((p) => p.divisionId === d.id && p.gender === 'M' && hasPlayerName(p) && hasTeamInDivision(d.id, p.clubId))
        .map((p) => ({ p, s: playerStandingByPlayerId.get(p.id) }))
        .filter((x): x is { p: (typeof x)['p']; s: NonNullable<(typeof x)['s']> } => Boolean(x.s))
        .sort((x, y) => compare(x.s, y.s))
        .slice(0, fitTopN)

      return { division: d, women, men }
    })
      .filter((x) => x.women.length + x.men.length > 0)
  }, [fitTopN, hasTeamInDivision, playerStandingByPlayerId, state.divisions, state.players])

  const rootRef = useRef<HTMLDivElement | null>(null)
  const gridAreaRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [cols, setCols] = useState<number>(2)
  const lastCommittedPxRef = useRef<number>(BASE_INIT)
  const isMeasuringRef = useRef<boolean>(false)
  const rafRef = useRef<number | null>(null)
  const debounceRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    const el = gridAreaRef.current
    if (!el) return

    const scheduleMeasure = () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      debounceRef.current = window.setTimeout(() => {
        rafRef.current = requestAnimationFrame(() => measure())
      }, 90)
    }

    const measure = () => {
      if (isMeasuringRef.current) return
      isMeasuringRef.current = true
      try {
        const root = rootRef.current
        const grid = gridRef.current
        if (!root || !grid) return

        const rect = el.getBoundingClientRect()
        const W = rect.width
        const H = rect.height
        const N = Math.max(1, topByDivision.length)
        const maxCols = Math.min(N, 6)

        const activeCols = clamp(cols, 1, maxCols)
        if (activeCols !== cols) {
          setCols(activeCols)
          return
        }

        const r = Math.ceil(N / activeCols)
        const gapPx = 12 // gap-3
        const availableH = Math.max(0, H - gapPx * Math.max(0, r - 1))
        const availableW = Math.max(0, W - gapPx * Math.max(0, activeCols - 1))
        const cardH = availableH / r
        // Rough lines per card; we still verify by measuring.
        const lines = 3.6 + fitTopN * 2
        const fontByHeight = (cardH / lines) * 0.72
        const cardW = availableW / activeCols
        const fontByWidth = cardW / 32
        const bestGuess = Math.min(fontByHeight, fontByWidth)

        const setVar = (px: number) => {
          root.style.setProperty('--tp-base', String(px))
        }

        const fits = (px: number) => {
          setVar(px)
          // One reflow so scrollHeight is up-to-date.
          void grid.getBoundingClientRect()
          return grid.scrollHeight <= grid.clientHeight + 1
        }

        const canFitAtMin = fits(BASE_MIN)
        if (!canFitAtMin) {
          if (activeCols < maxCols) {
            setCols(activeCols + 1)
            return
          }
          if (fitTopN > 1) {
            setFitTopN((n) => n - 1)
            return
          }
          lastCommittedPxRef.current = BASE_MIN
          setVar(BASE_MIN)
          return
        }

        // Binary search the max font size that fits.
        const hi = clamp(bestGuess, BASE_MIN, 220)
        let lo = BASE_MIN
        let upper = hi
        for (let i = 0; i < 11; i++) {
          const mid = (lo + upper) / 2
          if (fits(mid)) lo = mid
          else upper = mid
        }

        const next = clamp(lo, BASE_MIN, 220)
        const prev = lastCommittedPxRef.current
        if (Math.abs(prev - next) >= 0.75) {
          lastCommittedPxRef.current = next
          setVar(next)
        } else {
          // Keep stable; prevent tiny oscillations.
          setVar(prev)
        }
      } finally {
        isMeasuringRef.current = false
      }
    }

    // Ensure the CSS var is set (so the first paint is reasonable).
    const root = rootRef.current
    if (root && !root.style.getPropertyValue('--tp-base')) {
      root.style.setProperty('--tp-base', String(BASE_INIT))
      lastCommittedPxRef.current = BASE_INIT
    }

    const ro = new ResizeObserver(() => {
      if (isMeasuringRef.current) return
      scheduleMeasure()
    })
    ro.observe(el)

    // Initial measurement after mount.
    scheduleMeasure()

    return () => {
      ro.disconnect()
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [BASE_INIT, BASE_MIN, TOP_N, cols, fitTopN, topByDivision.length])

  return (
    <div
      ref={rootRef}
      className="h-full overflow-hidden px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-4"
      style={{ ['--tp-base' as never]: BASE_INIT }}
    >
      <div className="flex h-full flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <div
            className="font-semibold tracking-wide text-slate-100"
            style={{ fontSize: 'clamp(16px, calc(var(--tp-base) * 1.15 * 1px), 240px)', lineHeight: 1.05 }}
          >
            <Link
              to={scoresHref}
              aria-label="Go to Scores"
              title="Go to Scores"
              className="mr-2 inline-block text-slate-100 hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 rounded"
              style={{ fontSize: '1em', lineHeight: 'inherit' }}
            >
              🏆
            </Link>
            Top Players
          </div>
          <div
            className="text-slate-500 tabular-nums"
            style={{ fontSize: 'clamp(10px, calc(var(--tp-base) * 0.55 * 1px), 40px)' }}
          >
            Updated {new Date((cloud.enabled && cloud.lastSyncedAt) || state.updatedAt).toLocaleTimeString()}
          </div>
        </div>

        <div ref={gridAreaRef} className="min-h-0 flex-1 overflow-hidden">
          <div
            ref={gridRef}
            className="grid h-full gap-3"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              fontSize: 'calc(var(--tp-base) * 1px)',
              lineHeight: 1.05,
            }}
          >
            {topByDivision.map(({ division, women, men }) => (
              <div key={division.id} className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
                <div
                  className="mb-3 truncate font-semibold text-slate-100"
                  style={{ fontSize: 'clamp(14px, calc(var(--tp-base) * 1.05 * 1px), 240px)' }}
                >
                  {division.name}
                </div>

                <div className="grid gap-3">
                  {women.length > 0 ? (
                  <div>
                    <div
                      className="mb-2 font-semibold text-slate-300"
                      style={{ fontSize: 'clamp(12px, calc(var(--tp-base) * 0.9 * 1px), 180px)' }}
                    >
                      Women
                    </div>
                    <div className="grid gap-2">
                      {women.map(({ p, s }, idx) => (
                        <div key={p.id} className="grid grid-cols-[1.3em_minmax(0,1fr)_6.8em] items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                          <div className="text-center font-bold text-slate-300">{idx + 1}</div>
                          <div className="min-w-0 truncate font-semibold text-slate-100">
                            {getPlayerName(p)}{' '}
                            <span className="text-slate-500 font-medium">({clubCodeById.get(p.clubId) ?? p.clubId})</span>
                          </div>
                          <div className="text-right tabular-nums text-slate-200 whitespace-nowrap">
                            {s.wins}-{s.losses} • {s.pointDiff >= 0 ? `+${s.pointDiff}` : s.pointDiff}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  ) : null}

                  {men.length > 0 ? (
                  <div>
                    <div
                      className="mb-2 font-semibold text-slate-300"
                      style={{ fontSize: 'clamp(12px, calc(var(--tp-base) * 0.9 * 1px), 180px)' }}
                    >
                      Men
                    </div>
                    <div className="grid gap-2">
                      {men.map(({ p, s }, idx) => (
                        <div key={p.id} className="grid grid-cols-[1.3em_minmax(0,1fr)_6.8em] items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                          <div className="text-center font-bold text-slate-300">{idx + 1}</div>
                          <div className="min-w-0 truncate font-semibold text-slate-100">
                            {getPlayerName(p)}{' '}
                            <span className="text-slate-500 font-medium">({clubCodeById.get(p.clubId) ?? p.clubId})</span>
                          </div>
                          <div className="text-right tabular-nums text-slate-200 whitespace-nowrap">
                            {s.wins}-{s.losses} • {s.pointDiff >= 0 ? `+${s.pointDiff}` : s.pointDiff}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

