import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { computeClubStandings } from '../domain/analytics'
import { useTournamentStore } from '../store/useTournamentStore'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export function TvPage() {
  const { state, cloud } = useTournamentStore()
  const location = useLocation()
  const search = location.search || ''
  const scoresHref = search && search.startsWith('?') ? `/scores${search}` : '/scores'

  const clubStandings = useMemo(() => computeClubStandings(state), [state])
  const tournamentLocked = Boolean(state.tournamentLockedAt)

  // TV should use the full club names (configured in Setup -> Club Directory).
  const clubNameById = useMemo(() => new Map(state.clubs.map((c) => [c.id, c.name || c.id])), [state.clubs])

  const listRef = useRef<HTMLDivElement | null>(null)
  const [basePx, setBasePx] = useState<number>(24)
  const lastCommittedPxRef = useRef<number>(24)
  const isMeasuringRef = useRef<boolean>(false)
  const rafRef = useRef<number | null>(null)
  const debounceRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    const el = listRef.current
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
        const rect = el.getBoundingClientRect()
        const rows = Math.max(1, clubStandings.length)
        // Aim to fit all rows with gaps.
        const gapPx = 8 // gap-2
        const availableH = Math.max(0, rect.height - gapPx * Math.max(0, rows - 1))
        const rowH = availableH / rows
        // Account for vertical padding + line-height so letters with descenders (g, y, p, q) don't clip.
        const paddingY = 16 // py-2 = 8px top + 8px bottom
        // Use generous leading to avoid descender clipping on certain fonts / renderers.
        const lineH = 1.35
        const innerH = Math.max(0, rowH - paddingY)
        const next = clamp(innerH / lineH, 12, 200)

        const prev = lastCommittedPxRef.current
        if (Math.abs(prev - next) >= 0.75) {
          lastCommittedPxRef.current = next
          setBasePx(next)
        }
      } finally {
        isMeasuringRef.current = false
      }
    }

    // Initialize committed value so hysteresis has a stable baseline.
    lastCommittedPxRef.current = basePx
    scheduleMeasure()
    const ro = new ResizeObserver(() => {
      if (isMeasuringRef.current) return
      scheduleMeasure()
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [basePx, clubStandings.length])

  return (
    <div className="h-full overflow-hidden px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-4">
      <div className="flex h-full flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <div
            className="font-semibold tracking-wide text-slate-100"
            style={{ fontSize: `${clamp(basePx * 1.1, 16, 220)}px`, lineHeight: 1.05 }}
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
            Club Standings
          </div>
          <div className="text-slate-500 tabular-nums" style={{ fontSize: `${clamp(basePx * 0.55, 10, 40)}px` }}>
            Updated {new Date((cloud.enabled && cloud.lastSyncedAt) || state.updatedAt).toLocaleTimeString()}
          </div>
        </div>

        <div className="min-h-0 flex-1">
          <div ref={listRef} className="h-full">
            <div className="flex h-full flex-col gap-2">
              {clubStandings.map((row, idx) => (
                // When the tournament is locked, show medals for the top 3.
                // Keep alignment by using the same fixed-width rank column.
                <div
                  key={row.clubId}
                  className="grid w-full grid-cols-[1.3em_minmax(0,1fr)_3.8em_3.4em] items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/30 px-4 py-2"
                  style={{ fontSize: `${basePx}px`, lineHeight: 1.35 }}
                >
                  <div className="flex items-center justify-center font-bold text-slate-200">
                    {tournamentLocked && idx === 0 ? (
                      <span aria-label="Gold medal" title="1st">
                        🥇
                      </span>
                    ) : tournamentLocked && idx === 1 ? (
                      <span aria-label="Silver medal" title="2nd">
                        🥈
                      </span>
                    ) : tournamentLocked && idx === 2 ? (
                      <span aria-label="Bronze medal" title="3rd">
                        🥉
                      </span>
                    ) : (
                      idx + 1
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{clubNameById.get(row.clubId) ?? row.clubId}</div>
                  </div>
                  <div className="text-right tabular-nums font-bold">
                    {row.wins}
                    <span className="text-slate-500">-{row.losses}</span>
                  </div>
                  <div className="text-right tabular-nums font-semibold text-slate-200 whitespace-nowrap">
                    {row.pointDiff >= 0 ? `+${row.pointDiff}` : row.pointDiff}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

