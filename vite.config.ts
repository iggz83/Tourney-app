import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  return {
    // GitHub Pages project site: https://iggz83.github.io/Tourney-app/
    base: mode === 'production' ? '/Tourney-app/' : '/',
    plugins: [react(), tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
  }
})
