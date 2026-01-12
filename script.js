(() => {
	'use strict';

	const STORAGE_KEY = 'pbme_state_v1';

	const $ = (sel, root = document) => root.querySelector(sel);
	const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

	const nowIsoDate = () => {
		const d = new Date();
		const yyyy = d.getFullYear();
		const mm = String(d.getMonth() + 1).padStart(2, '0');
		const dd = String(d.getDate()).padStart(2, '0');
		return `${yyyy}-${mm}-${dd}`;
	};

	const uid = () => {
		return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
	};

	const clampInt = (value, min, max, fallback) => {
		const n = Number.parseInt(String(value), 10);
		if (!Number.isFinite(n)) return fallback;
		return Math.max(min, Math.min(max, n));
	};

	const escapeHtml = (s) => {
		return String(s)
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll("'", '&#39;');
	};

	// Non-crypto hash (works on file://). This is NOT secure; it just avoids plain-text storage.
	const fnv1a32Hex = (input) => {
		let hash = 0x811c9dc5;
		const str = String(input);
		for (let i = 0; i < str.length; i++) {
			hash ^= str.charCodeAt(i);
			// 32-bit FNV prime multiplication: hash *= 16777619
			hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
		}
		return hash.toString(16).padStart(8, '0');
	};

	const downloadText = (filename, text, mime = 'text/plain') => {
		const blob = new Blob([text], { type: mime });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	};

	const parseJsonFile = async (file) => {
		const text = await file.text();
		return JSON.parse(text);
	};

	const defaultState = () => ({
		version: 1,
		settings: {
			clubName: 'PBMatchEngine',
			requireAccessCode: false,
			accessCodeHash: '',
		},
		players: [],
		sessions: [],
		matches: [],
	});

	const hardResetLocal = () => {
		try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
		try { sessionStorage.removeItem('pbme_unlocked'); } catch { /* ignore */ }
		state = defaultState();
		currentSessionId = '';
		try { saveState(); } catch { /* ignore */ }
	};

	const loadState = () => {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return defaultState();
			const parsed = JSON.parse(raw);
			if (!parsed || parsed.version !== 1) return defaultState();
			return {
				...defaultState(),
				...parsed,
				settings: { ...defaultState().settings, ...(parsed.settings || {}) },
				players: Array.isArray(parsed.players) ? parsed.players : [],
				sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
				matches: Array.isArray(parsed.matches) ? parsed.matches : [],
			};
		} catch {
			return defaultState();
		}
	};

	const saveState = () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	};

	let state = loadState();
	let currentSessionId = state.sessions[0]?.id || '';

	// Elements
	const clubNameEl = $('#clubName');
	const accessGateEl = $('#accessGate');
	const gateFormEl = $('#gateForm');
	const gateCodeEl = $('#gateCode');
	const gateErrorEl = $('#gateError');

	const playerFormEl = $('#playerForm');
	const playerIdEl = $('#playerId');
	const playerNameEl = $('#playerName');
	const playerGenderEl = $('#playerGender');
	const playerDuprEl = $('#playerDupr');
	const playerFormMsgEl = $('#playerFormMsg');
	const playerCountEl = $('#playerCount');
	const playersTableEl = $('#playersTable');

	const sessionFormEl = $('#sessionForm');
	const sessionIdEl = $('#sessionId');
	const sessionNameEl = $('#sessionName');
	const sessionDateEl = $('#sessionDate');
	const sessionCourtsEl = $('#sessionCourts');
	const sessionFormatEl = $('#sessionFormat');
	const sessionPreferMixedEl = $('#sessionPreferMixed');
	const sessionRoundsEl = $('#sessionRounds');
	const sessionFormMsgEl = $('#sessionFormMsg');
	const sessionsTableEl = $('#sessionsTable');
	const currentSessionSummaryEl = $('#currentSessionSummary');

	const fixedTeamsCardEl = $('#fixedTeamsCard');
	const teamFormEl = $('#teamForm');
	const teamIdEl = $('#teamId');
	const teamP1El = $('#teamP1');
	const teamP2El = $('#teamP2');
	const teamFormMsgEl = $('#teamFormMsg');
	const teamsTableEl = $('#teamsTable');

	const scheduleWrapEl = $('#scheduleWrap');
	const scoresWrapEl = $('#scoresWrap');
	const standingsWrapEl = $('#standingsWrap');
	const exportMsgEl = $('#exportMsg');

	const settingsFormEl = $('#settingsForm');
	const settingsClubNameEl = $('#settingsClubName');
	const settingsRequireCodeEl = $('#settingsRequireCode');
	const settingsAccessCodeEl = $('#settingsAccessCode');
	const settingsMsgEl = $('#settingsMsg');

	const importBackupInput1 = $('#importBackupInput');
	const importBackupInput2 = $('#importBackupInput2');

	const views = new Set(['home', 'players', 'session', 'schedule', 'scores', 'standings', 'export', 'settings']);

	const getSession = (id) => state.sessions.find((s) => s.id === id) || null;
	const getPlayer = (id) => state.players.find((p) => p.id === id) || null;

	const getSessionMatches = (sessionId) => state.matches.filter((m) => m.sessionId === sessionId);

	const setCurrentSession = (sessionId) => {
		currentSessionId = sessionId;
		renderAll();
	};

	const setView = (name) => {
		if (!views.has(name)) return;
		$$('[data-view-panel]').forEach((el) => {
			el.hidden = el.getAttribute('data-view-panel') !== name;
		});
		$$('.navitem').forEach((btn) => {
			btn.classList.toggle('is-active', btn.getAttribute('data-view') === name);
		});
	};

	const genderLabel = (g) => {
		if (g === 'M') return 'M';
		if (g === 'F') return 'F';
		return 'X';
	};

	const formatLabel = (format) => {
		switch (format) {
			case 'DOUBLES_ROTATE':
				return 'Doubles — rotate partners';
			case 'DOUBLES_FIXED_TEAMS':
				return 'Doubles — fixed teams';
			case 'SINGLES':
				return 'Singles';
			default:
				return 'Unknown';
		}
	};

	const upsertPlayer = (player) => {
		const idx = state.players.findIndex((p) => p.id === player.id);
		if (idx >= 0) state.players[idx] = player;
		else state.players.push(player);
		saveState();
	};

	const deletePlayer = (playerId) => {
		state.players = state.players.filter((p) => p.id !== playerId);
		// Remove from sessions' teams
		state.sessions = state.sessions.map((s) => {
			if (!s.teams) return s;
			return {
				...s,
				teams: s.teams
					.filter((t) => t.players.every((pid) => pid !== playerId))
					.map((t) => ({ ...t })),
			};
		});
		// Remove matches containing that player
		state.matches = state.matches.filter((m) => {
			return !m.team1.includes(playerId) && !m.team2.includes(playerId);
		});
		saveState();
		if (currentSessionId && !getSession(currentSessionId)) currentSessionId = '';
	};

	const upsertSession = (session) => {
		const idx = state.sessions.findIndex((s) => s.id === session.id);
		if (idx >= 0) state.sessions[idx] = session;
		else state.sessions.push(session);
		saveState();
	};

	const deleteSession = (sessionId) => {
		state.sessions = state.sessions.filter((s) => s.id !== sessionId);
		state.matches = state.matches.filter((m) => m.sessionId !== sessionId);
		saveState();
		if (currentSessionId === sessionId) currentSessionId = state.sessions[0]?.id || '';
	};

	const clearSchedule = (sessionId) => {
		state.matches = state.matches.filter((m) => m.sessionId !== sessionId);
		saveState();		
	};

	const getDisplayTeam = (playerIds) => {
		return playerIds
			.map((pid) => getPlayer(pid)?.name || 'Unknown')
			.join(' / ');
	};

	const getSessionStatusPill = (sessionId) => {
		const matches = getSessionMatches(sessionId);
		if (matches.length === 0) return '<span class="pill pill--warn">No schedule</span>';
		const scored = matches.filter((m) => m.score1 != null && m.score2 != null).length;
		if (scored === 0) return `<span class="pill">${matches.length} matches</span>`;
		if (scored === matches.length) return `<span class="pill pill--ok">${matches.length} matches • all scored</span>`;
		return `<span class="pill">${matches.length} matches • ${scored} scored</span>`;
	};

	const renderPlayers = () => {
		playerCountEl.textContent = `${state.players.length} player(s)`;
		if (state.players.length === 0) {
			playersTableEl.innerHTML = '<div class="muted" style="padding:12px;">No players yet. Add your first player on the left.</div>';
			return;
		}

		const rows = state.players
			.slice()
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((p) => {
				return `
					<tr>
						<td>${escapeHtml(p.name)}</td>
						<td>${escapeHtml(genderLabel(p.gender))}</td>
						<td class="muted">${escapeHtml(p.duprId || '')}</td>
						<td>
							<button class="btn btn--ghost" data-action="edit-player" data-id="${p.id}" type="button">Edit</button>
							<button class="btn btn--danger" data-action="delete-player" data-id="${p.id}" type="button">Delete</button>
						</td>
					</tr>
				`;
			})
			.join('');

		playersTableEl.innerHTML = `
			<table>
				<thead>
					<tr>
						<th>Name</th>
						<th>Gender</th>
						<th>DUPR ID</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>${rows}</tbody>
			</table>
		`;
	};

	const renderSessions = () => {
		if (state.sessions.length === 0) {
			sessionsTableEl.innerHTML = '<div class="muted" style="padding:12px;">No sessions yet. Create one on the left.</div>';
			currentSessionSummaryEl.textContent = 'No session selected yet.';
			fixedTeamsCardEl.hidden = true;
			return;
		}

		const rows = state.sessions
			.slice()
			.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
			.map((s) => {
				const isCurrent = s.id === currentSessionId;
				return `
					<tr>
						<td>
							<div style="font-weight:800;">${escapeHtml(s.name)}</div>
							<div class="muted">${escapeHtml(s.date || '')} • ${escapeHtml(formatLabel(s.format))}</div>
						</td>
						<td>${getSessionStatusPill(s.id)}</td>
						<td>
							<button class="btn ${isCurrent ? 'btn--primary' : ''}" data-action="select-session" data-id="${s.id}" type="button">${isCurrent ? 'Selected' : 'Select'}</button>
							<button class="btn btn--ghost" data-action="edit-session" data-id="${s.id}" type="button">Edit</button>
							<button class="btn btn--danger" data-action="delete-session" data-id="${s.id}" type="button">Delete</button>
						</td>
					</tr>
				`;
			})
			.join('');

		sessionsTableEl.innerHTML = `
			<table>
				<thead>
					<tr>
						<th>Session</th>
						<th>Status</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>${rows}</tbody>
			</table>
		`;

		const current = getSession(currentSessionId) || state.sessions[0];
		if (current && current.id !== currentSessionId) currentSessionId = current.id;
		if (!current) {
			currentSessionSummaryEl.textContent = 'No session selected yet.';
			fixedTeamsCardEl.hidden = true;
			return;
		}

		const matchCount = getSessionMatches(current.id).length;
		currentSessionSummaryEl.innerHTML = `
			<div style="font-weight:800;">${escapeHtml(current.name)}</div>
			<div class="muted">${escapeHtml(current.date || '')} • ${escapeHtml(formatLabel(current.format))} • ${escapeHtml(String(current.courts))} courts • ${escapeHtml(String(current.rounds))} rounds</div>
			<div class="muted">${matchCount} match(es) currently scheduled</div>
		`;

		fixedTeamsCardEl.hidden = current.format !== 'DOUBLES_FIXED_TEAMS';
	};

	const renderFixedTeamsControls = () => {
		const session = getSession(currentSessionId);
		if (!session || session.format !== 'DOUBLES_FIXED_TEAMS') return;

		const players = state.players.slice().sort((a, b) => a.name.localeCompare(b.name));
		const options = ['<option value="">Select…</option>']
			.concat(players.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(genderLabel(p.gender))})</option>`))
			.join('');
		teamP1El.innerHTML = options;
		teamP2El.innerHTML = options;

		const teams = Array.isArray(session.teams) ? session.teams : [];
		if (teams.length === 0) {
			teamsTableEl.innerHTML = '<div class="muted" style="padding:12px;">No teams yet. Add teams to schedule fixed-team doubles.</div>';
			return;
		}

		const rows = teams
			.slice()
			.map((t) => {
				const names = t.players.map((pid) => getPlayer(pid)?.name || 'Unknown').join(' / ');
				return `
					<tr>
						<td>${escapeHtml(names)}</td>
						<td>
							<button class="btn btn--ghost" data-action="delete-team" data-id="${t.id}" type="button">Delete</button>
						</td>
					</tr>
				`;
			})
			.join('');

		teamsTableEl.innerHTML = `
			<table>
				<thead>
					<tr>
						<th>Team</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>${rows}</tbody>
			</table>
		`;
	};

	const renderSchedule = () => {
		const session = getSession(currentSessionId);
		if (!session) {
			scheduleWrapEl.innerHTML = '<div class="muted">No session selected.</div>';
			return;
		}

		const matches = getSessionMatches(session.id).slice().sort((a, b) => (a.round - b.round) || (a.court - b.court));
		if (matches.length === 0) {
			scheduleWrapEl.innerHTML = '<div class="card"><div class="card__title">No schedule yet</div><div class="muted">Go to Session and click “Generate schedule”.</div></div>';
			return;
		}

		const rounds = new Map();
		for (const m of matches) {
			if (!rounds.has(m.round)) rounds.set(m.round, []);
			rounds.get(m.round).push(m);
		}

		scheduleWrapEl.innerHTML = Array.from(rounds.entries())
			.sort((a, b) => a[0] - b[0])
			.map(([roundNum, roundMatches]) => {
				const rows = roundMatches
					.map((m) => {
						const score = (m.score1 != null && m.score2 != null)
							? `<span class="pill pill--ok">${m.score1}–${m.score2}</span>`
							: '<span class="pill">Unscored</span>';
						return `
							<tr>
								<td>${escapeHtml(String(m.court))}</td>
								<td>${escapeHtml(getDisplayTeam(m.team1))}</td>
								<td class="muted">vs</td>
								<td>${escapeHtml(getDisplayTeam(m.team2))}</td>
								<td>${score}</td>
							</tr>
						`;
					})
					.join('');
				return `
					<div class="card">
						<div class="card__title">Round ${roundNum}</div>
						<div class="tableWrap">
							<table>
								<thead>
									<tr>
										<th>Court</th>
										<th>Team 1</th>
										<th></th>
										<th>Team 2</th>
										<th>Status</th>
									</tr>
								</thead>
								<tbody>${rows}</tbody>
							</table>
						</div>
					</div>
				`;
			})
			.join('');
	};

	const renderScores = () => {
		const session = getSession(currentSessionId);
		if (!session) {
			scoresWrapEl.innerHTML = '<div class="muted">No session selected.</div>';
			return;
		}

		const matches = getSessionMatches(session.id).slice().sort((a, b) => (a.round - b.round) || (a.court - b.court));
		if (matches.length === 0) {
			scoresWrapEl.innerHTML = '<div class="card"><div class="card__title">No matches</div><div class="muted">Generate a schedule first.</div></div>';
			return;
		}

		const items = matches.map((m) => {
			const t1 = escapeHtml(getDisplayTeam(m.team1));
			const t2 = escapeHtml(getDisplayTeam(m.team2));
			const s1 = m.score1 == null ? '' : String(m.score1);
			const s2 = m.score2 == null ? '' : String(m.score2);
			return `
				<div class="card">
					<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
						<div>
							<div style="font-weight:900;">Round ${m.round} • Court ${m.court}</div>
							<div class="muted">${t1} vs ${t2}</div>
						</div>
						<div style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;">
							<label class="field" style="min-width:120px;">
								<span class="field__label">Team 1</span>
								<input type="number" inputmode="numeric" min="0" max="99" value="${escapeHtml(s1)}" data-score="1" data-id="${m.id}" />
							</label>
							<label class="field" style="min-width:120px;">
								<span class="field__label">Team 2</span>
								<input type="number" inputmode="numeric" min="0" max="99" value="${escapeHtml(s2)}" data-score="2" data-id="${m.id}" />
							</label>
							<button class="btn btn--primary" data-action="save-score" data-id="${m.id}" type="button">Save</button>
							<button class="btn btn--ghost" data-action="clear-score" data-id="${m.id}" type="button">Clear</button>
						</div>
					</div>
				</div>
			`;
		});

		scoresWrapEl.innerHTML = items.join('');
	};

	const computeStandings = (sessionId) => {
		const matches = getSessionMatches(sessionId);
		const stats = new Map();

		const ensure = (playerId) => {
			if (!stats.has(playerId)) {
				stats.set(playerId, {
					playerId,
					played: 0,
					wins: 0,
					losses: 0,
					pf: 0,
					pa: 0,
				});
			}
			return stats.get(playerId);
		};

		for (const m of matches) {
			if (m.score1 == null || m.score2 == null) continue;
			for (const pid of m.team1) ensure(pid);
			for (const pid of m.team2) ensure(pid);

			const team1Won = m.score1 > m.score2;
			const team2Won = m.score2 > m.score1;
			for (const pid of m.team1) {
				const s = ensure(pid);
				s.played += 1;
				s.pf += m.score1;
				s.pa += m.score2;
				if (team1Won) s.wins += 1;
				else if (team2Won) s.losses += 1;
			}
			for (const pid of m.team2) {
				const s = ensure(pid);
				s.played += 1;
				s.pf += m.score2;
				s.pa += m.score1;
				if (team2Won) s.wins += 1;
				else if (team1Won) s.losses += 1;
			}
		}

		const list = Array.from(stats.values()).map((s) => ({
			...s,
			diff: s.pf - s.pa,
			name: getPlayer(s.playerId)?.name || 'Unknown',
		}));

		list.sort((a, b) =>
			(b.wins - a.wins) ||
			(b.diff - a.diff) ||
			(b.pf - a.pf) ||
			a.name.localeCompare(b.name)
		);

		return list;
	};

	const renderStandings = () => {
		const session = getSession(currentSessionId);
		if (!session) {
			standingsWrapEl.innerHTML = '<div class="muted">No session selected.</div>';
			return;
		}

		const matches = getSessionMatches(session.id);
		if (matches.length === 0) {
			standingsWrapEl.innerHTML = '<div class="card"><div class="card__title">No matches</div><div class="muted">Generate a schedule first.</div></div>';
			return;
		}

		const standings = computeStandings(session.id);
		if (standings.length === 0) {
			standingsWrapEl.innerHTML = '<div class="card"><div class="card__title">No scores yet</div><div class="muted">Enter scores to see standings.</div></div>';
			return;
		}

		const rows = standings.map((s, idx) => `
			<tr>
				<td>${idx + 1}</td>
				<td>${escapeHtml(s.name)}</td>
				<td>${s.played}</td>
				<td>${s.wins}</td>
				<td>${s.losses}</td>
				<td>${s.pf}</td>
				<td>${s.pa}</td>
				<td>${s.diff}</td>
			</tr>
		`).join('');

		const scored = matches.filter((m) => m.score1 != null && m.score2 != null).length;
		standingsWrapEl.innerHTML = `
			<div class="card">
				<div class="card__title">${escapeHtml(session.name)} standings</div>
				<div class="muted">${scored}/${matches.length} matches scored</div>
				<div class="tableWrap" style="margin-top:12px;">
					<table>
						<thead>
							<tr>
								<th>#</th>
								<th>Player</th>
								<th>GP</th>
								<th>W</th>
								<th>L</th>
								<th>PF</th>
								<th>PA</th>
								<th>Diff</th>
							</tr>
						</thead>
						<tbody>${rows}</tbody>
					</table>
				</div>
			</div>
		`;
	};

	// Scheduling engine
	const makePairKey = (a, b) => {
		return a < b ? `${a}|${b}` : `${b}|${a}`;
	};

	const getCount = (map, a, b) => {
		return map.get(makePairKey(a, b)) || 0;
	};

	const incCount = (map, a, b, by = 1) => {
		const k = makePairKey(a, b);
		map.set(k, (map.get(k) || 0) + by);
	};

	const shuffle = (arr) => {
		for (let i = arr.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[arr[i], arr[j]] = [arr[j], arr[i]];
		}
		return arr;
	};

	const selectActivePlayers = (playerIds, count, gamesPlayed) => {
		const ids = playerIds.slice();
		ids.sort((a, b) => {
			const ga = gamesPlayed.get(a) || 0;
			const gb = gamesPlayed.get(b) || 0;
			if (ga !== gb) return ga - gb;
			return (getPlayer(a)?.name || '').localeCompare(getPlayer(b)?.name || '');
		});

		// Randomize ties for fairness
		let i = 0;
		while (i < ids.length) {
			const base = gamesPlayed.get(ids[i]) || 0;
			let j = i + 1;
			while (j < ids.length && (gamesPlayed.get(ids[j]) || 0) === base) j++;
			shuffle(ids.slice(i, j)).forEach((val, idx) => { ids[i + idx] = val; });
			i = j;
		}

		return ids.slice(0, count);
	};

	const createDoublesTeamsForRound = (activePlayerIds, partnerCounts, preferMixed) => {
		const remaining = new Set(activePlayerIds);
		const teams = [];

		const getGender = (pid) => getPlayer(pid)?.gender || 'X';
		const mixedPenalty = (a, b) => {
			if (!preferMixed) return 0;
			const ga = getGender(a);
			const gb = getGender(b);
			if (ga === 'X' || gb === 'X') return 0;
			return ga === gb ? 8 : 0;
		};

		while (remaining.size >= 2) {
			const [a] = remaining;
			remaining.delete(a);

			let best = null;
			let bestScore = Infinity;
			for (const b of remaining) {
				const score = (getCount(partnerCounts, a, b) * 100) + mixedPenalty(a, b);
				if (score < bestScore) {
					bestScore = score;
					best = b;
				}
			}
			if (!best) break;
			remaining.delete(best);
			teams.push([a, best]);
		}

		return teams;
	};

	const pairTeamsIntoMatches = (teams, opponentCounts) => {
		const remaining = teams.slice();
		const matches = [];

		const opponentScore = (t1, t2) => {
			let score = 0;
			for (const a of t1) for (const b of t2) score += getCount(opponentCounts, a, b);
			return score;
		};

		while (remaining.length >= 2) {
			const a = remaining.shift();
			let bestIdx = -1;
			let bestScore = Infinity;
			for (let i = 0; i < remaining.length; i++) {
				const b = remaining[i];
				const score = opponentScore(a, b);
				if (score < bestScore) {
					bestScore = score;
					bestIdx = i;
				}
			}
			const b = remaining.splice(bestIdx, 1)[0];
			matches.push([a, b]);
		}

		return matches;
	};

	const createSinglesMatchesForRound = (activePlayerIds, opponentCounts) => {
		const remaining = activePlayerIds.slice();
		const matches = [];

		const opponentScore = (a, b) => getCount(opponentCounts, a, b);

		while (remaining.length >= 2) {
			const a = remaining.shift();
			let bestIdx = -1;
			let bestScore = Infinity;
			for (let i = 0; i < remaining.length; i++) {
				const b = remaining[i];
				const score = opponentScore(a, b);
				if (score < bestScore) {
					bestScore = score;
					bestIdx = i;
				}
			}
			const b = remaining.splice(bestIdx, 1)[0];
			matches.push([[a], [b]]);
		}

		return matches;
	};

	const generateScheduleForSession = (sessionId) => {
		const session = getSession(sessionId);
		if (!session) throw new Error('No session selected.');
		if (state.players.length === 0) throw new Error('Add players first.');

		const courts = clampInt(session.courts, 1, 50, 4);
		const rounds = clampInt(session.rounds, 1, 200, 6);
		const preferMixed = !!session.preferMixed;

		clearSchedule(sessionId);

		const partnerCounts = new Map();
		const opponentCounts = new Map();
		const gamesPlayed = new Map();
		for (const p of state.players) gamesPlayed.set(p.id, 0);

		const allPlayerIds = state.players.map((p) => p.id);

		let courtCounter = 1;
		const newMatches = [];

		// Fixed-team helpers (persist across rounds)
		const fixedTeams = session.format === 'DOUBLES_FIXED_TEAMS'
			? (Array.isArray(session.teams) ? session.teams : [])
			: [];
		const fixedTeamIds = fixedTeams.map((t) => t.id);
		const fixedTeamGames = new Map(fixedTeamIds.map((id) => [id, 0]));
		const fixedTeamOpponentCounts = new Map();

		for (let round = 1; round <= rounds; round++) {
			courtCounter = 1;
			if (session.format === 'DOUBLES_ROTATE') {
				const needed = Math.min(allPlayerIds.length, courts * 4);
				if (needed < 4) throw new Error('Need at least 4 players for doubles.');
				const active = selectActivePlayers(allPlayerIds, needed, gamesPlayed);
				const teams = createDoublesTeamsForRound(active, partnerCounts, preferMixed);
				const pairs = pairTeamsIntoMatches(teams, opponentCounts).slice(0, courts);
				for (const [t1, t2] of pairs) {
					newMatches.push({
						id: uid(),
						sessionId,
						round,
						court: courtCounter++,
						team1: t1,
						team2: t2,
						score1: null,
						score2: null,
					});
					// Update counts
					incCount(partnerCounts, t1[0], t1[1]);
					incCount(partnerCounts, t2[0], t2[1]);
					for (const a of t1) for (const b of t2) incCount(opponentCounts, a, b);
					for (const pid of [...t1, ...t2]) gamesPlayed.set(pid, (gamesPlayed.get(pid) || 0) + 1);
				}
			} else if (session.format === 'SINGLES') {
				const needed = Math.min(allPlayerIds.length, courts * 2);
				if (needed < 2) throw new Error('Need at least 2 players for singles.');
				const active = selectActivePlayers(allPlayerIds, needed, gamesPlayed);
				const pairs = createSinglesMatchesForRound(active, opponentCounts).slice(0, courts);
				for (const [t1, t2] of pairs) {
					newMatches.push({
						id: uid(),
						sessionId,
						round,
						court: courtCounter++,
						team1: t1,
						team2: t2,
						score1: null,
						score2: null,
					});
					incCount(opponentCounts, t1[0], t2[0]);
					gamesPlayed.set(t1[0], (gamesPlayed.get(t1[0]) || 0) + 1);
					gamesPlayed.set(t2[0], (gamesPlayed.get(t2[0]) || 0) + 1);
				}
			} else if (session.format === 'DOUBLES_FIXED_TEAMS') {
				if (fixedTeams.length < 2) throw new Error('Add at least 2 fixed teams for this session.');
				const selectActiveTeams = (count) => {
					const ids = fixedTeamIds.slice();
					ids.sort((a, b) => (fixedTeamGames.get(a) || 0) - (fixedTeamGames.get(b) || 0));
					return ids.slice(0, count);
				};

				const neededTeams = Math.min(fixedTeamIds.length, courts * 2);
				const activeTeams = selectActiveTeams(neededTeams);
				// Pair teams with minimal repeats
				const remaining = activeTeams.slice();
				while (remaining.length >= 2 && courtCounter <= courts) {
					const a = remaining.shift();
					let bestIdx = -1;
					let bestScore = Infinity;
					for (let i = 0; i < remaining.length; i++) {
						const b = remaining[i];
						const score = getCount(fixedTeamOpponentCounts, a, b);
						if (score < bestScore) {
							bestScore = score;
							bestIdx = i;
						}
					}
					const b = remaining.splice(bestIdx, 1)[0];
					const teamA = fixedTeams.find((t) => t.id === a);
					const teamB = fixedTeams.find((t) => t.id === b);
					if (!teamA || !teamB) continue;
					newMatches.push({
						id: uid(),
						sessionId,
						round,
						court: courtCounter++,
						team1: teamA.players,
						team2: teamB.players,
						score1: null,
						score2: null,
					});
					incCount(fixedTeamOpponentCounts, a, b);
					fixedTeamGames.set(a, (fixedTeamGames.get(a) || 0) + 1);
					fixedTeamGames.set(b, (fixedTeamGames.get(b) || 0) + 1);
					for (const pid of [...teamA.players, ...teamB.players]) gamesPlayed.set(pid, (gamesPlayed.get(pid) || 0) + 1);
				}
			} else {
				throw new Error('Unsupported format.');
			}
		}

		state.matches = state.matches.concat(newMatches);
		saveState();
	};

	// DUPR CSV export (generic)
	const exportDuprCsv = (sessionId) => {
		const session = getSession(sessionId);
		if (!session) throw new Error('No session selected.');
		const matches = getSessionMatches(sessionId).filter((m) => m.score1 != null && m.score2 != null);
		if (matches.length === 0) throw new Error('No scored matches to export yet.');

		const header = [
			'match_date',
			'session_name',
			'format',
			'team1_player1',
			'team1_player2',
			'team2_player1',
			'team2_player2',
			'team1_score',
			'team2_score',
		].join(',');

		const rows = matches.map((m) => {
			const t1p1 = getPlayer(m.team1[0])?.name || '';
			const t1p2 = getPlayer(m.team1[1])?.name || '';
			const t2p1 = getPlayer(m.team2[0])?.name || '';
			const t2p2 = getPlayer(m.team2[1])?.name || '';

			const csv = [
				session.date || '',
				session.name || '',
				session.format || '',
				t1p1,
				t1p2,
				t2p1,
				t2p2,
				String(m.score1),
				String(m.score2),
			];

			return csv.map((v) => {
				const s = String(v ?? '');
				const needsQuote = /[",\n]/.test(s);
				return needsQuote ? `"${s.replaceAll('"', '""')}"` : s;
			}).join(',');
		});

		const filename = `dupr_${(session.name || 'session').replaceAll(/[^a-z0-9\-_]+/gi, '_')}_${session.date || nowIsoDate()}.csv`;
		downloadText(filename, [header, ...rows].join('\n'), 'text/csv');
	};

	const renderClubName = () => {
		clubNameEl.textContent = state.settings.clubName || 'PBMatchEngine';
		$('#clubName').textContent = state.settings.clubName || 'PBMatchEngine';
		$('#settingsClubName').value = state.settings.clubName || '';
		settingsRequireCodeEl.checked = !!state.settings.requireAccessCode;
	};

	const renderAll = () => {
		renderClubName();
		renderPlayers();
		renderSessions();
		renderFixedTeamsControls();
		renderSchedule();
		renderScores();
		renderStandings();
	};

	// Gate
	const shouldGate = () => {
		if (!state.settings.requireAccessCode || !state.settings.accessCodeHash) return false;
		return sessionStorage.getItem('pbme_unlocked') !== 'true';
	};

	const showGate = () => {
		accessGateEl.hidden = false;
		gateCodeEl.value = '';
		gateErrorEl.textContent = '';
		setTimeout(() => gateCodeEl.focus(), 0);
	};

	const hideGate = () => {
		accessGateEl.hidden = true;
	};

	// Event handlers
	document.addEventListener('click', (e) => {
		const target = e.target;
		if (!(target instanceof HTMLElement)) return;

		const view = target.getAttribute('data-view');
		if (view) {
			setView(view);
			return;
		}

		const action = target.getAttribute('data-action');
		if (!action) return;

		try {
			switch (action) {
				case 'gate-reset': {
					if (!confirm('Reset access and clear all local data on this device?')) return;
					hardResetLocal();
					hideGate();
					renderAll();
					setView('home');
					break;
				}
				case 'clear-player-form': {
					playerIdEl.value = '';
					playerNameEl.value = '';
					playerGenderEl.value = '';
					playerDuprEl.value = '';
					playerFormMsgEl.textContent = '';
					break;
				}
				case 'edit-player': {
					const id = target.getAttribute('data-id');
					const p = id ? getPlayer(id) : null;
					if (!p) return;
					playerIdEl.value = p.id;
					playerNameEl.value = p.name;
					playerGenderEl.value = p.gender;
					playerDuprEl.value = p.duprId || '';
					playerFormMsgEl.textContent = 'Editing player…';
					setView('players');
					break;
				}
				case 'delete-player': {
					const id = target.getAttribute('data-id');
					if (!id) return;
					if (!confirm('Delete this player? This will also remove them from any schedules.')) return;
					deletePlayer(id);
					renderAll();
					break;
				}
				case 'new-session': {
					sessionIdEl.value = '';
					sessionNameEl.value = '';
					sessionDateEl.value = nowIsoDate();
					sessionCourtsEl.value = '4';
					sessionRoundsEl.value = '6';
					sessionFormatEl.value = '';
					sessionPreferMixedEl.checked = false;
					sessionFormMsgEl.textContent = '';
					fixedTeamsCardEl.hidden = true;
					setView('session');
					break;
				}
				case 'clear-session-form': {
					sessionIdEl.value = '';
					sessionNameEl.value = '';
					sessionDateEl.value = nowIsoDate();
					sessionCourtsEl.value = '4';
					sessionRoundsEl.value = '6';
					sessionFormatEl.value = '';
					sessionPreferMixedEl.checked = false;
					sessionFormMsgEl.textContent = '';
					fixedTeamsCardEl.hidden = true;
					break;
				}
				case 'select-session': {
					const id = target.getAttribute('data-id');
					if (!id) return;
					setCurrentSession(id);
					break;
				}
				case 'edit-session': {
					const id = target.getAttribute('data-id');
					const s = id ? getSession(id) : null;
					if (!s) return;
					sessionIdEl.value = s.id;
					sessionNameEl.value = s.name;
					sessionDateEl.value = s.date || nowIsoDate();
					sessionCourtsEl.value = String(s.courts || 4);
					sessionRoundsEl.value = String(s.rounds || 6);
					sessionFormatEl.value = s.format;
					sessionPreferMixedEl.checked = !!s.preferMixed;
					sessionFormMsgEl.textContent = 'Editing session…';
					setCurrentSession(s.id);
					setView('session');
					break;
				}
				case 'delete-session': {
					const id = target.getAttribute('data-id');
					if (!id) return;
					if (!confirm('Delete this session and its matches/scores?')) return;
					deleteSession(id);
					renderAll();
					break;
				}
				case 'generate-schedule': {
					if (!currentSessionId) throw new Error('Select or create a session first.');
					generateScheduleForSession(currentSessionId);
					renderAll();
					setView('schedule');
					break;
				}
				case 'clear-schedule': {
					if (!currentSessionId) return;
					if (!confirm('Clear the schedule (and scores) for this session?')) return;
					clearSchedule(currentSessionId);
					renderAll();
					break;
				}
				case 'save-score': {
					const id = target.getAttribute('data-id');
					if (!id) return;
					const m = state.matches.find((x) => x.id === id);
					if (!m) return;
					const s1Input = $(`input[data-score="1"][data-id="${id}"]`);
					const s2Input = $(`input[data-score="2"][data-id="${id}"]`);
					const s1 = s1Input?.value === '' ? null : clampInt(s1Input?.value, 0, 99, 0);
					const s2 = s2Input?.value === '' ? null : clampInt(s2Input?.value, 0, 99, 0);
					m.score1 = s1;
					m.score2 = s2;
					saveState();
					renderSessions();
					renderSchedule();
					renderStandings();
					break;
				}
				case 'clear-score': {
					const id = target.getAttribute('data-id');
					if (!id) return;
					const m = state.matches.find((x) => x.id === id);
					if (!m) return;
					m.score1 = null;
					m.score2 = null;
					saveState();
					renderSessions();
					renderSchedule();
					renderScores();
					renderStandings();
					break;
				}
				case 'refresh-standings': {
					renderStandings();
					break;
				}
				case 'export-dupr': {
					if (!currentSessionId) throw new Error('Select a session first.');
					exportDuprCsv(currentSessionId);
					exportMsgEl.textContent = 'Downloaded CSV.';
					break;
				}
				case 'download-backup': {
					downloadText(`pbmatchengine_backup_${nowIsoDate()}.json`, JSON.stringify(state, null, 2), 'application/json');
					break;
				}
				case 'reset-all': {
					if (!confirm('Reset all local data on this device?')) return;
					hardResetLocal();
					renderAll();
					setView('home');
					break;
				}
				case 'clear-team-form': {
					teamIdEl.value = '';
					teamP1El.value = '';
					teamP2El.value = '';
					teamFormMsgEl.textContent = '';
					break;
				}
				case 'delete-team': {
					const teamId = target.getAttribute('data-id');
					const session = getSession(currentSessionId);
					if (!session || !teamId) return;
					session.teams = (session.teams || []).filter((t) => t.id !== teamId);
					upsertSession(session);
					renderAll();
					break;
				}
				case 'mark-all-unplayed': {
					if (!currentSessionId) return;
					const matches = getSessionMatches(currentSessionId);
					for (const m of matches) { m.score1 = null; m.score2 = null; }
					saveState();
					renderAll();
					break;
				}
				default:
					break;
			}
		} catch (err) {
			alert(err instanceof Error ? err.message : String(err));
		}
	});

	playerFormEl.addEventListener('submit', (e) => {
		e.preventDefault();
		const id = playerIdEl.value || uid();
		const name = playerNameEl.value.trim();
		const gender = playerGenderEl.value;
		const duprId = playerDuprEl.value.trim();
		if (!name) return;
		if (!gender) return;
		upsertPlayer({ id, name, gender, duprId: duprId || '' });
		playerIdEl.value = '';
		playerNameEl.value = '';
		playerGenderEl.value = '';
		playerDuprEl.value = '';
		playerFormMsgEl.textContent = 'Saved.';
		renderAll();
	});

	sessionFormEl.addEventListener('submit', (e) => {
		e.preventDefault();
		const id = sessionIdEl.value || uid();
		const name = sessionNameEl.value.trim();
		const date = sessionDateEl.value || nowIsoDate();
		const format = sessionFormatEl.value;
		const courts = clampInt(sessionCourtsEl.value, 1, 50, 4);
		const rounds = clampInt(sessionRoundsEl.value, 1, 200, 6);
		const preferMixed = !!sessionPreferMixedEl.checked;
		if (!name || !format) return;

		const existing = getSession(id);
		const teams = existing?.teams || [];
		upsertSession({ id, name, date, format, courts, rounds, preferMixed, teams });
		setCurrentSession(id);
		sessionFormMsgEl.textContent = 'Saved.';
		renderAll();
	});

	sessionFormatEl.addEventListener('change', () => {
		const isFixedTeams = sessionFormatEl.value === 'DOUBLES_FIXED_TEAMS';
		fixedTeamsCardEl.hidden = !isFixedTeams;
		if (isFixedTeams) renderFixedTeamsControls();
	});

	teamFormEl.addEventListener('submit', (e) => {
		e.preventDefault();
		const session = getSession(currentSessionId);
		if (!session) return;
		const p1 = teamP1El.value;
		const p2 = teamP2El.value;
		if (!p1 || !p2) return;
		if (p1 === p2) {
			teamFormMsgEl.textContent = 'Pick two different players.';
			return;
		}
		session.teams = Array.isArray(session.teams) ? session.teams : [];
		const used = new Set(session.teams.flatMap((t) => t.players));
		if (used.has(p1) || used.has(p2)) {
			teamFormMsgEl.textContent = 'One of these players is already on a team.';
			return;
		}
		session.teams.push({ id: uid(), players: [p1, p2] });
		upsertSession(session);
		teamP1El.value = '';
		teamP2El.value = '';
		teamFormMsgEl.textContent = 'Team saved.';
		renderAll();
	});

	settingsFormEl.addEventListener('submit', (e) => {
		e.preventDefault();
		state.settings.clubName = settingsClubNameEl.value.trim() || 'PBMatchEngine';
		state.settings.requireAccessCode = !!settingsRequireCodeEl.checked;
		const newCode = settingsAccessCodeEl.value;
		if (newCode) {
			state.settings.accessCodeHash = fnv1a32Hex(newCode);
			settingsAccessCodeEl.value = '';
		}
		saveState();
		settingsMsgEl.textContent = 'Saved.';
		renderAll();
		if (shouldGate()) showGate();
	});

	gateFormEl.addEventListener('submit', (e) => {
		e.preventDefault();
		gateErrorEl.textContent = '';
		const inputHash = fnv1a32Hex(gateCodeEl.value);
		if (inputHash === state.settings.accessCodeHash) {
			sessionStorage.setItem('pbme_unlocked', 'true');
			hideGate();
			return;
		}
		gateErrorEl.textContent = 'Incorrect code. Try again.';
	});

	const handleImport = async (file) => {
		const imported = await parseJsonFile(file);
		if (!imported || imported.version !== 1) throw new Error('Unsupported backup format.');
		state = {
			...defaultState(),
			...imported,
			settings: { ...defaultState().settings, ...(imported.settings || {}) },
			players: Array.isArray(imported.players) ? imported.players : [],
			sessions: Array.isArray(imported.sessions) ? imported.sessions : [],
			matches: Array.isArray(imported.matches) ? imported.matches : [],
		};
		saveState();
		currentSessionId = state.sessions[0]?.id || '';
		renderAll();
		setView('home');
		alert('Backup imported.');
	};

	const onImportChange = async (e) => {
		const input = e.target;
		if (!(input instanceof HTMLInputElement)) return;
		if (!input.files || input.files.length === 0) return;
		try {
			await handleImport(input.files[0]);
		} catch (err) {
			alert(err instanceof Error ? err.message : String(err));
		} finally {
			input.value = '';
		}
	};

	importBackupInput1.addEventListener('change', onImportChange);
	importBackupInput2.addEventListener('change', onImportChange);

	// Init
	try {
		const params = new URLSearchParams(window.location.search);
		if (params.get('reset') === '1') {
			hardResetLocal();
			// Remove the query param so refreshes are normal
			params.delete('reset');
			const qs = params.toString();
			const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash || ''}`;
			history.replaceState(null, '', nextUrl);
		}
	} catch {
		// ignore
	}

	if (!sessionDateEl.value) sessionDateEl.value = nowIsoDate();
	if (shouldGate()) showGate();
	renderAll();	
	setView('home');
})();
