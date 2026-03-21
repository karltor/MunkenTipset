import { db } from './config.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f } from './wizard.js';

const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
let allMatches = [];
let currentAdminGroup = 'A';
let existingResults = {};
let initDone = false;

export async function initAdmin(matchesData) {
    allMatches = matchesData;
    await refreshLockStatus();

    // Load existing results once
    const resultsSnap = await getDoc(doc(db, "matches", "_results"));
    existingResults = resultsSnap.exists() ? resultsSnap.data() : {};

    // Find first group with unplayed matches
    currentAdminGroup = GROUP_LETTERS.find(letter => {
        const gm = allMatches.filter(m => m.stage === `Grupp ${letter}`);
        return gm.some(m => !existingResults[m.id]);
    }) || 'A';

    const groupSelect = document.getElementById('admin-group-select');
    groupSelect.innerHTML = '';
    GROUP_LETTERS.forEach(letter => {
        const gm = allMatches.filter(m => m.stage === `Grupp ${letter}`);
        const allDone = gm.every(m => existingResults[m.id]);
        const btn = document.createElement('button');
        btn.className = 'admin-group-btn' + (letter === currentAdminGroup ? ' active' : '');
        btn.textContent = `${letter}`;
        if (allDone) btn.style.opacity = '0.5';
        btn.addEventListener('click', () => {
            currentAdminGroup = letter;
            groupSelect.querySelectorAll('.admin-group-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderAdminMatches(letter);
        });
        groupSelect.appendChild(btn);
    });

    renderAdminMatches(currentAdminGroup);
    renderAdminBracket();

    if (!initDone) {
        document.getElementById('admin-lock-tips').addEventListener('click', () => toggleLock(true));
        document.getElementById('admin-unlock-tips').addEventListener('click', () => toggleLock(false));
        document.getElementById('admin-save-results').addEventListener('click', saveAdminResults);
        initDone = true;
    }
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

function renderAdminMatches(letter) {
    const container = document.getElementById('admin-matches');
    let groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);

    if (groupMatches.length === 0) {
        container.innerHTML = '<p style="color: #999;">Inga matcher i denna grupp.</p>';
        return;
    }

    // Sort: unplayed first (by date), then played
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
            <span style="flex:1; text-align:right; font-weight:600;">${m.awayTeam}${f(m.awayTeam)}</span>`;
        container.appendChild(div);
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
                homeTeam: m.homeTeam, awayTeam: m.awayTeam, stage: m.stage
            };
            saved++;
        }
    });
    if (!saved) return;
    await setDoc(doc(db, "matches", "_results"), existingResults, { merge: true });
    renderAdminMatches(currentAdminGroup);

    // Refresh group buttons opacity
    document.querySelectorAll('#admin-group-select .admin-group-btn').forEach((btn, i) => {
        const letter = GROUP_LETTERS[i];
        const gm = allMatches.filter(m => m.stage === `Grupp ${letter}`);
        btn.style.opacity = gm.every(m => existingResults[m.id]) ? '0.5' : '1';
    });
}

// ─── ADMIN BRACKET BUILDER ──────────────────────────
async function renderAdminBracket() {
    const container = document.getElementById('admin-bracket');
    const bracketSnap = await getDoc(doc(db, "matches", "_bracket"));
    const bracket = bracketSnap.exists() ? bracketSnap.data() : { teams: [], rounds: {} };

    const rounds = ['R32', 'R16', 'KF', 'SF', 'Final'];
    const matchCounts = [16, 8, 4, 2, 1];

    let html = `<div style="overflow-x: auto;">`;
    html += `<div style="display: flex; gap: 10px; min-width: 900px;">`;

    rounds.forEach((round, ri) => {
        const count = matchCounts[ri];
        const roundMatches = bracket.rounds?.[round] || [];

        html += `<div style="flex: 1; min-width: 160px;">`;
        html += `<div style="text-align:center; font-weight:700; font-size:13px; margin-bottom:8px; color: ${ri === 4 ? '#ffc107' : '#333'};">${round}</div>`;

        for (let i = 0; i < count; i++) {
            const match = roundMatches[i] || {};
            const t1 = match.team1 || '';
            const t2 = match.team2 || '';
            const s1 = match.score1 ?? '';
            const s2 = match.score2 ?? '';

            html += `<div style="background:#f0f0f0; border-radius:6px; padding:6px; margin-bottom:6px; font-size:12px;">`;
            html += `<div style="display:flex; gap:4px; margin-bottom:3px;">
                <input class="admin-bracket-team" data-round="${round}" data-match="${i}" data-side="1" value="${t1}" placeholder="Lag 1" style="flex:1; padding:4px; border:1px solid #ddd; border-radius:4px; font-size:12px;">
                <input type="number" class="admin-bracket-score" data-round="${round}" data-match="${i}" data-side="1" value="${s1}" placeholder="-" style="width:30px; text-align:center; border:1px solid #ddd; border-radius:4px; font-size:12px;">
            </div>`;
            html += `<div style="display:flex; gap:4px;">
                <input class="admin-bracket-team" data-round="${round}" data-match="${i}" data-side="2" value="${t2}" placeholder="Lag 2" style="flex:1; padding:4px; border:1px solid #ddd; border-radius:4px; font-size:12px;">
                <input type="number" class="admin-bracket-score" data-round="${round}" data-match="${i}" data-side="2" value="${s2}" placeholder="-" style="width:30px; text-align:center; border:1px solid #ddd; border-radius:4px; font-size:12px;">
            </div>`;
            html += `</div>`;
        }
        html += `</div>`;
    });

    html += `</div></div>`;
    html += `<button class="btn" id="admin-save-bracket" style="margin-top: 15px; width: 100%; background: #ffc107; color: #000;">Spara bracket</button>`;

    container.innerHTML = html;

    document.getElementById('admin-save-bracket').addEventListener('click', () => saveAdminBracket(rounds, matchCounts));

    // Auto-advance winners when scores are entered
    container.querySelectorAll('.admin-bracket-score').forEach(input => {
        input.addEventListener('change', () => autoAdvanceWinners(rounds, matchCounts));
    });
}

function autoAdvanceWinners(rounds, matchCounts) {
    for (let ri = 0; ri < rounds.length - 1; ri++) {
        const round = rounds[ri];
        const nextRound = rounds[ri + 1];
        const count = matchCounts[ri];

        for (let i = 0; i < count; i++) {
            const t1El = document.querySelector(`.admin-bracket-team[data-round="${round}"][data-match="${i}"][data-side="1"]`);
            const t2El = document.querySelector(`.admin-bracket-team[data-round="${round}"][data-match="${i}"][data-side="2"]`);
            const s1El = document.querySelector(`.admin-bracket-score[data-round="${round}"][data-match="${i}"][data-side="1"]`);
            const s2El = document.querySelector(`.admin-bracket-score[data-round="${round}"][data-match="${i}"][data-side="2"]`);

            if (!t1El || !t2El || !s1El || !s2El) continue;
            if (s1El.value === '' || s2El.value === '') continue;

            const s1 = parseInt(s1El.value), s2 = parseInt(s2El.value);
            const winner = s1 > s2 ? t1El.value : (s2 > s1 ? t2El.value : '');

            if (winner) {
                const nextMatchIdx = Math.floor(i / 2);
                const nextSide = (i % 2) + 1;
                const nextEl = document.querySelector(`.admin-bracket-team[data-round="${nextRound}"][data-match="${nextMatchIdx}"][data-side="${nextSide}"]`);
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
}

export async function checkTipsLocked() {
    const snap = await getDoc(doc(db, "matches", "_settings"));
    return snap.exists() && snap.data().tipsLocked === true;
}
