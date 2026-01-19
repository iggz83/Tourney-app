import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { TournamentStoreProvider } from './store/tournamentStore.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <TournamentStoreProvider>
        <App />
      </TournamentStoreProvider>
    </HashRouter>
  </StrictMode>,
)
