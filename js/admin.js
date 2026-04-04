import { db } from './config.js';
import { doc, getDoc, setDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f, flags } from './wizard.js';
import { DEFAULT_SCORING } from './stats.js';
import { renderAdminBracket } from './admin-bracket.js';
import { addFakeTeachers, removeFakeTeachers, autoFillGroupResults, clearGroupResults, autoFillKnockoutRound, clearKnockoutResults, clearKnockoutTeams, renderMatchManager } from './admin-testtools.js';
import { initEmailDraft } from './admin-email.js';
import { initThemeEditor } from './admin-theme.js';
import { initBackup } from './admin-backup.js';
import { initTournament } from './admin-tournament.js';

import { getGroupLetters, getKnockoutRounds, getTournamentYear, getFinalRound, getChampionLabel } from './tournament-config.js';
export let allMatches = [];
export let currentAdminGroup = 'A';
export let existingResults = {};
let initDone = false;

// Bump dataVersion in _settings so clients know to invalidate their stats cache
export async function bumpDataVersion() {
    await setDoc(doc(db, "matches", "_settings"), { dataVersion: Date.now() }, { merge: true });
}

export async function initAdmin(matchesData) {
    allMatches = matchesData;
    await refreshLockStatus();

    const resultsSnap = await getDoc(doc(db, "matches", "_results"));
    existingResults = resultsSnap.exists() ? resultsSnap.data() : {};

    currentAdminGroup = getGroupLetters().find(letter => {
        const gm = allMatches.filter(m => m.stage === `Grupp ${letter}`);
        return gm.some(m => !existingResults[m.id]);
    }) || 'A';

    renderGroupButtons();
    renderAdminMatches(currentAdminGroup);
    renderTeamRenames();
    renderScoringConfig();
    renderAdminBracket();
    renderMatchManager();

    if (!initDone) {
        // Admin sub-tab navigation
        document.querySelectorAll('.admin-nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.admin-nav-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('.admin-sub-content').forEach(c => c.classList.remove('active'));
                document.getElementById(btn.dataset.adminTab).classList.add('active');
            });
        });

        document.getElementById('admin-lock-tips').addEventListener('click', () => toggleLock(true));
        document.getElementById('admin-unlock-tips').addEventListener('click', () => toggleLock(false));
        document.getElementById('admin-toggle-tips-visible').addEventListener('click', toggleTipsVisible);
        document.getElementById('admin-save-results').addEventListener('click', saveAdminResults);

        // Email draft
        initEmailDraft();

        // Theme editor
        initThemeEditor();

        // Backup/restore
        initBackup();

        // Tournament management
        initTournament();

        // Test tools
        document.getElementById('admin-add-fake-teachers').addEventListener('click', addFakeTeachers);
        document.getElementById('admin-remove-fake-teachers').addEventListener('click', removeFakeTeachers);
        document.getElementById('admin-autofill-group-results').addEventListener('click', autoFillGroupResults);
        document.getElementById('admin-clear-group-results').addEventListener('click', clearGroupResults);
        const koRoundBtns = {
            'admin-autofill-ko-r32': 'R32', 'admin-autofill-ko-r16': 'R16',
            'admin-autofill-ko-qf': 'KF', 'admin-autofill-ko-sf': 'SF',
            'admin-autofill-ko-final': 'Final'
        };
        Object.entries(koRoundBtns).forEach(([id, key]) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', () => autoFillKnockoutRound(key));
        });
        document.getElementById('admin-clear-ko-results').addEventListener('click', clearKnockoutResults);
        document.getElementById('admin-clear-ko-teams').addEventListener('click', clearKnockoutTeams);
        initDone = true;
    }
}

export function renderGroupButtons() {
    const groupSelect = document.getElementById('admin-group-select');
    groupSelect.innerHTML = '';
    const now = Date.now();

    getGroupLetters().forEach(letter => {
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

function parseMatchDate(dateStr) {
    if (!dateStr) return null;
    const months = { 'januari': 0, 'februari': 1, 'mars': 2, 'april': 3, 'maj': 4, 'juni': 5, 'juli': 6, 'augusti': 7, 'september': 8, 'oktober': 9, 'november': 10, 'december': 11 };
    const parts = dateStr.trim().match(/^(\d+)\s+(\w+)\s+(\d{1,2}):(\d{2})$/);
    if (!parts) return null;
    const day = parseInt(parts[1]);
    const month = months[parts[2].toLowerCase()];
    if (month === undefined) return null;
    return new Date(getTournamentYear(), month, day, parseInt(parts[3]), parseInt(parts[4]));
}

function isOverdue(dateStr, now) {
    const d = parseMatchDate(dateStr);
    if (!d) return false;
    return d.getTime() + 3 * 60 * 60 * 1000 < now;
}

async function refreshLockStatus() {
    const snap = await getDoc(doc(db, "matches", "_settings"));
    const settings = snap.exists() ? snap.data() : {};
    const lockBtn = document.getElementById('admin-lock-tips');
    const unlockBtn = document.getElementById('admin-unlock-tips');
    lockBtn.style.display = settings.tipsLocked ? 'none' : 'inline-block';
    unlockBtn.style.display = settings.tipsLocked ? 'inline-block' : 'none';
}

async function toggleLock(lock) {
    await setDoc(doc(db, "matches", "_settings"), { tipsLocked: lock }, { merge: true });
    refreshLockStatus();
}

async function toggleTipsVisible() {
    const snap = await getDoc(doc(db, "matches", "_settings"));
    const settings = snap.exists() ? snap.data() : {};
    const current = settings.tipsVisible !== false;
    await setDoc(doc(db, "matches", "_settings"), { tipsVisible: !current }, { merge: true });
    const btn = document.getElementById('admin-toggle-tips-visible');
    btn.textContent = !current ? '🔓 Tipsrader synliga för alla' : '🔒 Tipsrader dolda';
    btn.style.background = !current ? '#28a745' : '#6c757d';
}

export function renderAdminMatches(letter) {
    const container = document.getElementById('admin-matches');
    const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`).sort((a, b) => a.id - b.id);
    if (groupMatches.length === 0) { container.innerHTML = '<p>Inga matcher i denna grupp.</p>'; return; }
    let html = '';
    groupMatches.forEach(m => {
        const r = existingResults[m.id];
        const homeVal = r?.homeScore ?? '';
        const awayVal = r?.awayScore ?? '';
        const isDone = homeVal !== '' && awayVal !== '';
        const overdue = !isDone && isOverdue(m.date, Date.now());
        html += `<div class="admin-match-row ${isDone ? 'done' : ''} ${overdue ? 'overdue' : ''}">
            <span class="admin-match-label">${m.date || ''}</span>
            <span class="admin-match-home">${f(m.homeTeam)}${m.homeTeam}</span>
            <span class="admin-score-group">
                <input type="number" min="0" class="admin-score" data-match="${m.id}" data-side="home" value="${homeVal}" placeholder="-">
                <span class="admin-sep">–</span>
                <input type="number" min="0" class="admin-score" data-match="${m.id}" data-side="away" value="${awayVal}" placeholder="-">
            </span>
            <span class="admin-match-away">${m.awayTeam}${f(m.awayTeam)}</span>
        </div>`;
    });
    container.innerHTML = html;
}

async function saveAdminResults() {
    const inputs = document.querySelectorAll('.admin-score');
    const updates = {};
    inputs.forEach(input => {
        const matchId = input.dataset.match;
        if (!updates[matchId]) updates[matchId] = {};
        updates[matchId][input.dataset.side] = input.value !== '' ? parseInt(input.value) : undefined;
    });

    Object.entries(updates).forEach(([matchId, scores]) => {
        if (scores.home !== undefined && scores.away !== undefined) {
            const m = allMatches.find(m2 => String(m2.id) === matchId);
            existingResults[matchId] = {
                homeScore: scores.home, awayScore: scores.away,
                homeTeam: m?.homeTeam, awayTeam: m?.awayTeam,
                stage: m?.stage, date: m?.date
            };
        }
    });

    await setDoc(doc(db, "matches", "_results"), existingResults);
    await bumpDataVersion();
    renderGroupButtons();
    const btn = document.getElementById('admin-save-results');
    btn.textContent = '✓ Sparat!';
    setTimeout(() => { btn.textContent = 'Spara resultat'; }, 2000);
}

function renderTeamRenames() {
    const container = document.getElementById('admin-team-rename');
    const teams = new Set();
    allMatches.forEach(m => {
        if (m.homeTeam) teams.add(m.homeTeam);
        if (m.awayTeam) teams.add(m.awayTeam);
    });
    // Only show teams that don't have a known flag (unclear qualification names)
    const unclearTeams = [...teams].filter(t => !flags[t]).sort();
    if (unclearTeams.length === 0) {
        container.innerHTML = '<p style="color:#28a745; font-size:13px;">✓ Alla lag har kända namn — inget att döpa om.</p>';
        return;
    }
    let html = '<div style="max-height: 300px; overflow-y: auto; border: 1px solid #eee; border-radius: 8px; padding: 10px;">';
    unclearTeams.forEach(team => {
        html += `<div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; font-size:13px;">
            <span style="min-width:140px; font-weight:600; color:#dc3545;">${team}</span>
            <span>→</span>
            <input class="admin-rename-input" data-old="${team}" value="${team}" style="flex:1; padding:4px 8px; border:1px solid #ddd; border-radius:4px; font-size:13px;">
        </div>`;
    });
    html += '</div>';
    html += `<button class="btn" id="admin-save-renames" style="margin-top:10px; width:100%; background:#ffc107; color:#000;">Spara namnändringar</button>`;
    container.innerHTML = html;
    document.getElementById('admin-save-renames').addEventListener('click', saveTeamRenames);
}

async function saveTeamRenames() {
    const inputs = document.querySelectorAll('.admin-rename-input');
    const renames = {};
    inputs.forEach(input => {
        const oldName = input.dataset.old;
        const newName = input.value.trim();
        if (newName && newName !== oldName) renames[oldName] = newName;
    });

    if (Object.keys(renames).length === 0) return;

    // Rename in match documents
    const snap = await getDocs(collection(db, "matches"));
    for (const matchDoc of snap.docs) {
        if (matchDoc.id.startsWith('_')) continue;
        const data = matchDoc.data();
        let changed = false;
        if (renames[data.homeTeam]) { data.homeTeam = renames[data.homeTeam]; changed = true; }
        if (renames[data.awayTeam]) { data.awayTeam = renames[data.awayTeam]; changed = true; }
        if (changed) await setDoc(doc(db, "matches", matchDoc.id), data);
    }

    // Rename in results
    const resultsSnap = await getDoc(doc(db, "matches", "_results"));
    if (resultsSnap.exists()) {
        const results = resultsSnap.data();
        let changed = false;
        Object.values(results).forEach(r => {
            if (renames[r.homeTeam]) { r.homeTeam = renames[r.homeTeam]; changed = true; }
            if (renames[r.awayTeam]) { r.awayTeam = renames[r.awayTeam]; changed = true; }
        });
        if (changed) await setDoc(doc(db, "matches", "_results"), results);
    }

    await bumpDataVersion();
    const btn = document.getElementById('admin-save-renames');
    btn.textContent = '✓ Sparat!';
    btn.style.background = '#28a745';
    setTimeout(() => { btn.textContent = 'Spara namnändringar'; btn.style.background = ''; }, 2000);
}

async function renderScoringConfig() {
    const snap = await getDoc(doc(db, "matches", "_settings"));
    const settings = snap.exists() ? snap.data() : {};
    const scoring = { ...DEFAULT_SCORING, ...(settings.scoring || {}) };

    const container = document.getElementById('admin-scoring');
    const labels = {
        matchResult: 'Rätt 1X2', matchHomeGoals: 'Rätt hemmalag mål',
        matchAwayGoals: 'Rätt bortalag mål', exactScore: 'Bonus exakt resultat',
        groupWinner: 'Rätt gruppetta', groupRunnerUp: 'Rätt grupptvåa', groupThird: 'Rätt grupptrea',
    };
    const koRounds = getKnockoutRounds();
    const finalRd = getFinalRound();
    koRounds.forEach(r => {
        labels[`ko_${r.key}`] = r === finalRd ? `Rätt ${getChampionLabel().replace(/^Ditt\s+/i, '')}` : `Rätt lag ${r.label}`;
    });
    let html = '<div style="display:grid; grid-template-columns: 1fr 60px; gap:4px 12px; max-width:400px;">';
    Object.entries(labels).forEach(([key, label]) => {
        html += `<label style="font-size:13px; align-self:center;">${label}</label>`;
        html += `<input type="number" min="0" class="admin-scoring-input" data-key="${key}" value="${scoring[key]}" style="width:60px; padding:4px; text-align:center; border:1px solid #ddd; border-radius:4px;">`;
    });
    html += '</div>';
    html += `<button class="btn" id="admin-save-scoring" style="margin-top:10px; background:#ffc107; color:#000;">Spara poänginställningar</button>`;
    container.innerHTML = html;
    document.getElementById('admin-save-scoring').addEventListener('click', saveScoringConfig);
}

async function saveScoringConfig() {
    const inputs = document.querySelectorAll('.admin-scoring-input');
    const scoring = {};
    inputs.forEach(input => { scoring[input.dataset.key] = parseInt(input.value) || 0; });
    await setDoc(doc(db, "matches", "_settings"), { scoring }, { merge: true });
    await bumpDataVersion();
    const btn = document.getElementById('admin-save-scoring');
    btn.textContent = '✓ Sparat!';
    btn.style.background = '#28a745';
    setTimeout(() => { btn.textContent = 'Spara poänginställningar'; btn.style.background = ''; }, 2000);
}

export async function checkTipsLocked() {
    const snap = await getDoc(doc(db, "matches", "_settings"));
    const settings = snap.exists() ? snap.data() : {};
    return { locked: settings.tipsLocked === true, settings };
}
