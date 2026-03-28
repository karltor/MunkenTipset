import { db } from './config.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f } from './wizard.js';
import { bumpDataVersion, allMatches, existingResults } from './admin.js';

const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

export function getGroupStandings() {
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
    const teams = new Set();
    allMatches.forEach(m => {
        if (!m.stage || !m.stage.startsWith('Grupp ')) return;
        if (m.homeTeam) teams.add(m.homeTeam);
        if (m.awayTeam) teams.add(m.awayTeam);
    });
    return Array.from(teams).sort();
}

const MONTHS = ['juni', 'juli'];

function parseDateStr(dateStr) {
    if (!dateStr) return { day: '', month: '', time: '' };
    const m = dateStr.trim().match(/^(\d+)\s+(\w+)\s+(\d{1,2}:\d{2})$/);
    if (m) return { day: m[1], month: m[2].toLowerCase(), time: m[3] };
    return { day: '', month: '', time: '' };
}

function buildDateStr(round, matchIdx) {
    const prefix = `[data-round="${round}"][data-match="${matchIdx}"]`;
    const day = document.querySelector(`.abt-date-day${prefix}`)?.value || '';
    const month = document.querySelector(`.abt-date-month${prefix}`)?.value || '';
    const timeSelect = document.querySelector(`.abt-date-time${prefix}`)?.value || '';
    const timeCustom = document.querySelector(`.abt-date-time-custom${prefix}`)?.value || '';
    const time = timeSelect === 'custom' ? timeCustom : timeSelect;
    if (!day || !month || !time) return '';
    return `${day} ${month} ${time}`;
}

function renderMatchCard(round, matchIdx, match, side) {
    const { day, month, time } = parseDateStr(match.date || '');
    const dayOpts = '<option value="">--</option>' + Array.from({ length: 31 }, (_, i) => {
        const d = String(i + 1);
        return `<option value="${d}"${d === day ? ' selected' : ''}>${d}</option>`;
    }).join('');
    const monthOpts = '<option value="">--</option>' + MONTHS.map(m =>
        `<option value="${m}"${m === month ? ' selected' : ''}>${m}</option>`
    ).join('');
    const standardTimes = ['15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00','03:00','04:00'];
    const isCustomTime = time && !standardTimes.includes(time);
    const timeOpts = '<option value="">--:--</option>' + standardTimes
        .map(t => `<option value="${t}"${t === time ? ' selected' : ''}>${t}</option>`).join('')
        + `<option value="custom"${isCustomTime ? ' selected' : ''}>Annan…</option>`;

    return `<div class="abt-match" data-round="${round}" data-idx="${matchIdx}">
        <div class="abt-team-row">
            <input class="admin-bracket-team abt-input" data-round="${round}" data-match="${matchIdx}" data-side="1" value="${match.team1 || ''}" placeholder="Lag 1" list="team-autocomplete">
            <input type="number" class="admin-bracket-score abt-score" data-round="${round}" data-match="${matchIdx}" data-side="1" value="${match.score1 ?? ''}" placeholder="-">
        </div>
        <div class="abt-team-row">
            <input class="admin-bracket-team abt-input" data-round="${round}" data-match="${matchIdx}" data-side="2" value="${match.team2 || ''}" placeholder="Lag 2" list="team-autocomplete">
            <input type="number" class="admin-bracket-score abt-score" data-round="${round}" data-match="${matchIdx}" data-side="2" value="${match.score2 ?? ''}" placeholder="-">
        </div>
        <div class="abt-date-row" style="display:flex; gap:3px; margin-top:3px;">
            <select class="abt-date-day" data-round="${round}" data-match="${matchIdx}" style="font-size:11px; padding:2px; border:1px solid #ddd; border-radius:4px; flex:0 0 42px;">${dayOpts}</select>
            <select class="abt-date-month" data-round="${round}" data-match="${matchIdx}" style="font-size:11px; padding:2px; border:1px solid #ddd; border-radius:4px; flex:1;">${monthOpts}</select>
            <select class="abt-date-time" data-round="${round}" data-match="${matchIdx}" style="font-size:11px; padding:2px; border:1px solid #ddd; border-radius:4px; flex:0 0 58px;">${timeOpts}</select>
            <input type="text" class="abt-date-time-custom" data-round="${round}" data-match="${matchIdx}" placeholder="HH:MM" value="${isCustomTime ? time : ''}" style="font-size:11px; padding:2px; border:1px solid #ddd; border-radius:4px; flex:0 0 50px; display:${isCustomTime ? 'block' : 'none'};">
        </div>
    </div>`;
}

export async function renderAdminBracket() {
    const container = document.getElementById('admin-bracket');
    const bracketSnap = await getDoc(doc(db, "matches", "_bracket"));
    const bracket = bracketSnap.exists() ? bracketSnap.data() : { teams: [], rounds: {} };
    const rd = bracket.rounds || {};

    const standings = getGroupStandings();
    const allTeams = getAllTeamsForAutocomplete();

    let html = '';
    const hasStandings = Object.keys(standings).length > 0;
    if (hasStandings) {
        html += `<div style="margin-bottom:15px;">`;
        html += `<button class="btn" id="admin-autofill-r32" style="background:#17a2b8;">Autofyll R32 från gruppresultat</button>`;
        html += `</div>`;
    }

    html += `<datalist id="team-autocomplete">`;
    allTeams.forEach(t => { html += `<option value="${t}">`; });
    html += `</datalist>`;

    const leftRounds = [
        { key: 'R32', label: 'Sextondelsfinal', start: 0, count: 8 },
        { key: 'R16', label: 'Åttondelsfinal', start: 0, count: 4 },
        { key: 'KF',  label: 'Kvartsfinal', start: 0, count: 2 },
        { key: 'SF',  label: 'Semifinal', start: 0, count: 1 },
    ];
    const rightRounds = [
        { key: 'SF',  label: 'Semifinal', start: 1, count: 1 },
        { key: 'KF',  label: 'Kvartsfinal', start: 2, count: 2 },
        { key: 'R16', label: 'Åttondelsfinal', start: 4, count: 4 },
        { key: 'R32', label: 'Sextondelsfinal', start: 8, count: 8 },
    ];

    html += `<div class="abt-tree">`;

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

    const finalMatch = (rd['Final'] || [])[0] || {};
    html += `<div class="abt-round abt-round-final">`;
    html += `<div class="abt-round-label abt-final-label">FINAL</div>`;
    html += `<div class="abt-round-matches">`;
    html += `<div class="abt-match-wrapper abt-mw-final">`;
    html += renderMatchCard('Final', 0, finalMatch, 'center');
    html += `</div>`;
    html += `</div></div>`;

    rightRounds.forEach((round, ri) => {
        const depth = 3 - ri;
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

    html += `</div>`;

    html += `<button class="btn" id="admin-save-bracket" style="margin-top: 15px; width: 100%; background: #ffc107; color: #000;">Spara bracket</button>`;
    container.innerHTML = html;

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

    // Toggle custom time input when "Annan…" is selected
    container.querySelectorAll('.abt-date-time').forEach(sel => {
        sel.addEventListener('change', () => {
            const r = sel.dataset.round, m = sel.dataset.match;
            const customInput = container.querySelector(`.abt-date-time-custom[data-round="${r}"][data-match="${m}"]`);
            if (customInput) {
                customInput.style.display = sel.value === 'custom' ? 'block' : 'none';
                if (sel.value === 'custom') customInput.focus();
            }
        });
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
            const dateVal = buildDateStr(round, i);
            const match = { team1: t1, team2: t2, date: dateVal };
            if (s1 !== '' && s2 !== '' && s1 !== undefined && s2 !== undefined) {
                match.score1 = parseInt(s1); match.score2 = parseInt(s2);
                match.winner = match.score1 > match.score2 ? t1 : (match.score2 > match.score1 ? t2 : '');
            }
            bracket.rounds[round].push(match);
        }
    });
    bracket.teams = (bracket.rounds.R32 || []).flatMap(m => [m.team1, m.team2].filter(Boolean));
    await setDoc(doc(db, "matches", "_bracket"), bracket, { merge: true });
    await bumpDataVersion();
    const btn = document.getElementById('admin-save-bracket');
    btn.textContent = '✓ Sparat!';
    setTimeout(() => { btn.textContent = 'Spara bracket'; }, 2000);
}
