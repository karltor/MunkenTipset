import { db, auth } from './config.js';
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f, flags } from './wizard.js';

const ROUNDS = ['r32', 'r16', 'qf', 'sf', 'final'];
const ROUND_LABELS = {
    r32: 'Välj 16 lag som går vidare till åttondelsfinal',
    r16: 'Välj 8 lag som går vidare till kvartsfinal',
    qf: 'Välj 4 lag som går vidare till semifinal',
    sf: 'Välj 2 lag som går vidare till final',
    final: 'Vilket lag vinner VM 2026?'
};
const ROUND_PICK_COUNT = { r32: 16, r16: 8, qf: 4, sf: 2, final: 1 };

let currentRound = 0;
let knockoutData = {};
let allTeamsInRound = [];
let selectedTeams = new Set();
let listenersAttached = false;
let bracketLocked = false;

export async function initBracket(groupPicks, tipsLocked) {
    bracketLocked = tipsLocked || false;
    if (!groupPicks || !groupPicks.completedAt) { showLocked(); return; }

    const userId = auth.currentUser.uid;
    const userSnap = await getDoc(doc(db, "users", userId));
    knockoutData = userSnap.exists() ? (userSnap.data().knockout || {}) : {};

    allTeamsInRound = buildQualifiedTeams(groupPicks);

    // Attach listeners early — must happen before any early return
    if (!listenersAttached) {
        document.getElementById('btn-bracket-save').addEventListener('click', saveBracketRound);
        document.getElementById('btn-bracket-prev').addEventListener('click', () => {
            if (currentRound > 0) { currentRound--; loadRound(currentRound); }
        });
        listenersAttached = true;
    }

    if (knockoutData.final) { showChampion(knockoutData.final); return; }

    currentRound = 0;
    if (knockoutData.r32?.length === 16) currentRound = 1;
    if (knockoutData.r16?.length === 8) currentRound = 2;
    if (knockoutData.qf?.length === 4) currentRound = 3;
    if (knockoutData.sf?.length === 2) currentRound = 4;

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
            thirds.push({ name: picks[letter].third, group: letter, seed: '3',
                pts: picks[letter].thirdPts || 0, gd: picks[letter].thirdGd || 0, gf: picks[letter].thirdGf || 0 });
        }
    });
    thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    return [...firsts, ...seconds, ...thirds.slice(0, 8)];
}

function loadRound(roundIndex) {
    const roundKey = ROUNDS[roundIndex];
    selectedTeams = new Set();

    let teamsForRound;
    if (roundIndex === 0) {
        teamsForRound = allTeamsInRound;
    } else {
        const prevKey = ROUNDS[roundIndex - 1];
        const prev = knockoutData[prevKey] || [];
        teamsForRound = prev.map(name => ({ name, seed: '', group: '' }));
    }

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
        let html = `<div style="text-align: center; padding: 40px 0;">`;
        html += `<h3 style="font-family: 'Playfair Display', serif; color: #ffc107; font-size: 1.8rem; margin-bottom: 24px;">VM-FINALEN</h3>`;
        html += `<div class="bracket-team-grid" style="justify-content: center; gap: 20px;">`;
        teams.forEach(t => {
            const sel = selectedTeams.has(t.name) ? 'selected' : '';
            html += `<div class="bracket-team ${sel}" style="font-size: 1.2rem; padding: 16px 24px;" onclick="window.toggleBracketTeam('${t.name}')">${fLarge(t.name)}${t.name}</div>`;
        });
        html += `</div></div>`;
        container.innerHTML = html;
        return;
    }

    if (roundKey === 'r32') {
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
    return flags[t] ? `<img src="https://flagcdn.com/32x24/${flags[t]}.png" style="vertical-align:middle; margin-right:10px; border-radius:2px;" width="32" height="24" alt="">` : '🌍 ';
}

window.toggleBracketTeam = function (team) {
    if (bracketLocked) return;
    const roundKey = ROUNDS[currentRound];
    const required = ROUND_PICK_COUNT[roundKey];

    if (selectedTeams.has(team)) {
        selectedTeams.delete(team);
    } else {
        if (roundKey === 'final') selectedTeams.clear();
        else if (selectedTeams.size >= required) return;
        selectedTeams.add(team);
    }

    const prevKey = currentRound === 0 ? null : ROUNDS[currentRound - 1];
    const teams = currentRound === 0 ? allTeamsInRound : (knockoutData[prevKey] || []).map(n => ({ name: n, seed: '', group: '' }));
    renderTeams(teams, roundKey);
    updateSaveBtn(roundKey);
};

function updateSaveBtn(roundKey) {
    const btn = document.getElementById('btn-bracket-save');
    const required = ROUND_PICK_COUNT[roundKey];
    const count = selectedTeams.size;
    btn.textContent = roundKey === 'final' ? '🏆 Kröna mästaren!' : `Spara & Nästa (${count}/${required}) ➡`;
    btn.disabled = count !== required;
}

async function saveBracketRound() {
    if (bracketLocked) return;
    const roundKey = ROUNDS[currentRound];
    const userId = auth.currentUser.uid;

    if (roundKey === 'final') knockoutData.final = Array.from(selectedTeams)[0];
    else knockoutData[roundKey] = Array.from(selectedTeams);

    await updateDoc(doc(db, "users", userId), { knockout: knockoutData });

    if (roundKey === 'final') { showChampion(knockoutData.final); }
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
                <h2>🏆 Ditt VM-Guld 2026 🏆</h2>
                <div style="margin: 30px 0;">${bigFlag}</div>
                <div style="font-size: 2.5rem; font-weight: 800; color: #ffc107;">${team}</div>
                <p style="color: #aaa; margin-top: 20px;">Du har tippat att ${team} vinner VM 2026!</p>
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
        // Start from R32 with all picks pre-filled
        currentRound = 0;
        loadRound(currentRound);
    });
}
