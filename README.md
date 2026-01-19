# Inter-Club Pickleball Tournament Tracker

## Local dev

```bash
npm install
npm run dev
```

## Cloud sync (Supabase) – for live TV updates without HDMI

The app supports optional cloud sync via Supabase. When enabled, multiple devices opening the same `tid` will stay in sync (scores entered on a laptop will update `/tv` on a TV).

### 1) Create Supabase table + policies

In your Supabase project:
- Open **SQL Editor**
- Run the script at `supabase/schema.sql`

### 2) Get Supabase credentials

In Supabase:
- **Project Settings → API**
- Copy:
  - Project URL
  - `anon` public API key

### 3) Add local env vars

Create a `.env.local` in the project root:

```bash
VITE_SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
VITE_SUPABASE_ANON_KEY="YOUR_ANON_KEY"
```

### 4) Use cloud sync

Open the app with a tournament id:
- Local dev: `http://localhost:5173/#/standings?tid=YOUR_TOURNAMENT_ID`
- GitHub Pages: `https://iggz83.github.io/Tourney-app/#/standings?tid=YOUR_TOURNAMENT_ID`

Tip: Use a random id (UUID). Share the same link to the TV (or just `/tv?tid=...`).

## GitHub Pages

When deploying to GitHub Pages, you’ll need to provide the same `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` at build time (via GitHub Actions secrets or repository variables).
