import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { TournamentStoreProvider } from './store/tournamentStore.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <TournamentStoreProvider>
        <App />
      </TournamentStoreProvider>
    </BrowserRouter>
  </StrictMode>,
)
