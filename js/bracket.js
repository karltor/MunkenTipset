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
    return `Välj vinnare i varje möte — de går vidare till ${nextRound?.label?.toLowerCase() || 'nästa omgång'}`;
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
let allTeamsInRound = [];
let selectedTeams = new Set();
let listenersAttached = false;
let bracketLocked = false;
let adminBracket = null;
let knockoutOnly = false;

export async function initBracket(groupPicks, tipsLocked) {
    bracketLocked = tipsLocked || false;
    knockoutOnly = !hasStageType('round-robin-groups');

    if (knockoutOnly) {
        // Load bracket from admin — teams/matchups defined there
        const bracketSnap = await getDoc(doc(db, "matches", "_bracket"));
        adminBracket = bracketSnap.exists() ? bracketSnap.data() : null;
        if (!adminBracket || !adminBracket.teams || adminBracket.teams.length === 0) {
            showNoBracket();
            return;
        }
    } else {
        // Group-stage tournaments: require group picks
        if (!groupPicks || !groupPicks.completedAt) { showLocked(); return; }
        allTeamsInRound = buildQualifiedTeams(groupPicks);
    }

    const userId = auth.currentUser.uid;
    const userSnap = await getDoc(doc(db, "users", userId));
    knockoutData = userSnap.exists() ? (userSnap.data().knockout || {}) : {};

    // Attach listeners early
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

    // Find furthest completed round
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

// ── Get matchups for a round in knockout-only mode ──────────────────
function getMatchupsForRound(roundIndex) {
    const rounds = _rounds();
    const roundKey = rounds[roundIndex];
    const adminKey = getRoundAdminKey(roundKey);
    const adminRound = adminBracket?.rounds?.[adminKey] || [];

    if (roundIndex === 0) {
        // First round: matchups directly from admin bracket
        return adminRound.map(m => ({
            team1: m.team1 || '',
            team2: m.team2 || '',
            date: m.date || ''
        }));
    }

    // Subsequent rounds: pair up winners from previous round
    const prevKey = rounds[roundIndex - 1];
    const prevPicks = knockoutData[prevKey] || [];
    const matchups = [];
    for (let i = 0; i < prevPicks.length; i += 2) {
        matchups.push({
            team1: prevPicks[i] || '',
            team2: prevPicks[i + 1] || '',
            date: ''
        });
    }
    return matchups;
}

function loadRound(roundIndex) {
    const roundKey = _rounds()[roundIndex];
    selectedTeams = new Set();

    // Pre-select previously saved picks
    if (knockoutData[roundKey]) {
        const picks = _isFinalRound(roundKey) ? [knockoutData[roundKey]] : knockoutData[roundKey];
        picks.forEach(t => selectedTeams.add(t));
    }

    document.getElementById('bracket-round-info').innerHTML =
        `<p style="font-size: 1.1rem;">${_roundLabel(roundKey)}</p>`;

    if (knockoutOnly) {
        renderMatchups(roundIndex, roundKey);
    } else {
        // Original flat-grid mode for group-stage tournaments
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

// ── Matchup-based rendering (knockout-only mode) ────────────────────
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
            html += renderMatchupCard(m, roundKey, true);
        } else {
            // Just show the two teams from prev round
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
        html += renderMatchupCard(m, roundKey, false, twoLeg);
    });
    html += `</div>`;
    container.innerHTML = html;
}

function renderMatchupCard(matchup, roundKey, isFinal, twoLeg) {
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

window.toggleBracketTeam = function (team) {
    if (bracketLocked) return;
    const roundKey = _rounds()[currentRound];

    if (knockoutOnly) {
        // Matchup mode: selecting a team deselects its opponent
        const matchups = getMatchupsForRound(currentRound);
        const matchup = matchups.find(m => m.team1 === team || m.team2 === team);
        if (matchup) {
            const opponent = matchup.team1 === team ? matchup.team2 : matchup.team1;
            if (selectedTeams.has(team)) {
                selectedTeams.delete(team);
            } else {
                selectedTeams.delete(opponent); // deselect opponent
                selectedTeams.add(team);
            }
        }
        renderMatchups(currentRound, roundKey);
    } else {
        // Original flat-grid mode
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

function updateSaveBtn(roundKey) {
    const btn = document.getElementById('btn-bracket-save');
    const required = _roundPickCount(roundKey);
    const count = selectedTeams.size;
    btn.textContent = _isFinalRound(roundKey) ? '🏆 Kröna mästaren!' : `Spara & Nästa (${count}/${required}) ➡`;
    btn.disabled = count !== required;
}

async function saveBracketRound() {
    if (bracketLocked) return;
    const roundKey = _rounds()[currentRound];
    const userId = auth.currentUser.uid;

    if (_isFinalRound(roundKey)) {
        knockoutData[roundKey] = Array.from(selectedTeams)[0];
    } else {
        knockoutData[roundKey] = Array.from(selectedTeams);
        // Clear all subsequent rounds — picks are now invalid since the pool changed
        const rounds = _rounds();
        const thisIdx = rounds.indexOf(roundKey);
        for (let i = thisIdx + 1; i < rounds.length; i++) {
            delete knockoutData[rounds[i]];
        }
    }

    await updateDoc(doc(db, "users", userId), { knockout: knockoutData });
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
