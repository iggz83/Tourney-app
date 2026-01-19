import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  return {
    // GitHub Pages project site: https://iggz83.github.io/Tourney-app/
    base: mode === 'production' ? '/Tourney-app/' : '/',
    plugins: [react(), tailwindcss()],
  }
})
