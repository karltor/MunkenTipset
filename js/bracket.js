import { db, auth } from './config.js';
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f, flags } from './wizard.js';
import { invalidateStatsCache } from './stats.js';
import { getKnockoutRounds, getGroupLetters, getGroupStageConfig, getChampionLabel, getTournamentName, getFinalRound, hasStageType, isTwoLegged, getRoundAdminKey } from './tournament-config.js';

function _rounds() { return getKnockoutRounds().map(r => r.key); }
function _roundLabel(key) {
    const rounds = getKnockoutRounds();
    const round = rounds.find(r => r.key === key);
    const idx = rounds.indexOf(round);
    const finalKey = rounds.length > 0 ? rounds[rounds.length - 1].key : 'final';
    if (key === finalKey) return `Vilket lag vinner ${getTournamentName()}?`;
    const nextRound = idx < rounds.length - 1 ? rounds[idx + 1] : null;
    return `Vilka lag går vidare till ${nextRound?.label?.toLowerCase() || 'nästa omgång'}?`;
}
function _roundPickCount(key) {
    const round = getKnockoutRounds().find(r => r.key === key);
    return round ? round.teams / 2 : 1;
}
function _isFinalRound(key) {
    const rounds = getKnockoutRounds();
    return rounds.length > 0 && rounds[rounds.length - 1].key === key;
}

let currentRound = 0;
let knockoutData = {};
let knockoutScores = {};
let bracketMode = 'casual';
let allTeamsInRound = [];
let selectedTeams = new Set();
let penaltyWinners = {};
let listenersAttached = false;
let bracketLocked = false;
let adminBracket = null;
let knockoutOnly = false;

export async function initBracket(groupPicks, tipsLocked) {
    bracketLocked = tipsLocked || false;
    knockoutOnly = !hasStageType('round-robin-groups');

    if (knockoutOnly) {
        const bracketSnap = await getDoc(doc(db, "matches", "_bracket"));
        adminBracket = bracketSnap.exists() ? bracketSnap.data() : null;
        if (!adminBracket || !adminBracket.teams || adminBracket.teams.length === 0) {
            showNoBracket();
            return;
        }
    } else {
        if (!groupPicks || !groupPicks.completedAt) { showLocked(); return; }
        allTeamsInRound = buildQualifiedTeams(groupPicks);
    }

    const userId = auth.currentUser.uid;
    const userSnap = await getDoc(doc(db, "users", userId));
    const userData = userSnap.exists() ? userSnap.data() : {};
    knockoutData = userData.knockout || {};
    knockoutScores = userData.knockoutScores || {};
    bracketMode = userData.knockoutMode || 'casual';

    if (!listenersAttached) {
        document.getElementById('btn-bracket-save').addEventListener('click', saveBracketRound);
        document.getElementById('btn-bracket-prev').addEventListener('click', () => {
            if (currentRound > 0) { currentRound--; loadRound(currentRound); }
        });
        listenersAttached = true;
    }

    const rounds = _rounds();
    const finalRoundKey = rounds.length > 0 ? rounds[rounds.length - 1] : 'final';
    if (knockoutData[finalRoundKey] && typeof knockoutData[finalRoundKey] === 'string') { showChampion(knockoutData[finalRoundKey]); return; }
    if (knockoutData[finalRoundKey]) { showChampion(knockoutData[finalRoundKey]); return; }

    currentRound = 0;
    const koRounds = getKnockoutRounds();
    for (let i = 0; i < koRounds.length - 1; i++) {
        const r = koRounds[i];
        const expectedPicks = r.teams / 2;
        if (knockoutData[r.key]?.length === expectedPicks) currentRound = i + 1;
    }

    showBracketContent();
    loadRound(currentRound);
}

function showLocked() {
    document.getElementById('bracket-locked').style.display = 'block';
    document.getElementById('bracket-content').style.display = 'none';
    document.getElementById('bracket-champion').style.display = 'none';
    document.getElementById('btn-go-to-groups').onclick = () =>
        document.querySelector('.tab-btn[data-target="wizard-tab"]').click();
}

function showNoBracket() {
    const lockedDiv = document.getElementById('bracket-locked');
    lockedDiv.style.display = 'block';
    document.getElementById('bracket-content').style.display = 'none';
    document.getElementById('bracket-champion').style.display = 'none';
    lockedDiv.innerHTML = `<div style="background: white; padding: 3rem 2rem; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); text-align: center;">
        <h2 style="color: #999;">Slutspelet är inte klart ännu</h2>
        <p>Admin har inte satt upp slutspelsmatcherna ännu. Kom tillbaka snart!</p>
    </div>`;
}

function showBracketContent() {
    document.getElementById('bracket-locked').style.display = 'none';
    document.getElementById('bracket-content').style.display = 'block';
    document.getElementById('bracket-champion').style.display = 'none';
    if (knockoutOnly) renderModeBar();
}

function buildQualifiedTeams(picks) {
    const letters = getGroupLetters();
    const groupStage = getGroupStageConfig();
    const bestOfRest = groupStage?.qualification?.bestOfRest || 0;
    const firsts = [], seconds = [], thirds = [];
    letters.forEach(letter => {
        if (!picks[letter]) return;
        firsts.push({ name: picks[letter].first, group: letter, seed: '1' });
        seconds.push({ name: picks[letter].second, group: letter, seed: '2' });
        if (picks[letter].third) {
            thirds.push({ name: picks[letter].third, group: letter, seed: '3',
                pts: picks[letter].thirdPts || 0, gd: picks[letter].thirdGd || 0, gf: picks[letter].thirdGf || 0 });
        }
    });
    thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    return [...firsts, ...seconds, ...thirds.slice(0, bestOfRest)];
}

// ── Mode bar for knockout-only ────────────────────────────────────────
function renderModeBar() {
    let bar = document.getElementById('bracket-mode-bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'bracket-mode-bar';
        bar.style.cssText = 'text-align:center; margin-bottom:12px;';
        const content = document.getElementById('bracket-content');
        const roundInfo = document.getElementById('bracket-round-info');
        content.insertBefore(bar, roundInfo);
    }

    const isCasual = bracketMode === 'casual';
    bar.innerHTML = `
        <button class="btn" id="btn-bracket-switch-mode" style="background:rgba(255,255,255,0.15); color:white; font-size:12px; padding:6px 16px;">
            ${isCasual ? '📊 Byt till Detaljerat' : '🎯 Byt till Snabbtips'}
        </button>
        <p style="font-size:12px; color:#888; margin:8px 0 0;">
            ${isCasual
                ? 'Välj vinnare — matchresultat genereras automatiskt'
                : 'Tippa matchresultat — vinnaren bestäms av dina resultat'}
        </p>
    `;

    document.getElementById('btn-bracket-switch-mode').addEventListener('click', () => {
        bracketMode = bracketMode === 'casual' ? 'detailed' : 'casual';
        renderModeBar();
        loadRound(currentRound);
    });
}

// ── Get matchups for a round in knockout-only mode ──────────────────
function getMatchupsForRound(roundIndex) {
    const rounds = _rounds();
    const roundKey = rounds[roundIndex];
    const adminKey = getRoundAdminKey(roundKey);
    const adminRound = adminBracket?.rounds?.[adminKey] || [];

    if (roundIndex === 0) {
        return adminRound.map(m => ({
            team1: m.team1 || '',
            team2: m.team2 || '',
            date: m.date || '',
            date_leg2: m.date_leg2 || ''
        }));
    }

    const prevKey = rounds[roundIndex - 1];
    const prevPicks = knockoutData[prevKey] || [];
    const matchups = [];
    for (let i = 0; i < prevPicks.length; i += 2) {
        matchups.push({
            team1: prevPicks[i] || '',
            team2: prevPicks[i + 1] || '',
            date: '',
            date_leg2: ''
        });
    }
    return matchups;
}

function loadRound(roundIndex) {
    const roundKey = _rounds()[roundIndex];
    selectedTeams = new Set();
    penaltyWinners = {};

    if (knockoutData[roundKey]) {
        const picks = _isFinalRound(roundKey) ? [knockoutData[roundKey]] : knockoutData[roundKey];
        picks.forEach(t => selectedTeams.add(t));
    }

    // Restore penalty winners from saved scores
    const roundScores = knockoutScores[roundKey] || [];
    roundScores.forEach((s, i) => {
        if (s.penaltyWinner) penaltyWinners[i] = s.penaltyWinner;
    });

    document.getElementById('bracket-round-info').innerHTML =
        `<p style="font-size: 1.1rem;">${_roundLabel(roundKey)}</p>`;

    if (knockoutOnly) {
        if (bracketMode === 'detailed') {
            renderDetailedMatchups(roundIndex, roundKey);
        } else {
            renderMatchups(roundIndex, roundKey);
        }
    } else {
        let teamsForRound;
        if (roundIndex === 0) {
            teamsForRound = allTeamsInRound;
        } else {
            const prevKey = _rounds()[roundIndex - 1];
            const prev = knockoutData[prevKey] || [];
            teamsForRound = prev.map(name => ({ name, seed: '', group: '' }));
        }
        document.getElementById('bracket-round-info').innerHTML +=
            `<p style="font-size: 0.85rem; color: #888;">Välj <strong>${_roundPickCount(roundKey)}</strong> lag</p>`;
        renderTeams(teamsForRound, roundKey);
    }
    updateSaveBtn(roundKey);
}

// ── Casual mode rendering (matchup cards with team picker) ────────────
function renderMatchups(roundIndex, roundKey) {
    const container = document.getElementById('bracket-container');
    const matchups = getMatchupsForRound(roundIndex);
    const twoLeg = isTwoLegged(roundKey);

    if (_isFinalRound(roundKey)) {
        const finalRound = getFinalRound();
        let html = `<div style="text-align: center; padding: 40px 0;">`;
        html += `<h3 style="font-family: 'Playfair Display', serif; color: #ffc107; font-size: 1.8rem; margin-bottom: 24px;">${(finalRound?.label || 'FINAL').toUpperCase()}</h3>`;
        if (matchups.length > 0 && matchups[0].team1 && matchups[0].team2) {
            const m = matchups[0];
            html += renderCasualMatchupCard(m, roundKey, true);
        } else {
            const prevKey = _rounds()[roundIndex - 1];
            const prevPicks = knockoutData[prevKey] || [];
            html += `<div class="bracket-team-grid" style="justify-content: center; gap: 20px;">`;
            prevPicks.forEach(t => {
                const sel = selectedTeams.has(t) ? 'selected' : '';
                html += `<div class="bracket-team ${sel}" style="font-size: 1.2rem; padding: 16px 24px;" onclick="window.toggleBracketTeam('${t}')">${fLarge(t)}${t}</div>`;
            });
            html += `</div>`;
        }
        html += `</div>`;
        container.innerHTML = html;
        return;
    }

    let html = `<div class="bracket-matchups">`;
    matchups.forEach(m => {
        html += renderCasualMatchupCard(m, roundKey, false, twoLeg);
    });
    html += `</div>`;
    container.innerHTML = html;
}

function renderCasualMatchupCard(matchup, roundKey, isFinal, twoLeg) {
    const { team1, team2, date } = matchup;
    if (!team1 && !team2) return '';

    const sel1 = selectedTeams.has(team1) ? 'selected' : '';
    const sel2 = selectedTeams.has(team2) ? 'selected' : '';
    const style = isFinal ? 'font-size: 1.2rem; padding: 16px 24px;' : '';

    let html = `<div class="bracket-matchup-card">`;
    if (date) html += `<div class="bracket-matchup-date">${date}</div>`;
    if (twoLeg) html += `<div class="bracket-matchup-tag">Dubbelmöte</div>`;

    html += `<div class="bracket-matchup-teams">`;
    html += `<div class="bracket-team ${sel1}" style="${style}" onclick="window.toggleBracketTeam('${team1}')">${f(team1)}${team1}</div>`;
    html += `<div class="bracket-matchup-vs">vs</div>`;
    html += `<div class="bracket-team ${sel2}" style="${style}" onclick="window.toggleBracketTeam('${team2}')">${f(team2)}${team2}</div>`;
    html += `</div>`;

    if (twoLeg) {
        html += `<div class="bracket-matchup-leg2">`;
        html += `<span style="font-size:11px; color:#888;">Retur:</span> ${f(team2)}${team2} vs ${f(team1)}${team1}`;
        html += `</div>`;
    }

    html += `</div>`;
    return html;
}

// ── Detailed mode rendering (score inputs for each leg) ───────────────
function renderDetailedMatchups(roundIndex, roundKey) {
    const container = document.getElementById('bracket-container');
    const matchups = getMatchupsForRound(roundIndex);
    const twoLeg = isTwoLegged(roundKey);
    const savedRoundScores = knockoutScores[roundKey] || [];

    let html = '';
    if (_isFinalRound(roundKey)) {
        const finalRound = getFinalRound();
        html += `<div style="text-align: center; padding: 20px 0;">`;
        html += `<h3 style="font-family: 'Playfair Display', serif; color: #ffc107; font-size: 1.8rem; margin-bottom: 24px;">${(finalRound?.label || 'FINAL').toUpperCase()}</h3>`;
        if (matchups.length > 0 && matchups[0].team1 && matchups[0].team2) {
            html += renderDetailedMatchupCard(matchups[0], 0, roundKey, true, isTwoLegged(roundKey), savedRoundScores[0]);
        } else {
            const prevKey = _rounds()[roundIndex - 1];
            const prevPicks = knockoutData[prevKey] || [];
            if (prevPicks.length === 2) {
                const fakeMatchup = { team1: prevPicks[0], team2: prevPicks[1], date: '', date_leg2: '' };
                html += renderDetailedMatchupCard(fakeMatchup, 0, roundKey, true, isTwoLegged(roundKey), savedRoundScores[0]);
            }
        }
        html += `</div>`;
    } else {
        html += `<div class="bracket-matchups">`;
        matchups.forEach((m, i) => {
            html += renderDetailedMatchupCard(m, i, roundKey, false, twoLeg, savedRoundScores[i]);
        });
        html += `</div>`;
    }

    container.innerHTML = html;
    wireScoreInputs();
    recalcDetailedWinners(roundKey);
}

function renderDetailedMatchupCard(matchup, matchIdx, roundKey, isFinal, twoLeg, savedScores) {
    const { team1, team2, date, date_leg2 } = matchup;
    if (!team1 && !team2) return '';

    const s = savedScores || {};
    const cardStyle = isFinal ? 'max-width:400px; margin:0 auto;' : '';

    let html = `<div class="bracket-matchup-card bracket-detailed-card" style="${cardStyle}" data-matchup="${matchIdx}">`;

    // Leg 1
    if (twoLeg) html += `<div class="bracket-leg-label" style="color:#17a2b8;">MATCH 1</div>`;
    if (date) html += `<div class="bracket-matchup-date">${date}</div>`;
    html += `<div class="bracket-leg-row">`;
    html += `<span class="bracket-leg-team" style="text-align:right;">${f(team1)}${team1}</span>`;
    html += `<input type="number" min="0" max="20" class="bracket-score-input" data-matchup="${matchIdx}" data-leg="1" data-side="1" value="${s.score1 ?? ''}">`;
    html += `<span class="bracket-leg-sep">–</span>`;
    html += `<input type="number" min="0" max="20" class="bracket-score-input" data-matchup="${matchIdx}" data-leg="1" data-side="2" value="${s.score2 ?? ''}">`;
    html += `<span class="bracket-leg-team" style="text-align:left;">${f(team2)}${team2}</span>`;
    html += `</div>`;

    // Leg 2
    if (twoLeg) {
        html += `<div style="border-top:1px dashed rgba(255,255,255,0.1); margin:6px 0;"></div>`;
        html += `<div class="bracket-leg-label" style="color:#ffc107;">MATCH 2 (retur)</div>`;
        if (date_leg2) html += `<div class="bracket-matchup-date">${date_leg2}</div>`;
        html += `<div class="bracket-leg-row">`;
        html += `<span class="bracket-leg-team" style="text-align:right;">${f(team2)}${team2}</span>`;
        html += `<input type="number" min="0" max="20" class="bracket-score-input" data-matchup="${matchIdx}" data-leg="2" data-side="1" value="${s.score1_leg2 ?? ''}">`;
        html += `<span class="bracket-leg-sep">–</span>`;
        html += `<input type="number" min="0" max="20" class="bracket-score-input" data-matchup="${matchIdx}" data-leg="2" data-side="2" value="${s.score2_leg2 ?? ''}">`;
        html += `<span class="bracket-leg-team" style="text-align:left;">${f(team1)}${team1}</span>`;
        html += `</div>`;
    }

    // Aggregate / winner display
    html += `<div class="bracket-matchup-result" data-matchup="${matchIdx}"></div>`;

    // Penalty picker (hidden by default, shown when tied)
    html += `<div class="bracket-penalty-pick" data-matchup="${matchIdx}" style="display:none;">`;
    html += `<div style="font-size:11px; color:#ffc107; margin-top:4px; text-align:center;">Lika efter ${twoLeg ? '180' : '90'} min — välj straffvinnare:</div>`;
    html += `<div style="display:flex; gap:8px; justify-content:center; margin-top:6px;">`;
    const pw = penaltyWinners[matchIdx] || '';
    html += `<div class="bracket-team bracket-penalty-btn ${pw === team1 ? 'selected' : ''}" onclick="window.setPenaltyWinner(${matchIdx}, '${team1}')" style="font-size:12px; padding:6px 12px;">${f(team1)}${team1}</div>`;
    html += `<div class="bracket-team bracket-penalty-btn ${pw === team2 ? 'selected' : ''}" onclick="window.setPenaltyWinner(${matchIdx}, '${team2}')" style="font-size:12px; padding:6px 12px;">${f(team2)}${team2}</div>`;
    html += `</div></div>`;

    html += `</div>`;
    return html;
}

function wireScoreInputs() {
    document.querySelectorAll('.bracket-score-input').forEach(input => {
        input.addEventListener('input', () => {
            const roundKey = _rounds()[currentRound];
            recalcDetailedWinners(roundKey);
            updateSaveBtn(roundKey);
        });
    });
}

// ── Recalculate winners from score inputs in detailed mode ────────────
function recalcDetailedWinners(roundKey) {
    const matchups = getMatchupsForRound(currentRound);
    const twoLeg = isTwoLegged(roundKey);
    selectedTeams = new Set();

    matchups.forEach((m, i) => {
        const resultEl = document.querySelector(`.bracket-matchup-result[data-matchup="${i}"]`);
        const penaltyEl = document.querySelector(`.bracket-penalty-pick[data-matchup="${i}"]`);
        if (!resultEl) return;

        const s1 = getScoreVal(i, '1', '1');
        const s2 = getScoreVal(i, '1', '2');

        if (s1 === null || s2 === null) {
            resultEl.innerHTML = '';
            if (penaltyEl) penaltyEl.style.display = 'none';
            return;
        }

        if (!twoLeg) {
            // Single leg
            if (s1 > s2) {
                selectedTeams.add(m.team1);
                resultEl.innerHTML = `<div style="font-size:12px; color:#28a745; text-align:center; margin-top:6px;">✅ ${f(m.team1)}${m.team1} vinner</div>`;
                if (penaltyEl) penaltyEl.style.display = 'none';
            } else if (s2 > s1) {
                selectedTeams.add(m.team2);
                resultEl.innerHTML = `<div style="font-size:12px; color:#28a745; text-align:center; margin-top:6px;">✅ ${f(m.team2)}${m.team2} vinner</div>`;
                if (penaltyEl) penaltyEl.style.display = 'none';
            } else {
                // Draw in single leg - need penalty
                resultEl.innerHTML = '';
                if (penaltyEl) penaltyEl.style.display = 'block';
                if (penaltyWinners[i]) selectedTeams.add(penaltyWinners[i]);
            }
            return;
        }

        // Two-legged
        const s1l2 = getScoreVal(i, '2', '1');
        const s2l2 = getScoreVal(i, '2', '2');

        if (s1l2 === null || s2l2 === null) {
            resultEl.innerHTML = `<div style="font-size:11px; color:#888; text-align:center; margin-top:6px;">Match 1: ${m.team1} ${s1} – ${s2} ${m.team2}</div>`;
            if (penaltyEl) penaltyEl.style.display = 'none';
            return;
        }

        // leg1: team1 s1 - s2 team2 (team1 home)
        // leg2: team2 s1l2 - s2l2 team1 (team2 home)
        const t1agg = s1 + s2l2;
        const t2agg = s2 + s1l2;

        let aggHtml = `<div style="font-size:11px; color:#ccc; text-align:center; margin-top:6px; border-top:1px solid rgba(255,255,255,0.05); padding-top:6px;">Totalt: ${m.team1} ${t1agg} – ${t2agg} ${m.team2}`;

        if (t1agg > t2agg) {
            selectedTeams.add(m.team1);
            aggHtml += ` — <span style="color:#28a745;">${m.team1} vidare</span>`;
            if (penaltyEl) penaltyEl.style.display = 'none';
        } else if (t2agg > t1agg) {
            selectedTeams.add(m.team2);
            aggHtml += ` — <span style="color:#28a745;">${m.team2} vidare</span>`;
            if (penaltyEl) penaltyEl.style.display = 'none';
        } else {
            aggHtml += ` — <span style="color:#ffc107;">Lika!</span>`;
            if (penaltyEl) penaltyEl.style.display = 'block';
            if (penaltyWinners[i]) selectedTeams.add(penaltyWinners[i]);
        }
        aggHtml += `</div>`;
        resultEl.innerHTML = aggHtml;
    });
}

function getScoreVal(matchIdx, leg, side) {
    const el = document.querySelector(`.bracket-score-input[data-matchup="${matchIdx}"][data-leg="${leg}"][data-side="${side}"]`);
    if (!el || el.value === '') return null;
    return parseInt(el.value);
}

// ── Score generation for casual mode ──────────────────────────────────
function generateMatchScores(winner, team1, team2, twoLeg) {
    if (!twoLeg) {
        let s1, s2;
        do {
            s1 = Math.floor(Math.random() * 4);
            s2 = Math.floor(Math.random() * 4);
        } while (s1 === s2);
        if ((winner === team1 && s1 < s2) || (winner === team2 && s1 > s2)) {
            [s1, s2] = [s2, s1];
        }
        return { score1: s1, score2: s2 };
    }

    // Two-legged
    let s1 = Math.floor(Math.random() * 4);
    let s2 = Math.floor(Math.random() * 4);
    let s1l2 = Math.floor(Math.random() * 4);
    let s2l2 = Math.floor(Math.random() * 4);

    // team1 aggregate = s1 + s2l2, team2 aggregate = s2 + s1l2
    let t1agg = s1 + s2l2;
    let t2agg = s2 + s1l2;
    const winnerIsTeam1 = winner === team1;

    if (t1agg === t2agg) {
        return { score1: s1, score2: s2, score1_leg2: s1l2, score2_leg2: s2l2, penaltyWinner: winner };
    }

    if ((winnerIsTeam1 && t1agg > t2agg) || (!winnerIsTeam1 && t2agg > t1agg)) {
        return { score1: s1, score2: s2, score1_leg2: s1l2, score2_leg2: s2l2 };
    }

    // Wrong winner — swap all scores to reverse the aggregate
    return { score1: s2, score2: s1, score1_leg2: s2l2, score2_leg2: s1l2 };
}

// ── Read scores from detailed mode inputs ─────────────────────────────
function readDetailedScores(roundKey) {
    const matchups = getMatchupsForRound(currentRound);
    const twoLeg = isTwoLegged(roundKey);
    const scores = [];

    matchups.forEach((m, i) => {
        const s = {
            score1: getScoreVal(i, '1', '1'),
            score2: getScoreVal(i, '1', '2')
        };
        if (twoLeg) {
            s.score1_leg2 = getScoreVal(i, '2', '1');
            s.score2_leg2 = getScoreVal(i, '2', '2');
        }
        if (penaltyWinners[i]) s.penaltyWinner = penaltyWinners[i];
        scores.push(s);
    });
    return scores;
}

// ── Original flat-grid rendering (group-stage tournaments) ──────────
function renderTeams(teams, roundKey) {
    const container = document.getElementById('bracket-container');

    if (_isFinalRound(roundKey)) {
        const finalRound = getFinalRound();
        let html = `<div style="text-align: center; padding: 40px 0;">`;
        html += `<h3 style="font-family: 'Playfair Display', serif; color: #ffc107; font-size: 1.8rem; margin-bottom: 24px;">${(finalRound?.label || 'FINAL').toUpperCase()}</h3>`;
        html += `<div class="bracket-team-grid" style="justify-content: center; gap: 20px;">`;
        teams.forEach(t => {
            const sel = selectedTeams.has(t.name) ? 'selected' : '';
            html += `<div class="bracket-team ${sel}" style="font-size: 1.2rem; padding: 16px 24px;" onclick="window.toggleBracketTeam('${t.name}')">${fLarge(t.name)}${t.name}</div>`;
        });
        html += `</div></div>`;
        container.innerHTML = html;
        return;
    }

    if (roundKey === _rounds()[0]) {
        let html = '';
        const firsts = teams.filter(t => t.seed === '1');
        const seconds = teams.filter(t => t.seed === '2');
        const thirds = teams.filter(t => t.seed === '3');
        html += renderSection('Gruppettor', firsts, true);
        html += renderSection('Grupptvåor', seconds, true);
        if (thirds.length > 0) html += renderSection('Bästa treor', thirds, true);
        container.innerHTML = html;
    } else {
        let html = `<div class="bracket-team-grid">`;
        teams.forEach(t => {
            const sel = selectedTeams.has(t.name) ? 'selected' : '';
            html += `<div class="bracket-team ${sel}" onclick="window.toggleBracketTeam('${t.name}')">${f(t.name)}${t.name}</div>`;
        });
        html += `</div>`;
        container.innerHTML = html;
    }
}

function renderSection(title, teams, showGroup) {
    let html = `<div class="bracket-section"><div class="bracket-section-title">${title}</div><div class="bracket-team-grid">`;
    teams.forEach(t => {
        const sel = selectedTeams.has(t.name) ? 'selected' : '';
        const groupLabel = showGroup && t.group ? ` <span style="font-size:10px;color:#888;">${t.group}</span>` : '';
        html += `<div class="bracket-team ${sel}" onclick="window.toggleBracketTeam('${t.name}')">${f(t.name)}${t.name}${groupLabel}</div>`;
    });
    html += `</div></div>`;
    return html;
}

function fLarge(t) {
    return flags[t] ? `<img src="https://flagcdn.com/40x30/${flags[t]}.png" style="vertical-align:-5px; margin-right:10px; border-radius:2px;" width="40" height="30" alt="">` : '🌍 ';
}

// ── Team toggle (casual mode + flat grid) ─────────────────────────────
window.toggleBracketTeam = function (team) {
    if (bracketLocked) return;
    const roundKey = _rounds()[currentRound];

    if (knockoutOnly && bracketMode === 'detailed') return; // detailed mode uses score inputs

    if (knockoutOnly) {
        const matchups = getMatchupsForRound(currentRound);
        const matchup = matchups.find(m => m.team1 === team || m.team2 === team);
        if (matchup) {
            const opponent = matchup.team1 === team ? matchup.team2 : matchup.team1;
            if (selectedTeams.has(team)) {
                selectedTeams.delete(team);
            } else {
                selectedTeams.delete(opponent);
                selectedTeams.add(team);
            }
        }
        renderMatchups(currentRound, roundKey);
    } else {
        const required = _roundPickCount(roundKey);
        if (selectedTeams.has(team)) {
            selectedTeams.delete(team);
        } else {
            if (_isFinalRound(roundKey)) selectedTeams.clear();
            else if (selectedTeams.size >= required) return;
            selectedTeams.add(team);
        }
        const prevKey = currentRound === 0 ? null : _rounds()[currentRound - 1];
        const teams = currentRound === 0 ? allTeamsInRound : (knockoutData[prevKey] || []).map(n => ({ name: n, seed: '', group: '' }));
        renderTeams(teams, roundKey);
    }
    updateSaveBtn(roundKey);
};

// ── Penalty winner picker (detailed mode) ─────────────────────────────
window.setPenaltyWinner = function (matchIdx, team) {
    penaltyWinners[matchIdx] = team;
    const roundKey = _rounds()[currentRound];
    // Update the penalty buttons
    document.querySelectorAll(`.bracket-penalty-pick[data-matchup="${matchIdx}"] .bracket-penalty-btn`).forEach(btn => {
        btn.classList.toggle('selected', btn.textContent.includes(team));
    });
    recalcDetailedWinners(roundKey);
    updateSaveBtn(roundKey);
};

function updateSaveBtn(roundKey) {
    const btn = document.getElementById('btn-bracket-save');
    const required = _roundPickCount(roundKey);
    const count = selectedTeams.size;

    if (knockoutOnly && bracketMode === 'detailed') {
        // In detailed mode, check that all matchups have complete scores
        const matchups = getMatchupsForRound(currentRound);
        const twoLeg = isTwoLegged(roundKey);
        let allComplete = true;
        matchups.forEach((m, i) => {
            if (!m.team1 || !m.team2) return;
            const s1 = getScoreVal(i, '1', '1');
            const s2 = getScoreVal(i, '1', '2');
            if (s1 === null || s2 === null) { allComplete = false; return; }
            if (twoLeg) {
                if (getScoreVal(i, '2', '1') === null || getScoreVal(i, '2', '2') === null) { allComplete = false; return; }
            }
        });
        const winnersComplete = count === required;
        btn.textContent = _isFinalRound(roundKey) ? '🏆 Kröna mästaren!' : `Spara & Nästa (${count}/${required}) ➡`;
        btn.disabled = !allComplete || !winnersComplete;
    } else {
        btn.textContent = _isFinalRound(roundKey) ? '🏆 Kröna mästaren!' : `Spara & Nästa (${count}/${required}) ➡`;
        btn.disabled = count !== required;
    }
}

// ── Save bracket round ────────────────────────────────────────────────
async function saveBracketRound() {
    if (bracketLocked) return;
    const roundKey = _rounds()[currentRound];
    const userId = auth.currentUser.uid;
    const twoLeg = isTwoLegged(roundKey);
    const matchups = knockoutOnly ? getMatchupsForRound(currentRound) : [];

    // Build scores for this round
    if (knockoutOnly) {
        if (bracketMode === 'detailed') {
            knockoutScores[roundKey] = readDetailedScores(roundKey);
        } else {
            // Casual: generate random scores for each matchup
            const scores = [];
            matchups.forEach((m, i) => {
                const winner = Array.from(selectedTeams).find(t => t === m.team1 || t === m.team2);
                if (winner && m.team1 && m.team2) {
                    scores.push(generateMatchScores(winner, m.team1, m.team2, twoLeg));
                } else {
                    scores.push({});
                }
            });
            knockoutScores[roundKey] = scores;
        }
    }

    if (_isFinalRound(roundKey)) {
        knockoutData[roundKey] = Array.from(selectedTeams)[0];
    } else {
        knockoutData[roundKey] = Array.from(selectedTeams);
        const rounds = _rounds();
        const thisIdx = rounds.indexOf(roundKey);
        for (let i = thisIdx + 1; i < rounds.length; i++) {
            delete knockoutData[rounds[i]];
            delete knockoutScores[rounds[i]];
        }
    }

    await updateDoc(doc(db, "users", userId), {
        knockout: knockoutData,
        knockoutScores: knockoutScores,
        knockoutMode: bracketMode
    });
    invalidateStatsCache();

    if (_isFinalRound(roundKey)) { showChampion(knockoutData[roundKey]); }
    else { currentRound++; loadRound(currentRound); window.scrollTo(0, 0); }
}

function showChampion(team) {
    document.getElementById('bracket-locked').style.display = 'none';
    document.getElementById('bracket-content').style.display = 'none';
    const champ = document.getElementById('bracket-champion');
    champ.style.display = 'block';

    const flagCode = flags[team];
    const bigFlag = flagCode ? `<img src="https://flagcdn.com/80x60/${flagCode}.png" style="border-radius:4px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);" width="80" height="60" alt="">` : '';

    champ.innerHTML = `
        <div class="bracket-bg" style="min-height: 400px; display: flex; align-items: center; justify-content: center;">
            <div class="champion-reveal">
                <h2>🏆 ${getChampionLabel()} 🏆</h2>
                <div style="margin: 30px 0;">${bigFlag}</div>
                <div style="font-size: 2.5rem; font-weight: 800; color: #ffc107;">${team}</div>
                <p style="color: #aaa; margin-top: 20px;">Du har tippat att ${team} vinner ${getTournamentName()}!</p>
                <div style="display: flex; gap: 12px; justify-content: center; margin-top: 20px;">
                    <button class="btn" style="background: rgba(255,255,255,0.1); color: white;" id="btn-back-to-start">Tillbaka till Start</button>
                    <button class="btn" style="background: rgba(255,255,255,0.1); color: white;" id="btn-edit-bracket">Ändra tips</button>
                </div>
            </div>
        </div>`;

    document.getElementById('btn-back-to-start').addEventListener('click', () => {
        document.querySelector('.tab-btn[data-target="start-tab"]').click();
    });

    document.getElementById('btn-edit-bracket').addEventListener('click', () => {
        champ.style.display = 'none';
        showBracketContent();
        currentRound = 0;
        loadRound(currentRound);
    });
}
