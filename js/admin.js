import { db } from './config.js';
import { doc, getDoc, setDoc, deleteField, collection, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f, flags } from './wizard.js';
import { DEFAULT_SCORING } from './stats.js';

const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
let allMatches = [];
let currentAdminGroup = 'A';
let existingResults = {};
let initDone = false;

export async function initAdmin(matchesData) {
    allMatches = matchesData;
    await refreshLockStatus();

    const resultsSnap = await getDoc(doc(db, "matches", "_results"));
    existingResults = resultsSnap.exists() ? resultsSnap.data() : {};

    currentAdminGroup = GROUP_LETTERS.find(letter => {
        const gm = allMatches.filter(m => m.stage === `Grupp ${letter}`);
        return gm.some(m => !existingResults[m.id]);
    }) || 'A';

    renderGroupButtons();
    renderAdminMatches(currentAdminGroup);
    renderTeamRenames();
    renderScoringConfig();
    renderAdminBracket();

    if (!initDone) {
        document.getElementById('admin-lock-tips').addEventListener('click', () => toggleLock(true));
        document.getElementById('admin-unlock-tips').addEventListener('click', () => toggleLock(false));
        document.getElementById('admin-toggle-tips-visible').addEventListener('click', toggleTipsVisible);
        document.getElementById('admin-save-results').addEventListener('click', saveAdminResults);
        // Test tools
        document.getElementById('admin-add-fake-teachers').addEventListener('click', addFakeTeachers);
        document.getElementById('admin-remove-fake-teachers').addEventListener('click', removeFakeTeachers);
        document.getElementById('admin-autofill-group-results').addEventListener('click', autoFillGroupResults);
        document.getElementById('admin-clear-group-results').addEventListener('click', clearGroupResults);
        document.getElementById('admin-autofill-ko-r32').addEventListener('click', () => autoFillKnockoutRound('R32'));
        document.getElementById('admin-autofill-ko-r16').addEventListener('click', () => autoFillKnockoutRound('R16'));
        document.getElementById('admin-autofill-ko-qf').addEventListener('click', () => autoFillKnockoutRound('KF'));
        document.getElementById('admin-autofill-ko-sf').addEventListener('click', () => autoFillKnockoutRound('SF'));
        document.getElementById('admin-autofill-ko-final').addEventListener('click', () => autoFillKnockoutRound('Final'));
        document.getElementById('admin-clear-ko-results').addEventListener('click', clearKnockoutResults);
        document.getElementById('admin-clear-ko-teams').addEventListener('click', clearKnockoutTeams);
        initDone = true;
    }
}

function renderGroupButtons() {
    const groupSelect = document.getElementById('admin-group-select');
    groupSelect.innerHTML = '';
    const now = Date.now();

    GROUP_LETTERS.forEach(letter => {
        const gm = allMatches.filter(m => m.stage === `Grupp ${letter}`);
        const allDone = gm.every(m => existingResults[m.id]);
        const hasOverdue = gm.some(m => !existingResults[m.id] && isOverdue(m.date, now));

        const btn = document.createElement('button');
        btn.className = 'admin-group-btn' + (letter === currentAdminGroup ? ' active' : '');
        if (hasOverdue) btn.classList.add('overdue');
        btn.textContent = letter;
        if (allDone) btn.style.opacity = '0.5';
        btn.addEventListener('click', () => {
            currentAdminGroup = letter;
            groupSelect.querySelectorAll('.admin-group-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderAdminMatches(letter);
        });
        groupSelect.appendChild(btn);
    });
}

// Parse date like "18 juni 21:00" or "12 juni 04:00" relative to 2026
function parseMatchDate(dateStr) {
    if (!dateStr) return null;
    const months = { 'januari': 0, 'februari': 1, 'mars': 2, 'april': 3, 'maj': 4, 'juni': 5, 'juli': 6, 'augusti': 7, 'september': 8, 'oktober': 9, 'november': 10, 'december': 11 };
    const parts = dateStr.trim().match(/^(\d+)\s+(\w+)\s+(\d{1,2}):(\d{2})$/);
    if (!parts) return null;
    const day = parseInt(parts[1]);
    const month = months[parts[2].toLowerCase()];
    if (month === undefined) return null;
    return new Date(2026, month, day, parseInt(parts[3]), parseInt(parts[4]));
}

function isOverdue(dateStr, now) {
    const kickoff = parseMatchDate(dateStr);
    if (!kickoff) return false;
    return (now - kickoff.getTime()) > 2.5 * 60 * 60 * 1000;
}

async function refreshLockStatus() {
    const el = document.getElementById('admin-lock-status');
    const snap = await getDoc(doc(db, "matches", "_settings"));
    const locked = snap.exists() && snap.data().tipsLocked;
    el.textContent = locked ? '🔒 Tipsraderna är LÅSTA.' : '🔓 Tipsraderna är öppna.';
    el.style.background = locked ? '#fce8e6' : '#e8f5e9';
    el.style.color = locked ? '#c62828' : '#2e7d32';
}

async function toggleLock(lock) {
    await setDoc(doc(db, "matches", "_settings"), { tipsLocked: lock }, { merge: true });
    await refreshLockStatus();
}

async function toggleTipsVisible() {
    const snap = await getDoc(doc(db, "matches", "_settings"));
    const current = snap.exists() ? snap.data().tipsVisible : true;
    const newVal = current === false ? true : false;
    await setDoc(doc(db, "matches", "_settings"), { tipsVisible: newVal }, { merge: true });
    const btn = document.getElementById('admin-toggle-tips-visible');
    btn.textContent = newVal ? '👁 Tips synliga' : '🙈 Tips dolda';
    btn.style.background = newVal ? '#28a745' : '#dc3545';
    setTimeout(() => { btn.textContent = 'Dölj/Visa andras tips'; btn.style.background = '#17a2b8'; }, 2000);
}

function renderAdminMatches(letter) {
    const container = document.getElementById('admin-matches');
    let groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);

    if (groupMatches.length === 0) {
        container.innerHTML = '<p style="color: #999;">Inga matcher i denna grupp.</p>';
        return;
    }

    groupMatches.sort((a, b) => {
        const aDone = !!existingResults[a.id];
        const bDone = !!existingResults[b.id];
        if (aDone !== bDone) return aDone ? 1 : -1;
        return (a.date || '').localeCompare(b.date || '');
    });

    container.innerHTML = '';
    groupMatches.forEach(m => {
        const r = existingResults[m.id] || {};
        const done = r.homeScore !== undefined;
        const div = document.createElement('div');
        div.className = 'admin-match-card' + (done ? ' completed' : '');
        div.innerHTML = `
            <span class="match-date">${m.date || ''}</span>
            <span style="flex:1; font-weight:600;">${f(m.homeTeam)}${m.homeTeam}</span>
            <input type="number" min="0" class="score-input" id="adminHome-${m.id}" value="${r.homeScore ?? ''}" placeholder="-">
            <span style="color:#aaa; font-weight:bold;">:</span>
            <input type="number" min="0" class="score-input" id="adminAway-${m.id}" value="${r.awayScore ?? ''}" placeholder="-">
            <span style="flex:1; text-align:right; font-weight:600;">${m.awayTeam}${f(m.awayTeam)}</span>
            ${done ? `<button class="btn-delete-result" data-match-id="${m.id}" title="Ta bort resultat">✕</button>` : ''}`;
        container.appendChild(div);
    });

    // Wire delete buttons
    container.querySelectorAll('.btn-delete-result').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const matchId = btn.dataset.matchId;
            delete existingResults[matchId];
            await setDoc(doc(db, "matches", "_results"), existingResults);
            renderAdminMatches(currentAdminGroup);
            renderGroupButtons();
        });
    });
}

async function saveAdminResults() {
    const groupMatches = allMatches.filter(m => m.stage === `Grupp ${currentAdminGroup}`);
    let saved = 0;
    groupMatches.forEach(m => {
        const hEl = document.getElementById(`adminHome-${m.id}`);
        const aEl = document.getElementById(`adminAway-${m.id}`);
        if (hEl && aEl && hEl.value !== '' && aEl.value !== '') {
            existingResults[m.id] = {
                homeScore: parseInt(hEl.value), awayScore: parseInt(aEl.value),
                homeTeam: m.homeTeam, awayTeam: m.awayTeam, stage: m.stage, date: m.date
            };
            saved++;
        }
    });
    if (!saved) return;
    await setDoc(doc(db, "matches", "_results"), existingResults, { merge: true });
    renderAdminMatches(currentAdminGroup);
    renderGroupButtons();
}

// ─── TEAM RENAME ────────────────────────────────────
function renderTeamRenames() {
    const container = document.getElementById('admin-team-rename');
    // Find teams with "/" in name from GROUP stage only (not knockout placeholders like "3A/B/C/D/F")
    const undecided = new Set();
    allMatches.forEach(m => {
        if (!m.stage || !m.stage.startsWith('Grupp ')) return;
        if (m.homeTeam?.includes('/')) undecided.add(m.homeTeam);
        if (m.awayTeam?.includes('/')) undecided.add(m.awayTeam);
    });

    if (undecided.size === 0) {
        container.innerHTML = '<p style="color:#999; font-size:14px;">Alla lag är bekräftade.</p>';
        return;
    }

    let html = '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px;">';
    Array.from(undecided).sort().forEach(team => {
        html += `<div style="display:flex; gap:6px; align-items:center;">
            <span style="font-size:13px; min-width:130px; font-weight:600;">${f(team)}${team}</span>
            <span style="color:#aaa;">→</span>
            <input class="rename-input" data-old-name="${team}" value="" placeholder="Nytt namn" style="flex:1; padding:6px; border:1px solid #ddd; border-radius:4px; font-size:13px;">
        </div>`;
    });
    html += '</div>';
    html += '<button class="btn" id="admin-save-renames" style="margin-top:10px; width:100%;">Uppdatera lagnamn</button>';
    container.innerHTML = html;

    document.getElementById('admin-save-renames').addEventListener('click', saveTeamRenames);
}

async function saveTeamRenames() {
    const inputs = document.querySelectorAll('.rename-input');
    const renames = {};
    inputs.forEach(inp => {
        const newName = inp.value.trim();
        if (newName) renames[inp.dataset.oldName] = newName;
    });

    if (Object.keys(renames).length === 0) return;

    // Update all match documents in Firestore
    const matchesSnap = await getDocs(collection(db, "matches"));
    const batch = writeBatch(db);
    let updated = 0;

    matchesSnap.docs.forEach(d => {
        if (d.id.startsWith('_')) return;
        const data = d.data();
        let changed = false;
        const newData = { ...data };
        if (renames[data.homeTeam]) { newData.homeTeam = renames[data.homeTeam]; changed = true; }
        if (renames[data.awayTeam]) { newData.awayTeam = renames[data.awayTeam]; changed = true; }
        if (changed) { batch.set(doc(db, "matches", d.id), newData); updated++; }
    });

    if (updated > 0) {
        await batch.commit();
        // Update local data too
        allMatches.forEach(m => {
            if (renames[m.homeTeam]) m.homeTeam = renames[m.homeTeam];
            if (renames[m.awayTeam]) m.awayTeam = renames[m.awayTeam];
        });
        renderAdminMatches(currentAdminGroup);
        renderTeamRenames();
    }
}

// ─── SCORING CONFIG ────────────────────────────────
const SCORING_LABELS = {
    matchResult: 'Rätt 1X2 (per match)',
    matchHomeGoals: 'Rätt hemmalag mål (per match)',
    matchAwayGoals: 'Rätt bortalag mål (per match)',
    exactScore: 'Bonus exakt rätt resultat (per match)',
    groupWinner: 'Rätt gruppetta (per grupp)',
    groupRunnerUp: 'Rätt grupptvåa (per grupp)',
    groupThird: 'Rätt grupptrea (per grupp)',
    koR32: 'Rätt lag vidare R32 (per lag)',
    koR16: 'Rätt lag vidare R16 (per lag)',
    koQF: 'Rätt lag vidare KF (per lag)',
    koSF: 'Rätt lag vidare SF (per lag)',
    koFinal: 'Rätt VM-mästare',
};

async function renderScoringConfig() {
    const container = document.getElementById('admin-scoring');
    const settingsSnap = await getDoc(doc(db, "matches", "_settings"));
    const settings = settingsSnap.exists() ? settingsSnap.data() : {};
    const current = { ...DEFAULT_SCORING, ...(settings.scoring || {}) };

    let html = '<div class="scoring-grid">';
    // Group into sections
    const sections = [
        { title: 'Gruppspel — Matcher', keys: ['matchResult', 'matchHomeGoals', 'matchAwayGoals', 'exactScore'] },
        { title: 'Gruppspel — Placeringar', keys: ['groupWinner', 'groupRunnerUp', 'groupThird'] },
        { title: 'Slutspel', keys: ['koR32', 'koR16', 'koQF', 'koSF', 'koFinal'] },
    ];

    sections.forEach(section => {
        html += `<div class="scoring-section"><h4 style="margin:0 0 8px; font-size:14px; color:#555;">${section.title}</h4>`;
        section.keys.forEach(key => {
            html += `<div class="scoring-row">
                <label>${SCORING_LABELS[key]}</label>
                <input type="number" min="0" class="scoring-input" data-key="${key}" value="${current[key]}" style="width:50px; text-align:center; padding:4px; border:1px solid #ddd; border-radius:4px; font-size:14px; font-weight:600;">
                <span style="color:#999; font-size:12px;">p</span>
            </div>`;
        });
        html += `</div>`;
    });
    html += '</div>';
    html += '<button class="btn" id="admin-save-scoring" style="margin-top:12px; width:100%;">Spara poänginställningar</button>';
    container.innerHTML = html;

    document.getElementById('admin-save-scoring').addEventListener('click', saveScoringConfig);
}

async function saveScoringConfig() {
    const scoring = {};
    document.querySelectorAll('.scoring-input').forEach(input => {
        scoring[input.dataset.key] = parseInt(input.value) || 0;
    });
    await setDoc(doc(db, "matches", "_settings"), { scoring }, { merge: true });
    // Visual feedback
    const btn = document.getElementById('admin-save-scoring');
    btn.textContent = '✓ Sparat!';
    btn.style.background = '#28a745';
    setTimeout(() => { btn.textContent = 'Spara poänginställningar'; btn.style.background = ''; }, 2000);
}

// ─── ADMIN BRACKET BUILDER ──────────────────────────
function getGroupStandings() {
    const standings = {};
    GROUP_LETTERS.forEach(letter => {
        const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);
        if (groupMatches.length === 0) return;
        const teams = {};
        groupMatches.forEach(m => {
            if (!teams[m.homeTeam]) teams[m.homeTeam] = { name: m.homeTeam, pts: 0, gd: 0, gf: 0 };
            if (!teams[m.awayTeam]) teams[m.awayTeam] = { name: m.awayTeam, pts: 0, gd: 0, gf: 0 };
            const r = existingResults[m.id];
            if (!r || r.homeScore === undefined) return;
            const h = r.homeScore, a = r.awayScore;
            teams[m.homeTeam].gf += h; teams[m.homeTeam].gd += (h - a);
            teams[m.awayTeam].gf += a; teams[m.awayTeam].gd += (a - h);
            if (h > a) teams[m.homeTeam].pts += 3;
            else if (a > h) teams[m.awayTeam].pts += 3;
            else { teams[m.homeTeam].pts += 1; teams[m.awayTeam].pts += 1; }
        });
        const sorted = Object.values(teams).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
        standings[letter] = sorted;
    });
    return standings;
}

function getAllTeamsForAutocomplete() {
    // Only include real nation names from group stage matches (not knockout placeholders like "1A", "3A/B/C/D/F")
    const teams = new Set();
    allMatches.forEach(m => {
        if (!m.stage || !m.stage.startsWith('Grupp ')) return;
        if (m.homeTeam) teams.add(m.homeTeam);
        if (m.awayTeam) teams.add(m.awayTeam);
    });
    return Array.from(teams).sort();
}

function renderMatchCard(round, matchIdx, match, side) {
    // side: 'left' or 'right' (affects connector direction)
    return `<div class="abt-match" data-round="${round}" data-idx="${matchIdx}">
        <div class="abt-team-row">
            <input class="admin-bracket-team abt-input" data-round="${round}" data-match="${matchIdx}" data-side="1" value="${match.team1 || ''}" placeholder="Lag 1" list="team-autocomplete">
            <input type="number" class="admin-bracket-score abt-score" data-round="${round}" data-match="${matchIdx}" data-side="1" value="${match.score1 ?? ''}" placeholder="-">
        </div>
        <div class="abt-team-row">
            <input class="admin-bracket-team abt-input" data-round="${round}" data-match="${matchIdx}" data-side="2" value="${match.team2 || ''}" placeholder="Lag 2" list="team-autocomplete">
            <input type="number" class="admin-bracket-score abt-score" data-round="${round}" data-match="${matchIdx}" data-side="2" value="${match.score2 ?? ''}" placeholder="-">
        </div>
    </div>`;
}

async function renderAdminBracket() {
    const container = document.getElementById('admin-bracket');
    const bracketSnap = await getDoc(doc(db, "matches", "_bracket"));
    const bracket = bracketSnap.exists() ? bracketSnap.data() : { teams: [], rounds: {} };
    const rd = bracket.rounds || {};

    const standings = getGroupStandings();
    const allTeams = getAllTeamsForAutocomplete();

    // Qualified teams summary
    let html = '';
    const hasStandings = Object.keys(standings).length > 0;
    if (hasStandings) {
        html += `<div style="margin-bottom:15px;">`;
        html += `<h4 style="margin:0 0 8px; font-size:14px; color:#555;">Kvalificerade lag från gruppspelet</h4>`;
        html += `<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:4px; font-size:12px; margin-bottom:10px;">`;
        GROUP_LETTERS.forEach(letter => {
            const s = standings[letter];
            if (!s || s.length < 2) return;
            html += `<div><strong>Grupp ${letter}:</strong> ${f(s[0].name)}${s[0].name} · ${f(s[1].name)}${s[1].name}</div>`;
        });
        html += `</div>`;
        html += `<button class="btn" id="admin-autofill-r32" style="background:#17a2b8; margin-bottom:10px;">Autofyll R32 från gruppresultat</button>`;
        html += `</div>`;
    }

    // Datalist for autocomplete
    html += `<datalist id="team-autocomplete">`;
    allTeams.forEach(t => { html += `<option value="${t}">`; });
    html += `</datalist>`;

    // ── BUILD BRACKET TREE ──────────────────────────
    // Left half: R32 matches 0-7 → R16 0-3 → KF 0-1 → SF 0
    // Right half: R32 matches 8-15 → R16 4-7 → KF 2-3 → SF 1
    // Center: Final

    const leftRounds = [
        { key: 'R32', label: 'Åttondelsfinal', start: 0, count: 8 },
        { key: 'R16', label: 'Sextondelsfinal', start: 0, count: 4 },
        { key: 'KF',  label: 'Kvartsfinal', start: 0, count: 2 },
        { key: 'SF',  label: 'Semifinal', start: 0, count: 1 },
    ];
    const rightRounds = [
        { key: 'SF',  label: 'Semifinal', start: 1, count: 1 },
        { key: 'KF',  label: 'Kvartsfinal', start: 2, count: 2 },
        { key: 'R16', label: 'Sextondelsfinal', start: 4, count: 4 },
        { key: 'R32', label: 'Åttondelsfinal', start: 8, count: 8 },
    ];

    html += `<div class="abt-tree">`;

    // Left half
    leftRounds.forEach((round, ri) => {
        html += `<div class="abt-round abt-round-left abt-depth-${ri}">`;
        html += `<div class="abt-round-label">${round.label}</div>`;
        html += `<div class="abt-round-matches">`;
        for (let i = 0; i < round.count; i++) {
            const matchIdx = round.start + i;
            const match = (rd[round.key] || [])[matchIdx] || {};
            html += `<div class="abt-match-wrapper abt-mw-d${ri}">`;
            html += renderMatchCard(round.key, matchIdx, match, 'left');
            html += `</div>`;
        }
        html += `</div></div>`;
    });

    // Final (center)
    const finalMatch = (rd['Final'] || [])[0] || {};
    html += `<div class="abt-round abt-round-final">`;
    html += `<div class="abt-round-label abt-final-label">FINAL</div>`;
    html += `<div class="abt-round-matches">`;
    html += `<div class="abt-match-wrapper abt-mw-final">`;
    html += renderMatchCard('Final', 0, finalMatch, 'center');
    html += `</div>`;
    html += `</div></div>`;

    // Right half (mirrored)
    rightRounds.forEach((round, ri) => {
        const depth = 3 - ri; // SF=3, KF=2, R16=1, R32=0
        html += `<div class="abt-round abt-round-right abt-depth-${depth}">`;
        html += `<div class="abt-round-label">${round.label}</div>`;
        html += `<div class="abt-round-matches">`;
        for (let i = 0; i < round.count; i++) {
            const matchIdx = round.start + i;
            const match = (rd[round.key] || [])[matchIdx] || {};
            html += `<div class="abt-match-wrapper abt-mw-d${depth}">`;
            html += renderMatchCard(round.key, matchIdx, match, 'right');
            html += `</div>`;
        }
        html += `</div></div>`;
    });

    html += `</div>`; // .abt-tree

    html += `<button class="btn" id="admin-save-bracket" style="margin-top: 15px; width: 100%; background: #ffc107; color: #000;">Spara bracket</button>`;
    container.innerHTML = html;

    // Wire autofill
    const autofillBtn = document.getElementById('admin-autofill-r32');
    if (autofillBtn) {
        autofillBtn.addEventListener('click', () => autofillR32(standings));
    }

    const rounds = ['R32', 'R16', 'KF', 'SF', 'Final'];
    const matchCounts = [16, 8, 4, 2, 1];
    document.getElementById('admin-save-bracket').addEventListener('click', () => saveAdminBracket(rounds, matchCounts));
    container.querySelectorAll('.abt-score').forEach(input => {
        input.addEventListener('change', () => autoAdvanceWinners(rounds, matchCounts));
    });
}

function autofillR32(standings) {
    const firsts = [], seconds = [], thirds = [];
    GROUP_LETTERS.forEach(letter => {
        const s = standings[letter];
        if (!s || s.length < 2) return;
        firsts.push({ name: s[0].name, group: letter });
        seconds.push({ name: s[1].name, group: letter });
        if (s.length >= 3) thirds.push({ ...s[2], group: letter });
    });
    thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    const qualifiedThirds = thirds.slice(0, 8);
    const allQualified = [...firsts, ...seconds, ...qualifiedThirds];

    for (let i = 0; i < 16; i++) {
        const t1 = allQualified[i]?.name || '';
        const t2 = allQualified[i + 16]?.name || '';
        const el1 = document.querySelector(`.admin-bracket-team[data-round="R32"][data-match="${i}"][data-side="1"]`);
        const el2 = document.querySelector(`.admin-bracket-team[data-round="R32"][data-match="${i}"][data-side="2"]`);
        if (el1) el1.value = t1;
        if (el2) el2.value = t2;
    }
}

function autoAdvanceWinners(rounds, matchCounts) {
    for (let ri = 0; ri < rounds.length - 1; ri++) {
        const round = rounds[ri], nextRound = rounds[ri + 1], count = matchCounts[ri];
        for (let i = 0; i < count; i++) {
            const t1El = document.querySelector(`.admin-bracket-team[data-round="${round}"][data-match="${i}"][data-side="1"]`);
            const t2El = document.querySelector(`.admin-bracket-team[data-round="${round}"][data-match="${i}"][data-side="2"]`);
            const s1El = document.querySelector(`.admin-bracket-score[data-round="${round}"][data-match="${i}"][data-side="1"]`);
            const s2El = document.querySelector(`.admin-bracket-score[data-round="${round}"][data-match="${i}"][data-side="2"]`);
            if (!t1El || !t2El || !s1El || !s2El || s1El.value === '' || s2El.value === '') continue;
            const s1 = parseInt(s1El.value), s2 = parseInt(s2El.value);
            const winner = s1 > s2 ? t1El.value : (s2 > s1 ? t2El.value : '');
            if (winner) {
                const nextEl = document.querySelector(`.admin-bracket-team[data-round="${nextRound}"][data-match="${Math.floor(i / 2)}"][data-side="${(i % 2) + 1}"]`);
                if (nextEl) nextEl.value = winner;
            }
        }
    }
}

async function saveAdminBracket(rounds, matchCounts) {
    const bracket = { rounds: {} };
    rounds.forEach((round, ri) => {
        bracket.rounds[round] = [];
        for (let i = 0; i < matchCounts[ri]; i++) {
            const t1 = document.querySelector(`.admin-bracket-team[data-round="${round}"][data-match="${i}"][data-side="1"]`)?.value || '';
            const t2 = document.querySelector(`.admin-bracket-team[data-round="${round}"][data-match="${i}"][data-side="2"]`)?.value || '';
            const s1 = document.querySelector(`.admin-bracket-score[data-round="${round}"][data-match="${i}"][data-side="1"]`)?.value;
            const s2 = document.querySelector(`.admin-bracket-score[data-round="${round}"][data-match="${i}"][data-side="2"]`)?.value;
            const match = { team1: t1, team2: t2 };
            if (s1 !== '' && s2 !== '' && s1 !== undefined && s2 !== undefined) {
                match.score1 = parseInt(s1); match.score2 = parseInt(s2);
                match.winner = match.score1 > match.score2 ? t1 : (match.score2 > match.score1 ? t2 : '');
            }
            bracket.rounds[round].push(match);
        }
    });
    bracket.teams = (bracket.rounds.R32 || []).flatMap(m => [m.team1, m.team2].filter(Boolean));
    await setDoc(doc(db, "matches", "_bracket"), bracket, { merge: true });
    // Visual feedback
    const btn = document.getElementById('admin-save-bracket');
    btn.textContent = '✓ Sparat!';
    setTimeout(() => { btn.textContent = 'Spara bracket'; }, 2000);
}

// ═══ TEST TOOLS ═══════════════════════════════════════════════

const FAKE_NAMES = [
    'Lure Drejeri', 'Bo Ring', 'Anna Conda', 'Sansen Dansen',
    'Bert-Ove Trollström', 'Göran-Göran Sansen', 'Ella Fansen',
    'Nansen Klansen', 'Bansen Kranström', 'Pransen Fjällqvist',
    'Hjansen Vransen', 'Stansen Brankvist', 'Fansen Grenqvist',
    'Dransen Ljungström', 'Klansen Glansen', 'Vransen Panström',
    'Gransen Bansen', 'Transen Kanström', 'Ljansen Stanström',
    'Bransen Pranström', 'Kansen Nansen', 'Glansen Fanström',
    'Fjansen Dranström', 'Pansen Granström', 'Dansen Hjanström',
    'Sansen Trollqvist', 'Kransen Vransen', 'Bert-Ansen Dansen',
    'Göran Granström', 'Nansen Nilström'
];
let fakeNameIdx = 0;

function showToast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}

async function addFakeTeachers() {
    const statusEl = document.getElementById('admin-fake-status');
    statusEl.textContent = 'Skapar fejklärare...';

    const groupTeams = {};
    GROUP_LETTERS.forEach(letter => {
        const teams = new Set();
        allMatches.filter(m => m.stage === `Grupp ${letter}`).forEach(m => {
            teams.add(m.homeTeam);
            teams.add(m.awayTeam);
        });
        groupTeams[letter] = Array.from(teams);
    });
    const allTeamsList = [...new Set(allMatches.filter(m => m.stage?.startsWith('Grupp')).flatMap(m => [m.homeTeam, m.awayTeam]))];
    const groupMatches = allMatches.filter(m => m.stage?.startsWith('Grupp'));

    // Offset name index by existing fake count
    const usersSnap = await getDocs(collection(db, "users"));
    const existingFakeCount = usersSnap.docs.filter(d => d.id.startsWith('fake_')).length;
    fakeNameIdx = existingFakeCount;

    for (let i = 0; i < 10; i++) {
        const name = FAKE_NAMES[(fakeNameIdx + i) % FAKE_NAMES.length];
        const fakeId = `fake_${Date.now()}_${i}`;

        const batch = writeBatch(db);

        batch.set(doc(db, "users", fakeId), { email: `${fakeId}@fake.test` });
        batch.set(doc(db, "users", fakeId, "tips", "_profile"), { name });

        // Group picks: random 1st/2nd per group
        const groupPicks = { mode: 'detailed', completedAt: new Date().toISOString() };
        GROUP_LETTERS.forEach(letter => {
            const teams = [...(groupTeams[letter] || [])].sort(() => Math.random() - 0.5);
            groupPicks[letter] = { first: teams[0], second: teams[1], third: teams[2], fourth: teams[3] };
        });
        batch.set(doc(db, "users", fakeId, "tips", "_groupPicks"), groupPicks);

        // Match tips: random scores for each group match
        groupMatches.forEach(m => {
            batch.set(doc(db, "users", fakeId, "tips", String(m.id)), {
                homeScore: Math.floor(Math.random() * 4),
                awayScore: Math.floor(Math.random() * 4),
                homeTeam: m.homeTeam, awayTeam: m.awayTeam,
                stage: m.stage
            });
        });

        // Knockout picks: random teams advancing
        const shuffled = [...allTeamsList].sort(() => Math.random() - 0.5);
        batch.set(doc(db, "users", fakeId, "tips", "_knockout"), {
            r32: shuffled.slice(0, 16),
            r16: shuffled.slice(0, 8),
            qf: shuffled.slice(0, 4),
            sf: shuffled.slice(0, 2),
            final: shuffled[0]
        });

        await batch.commit();
    }

    fakeNameIdx += 10;
    statusEl.textContent = `✓ 10 fejklärare tillagda! (${fakeNameIdx} totalt)`;
    setTimeout(() => { statusEl.textContent = ''; }, 4000);
}

async function removeFakeTeachers() {
    const statusEl = document.getElementById('admin-fake-status');
    statusEl.textContent = 'Tar bort fejklärare...';

    const usersSnap = await getDocs(collection(db, "users"));
    let removed = 0;

    for (const userDoc of usersSnap.docs) {
        if (!userDoc.id.startsWith('fake_')) continue;

        const tipsSnap = await getDocs(collection(db, "users", userDoc.id, "tips"));
        const batch = writeBatch(db);
        tipsSnap.forEach(tipDoc => {
            batch.delete(doc(db, "users", userDoc.id, "tips", tipDoc.id));
        });
        batch.delete(doc(db, "users", userDoc.id));
        await batch.commit();
        removed++;
    }

    fakeNameIdx = 0;
    statusEl.textContent = `✓ ${removed} fejklärare borttagna!`;
    setTimeout(() => { statusEl.textContent = ''; }, 4000);
}

async function autoFillGroupResults() {
    const resultsSnap = await getDoc(doc(db, "matches", "_results"));
    const results = resultsSnap.exists() ? resultsSnap.data() : {};

    const groupMatches = allMatches.filter(m => m.stage?.startsWith('Grupp'));
    let filled = 0;
    groupMatches.forEach(m => {
        if (results[m.id]?.homeScore !== undefined) return;
        results[m.id] = {
            homeScore: Math.floor(Math.random() * 5),
            awayScore: Math.floor(Math.random() * 5),
            homeTeam: m.homeTeam, awayTeam: m.awayTeam,
            stage: m.stage, date: m.date
        };
        filled++;
    });

    await setDoc(doc(db, "matches", "_results"), results);
    existingResults = results;
    renderGroupButtons();
    renderAdminMatches(currentAdminGroup);
    showToast(`${filled} gruppresultat autofyllda!`);
}

async function clearGroupResults() {
    await setDoc(doc(db, "matches", "_results"), {});
    existingResults = {};
    renderGroupButtons();
    renderAdminMatches(currentAdminGroup);
    showToast('Alla gruppresultat rensade!');
}

async function autoFillKnockoutRound(targetRound) {
    const bracketSnap = await getDoc(doc(db, "matches", "_bracket"));
    const bracket = bracketSnap.exists() ? bracketSnap.data() : { teams: [], rounds: {} };
    if (!bracket.rounds) bracket.rounds = {};

    const rounds = ['R32', 'R16', 'KF', 'SF', 'Final'];
    const matchCounts = { R32: 16, R16: 8, KF: 4, SF: 2, Final: 1 };

    // For R32: populate teams from group standings if empty
    if (targetRound === 'R32') {
        if (!bracket.rounds.R32) bracket.rounds.R32 = [];
        const hasTeams = bracket.rounds.R32.some(m => m?.team1);
        if (!hasTeams) {
            const standings = getGroupStandings();
            const firsts = [], seconds = [], thirds = [];
            GROUP_LETTERS.forEach(letter => {
                const s = standings[letter];
                if (!s || s.length < 2) return;
                firsts.push(s[0].name);
                seconds.push(s[1].name);
                if (s.length >= 3) thirds.push(s[2]);
            });
            thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
            const qualifiedThirds = thirds.slice(0, 8).map(t => t.name);
            const allQualified = [...firsts, ...seconds, ...qualifiedThirds];
            for (let i = 0; i < 16; i++) {
                if (!bracket.rounds.R32[i]) bracket.rounds.R32[i] = {};
                bracket.rounds.R32[i].team1 = allQualified[i] || '';
                bracket.rounds.R32[i].team2 = allQualified[i + 16] || '';
            }
        }
    } else {
        // Advance winners from previous round
        const prevRoundIdx = rounds.indexOf(targetRound) - 1;
        if (prevRoundIdx >= 0) {
            const prevRound = rounds[prevRoundIdx];
            if (!bracket.rounds[targetRound]) bracket.rounds[targetRound] = [];
            const prevMatches = bracket.rounds[prevRound] || [];
            for (let i = 0; i < prevMatches.length; i++) {
                const m = prevMatches[i];
                if (m?.winner) {
                    const nextIdx = Math.floor(i / 2);
                    if (!bracket.rounds[targetRound][nextIdx]) bracket.rounds[targetRound][nextIdx] = {};
                    if (i % 2 === 0) {
                        bracket.rounds[targetRound][nextIdx].team1 = m.winner;
                    } else {
                        bracket.rounds[targetRound][nextIdx].team2 = m.winner;
                    }
                }
            }
        }
    }

    // Generate random non-draw scores
    const count = matchCounts[targetRound];
    let filled = 0;
    for (let i = 0; i < count; i++) {
        if (!bracket.rounds[targetRound]) bracket.rounds[targetRound] = [];
        if (!bracket.rounds[targetRound][i]) bracket.rounds[targetRound][i] = {};
        const match = bracket.rounds[targetRound][i];
        if (!match.team1 || !match.team2) continue;
        if (match.winner) continue;

        let s1, s2;
        do {
            s1 = Math.floor(Math.random() * 4);
            s2 = Math.floor(Math.random() * 4);
        } while (s1 === s2);

        match.score1 = s1;
        match.score2 = s2;
        match.winner = s1 > s2 ? match.team1 : match.team2;
        filled++;
    }

    // Auto-advance winners to next round
    const roundIdx = rounds.indexOf(targetRound);
    if (roundIdx < rounds.length - 1) {
        const nextRound = rounds[roundIdx + 1];
        if (!bracket.rounds[nextRound]) bracket.rounds[nextRound] = [];
        for (let i = 0; i < count; i++) {
            const match = bracket.rounds[targetRound][i];
            if (!match?.winner) continue;
            const nextIdx = Math.floor(i / 2);
            if (!bracket.rounds[nextRound][nextIdx]) bracket.rounds[nextRound][nextIdx] = {};
            if (i % 2 === 0) {
                bracket.rounds[nextRound][nextIdx].team1 = match.winner;
            } else {
                bracket.rounds[nextRound][nextIdx].team2 = match.winner;
            }
        }
    }

    bracket.teams = (bracket.rounds.R32 || []).flatMap(m => [m.team1, m.team2].filter(Boolean));
    await setDoc(doc(db, "matches", "_bracket"), bracket);
    await renderAdminBracket();
    showToast(`${targetRound}: ${filled} matcher autofyllda!`);
}

async function clearKnockoutResults() {
    const bracketSnap = await getDoc(doc(db, "matches", "_bracket"));
    const bracket = bracketSnap.exists() ? bracketSnap.data() : { teams: [], rounds: {} };

    // Remove scores and winners, but keep R32 teams
    ['R32', 'R16', 'KF', 'SF', 'Final'].forEach(round => {
        (bracket.rounds[round] || []).forEach(m => {
            delete m.score1; delete m.score2; delete m.winner;
        });
    });
    // Clear teams from R16 onwards (they're derived from results)
    ['R16', 'KF', 'SF', 'Final'].forEach(round => {
        (bracket.rounds[round] || []).forEach(m => {
            m.team1 = ''; m.team2 = '';
        });
    });

    await setDoc(doc(db, "matches", "_bracket"), bracket);
    await renderAdminBracket();
    showToast('Slutspelsresultat rensade!');
}

async function clearKnockoutTeams() {
    await setDoc(doc(db, "matches", "_bracket"), { teams: [], rounds: {} });
    await renderAdminBracket();
    showToast('Hela bracketen rensad!');
}

export async function checkTipsLocked() {
    const snap = await getDoc(doc(db, "matches", "_settings"));
    return snap.exists() && snap.data().tipsLocked === true;
}
