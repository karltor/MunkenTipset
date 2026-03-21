import { db, auth } from './config.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f, flags } from './wizard.js';

const ROUNDS = ['r16', 'qf', 'sf', 'final'];
const ROUND_LABELS = {
    r16: 'Välj 16 lag som du tror går vidare till kvartsfinal',
    qf: 'Välj 8 lag som du tror går vidare till semifinal',
    sf: 'Välj 4 lag som du tror går vidare till final',
    final: 'Välj ditt VM-guld!'
};
const ROUND_PICK_COUNT = { r16: 16, qf: 8, sf: 4, final: 1 };

let currentRound = 0;
let knockoutData = {};
let allTeamsInRound = [];
let selectedTeams = new Set();
let listenersAttached = false;

export async function initBracket(groupPicks) {
    if (!groupPicks || !groupPicks.completedAt) {
        showLocked();
        return;
    }

    // Load existing knockout picks
    const userId = auth.currentUser.uid;
    const koRef = doc(db, "users", userId, "tips", "_knockout");
    const koSnap = await getDoc(koRef);
    if (koSnap.exists()) knockoutData = koSnap.data();
    else knockoutData = {};

    // Build the 32 qualified teams
    allTeamsInRound = buildQualifiedTeams(groupPicks);

    // Determine which round to show
    if (knockoutData.final) {
        showChampion(knockoutData.final);
        return;
    }
    currentRound = 0;
    if (knockoutData.r16?.length === 16) currentRound = 1;
    if (knockoutData.qf?.length === 8) currentRound = 2;
    if (knockoutData.sf?.length === 4) currentRound = 3;

    showBracketContent();
    loadRound(currentRound);

    if (!listenersAttached) {
        document.getElementById('btn-bracket-save').addEventListener('click', saveBracketRound);
        document.getElementById('btn-bracket-prev').addEventListener('click', () => {
            if (currentRound > 0) { currentRound--; loadRound(currentRound); }
        });
        listenersAttached = true;
    }
}

function showLocked() {
    document.getElementById('bracket-locked').style.display = 'block';
    document.getElementById('bracket-content').style.display = 'none';
    document.getElementById('bracket-champion').style.display = 'none';
    const btn = document.getElementById('btn-go-to-groups');
    btn.onclick = () => document.querySelector('.tab-btn[data-target="wizard-tab"]').click();
}

function showBracketContent() {
    document.getElementById('bracket-locked').style.display = 'none';
    document.getElementById('bracket-content').style.display = 'block';
    document.getElementById('bracket-champion').style.display = 'none';
}

function buildQualifiedTeams(picks) {
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
    const firsts = [], seconds = [], thirds = [];

    letters.forEach(letter => {
        if (!picks[letter]) return;
        firsts.push({ name: picks[letter].first, group: letter, seed: '1' });
        seconds.push({ name: picks[letter].second, group: letter, seed: '2' });
        if (picks[letter].third) {
            thirds.push({
                name: picks[letter].third,
                group: letter,
                seed: '3',
                pts: picks[letter].thirdPts || 0,
                gd: picks[letter].thirdGd || 0,
                gf: picks[letter].thirdGf || 0
            });
        }
    });

    // Pick best 8 third-place teams
    thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    const bestThirds = thirds.slice(0, 8);

    return [...firsts, ...seconds, ...bestThirds];
}

function loadRound(roundIndex) {
    const roundKey = ROUNDS[roundIndex];
    selectedTeams = new Set();

    // Determine teams available this round
    let teamsForRound;
    if (roundIndex === 0) {
        teamsForRound = allTeamsInRound;
    } else {
        const prevKey = ROUNDS[roundIndex - 1];
        const prevPicks = knockoutData[prevKey] || [];
        teamsForRound = prevPicks.map(name => ({ name, seed: '', group: '' }));
    }

    // Restore existing selections
    if (knockoutData[roundKey]) {
        const picks = roundKey === 'final' ? [knockoutData[roundKey]] : knockoutData[roundKey];
        picks.forEach(t => selectedTeams.add(t));
    }

    document.getElementById('bracket-round-info').innerHTML =
        `<p style="font-size: 1.1rem;">${ROUND_LABELS[roundKey]}</p>
         <p style="font-size: 0.85rem; color: #888;">Välj <strong>${ROUND_PICK_COUNT[roundKey]}</strong> lag</p>`;

    renderTeams(teamsForRound, roundKey);
    updateSaveBtn(roundKey);
}

function renderTeams(teams, roundKey) {
    const container = document.getElementById('bracket-container');

    if (roundKey === 'final') {
        // Grand final styling
        let html = `<div style="display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 40px 0;">`;
        html += `<h3 style="font-family: 'Playfair Display', serif; color: #ffc107; font-size: 1.8rem;">VM-FINALEN</h3>`;
        teams.forEach(t => {
            const sel = selectedTeams.has(t.name) ? 'selected' : '';
            html += `<div class="bracket-team ${sel}" style="width: 300px; font-size: 1.3rem; padding: 18px 24px;" onclick="window.toggleBracketTeam('${t.name}')">${fLarge(t.name)}${t.name}</div>`;
        });
        html += `</div>`;
        container.innerHTML = html;
        return;
    }

    // Group teams by seed for R16, otherwise just list them
    if (roundKey === 'r16') {
        const firsts = teams.filter(t => t.seed === '1');
        const seconds = teams.filter(t => t.seed === '2');
        const thirds = teams.filter(t => t.seed === '3');

        let html = '';
        html += renderSection('Gruppettor', firsts);
        html += renderSection('Grupptvåor', seconds);
        if (thirds.length > 0) html += renderSection('Bästa treor', thirds);
        container.innerHTML = html;
    } else {
        // QF / SF: just a flat grid
        let html = `<div class="bracket-grid">`;
        teams.forEach(t => {
            const sel = selectedTeams.has(t.name) ? 'selected' : '';
            html += `<div class="bracket-team ${sel}" onclick="window.toggleBracketTeam('${t.name}')">${f(t.name)}${t.name}</div>`;
        });
        html += `</div>`;
        container.innerHTML = html;
    }
}

function renderSection(title, teams) {
    let html = `<div class="bracket-section"><div class="bracket-section-title">${title}</div><div class="bracket-grid">`;
    teams.forEach(t => {
        const sel = selectedTeams.has(t.name) ? 'selected' : '';
        html += `<div class="bracket-team ${sel}" onclick="window.toggleBracketTeam('${t.name}')">${f(t.name)}${t.name} <span style="font-size:11px;color:#888;">(${t.group})</span></div>`;
    });
    html += `</div></div>`;
    return html;
}

function fLarge(t) {
    return flags[t] ? `<img src="https://flagcdn.com/32x24/${flags[t]}.png" style="vertical-align:middle; margin-right:10px; border-radius:2px; box-shadow: 0 1px 3px rgba(0,0,0,0.2);" width="32" height="24" alt="">` : '🌍 ';
}

window.toggleBracketTeam = function (team) {
    const roundKey = ROUNDS[currentRound];
    const required = ROUND_PICK_COUNT[roundKey];

    if (selectedTeams.has(team)) {
        selectedTeams.delete(team);
    } else {
        if (roundKey === 'final') selectedTeams.clear();
        else if (selectedTeams.size >= required) return; // Max reached
        selectedTeams.add(team);
    }

    // Re-render to update selection state
    const prevKey = currentRound === 0 ? null : ROUNDS[currentRound - 1];
    const teams = currentRound === 0
        ? allTeamsInRound
        : (knockoutData[prevKey] || []).map(name => ({ name, seed: '', group: '' }));
    renderTeams(teams, roundKey);
    updateSaveBtn(roundKey);
};

function updateSaveBtn(roundKey) {
    const btn = document.getElementById('btn-bracket-save');
    const required = ROUND_PICK_COUNT[roundKey];
    const count = selectedTeams.size;
    if (roundKey === 'final') {
        btn.textContent = '🏆 Kröna mästaren!';
    } else {
        btn.textContent = `Spara & Nästa (${count}/${required}) ➡`;
    }
    btn.disabled = count !== required;
}

async function saveBracketRound() {
    const roundKey = ROUNDS[currentRound];
    const userId = auth.currentUser.uid;

    if (roundKey === 'final') {
        knockoutData.final = Array.from(selectedTeams)[0];
    } else {
        knockoutData[roundKey] = Array.from(selectedTeams);
    }

    const koRef = doc(db, "users", userId, "tips", "_knockout");
    await setDoc(koRef, knockoutData, { merge: true });

    if (roundKey === 'final') {
        showChampion(knockoutData.final);
    } else {
        currentRound++;
        loadRound(currentRound);
        window.scrollTo(0, 0);
    }
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
                <h2>🏆 Ditt VM-Guld 2026 🏆</h2>
                <div style="margin: 30px 0;">${bigFlag}</div>
                <div style="font-size: 2.5rem; font-weight: 800; color: #ffc107;">${team}</div>
                <p style="color: #aaa; margin-top: 20px;">Du har tippat att ${team} vinner VM 2026!</p>
                <button class="btn" style="margin-top: 20px; background: rgba(255,255,255,0.1); color: white;" id="btn-edit-bracket">Ändra tips</button>
            </div>
        </div>`;

    document.getElementById('btn-edit-bracket').addEventListener('click', () => {
        champ.style.display = 'none';
        showBracketContent();
        currentRound = 3; // Go back to final round
        loadRound(currentRound);
    });
}
