import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { SetupPage } from './pages/SetupPage'
import { ScoreEntryPage } from './pages/ScoreEntryPage'
import { StandingsPage } from './pages/StandingsPage'
import { TvPage } from './pages/TvPage'

function Shell({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const isTv = location.pathname.startsWith('/tv')

  if (isTv) {
    return <div className="min-h-dvh bg-slate-950 text-slate-100">{children}</div>
  }

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-wide text-slate-200">
              Inter-Club Pickleball Tournament Tracker
            </div>
            <div className="truncate text-xs text-slate-400">4 Clubs • 3 Rounds • Multi-division standings</div>
          </div>
          <nav className="flex shrink-0 items-center gap-1 text-sm">
            <TopNav to="/setup">Setup</TopNav>
            <TopNav to="/scores">Scores</TopNav>
            <TopNav to="/standings">Standings</TopNav>
            <TopNav to="/tv">TV</TopNav>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
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
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Navigate to="/standings" replace />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/scores" element={<ScoreEntryPage />} />
        <Route path="/standings" element={<StandingsPage />} />
        <Route path="/tv" element={<TvPage />} />
      </Routes>
    </Shell>
  )
}
