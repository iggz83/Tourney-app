import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { SetupPage } from './pages/SetupPage'
import { ScoreEntryPage } from './pages/ScoreEntryPage'
import { StandingsPage } from './pages/StandingsPage'
import { TvPage } from './pages/TvPage'

function withSearch(pathname: string, search: string) {
  return search && search.startsWith('?') ? `${pathname}${search}` : pathname
}

function Shell({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const isTv = location.pathname.startsWith('/tv')
  const search = location.search || ''

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-wide text-slate-200">
              Inter-Club Pickleball Tournament Tracker
            </div>
            <div className="truncate text-xs text-slate-400">4 Clubs • 3 Rounds • Multi-division standings</div>
          </div>
          <nav className="flex shrink-0 items-center gap-1 text-sm">
            <TopNav to={withSearch('/setup', search)}>Setup</TopNav>
            <TopNav to={withSearch('/scores', search)}>Scores</TopNav>
            <TopNav to={withSearch('/standings', search)}>Standings</TopNav>
            <TopNav to={withSearch('/tv', search)}>TV</TopNav>
          </nav>
        </div>
      </header>
      <main className={isTv ? 'mx-auto max-w-none px-0 py-0' : 'mx-auto max-w-7xl px-4 py-6'}>{children}</main>
    </div>
  )
}

function TopNav({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          'rounded-md px-3 py-1.5',
          isActive ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-900 hover:text-white',
        ].join(' ')
      }
    >
      {children}
    </NavLink>
  )
}

export default function App() {
  const location = useLocation()
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Navigate to={withSearch('/standings', location.search || '')} replace />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/scores" element={<ScoreEntryPage />} />
        <Route path="/standings" element={<StandingsPage />} />
        <Route path="/tv" element={<TvPage />} />
      </Routes>
    </Shell>
  )
}
