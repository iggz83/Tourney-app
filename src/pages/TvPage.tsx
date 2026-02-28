import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { computeClubStandings } from '../domain/analytics'
import { useTournamentStore } from '../store/useTournamentStore'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function sameNumRecord(a: Record<string, number>, b: Record<string, number>, eps = 0.025) {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    const av = a[k]
    const bv = b[k]
    if (av === undefined || bv === undefined) return false
    if (Math.abs(av - bv) > eps) return false
  }
  return true
}

export function TvPage() {
  const { state, cloud } = useTournamentStore()
  const location = useLocation()
  const search = location.search || ''
  const scoresHref = search && search.startsWith('?') ? `/scores${search}` : '/scores'

  const clubStandings = useMemo(() => computeClubStandings(state), [state])
  const tournamentLocked = Boolean(state.tournamentLockedAt)

  const clubCodeById = useMemo(() => new Map(state.clubs.map((c) => [c.id, c.code || c.id])), [state.clubs])
  // TV should use the full club names (configured in Setup -> Club Directory), falling back to club acronym (code).
  const clubNameById = useMemo(
    () => new Map(state.clubs.map((c) => [c.id, (c.name ?? '').trim() ? c.name : (c.code || c.id)])),
    [state.clubs],
  )

  const listRef = useRef<HTMLDivElement | null>(null)
  const [basePx, setBasePx] = useState<number>(24)
  const lastCommittedPxRef = useRef<number>(24)
  const isMeasuringRef = useRef<boolean>(false)
  const rafRef = useRef<number | null>(null)
  const debounceRef = useRef<number | null>(null)
  const [nameScaleByClubId, setNameScaleByClubId] = useState<Record<string, number>>({})

  // Make names more readable from far away by scaling them up slightly
  // while keeping stats a bit tighter.
  const NAME_SCALE = 1.22
  const STAT_SCALE = 0.96

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

    const measureNameScale = () => {
      const nodes = el.querySelectorAll<HTMLElement>('[data-role="club-name-cell"][data-club-id]')
      const next: Record<string, number> = {}
      nodes.forEach((cell) => {
        const clubId = cell.getAttribute('data-club-id') || ''
        if (!clubId) return
        const full = cell.querySelector<HTMLElement>('[data-role="club-fullname-measure"]')
        if (!full) return
        const containerW = cell.clientWidth
        const fullW = full.offsetWidth
        if (containerW <= 0 || fullW <= 0) {
          next[clubId] = 1
          return
        }
        // Fit longer team names by shrinking just the name text (single line).
        // Clamp so names don't become unreadably tiny.
        const ratio = (containerW - 2) / fullW
        next[clubId] = clamp(ratio, 0.62, 1)
      })
      setNameScaleByClubId((prev) => (sameNumRecord(prev, next) ? prev : next))
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

        // After basePx is applied, compute per-team name scaling to avoid truncation.
        requestAnimationFrame(() => measureNameScale())
      } finally {
        isMeasuringRef.current = false
      }
    }

    // Initialize committed value so hysteresis has a stable baseline.
    if (!Number.isFinite(lastCommittedPxRef.current) || lastCommittedPxRef.current <= 0) lastCommittedPxRef.current = basePx
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
  }, [clubStandings.length, state.clubs])

  return (
    <div className="h-full overflow-hidden px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-4">
      <div className="flex h-full flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <div
            className="font-semibold tracking-wide text-slate-100"
            style={{ fontSize: 'clamp(18px, 5vw, 240px)', lineHeight: 1.05 }}
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
          <div className="text-slate-500 tabular-nums" style={{ fontSize: 'clamp(10px, 1.7vw, 64px)' }}>
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
                  className="grid w-full grid-cols-[1.3em_minmax(0,1fr)_max-content] items-center gap-4 rounded-lg border border-slate-800 bg-slate-950/30 px-4 py-2"
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
                  <div className="min-w-0 relative" data-role="club-name-cell" data-club-id={row.clubId}>
                    <div
                      className="truncate font-black tracking-wide"
                      style={{
                        fontSize: `${basePx * NAME_SCALE * (nameScaleByClubId[row.clubId] ?? 1)}px`,
                        lineHeight: 1.05,
                      }}
                    >
                      {clubNameById.get(row.clubId) ?? clubCodeById.get(row.clubId) ?? row.clubId}
                    </div>
                    {/* Hidden measure span: unscaled, used to compute the shrink ratio */}
                    <span
                      className="absolute -z-10 invisible whitespace-nowrap font-black tracking-wide"
                      style={{ fontSize: `${basePx * NAME_SCALE}px`, lineHeight: 1.05 }}
                      data-role="club-fullname-measure"
                    >
                      {clubNameById.get(row.clubId) ?? clubCodeById.get(row.clubId) ?? row.clubId}
                    </span>
                  </div>
                  <div
                    className="text-right tabular-nums whitespace-nowrap"
                    style={{ fontSize: `${basePx * STAT_SCALE}px`, lineHeight: 1.05 }}
                  >
                    <span className="font-extrabold text-slate-100">
                      {row.wins}
                      <span className="text-slate-500">-{row.losses}</span>
                    </span>
                    <span className="mx-3 text-slate-700">•</span>
                    <span className="ml-2 font-extrabold text-slate-200">
                      {row.pointDiff >= 0 ? `+${row.pointDiff}` : row.pointDiff}
                    </span>
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

