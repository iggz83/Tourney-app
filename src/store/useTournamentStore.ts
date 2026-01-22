import { createContext, useContext } from 'react'
import type { TournamentStore } from './tournamentStoreTypes'

export const TournamentStoreContext = createContext<TournamentStore | null>(null)

export function useTournamentStore(): TournamentStore {
  const v = useContext(TournamentStoreContext)
  if (!v) throw new Error('useTournamentStore must be used within TournamentStoreProvider')
  return v
}

