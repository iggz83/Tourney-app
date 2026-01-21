import { SEEDED_EVENTS, SKILL_DIVISIONS } from '../domain/constants'
import type { ClubId, EventType, PlayerId } from '../domain/types'
import { seedKey } from '../domain/keys'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTournamentStore } from '../store/tournamentStore'
import { normalizeTournamentState } from '../store/normalizeTournamentState'
import { CommitInput } from '../components/CommitInput'
import {
  clearTournamentIdFromUrl,
  ensureTournamentIdInUrl,
  getTournamentIdFromUrl,
  setCloudEnabledInUrl,
  setTournamentIdInUrl,
  shouldEnableCloudSync,
} from '../store/cloudSync'
import { deleteTournament, fetchTournamentName, listTournaments, type TournamentListItem, updateTournamentName } from '../store/cloudSync'

function playerLabel(p: { firstName: string; lastName: string }) {
  const full = `${p.firstName} ${p.lastName}`.trim()
  return full.length ? full : '(unnamed)'
}

function rosterSlotLabel(p: { id: string; gender: 'M' | 'F' }) {
  // Player ids are like: <divisionId>:<clubId>:W1 or ...:M4
  const m = /:(W|M)(\d)$/.exec(p.id)
  const n = m ? m[2] : p.id.slice(-1)
  const prefix = p.gender === 'F' ? 'W' : 'M'
  return `${prefix}${n}`
}

function rosterSortKey(p: { id: string; gender: 'M' | 'F' }) {
  const m = /:(W|M)(\d)$/.exec(p.id)
  const n = m ? Number(m[2]) : Number(p.id.slice(-1))
  const num = Number.isFinite(n) ? n : 99
  // Women first, then Men; each in numeric order.
  return (p.gender === 'F' ? 0 : 1) * 10 + num
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function SetupPage() {
  const { state, actions } = useTournamentStore()
  const [divisionId, setDivisionId] = useState(state.divisions[0]?.id ?? SKILL_DIVISIONS[0].id)
  const [clubId, setClubId] = useState<ClubId>(state.clubs[0]?.id ?? '')
  const [importError, setImportError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedTopPlayers, setCopiedTopPlayers] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [tournaments, setTournaments] = useState<TournamentListItem[]>([])
  const [tournamentName, setTournamentName] = useState<string>('')
  const [newClubCode, setNewClubCode] = useState<string>('')
  const [newClubName, setNewClubName] = useState<string>('')
  const prevTidRef = useRef<string | null>(null)

  const playersForClub = useMemo(
    () => state.players.filter((p) => p.clubId === clubId && p.divisionId === divisionId),
    [state.players, clubId, divisionId],
  )

  const divisionConfig = useMemo(
    () => state.divisionConfigs.find((d) => d.divisionId === divisionId),
    [state.divisionConfigs, divisionId],
  )

  const seedsForClub = divisionConfig?.seedsByClub?.[clubId]

  const tid = getTournamentIdFromUrl()
  const cloudEnabled = shouldEnableCloudSync()

  // Keep selected club valid if clubs list changes (add/remove).
  useEffect(() => {
    if (clubId && state.clubs.some((c) => c.id === clubId)) return
    setClubId(state.clubs[0]?.id ?? '')
  }, [clubId, state.clubs])

  const clubEnabledForDivision = (cid: ClubId) => (divisionConfig?.clubEnabled?.[cid] ?? true) !== false

  useEffect(() => {
    if (!cloudEnabled || !tid) return
    let cancelled = false
    if (prevTidRef.current && prevTidRef.current !== tid) {
      setTournamentName('')
    }
    void fetchTournamentName(tid).then((name) => {
      if (cancelled) return
      const remote = (name ?? '').trim()
      if (remote.length) setTournamentName(remote)
      // If remote name is empty, keep whatever the user typed locally (avoid clearing on enable).
    })
    return () => {
      cancelled = true
      prevTidRef.current = tid
    }
  }, [cloudEnabled, tid])

  function importFromFile(file: File) {
    setImportError(null)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const raw = String(reader.result ?? '')
        const parsed = JSON.parse(raw)
        const normalized = normalizeTournamentState(parsed)
        if (!normalized) throw new Error('Unsupported file format/version')
        actions.importState(normalized)
      } catch (e) {
        setImportError(e instanceof Error ? e.message : 'Import failed')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Setup</h1>
          <p className="text-sm text-slate-300">
            Edit rosters, map seeded teams for each division, then generate the schedule.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium hover:bg-slate-700"
            onClick={() => {
              if (
                state.matches.length > 0 &&
                !confirm(
                  'Regenerate schedule?\n\nThis will DELETE the current schedule and CLEAR ALL SCORES.\nUse this if you want to start over.\n\nContinue?',
                )
              )
                return
              actions.regenerateSchedule()
            }}
          >
            Generate schedule
          </button>
          <button
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium hover:bg-slate-700"
            onClick={() => download(`tourney-export-${new Date().toISOString().slice(0, 10)}.json`, actions.exportJson())}
          >
            Export JSON
          </button>
          <label className="cursor-pointer rounded-md bg-slate-800 px-3 py-2 text-sm font-medium hover:bg-slate-700">
            Import JSON
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) importFromFile(f)
                e.currentTarget.value = ''
              }}
            />
          </label>
          <button
            className="rounded-md border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900"
            onClick={() => {
              if (confirm('Reset everything? This clears rosters, mapping, and scores.')) actions.reset()
            }}
          >
            Reset
          </button>
        </div>
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Cloud Sync (Supabase)</div>
            <div className="text-sm text-slate-300">
              Tournament ID (tid):{' '}
              <span className="font-mono text-slate-100">{getTournamentIdFromUrl() ?? '— not set —'}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="text-xs font-semibold text-slate-400">Name</div>
              <input
                className="w-72 max-w-full rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1 text-sm text-slate-100 outline-none focus:border-slate-600"
                placeholder="e.g. 2026 Inter-Club Finals"
                value={tournamentName}
                onChange={(e) => setTournamentName(e.target.value)}
                onBlur={() => {
                  const currentTid = getTournamentIdFromUrl()
                  if (!currentTid) return
                  if (!shouldEnableCloudSync()) return
                  void updateTournamentName(currentTid, tournamentName.trim())
                }}
              />
            </div>
            <div className="text-xs text-slate-400">
              Share the same link (same <span className="font-mono">tid</span>) to the scoring device and the TV.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium hover:bg-slate-700"
              onClick={() => {
                const nextTid = ensureTournamentIdInUrl()
                setCloudEnabledInUrl(true)
                if (tournamentName.trim().length) void updateTournamentName(nextTid, tournamentName.trim())
              }}
            >
              {shouldEnableCloudSync() ? 'Sync enabled' : 'Enable sync + generate tid'}
            </button>
            {shouldEnableCloudSync() ? (
              <button
                className="rounded-md border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900"
                onClick={() => {
                  if (
                    !confirm(
                      'Start a new tournament?\n\nThis creates a new Tournament ID (tid) and switches this browser to it.\nYour existing tournament remains saved in Supabase.\n\nWe will keep your setup (clubs/rosters/mapping) but clear matches/scores.',
                    )
                  )
                    return

                  const newTid = crypto.randomUUID()
                  // Keep setup but clear matches/scores for the new tournament
                  actions.importState({
                    ...state,
                    matches: [],
                    updatedAt: new Date().toISOString(),
                  })
                  setTournamentName('')
                  setTournamentIdInUrl(newTid)
                  setCloudEnabledInUrl(true)
                }}
              >
                New tournament
              </button>
            ) : null}
            <button
              className="rounded-md border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900"
              onClick={async () => {
                ensureTournamentIdInUrl()
                try {
                  const u = new URL(window.location.href)
                  // Always include cloud=1 for the shared TV link.
                  if (u.hash.includes('#/')) {
                    const parts = u.hash.split('?')
                    const queryPart = parts.length > 1 ? parts[1] : ''
                    const sp = new URLSearchParams(queryPart ?? '')
                    sp.set('cloud', '1')
                    // force TV route
                    u.hash = `#/tv?${sp.toString()}`
                  } else {
                    u.searchParams.set('cloud', '1')
                    u.pathname = u.pathname.replace(/\/setup\/?$/, '/tv')
                    if (!u.pathname.endsWith('/tv')) u.pathname = '/tv'
                  }
                  await navigator.clipboard.writeText(u.toString())
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1000)
                } catch {
                  // ignore
                }
              }}
            >
              {copied ? 'Copied!' : 'Copy TV link'}
            </button>
            <button
              className="rounded-md border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900"
              onClick={async () => {
                ensureTournamentIdInUrl()
                try {
                  const u = new URL(window.location.href)
                  // Always include cloud=1 for the shared Top Players link.
                  if (u.hash.includes('#/')) {
                    const parts = u.hash.split('?')
                    const queryPart = parts.length > 1 ? parts[1] : ''
                    const sp = new URLSearchParams(queryPart ?? '')
                    sp.set('cloud', '1')
                    // force Top Players route
                    u.hash = `#/top-players?${sp.toString()}`
                  } else {
                    u.searchParams.set('cloud', '1')
                    u.pathname = u.pathname.replace(/\/setup\/?$/, '/top-players')
                    if (!u.pathname.endsWith('/top-players')) u.pathname = '/top-players'
                  }
                  await navigator.clipboard.writeText(u.toString())
                  setCopiedTopPlayers(true)
                  setTimeout(() => setCopiedTopPlayers(false), 1000)
                } catch {
                  // ignore
                }
              }}
            >
              {copiedTopPlayers ? 'Copied!' : 'Copy Top Players link'}
            </button>
            <button
              className="rounded-md border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900"
              onClick={async () => {
                setPickerOpen(true)
                setPickerError(null)
                setPickerLoading(true)
                try {
                  const rows = await listTournaments(50)
                  setTournaments(rows)
                } catch (e) {
                  setPickerError(e instanceof Error ? e.message : 'Failed to load tournaments')
                } finally {
                  setPickerLoading(false)
                }
              }}
            >
              Load / Delete…
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Club Directory</h2>
          <p className="text-sm text-slate-400">Set the full club names (TV view uses full names).</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {state.clubs.map((c) => (
            <div key={c.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-100">{c.code}</div>
                 <button
                   className="rounded-md border border-red-900/60 px-2 py-1 text-xs font-medium text-red-200 hover:bg-red-950/40"
                   onClick={() => {
                     if (!confirm(`Remove club ${c.id}?\n\nThis will remove its roster, mappings, and any matches involving it.`)) return
                     actions.removeClub(c.id)
                   }}
                   title="Remove club"
                 >
                   Remove
                 </button>
              </div>
              <label className="block text-xs font-semibold text-slate-400">Full name</label>
              <CommitInput
                className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1 text-sm text-slate-100 outline-none focus:border-slate-600"
                placeholder="e.g. North Pickleball Club"
                value={c.name}
                onCommit={(next) => actions.setClubName(c.id, next)}
              />
            </div>
          ))}
        </div>

         <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
           <div className="mb-2 text-sm font-semibold text-slate-100">Add club</div>
           <div className="grid gap-2 md:grid-cols-3">
             <input
               className="rounded-md border border-slate-800 bg-slate-950/40 px-2 py-2 text-sm text-slate-100 outline-none focus:border-slate-600"
               placeholder="Acronym (e.g. ABC)"
               value={newClubCode}
               onChange={(e) => setNewClubCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
             />
             <input
               className="rounded-md border border-slate-800 bg-slate-950/40 px-2 py-2 text-sm text-slate-100 outline-none focus:border-slate-600"
               placeholder="Full name (optional)"
               value={newClubName}
               onChange={(e) => setNewClubName(e.target.value)}
             />
             <button
               className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
               disabled={!newClubCode.trim().length}
               onClick={() => {
                 const code = newClubCode.trim()
                 if (!code) return
                 if (state.clubs.some((c) => c.id === code)) {
                   alert(`Club ${code} already exists.`)
                   return
                 }
                 // Don't prepopulate club full name; if left blank, keep it blank.
                 actions.addClub(code, newClubName.trim())
                 setNewClubCode('')
                 setNewClubName('')
                 setClubId(code)
               }}
             >
               Add
             </button>
           </div>
           <div className="mt-2 text-xs text-slate-500">Tip: use a short unique acronym; it becomes the club id.</div>
         </div>
      </section>

      

      {pickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">Tournaments</div>
                <div className="text-xs text-slate-400">Load an existing tournament or delete it (delete is permanent).</div>
              </div>
              <button
                className="rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-900 hover:text-white"
                onClick={() => setPickerOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="p-4">
              {pickerError ? (
                <div className="mb-3 rounded-lg border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-200">
                  {pickerError}
                </div>
              ) : null}
              {pickerLoading ? (
                <div className="text-sm text-slate-300">Loading…</div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-slate-800">
                  <div className="grid grid-cols-12 gap-2 bg-slate-900/60 px-3 py-2 text-xs font-semibold text-slate-300">
                    <div className="col-span-3">Name</div>
                    <div className="col-span-5">Tournament ID</div>
                    <div className="col-span-2">Updated</div>
                    <div className="col-span-2 text-right">Actions</div>
                  </div>
                  <div className="divide-y divide-slate-800 bg-slate-950/30">
                    {tournaments.map((t) => (
                      <div key={t.id} className="grid grid-cols-12 items-center gap-2 px-3 py-2 text-sm">
                        <div className="col-span-3 truncate text-sm font-semibold text-slate-100">
                          {t.name?.trim()?.length ? t.name : <span className="text-slate-500">(unnamed)</span>}
                        </div>
                        <div className="col-span-5 font-mono text-xs text-slate-200">{t.id}</div>
                        <div className="col-span-2 text-xs text-slate-400">{new Date(t.updated_at).toLocaleDateString()}</div>
                        <div className="col-span-2 flex justify-end gap-2">
                          <button
                            className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium hover:bg-slate-700"
                            onClick={() => {
                              setTournamentIdInUrl(t.id)
                              setPickerOpen(false)
                            }}
                          >
                            Load
                          </button>
                          <button
                            className="rounded-md border border-red-900/60 px-3 py-1.5 text-sm font-medium text-red-200 hover:bg-red-950/40"
                            onClick={async () => {
                              if (!confirm(`Delete tournament ${t.id}? This cannot be undone.`)) return
                              try {
                                await deleteTournament(t.id)
                                setTournaments((prev) => prev.filter((x) => x.id !== t.id))
                                if (getTournamentIdFromUrl() === t.id) {
                                  actions.reset()
                                  clearTournamentIdFromUrl()
                                  setPickerOpen(false)
                                }
                              } catch (e) {
                                alert(e instanceof Error ? e.message : 'Delete failed')
                              }
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                    {tournaments.length === 0 ? (
                      <div className="px-3 py-6 text-sm text-slate-400">No tournaments found.</div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {importError ? (
        <div className="rounded-lg border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-200">
          {importError}
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Club Rosters</h2>
            <p className="text-sm text-slate-400">
              8 per club <span className="text-slate-500">(per division)</span> — 4 women, 4 men. Names are editable.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-300">
              <span className="mr-2 text-xs text-slate-400">Roster division</span>
              <select
                className="rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-sm text-slate-100"
                value={divisionId}
                onChange={(e) => setDivisionId(e.target.value)}
              >
                {state.divisions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {state.clubs.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4 text-sm text-slate-300">
            No clubs yet. Add a club above to create roster slots.
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          {state.clubs.map((club) => {
            const enabled = clubEnabledForDivision(club.id)
            const players = state.players
              .filter((p) => p.clubId === club.id && p.divisionId === divisionId)
              .slice()
              .sort((a, b) => rosterSortKey(a) - rosterSortKey(b))
            return (
              <div key={club.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-semibold">{club.name}</div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => actions.setDivisionClubEnabled(divisionId, club.id, e.target.checked)}
                      />
                      Has team
                    </label>
                    <div className="text-xs text-slate-400">{players.length} players</div>
                  </div>
                </div>
                {!enabled ? (
                  <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-3 text-sm text-slate-300">
                    No team for this division. This club will be excluded from schedule generation for this division.
                  </div>
                ) : (
                <div className="space-y-2">
                  {players.map((p) => (
                    <div key={p.id} className="grid grid-cols-12 gap-2">
                      <div className="col-span-1 rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1 text-center text-xs font-semibold text-slate-200">
                        {rosterSlotLabel(p)}
                      </div>
                      <div className="col-span-1 rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1 text-center text-xs text-slate-300">
                        {p.gender}
                      </div>
                      <CommitInput
                        className="col-span-5 rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1 text-sm text-slate-100 outline-none focus:border-slate-600"
                        placeholder="First"
                        value={p.firstName}
                        onCommit={(next) => actions.updatePlayer(p.id, next, p.lastName)}
                      />
                      <CommitInput
                        className="col-span-5 rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1 text-sm text-slate-100 outline-none focus:border-slate-600"
                        placeholder="Last"
                        value={p.lastName}
                        onCommit={(next) => actions.updatePlayer(p.id, p.firstName, next)}
                      />
                    </div>
                  ))}
                </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Seeded Team Mapping</h2>
            <p className="text-sm text-slate-400">
              Select a division and club, then assign which two players represent each seed (Women #1/#2, Men #1/#2,
              Mixed #1–#4).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-slate-300">
              <span className="mr-2 text-xs text-slate-400">Division</span>
              <select
                className="rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-sm text-slate-100"
                value={divisionId}
                onChange={(e) => setDivisionId(e.target.value)}
              >
                {state.divisions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-300">
              <span className="mr-2 text-xs text-slate-400">Club</span>
              <select
                className="rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-sm text-slate-100"
                value={clubId}
                onChange={(e) => setClubId(e.target.value as ClubId)}
                disabled={state.clubs.length === 0}
              >
                {state.clubs.filter((c) => clubEnabledForDivision(c.id)).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium hover:bg-slate-700"
              onClick={() => actions.autoSeed(divisionId, clubId)}
              title="Auto-fill mapping for the selected club in this division"
              disabled={!state.clubs.length || !clubId}
            >
              Auto-seed club
            </button>
            <button
              className="rounded-md border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900"
              onClick={() => actions.autoSeed(divisionId)}
              title="Auto-fill mapping for all clubs in this division"
              disabled={!state.clubs.length}
            >
              Auto-seed all clubs
            </button>
          </div>
        </div>

        {state.clubs.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4 text-sm text-slate-300">
            Add at least one club to set up seeded team mappings.
          </div>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="grid grid-cols-12 gap-2 bg-slate-900/60 px-3 py-2 text-xs font-semibold text-slate-300">
            <div className="col-span-3">Seed</div>
            <div className="col-span-4">Player 1</div>
            <div className="col-span-4">Player 2</div>
            <div className="col-span-1 text-right">Clear</div>
          </div>

          <div className="divide-y divide-slate-800 bg-slate-950/30">
            {SEEDED_EVENTS.map((ev) => {
              const k = seedKey(ev.eventType, ev.seed)
              const selected = seedsForClub?.[k]?.playerIds ?? [null, null]

              let allowed1 = playersForClub
              let allowed2 = playersForClub
              if (ev.eventType === 'WOMENS_DOUBLES') {
                allowed1 = playersForClub.filter((p) => p.gender === 'F')
                allowed2 = allowed1
              } else if (ev.eventType === 'MENS_DOUBLES') {
                allowed1 = playersForClub.filter((p) => p.gender === 'M')
                allowed2 = allowed1
              } else if (ev.eventType === 'MIXED_DOUBLES') {
                allowed1 = playersForClub.filter((p) => p.gender === 'F')
                allowed2 = playersForClub.filter((p) => p.gender === 'M')
              }

              const player1Id = selected[0] ?? ''
              const player2Id = selected[1] ?? ''

              return (
                <div key={k} className="grid grid-cols-12 items-center gap-2 px-3 py-2">
                  <div className="col-span-3 text-sm text-slate-100">{ev.label}</div>
                  <div className="col-span-4">
                    <select
                      className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-sm text-slate-100"
                      value={player1Id}
                      onChange={(e) => {
                        const next1 = (e.target.value || null) as PlayerId | null
                        const next2 = (player2Id || null) as PlayerId | null
                        actions.setSeed(
                          divisionId,
                          clubId,
                          ev.eventType as EventType,
                          ev.seed,
                          [next1, next2],
                        )
                      }}
                    >
                      <option value="">—</option>
                      {allowed1.map((p) => (
                        <option key={p.id} value={p.id}>
                          {playerLabel(p)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-4">
                    <select
                      className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-sm text-slate-100"
                      value={player2Id}
                      onChange={(e) => {
                        const next2 = (e.target.value || null) as PlayerId | null
                        const next1 = (player1Id || null) as PlayerId | null
                        actions.setSeed(
                          divisionId,
                          clubId,
                          ev.eventType as EventType,
                          ev.seed,
                          [next1, next2],
                        )
                      }}
                    >
                      <option value="">—</option>
                      {allowed2.map((p) => (
                        <option key={p.id} value={p.id}>
                          {playerLabel(p)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-1 text-right">
                    <button
                      className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-900 hover:text-white"
                      onClick={() => actions.setSeed(divisionId, clubId, ev.eventType as EventType, ev.seed, [null, null])}
                      title="Clear"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <div className="text-xs text-slate-500">
        <div>
          Matches generated: <span className="font-semibold text-slate-300">{state.matches.length}</span>
        </div>
        <div>Last updated: {new Date(state.updatedAt).toLocaleString()}</div>
        <div>App version: {__APP_VERSION__}</div>
      </div>
    </div>
  )
}

