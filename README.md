# PBMatchEngine (MVP)

A lightweight, modern, responsive **pickleball match engine** that runs as a static web app (no server required).

## What you can do right now
- Add and save players (stored locally on your device)
- Create sessions (singles or doubles)
- Generate a schedule that **biases toward unique matchups**
- Enter scores
- View standings
- Export a **DUPR-style CSV** (generic schema; adjustable when you confirm DUPR’s latest upload format)
- Download/import a backup JSON to move data between devices

## Run it (easy options)
### Option A: Just open it
- Double-click `index.html`

This works for most features.

### Option B (recommended): Run a tiny local web server
Some browser features behave better when served over `http://localhost`.

1. Open PowerShell in this project folder
2. Run:
   - `python -m http.server 5500`
3. Open in your browser:
   - `http://localhost:5500`

## Basic workflow
1. Go to **Players** and add everyone
2. Go to **Session** and create a session
3. Click **Generate schedule**
4. Go to **Scores** to enter results
5. Go to **Standings** to see rankings
6. Go to **Export** to download CSV

## Notes about authentication (important)
The current **Settings → Require access code** is an MVP “gate” for a static site. It helps prevent casual access on a shared device, but it is **not real authentication**.

For real club licensing/authentication (and logins per player), we’ll add a backend (e.g., Firebase, Supabase, or a custom API) later.
