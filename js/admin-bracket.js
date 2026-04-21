import { db } from './config.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f } from './wizard.js';
import { bumpDataVersion, allMatches, existingResults } from './admin.js';
import { getGroupLetters, getKnockoutRounds, getFinalRound, getGroupStageConfig, isTwoLegged, getRoundUserKey } from './tournament-config.js';

export function getGroupStandings() {
    const standings = {};
    getGroupLetters().forEach(letter => {
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

const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

function parseDateStr(dateStr) {
    if (!dateStr) return { day: '', month: '', time: '' };
    const m = dateStr.trim().match(/^(\d+)\s+(\w+)\s+(\d{1,2}:\d{2})$/);
    if (m) return { day: m[1], month: m[2].toLowerCase(), time: m[3] };
    return { day: '', month: '', time: '' };
}

function buildDateStr(round, matchIdx, legSuffix) {
    const suffix = legSuffix || '';
    const prefix = `[data-round="${round}"][data-match="${matchIdx}"]${suffix}`;
    const day = document.querySelector(`.abt-date-day${prefix}`)?.value || '';
    const month = document.querySelector(`.abt-date-month${prefix}`)?.value || '';
    const timeSelect = document.querySelector(`.abt-date-time${prefix}`)?.value || '';
    const timeCustom = document.querySelector(`.abt-date-time-custom${prefix}`)?.value || '';
    const time = timeSelect === 'custom' ? timeCustom : timeSelect;
    if (!day || !month || !time) return '';
    return `${day} ${month} ${time}`;
}

function dateSelectors(round, matchIdx, dateStr, legSuffix) {
    const { day, month, time } = parseDateStr(dateStr);
    const suffix = legSuffix || '';
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

    return `<div class="abt-date-row" style="display:flex; gap:3px; margin-top:3px;">
        <select class="abt-date-day" data-round="${round}" data-match="${matchIdx}" ${suffix ? `data-leg="2"` : ''} style="font-size:11px; padding:2px; border:1px solid var(--color-card-border); background:var(--color-card-bg); color:inherit; border-radius:4px; flex:0 0 42px;">${dayOpts}</select>
        <select class="abt-date-month" data-round="${round}" data-match="${matchIdx}" ${suffix ? `data-leg="2"` : ''} style="font-size:11px; padding:2px; border:1px solid var(--color-card-border); background:var(--color-card-bg); color:inherit; border-radius:4px; flex:1;">${monthOpts}</select>
        <select class="abt-date-time" data-round="${round}" data-match="${matchIdx}" ${suffix ? `data-leg="2"` : ''} style="font-size:11px; padding:2px; border:1px solid var(--color-card-border); background:var(--color-card-bg); color:inherit; border-radius:4px; flex:0 0 58px;">${timeOpts}</select>
        <input type="text" class="abt-date-time-custom" data-round="${round}" data-match="${matchIdx}" ${suffix ? `data-leg="2"` : ''} placeholder="HH:MM" value="${isCustomTime ? time : ''}" style="font-size:11px; padding:2px; border:1px solid var(--color-card-border); background:var(--color-card-bg); color:inherit; border-radius:4px; flex:0 0 50px; display:${isCustomTime ? 'block' : 'none'};">
    </div>`;
}

function renderMatchCard(round, matchIdx, match, side, twoLeg) {
    let html = `<div class="abt-match" data-round="${round}" data-idx="${matchIdx}">`;

    // Leg 1 (or only leg)
    if (twoLeg) html += `<div style="font-size:10px; color:#0d6e7a; font-weight:600; margin-bottom:2px;">MATCH 1</div>`;
    html += `<div class="abt-team-row">
        <input class="admin-bracket-team abt-input" data-round="${round}" data-match="${matchIdx}" data-side="1" value="${match.team1 || ''}" placeholder="Lag 1" list="team-autocomplete">
        <input type="number" class="admin-bracket-score abt-score" data-round="${round}" data-match="${matchIdx}" data-side="1" value="${match.score1 ?? ''}" placeholder="-">
    </div>
    <div class="abt-team-row">
        <input class="admin-bracket-team abt-input" data-round="${round}" data-match="${matchIdx}" data-side="2" value="${match.team2 || ''}" placeholder="Lag 2" list="team-autocomplete">
        <input type="number" class="admin-bracket-score abt-score" data-round="${round}" data-match="${matchIdx}" data-side="2" value="${match.score2 ?? ''}" placeholder="-">
    </div>`;
    html += dateSelectors(round, matchIdx, match.date || '');

    // Leg 2 (auto-filled: teams swapped, only date + scores editable)
    if (twoLeg) {
        const t2 = match.team2 || 'Lag 2';
        const t1 = match.team1 || 'Lag 1';
        html += `<div style="font-size:10px; color:#b38600; font-weight:600; margin-top:8px; margin-bottom:2px; border-top:1px dashed var(--color-card-border); padding-top:6px;">MATCH 2 (retur)</div>`;
        html += `<div class="abt-team-row">
            <span class="abt-input" style="flex:1; padding:4px 8px; color:color-mix(in srgb, var(--color-text) 55%, transparent); font-size:12px;">${f(t2)}${t2}</span>
            <input type="number" class="admin-bracket-score-leg2 abt-score" data-round="${round}" data-match="${matchIdx}" data-side="1" value="${match.score1_leg2 ?? ''}" placeholder="-">
        </div>
        <div class="abt-team-row">
            <span class="abt-input" style="flex:1; padding:4px 8px; color:color-mix(in srgb, var(--color-text) 55%, transparent); font-size:12px;">${f(t1)}${t1}</span>
            <input type="number" class="admin-bracket-score-leg2 abt-score" data-round="${round}" data-match="${matchIdx}" data-side="2" value="${match.score2_leg2 ?? ''}" placeholder="-">
        </div>`;
        html += dateSelectors(round, matchIdx, match.date_leg2 || '', '[data-leg="2"]');

        // Aggregate display
        html += `<div class="abt-aggregate" data-round="${round}" data-match="${matchIdx}" style="font-size:11px; color:color-mix(in srgb, var(--color-text) 55%, transparent); margin-top:6px; text-align:center;"></div>`;
    }

    // Penalty winner picker — rendered for both single- and two-leg matches.
    // Shown by updateAggregates() when the (aggregated) score is tied.
    const pw = match.penaltyWinner || '';
    html += `<div class="abt-penalty-pick" data-round="${round}" data-match="${matchIdx}" style="display:none; margin-top:6px; text-align:center;">
        <div style="font-size:10px; color:#ffc107; font-weight:600; margin-bottom:4px;">Lika — välj straffvinnare:</div>
        <div style="display:flex; gap:6px; justify-content:center;">
            <button type="button" class="btn abt-penalty-btn" data-round="${round}" data-match="${matchIdx}" data-side="1" style="font-size:11px; padding:4px 10px; background:${pw === (match.team1 || '') ? '#28a745' : 'color-mix(in srgb, var(--color-text) 25%, var(--color-card-bg))'};">${f(match.team1 || 'Lag 1')}${match.team1 || 'Lag 1'}</button>
            <button type="button" class="btn abt-penalty-btn" data-round="${round}" data-match="${matchIdx}" data-side="2" style="font-size:11px; padding:4px 10px; background:${pw === (match.team2 || '') ? '#28a745' : 'color-mix(in srgb, var(--color-text) 25%, var(--color-card-bg))'};">${f(match.team2 || 'Lag 2')}${match.team2 || 'Lag 2'}</button>
        </div>
        <input type="hidden" class="abt-penalty-winner" data-round="${round}" data-match="${matchIdx}" value="${pw}">
    </div>`;

    html += `</div>`;
    return html;
}

export async function renderAdminBracket() {
    const container = document.getElementById('admin-bracket');
    if (!container) return;
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
    // Also add teams from bracket if no group stage
    (bracket.teams || []).forEach(t => { html += `<option value="${t}">`; });
    html += `</datalist>`;

    const koRounds = getKnockoutRounds();
    const finalRound = getFinalRound();
    const nonFinal = koRounds.filter(r => r !== finalRound);
    const leftRounds = nonFinal.map(r => ({
        key: r.adminKey, userKey: r.key, label: r.label, start: 0, count: r.teams / 4
    }));
    const rightRounds = [...nonFinal].reverse().map(r => ({
        key: r.adminKey, userKey: r.key, label: r.label, start: r.teams / 4, count: r.teams / 4
    }));

    html += `<div class="abt-tree">`;

    leftRounds.forEach((round, ri) => {
        const twoLeg = isTwoLegged(round.userKey);
        html += `<div class="abt-round abt-round-left abt-depth-${ri}">`;
        html += `<div class="abt-round-label">${round.label}${twoLeg ? ' <span style="font-size:9px; color:#ffc107;">(2 möten)</span>' : ''}</div>`;
        html += `<div class="abt-round-matches">`;
        for (let i = 0; i < round.count; i++) {
            const matchIdx = round.start + i;
            const match = (rd[round.key] || [])[matchIdx] || {};
            html += `<div class="abt-match-wrapper abt-mw-d${ri}">`;
            html += renderMatchCard(round.key, matchIdx, match, 'left', twoLeg);
            html += `</div>`;
        }
        html += `</div></div>`;
    });

    const finalAdminKey = finalRound?.adminKey || 'Final';
    const finalUserKey = finalRound?.key || 'final';
    const finalMatch = (rd[finalAdminKey] || [])[0] || {};
    const finalTwoLeg = isTwoLegged(finalUserKey);
    html += `<div class="abt-round abt-round-final">`;
    html += `<div class="abt-round-label abt-final-label">${(finalRound?.label || 'FINAL').toUpperCase()}</div>`;
    html += `<div class="abt-round-matches">`;
    html += `<div class="abt-match-wrapper abt-mw-final">`;
    html += renderMatchCard(finalAdminKey, 0, finalMatch, 'center', finalTwoLeg);
    html += `</div>`;
    html += `</div></div>`;

    rightRounds.forEach((round, ri) => {
        const twoLeg = isTwoLegged(round.userKey);
        const depth = nonFinal.length - 1 - ri;
        html += `<div class="abt-round abt-round-right abt-depth-${depth}">`;
        html += `<div class="abt-round-label">${round.label}${twoLeg ? ' <span style="font-size:9px; color:#ffc107;">(2 möten)</span>' : ''}</div>`;
        html += `<div class="abt-round-matches">`;
        for (let i = 0; i < round.count; i++) {
            const matchIdx = round.start + i;
            const match = (rd[round.key] || [])[matchIdx] || {};
            html += `<div class="abt-match-wrapper abt-mw-d${depth}">`;
            html += renderMatchCard(round.key, matchIdx, match, 'right', twoLeg);
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

    const rounds = koRounds.map(r => r.adminKey);
    const matchCounts = koRounds.map(r => r.teams / 2);
    document.getElementById('admin-save-bracket').addEventListener('click', () => saveAdminBracket(rounds, matchCounts, koRounds));

    // Auto-advance on score change (single-leg scores)
    container.querySelectorAll('.abt-score').forEach(input => {
        input.addEventListener('change', () => {
            autoAdvanceWinners(rounds, matchCounts, koRounds);
            updateAggregates(container);
        });
    });
    container.querySelectorAll('.admin-bracket-score-leg2').forEach(input => {
        input.addEventListener('change', () => {
            autoAdvanceWinners(rounds, matchCounts, koRounds);
            updateAggregates(container);
        });
    });

    // Toggle custom time input
    container.querySelectorAll('.abt-date-time').forEach(sel => {
        sel.addEventListener('change', () => {
            const r = sel.dataset.round, m = sel.dataset.match, leg = sel.dataset.leg || '';
            const legSel = leg ? `[data-leg="${leg}"]` : ':not([data-leg])';
            const customInput = container.querySelector(`.abt-date-time-custom[data-round="${r}"][data-match="${m}"]${legSel}`);
            if (customInput) {
                customInput.style.display = sel.value === 'custom' ? 'block' : 'none';
                if (sel.value === 'custom') customInput.focus();
            }
        });
    });

    // Wire penalty buttons
    container.querySelectorAll('.abt-penalty-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const round = btn.dataset.round, matchIdx = btn.dataset.match, side = btn.dataset.side;
            const teamEl = container.querySelector(`.admin-bracket-team[data-round="${round}"][data-match="${matchIdx}"][data-side="${side}"]`);
            const team = teamEl?.value || '';
            const hiddenInput = container.querySelector(`.abt-penalty-winner[data-round="${round}"][data-match="${matchIdx}"]`);
            if (hiddenInput) hiddenInput.value = team;
            // Highlight selected button
            container.querySelectorAll(`.abt-penalty-btn[data-round="${round}"][data-match="${matchIdx}"]`).forEach(b => {
                b.style.background = 'color-mix(in srgb, var(--color-text) 25%, var(--color-card-bg))';
                b.style.color = 'inherit';
            });
            btn.style.background = '#28a745';
            // Auto-advance this winner
            const rounds = koRounds.map(r => r.adminKey);
            const matchCounts = koRounds.map(r => r.teams / 2);
            autoAdvanceWinners(rounds, matchCounts, koRounds);
        });
    });

    updateAggregates(container);
}

function updateAggregates(container) {
    // Two-legged matches: compute aggregate, show picker on tied aggregate.
    container.querySelectorAll('.abt-aggregate').forEach(el => {
        const round = el.dataset.round, matchIdx = el.dataset.match;
        const s1 = container.querySelector(`.admin-bracket-score[data-round="${round}"][data-match="${matchIdx}"][data-side="1"]`)?.value;
        const s2 = container.querySelector(`.admin-bracket-score[data-round="${round}"][data-match="${matchIdx}"][data-side="2"]`)?.value;
        const s1l2 = container.querySelector(`.admin-bracket-score-leg2[data-round="${round}"][data-match="${matchIdx}"][data-side="1"]`)?.value;
        const s2l2 = container.querySelector(`.admin-bracket-score-leg2[data-round="${round}"][data-match="${matchIdx}"][data-side="2"]`)?.value;
        const penaltyEl = container.querySelector(`.abt-penalty-pick[data-round="${round}"][data-match="${matchIdx}"]`);

        if (s1 !== '' && s2 !== '' && s1l2 !== '' && s2l2 !== '' &&
            s1 !== undefined && s2 !== undefined && s1l2 !== undefined && s2l2 !== undefined) {
            const t1Total = parseInt(s1) + parseInt(s2l2);
            const t2Total = parseInt(s2) + parseInt(s1l2);
            const t1name = container.querySelector(`.admin-bracket-team[data-round="${round}"][data-match="${matchIdx}"][data-side="1"]`)?.value || 'Lag 1';
            const t2name = container.querySelector(`.admin-bracket-team[data-round="${round}"][data-match="${matchIdx}"][data-side="2"]`)?.value || 'Lag 2';
            const isTied = t1Total === t2Total;
            el.innerHTML = `<strong>Aggregerat:</strong> ${t1name} ${t1Total} – ${t2Total} ${t2name}` +
                (isTied ? ' <span style="color:#ffc107;">(lika)</span>' : '');
            if (penaltyEl) penaltyEl.style.display = isTied ? 'block' : 'none';
        } else {
            el.innerHTML = '';
            if (penaltyEl) penaltyEl.style.display = 'none';
        }
    });

    // Single-leg matches: show picker when both scores entered and tied.
    // Identified by a penalty-pick element whose card has no .abt-aggregate.
    container.querySelectorAll('.abt-penalty-pick').forEach(el => {
        const round = el.dataset.round, matchIdx = el.dataset.match;
        const hasAgg = !!container.querySelector(`.abt-aggregate[data-round="${round}"][data-match="${matchIdx}"]`);
        if (hasAgg) return;
        const s1 = container.querySelector(`.admin-bracket-score[data-round="${round}"][data-match="${matchIdx}"][data-side="1"]`)?.value;
        const s2 = container.querySelector(`.admin-bracket-score[data-round="${round}"][data-match="${matchIdx}"][data-side="2"]`)?.value;
        if (s1 !== '' && s2 !== '' && s1 !== undefined && s2 !== undefined && parseInt(s1) === parseInt(s2)) {
            el.style.display = 'block';
        } else {
            el.style.display = 'none';
        }
    });
}

function autofillR32(standings) {
    const groupCfg = getGroupStageConfig();
    const bestOfRest = groupCfg?.qualification?.bestOfRest || 0;
    const firstRound = getKnockoutRounds()[0];
    const firstRoundKey = firstRound?.adminKey || 'R32';
    const matchCount = (firstRound?.teams || 32) / 2;

    const firsts = [], seconds = [], thirds = [];
    getGroupLetters().forEach(letter => {
        const s = standings[letter];
        if (!s || s.length < 2) return;
        firsts.push({ name: s[0].name, group: letter });
        seconds.push({ name: s[1].name, group: letter });
        if (s.length >= 3) thirds.push({ ...s[2], group: letter });
    });
    thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    const qualifiedThirds = thirds.slice(0, bestOfRest);
    const allQualified = [...firsts, ...seconds, ...qualifiedThirds];

    for (let i = 0; i < matchCount; i++) {
        const t1 = allQualified[i]?.name || '';
        const t2 = allQualified[i + matchCount]?.name || '';
        const el1 = document.querySelector(`.admin-bracket-team[data-round="${firstRoundKey}"][data-match="${i}"][data-side="1"]`);
        const el2 = document.querySelector(`.admin-bracket-team[data-round="${firstRoundKey}"][data-match="${i}"][data-side="2"]`);
        if (el1) el1.value = t1;
        if (el2) el2.value = t2;
    }
}

function autoAdvanceWinners(rounds, matchCounts, koRounds) {
    for (let ri = 0; ri < rounds.length - 1; ri++) {
        const round = rounds[ri], nextRound = rounds[ri + 1], count = matchCounts[ri];
        const userKey = koRounds[ri]?.key || '';
        const twoLeg = isTwoLegged(userKey);

        for (let i = 0; i < count; i++) {
            const t1El = document.querySelector(`.admin-bracket-team[data-round="${round}"][data-match="${i}"][data-side="1"]`);
            const t2El = document.querySelector(`.admin-bracket-team[data-round="${round}"][data-match="${i}"][data-side="2"]`);

            let winner = '';
            if (twoLeg) {
                // Aggregate over both legs
                const s1 = document.querySelector(`.admin-bracket-score[data-round="${round}"][data-match="${i}"][data-side="1"]`)?.value;
                const s2 = document.querySelector(`.admin-bracket-score[data-round="${round}"][data-match="${i}"][data-side="2"]`)?.value;
                const s1l2 = document.querySelector(`.admin-bracket-score-leg2[data-round="${round}"][data-match="${i}"][data-side="1"]`)?.value;
                const s2l2 = document.querySelector(`.admin-bracket-score-leg2[data-round="${round}"][data-match="${i}"][data-side="2"]`)?.value;
                if (s1 === '' || s2 === '' || s1l2 === '' || s2l2 === '' ||
                    s1 === undefined || s2 === undefined || s1l2 === undefined || s2l2 === undefined) continue;
                const t1Total = parseInt(s1) + parseInt(s2l2);
                const t2Total = parseInt(s2) + parseInt(s1l2);
                if (t1Total > t2Total) winner = t1El?.value || '';
                else if (t2Total > t1Total) winner = t2El?.value || '';
                else {
                    // Tied — check penalty winner selection
                    const pw = document.querySelector(`.abt-penalty-winner[data-round="${round}"][data-match="${i}"]`)?.value || '';
                    if (pw) winner = pw;
                }
            } else {
                const s1El = document.querySelector(`.admin-bracket-score[data-round="${round}"][data-match="${i}"][data-side="1"]`);
                const s2El = document.querySelector(`.admin-bracket-score[data-round="${round}"][data-match="${i}"][data-side="2"]`);
                if (!t1El || !t2El || !s1El || !s2El || s1El.value === '' || s2El.value === '') continue;
                const s1 = parseInt(s1El.value), s2 = parseInt(s2El.value);
                if (s1 > s2) winner = t1El.value;
                else if (s2 > s1) winner = t2El.value;
                else {
                    const pw = document.querySelector(`.abt-penalty-winner[data-round="${round}"][data-match="${i}"]`)?.value || '';
                    if (pw) winner = pw;
                }
            }

            if (winner) {
                const nextEl = document.querySelector(`.admin-bracket-team[data-round="${nextRound}"][data-match="${Math.floor(i / 2)}"][data-side="${(i % 2) + 1}"]`);
                if (nextEl) nextEl.value = winner;
            }
        }
    }
}

function buildDateStrLeg2(round, matchIdx) {
    const prefix = `[data-round="${round}"][data-match="${matchIdx}"][data-leg="2"]`;
    const day = document.querySelector(`.abt-date-day${prefix}`)?.value || '';
    const month = document.querySelector(`.abt-date-month${prefix}`)?.value || '';
    const timeSelect = document.querySelector(`.abt-date-time${prefix}`)?.value || '';
    const timeCustom = document.querySelector(`.abt-date-time-custom${prefix}`)?.value || '';
    const time = timeSelect === 'custom' ? timeCustom : timeSelect;
    if (!day || !month || !time) return '';
    return `${day} ${month} ${time}`;
}

async function saveAdminBracket(rounds, matchCounts, koRounds) {
    const bracket = { rounds: {} };
    rounds.forEach((round, ri) => {
        const userKey = koRounds[ri]?.key || '';
        const twoLeg = isTwoLegged(userKey);
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
            }

            if (twoLeg) {
                const s1l2 = document.querySelector(`.admin-bracket-score-leg2[data-round="${round}"][data-match="${i}"][data-side="1"]`)?.value;
                const s2l2 = document.querySelector(`.admin-bracket-score-leg2[data-round="${round}"][data-match="${i}"][data-side="2"]`)?.value;
                match.date_leg2 = buildDateStrLeg2(round, i);
                if (s1l2 !== '' && s2l2 !== '' && s1l2 !== undefined && s2l2 !== undefined) {
                    match.score1_leg2 = parseInt(s1l2);
                    match.score2_leg2 = parseInt(s2l2);
                }
                // Determine winner by aggregate or penalty
                if (match.score1 !== undefined && match.score2 !== undefined &&
                    match.score1_leg2 !== undefined && match.score2_leg2 !== undefined) {
                    const t1Total = match.score1 + match.score2_leg2;
                    const t2Total = match.score2 + match.score1_leg2;
                    if (t1Total > t2Total) {
                        match.winner = t1;
                    } else if (t2Total > t1Total) {
                        match.winner = t2;
                    } else {
                        // Tied aggregate — check penalty winner
                        const pw = document.querySelector(`.abt-penalty-winner[data-round="${round}"][data-match="${i}"]`)?.value || '';
                        if (pw) {
                            match.winner = pw;
                            match.penaltyWinner = pw;
                        } else {
                            match.winner = '';
                        }
                    }
                }
            } else {
                if (match.score1 !== undefined && match.score2 !== undefined) {
                    if (match.score1 > match.score2) {
                        match.winner = t1;
                    } else if (match.score2 > match.score1) {
                        match.winner = t2;
                    } else {
                        // Tied — read penalty winner selection
                        const pw = document.querySelector(`.abt-penalty-winner[data-round="${round}"][data-match="${i}"]`)?.value || '';
                        if (pw) {
                            match.winner = pw;
                            match.penaltyWinner = pw;
                        } else {
                            match.winner = '';
                        }
                    }
                }
            }

            bracket.rounds[round].push(match);
        }
    });
    const firstRoundKey = getKnockoutRounds()[0]?.adminKey || 'R32';
    bracket.teams = (bracket.rounds[firstRoundKey] || []).flatMap(m => [m.team1, m.team2].filter(Boolean));
    await setDoc(doc(db, "matches", "_bracket"), bracket, { merge: true });
    await bumpDataVersion();
    const btn = document.getElementById('admin-save-bracket');
    btn.textContent = '✓ Sparat!';
    setTimeout(() => { btn.textContent = 'Spara bracket'; }, 2000);
}
