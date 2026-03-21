import { db, auth } from './config.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f, flags } from './wizard.js';

const ROUNDS = ['r16', 'qf', 'sf', 'final'];
const ROUND_LABELS = {
    r16: 'Åttondelsfinal – Välj 16 lag som går vidare till kvartsfinal',
    qf: 'Kvartsfinal – Välj 8 lag som går vidare till semifinal',
    sf: 'Semifinal – Välj 4 lag som går vidare till final',
    final: 'Final – Välj ditt VM-guld!'
};
const ROUND_PICK_COUNT = { r16: 16, qf: 8, sf: 4, final: 1 };

let currentRound = 0;
let knockoutData = {}; // { r16: [...teams], qf: [...], sf: [...], final: "team" }
let qualifiedTeams = []; // 32 teams from group stage
let bracketMatchups = []; // Current round's matchups
let selectedTeams = new Set();

export async function initBracket(groupPicks) {
    if (!groupPicks || !groupPicks.completedAt) {
        showLocked();
        return;
    }

    // Build 32 qualified teams from group picks (1st & 2nd from each group + best 3rds)
    qualifiedTeams = buildQualifiedTeams(groupPicks);

    // Load existing knockout picks
    const userId = auth.currentUser.uid;
    const koRef = doc(db, "users", userId, "tips", "_knockout");
    const koSnap = await getDoc(koRef);
    if (koSnap.exists()) {
        knockoutData = koSnap.data();
    }

    // Determine which round to show
    if (knockoutData.final) {
        showChampion(knockoutData.final);
        return;
    }
    currentRound = 0;
    if (knockoutData.r16 && knockoutData.r16.length === 16) currentRound = 1;
    if (knockoutData.qf && knockoutData.qf.length === 8) currentRound = 2;
    if (knockoutData.sf && knockoutData.sf.length === 4) currentRound = 3;

    showBracketContent();
    loadRound(currentRound);

    document.getElementById('btn-bracket-save').addEventListener('click', saveBracketRound);
    document.getElementById('btn-bracket-prev').addEventListener('click', () => {
        if (currentRound > 0) { currentRound--; loadRound(currentRound); }
    });
}

function showLocked() {
    document.getElementById('bracket-locked').style.display = 'block';
    document.getElementById('bracket-content').style.display = 'none';
    document.getElementById('bracket-champion').style.display = 'none';
    document.getElementById('btn-go-to-groups').addEventListener('click', () => {
        document.querySelector('.tab-btn[data-target="wizard-tab"]').click();
    });
}

function showBracketContent() {
    document.getElementById('bracket-locked').style.display = 'none';
    document.getElementById('bracket-content').style.display = 'block';
    document.getElementById('bracket-champion').style.display = 'none';
}

function buildQualifiedTeams(picks) {
    const teams = [];
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
    letters.forEach(letter => {
        if (picks[letter]) {
            teams.push({ name: picks[letter].first, seed: `1${letter}` });
            teams.push({ name: picks[letter].second, seed: `2${letter}` });
        }
    });
    // For the 2026 format with 48 teams, best 3rd-place teams also qualify
    // but in casual mode we only have 1st/2nd so we use those 24 teams
    return teams;
}

// FIFA 2026 R32 matchups based on seeding
function getR16Matchups(teams) {
    const byS = {};
    teams.forEach(t => byS[t.seed] = t.name);

    // Simplified FIFA bracket structure for 48-team tournament
    // 8 groups of 4 → top 2 advance = 16 teams in R16 actually
    // But with 12 groups (A-L), 1st and 2nd = 24 teams, plus 8 best 3rds = 32
    // Since we only have 1st & 2nd (24 teams), we create 12 matchups
    // Actually the 2026 WC has 12 groups, top 2 + 8 best 3rds = 32 in R32
    // For simplicity with our picks (24 teams), we pair them:
    const matchups = [
        [byS['1A'], byS['2D']], [byS['1B'], byS['2C']],
        [byS['1C'], byS['2B']], [byS['1D'], byS['2A']],
        [byS['1E'], byS['2H']], [byS['1F'], byS['2G']],
        [byS['1G'], byS['2F']], [byS['1H'], byS['2E']],
        [byS['1I'], byS['2L']], [byS['1J'], byS['2K']],
        [byS['1K'], byS['2J']], [byS['1L'], byS['2I']]
    ];
    return matchups.filter(m => m[0] && m[1]);
}

function loadRound(roundIndex) {
    const roundKey = ROUNDS[roundIndex];
    selectedTeams = new Set();

    document.getElementById('bracket-round-info').innerHTML =
        `<p style="font-size: 1.1rem;">${ROUND_LABELS[roundKey]}</p>
         <p style="font-size: 0.85rem; color: #888;">Välj <strong>${ROUND_PICK_COUNT[roundKey]}</strong> lag</p>`;

    let teamsInRound;
    if (roundIndex === 0) {
        bracketMatchups = getR16Matchups(qualifiedTeams);
        teamsInRound = bracketMatchups;
    } else {
        // Teams from previous round's picks form new matchups
        const prevKey = ROUNDS[roundIndex - 1];
        const prevTeams = knockoutData[prevKey] || [];
        bracketMatchups = [];
        for (let i = 0; i < prevTeams.length; i += 2) {
            if (prevTeams[i + 1]) bracketMatchups.push([prevTeams[i], prevTeams[i + 1]]);
        }
        teamsInRound = bracketMatchups;
    }

    // Restore existing selections for this round
    if (knockoutData[roundKey]) {
        knockoutData[roundKey].forEach(t => selectedTeams.add(t));
    }

    renderBracketRound(teamsInRound, roundKey);
    updateBracketSaveBtn(roundKey);
}

function renderBracketRound(matchups, roundKey) {
    const container = document.getElementById('bracket-container');
    const required = ROUND_PICK_COUNT[roundKey];

    if (roundKey === 'final') {
        // Final is special - pick one winner from 2 teams (or from semifinal winners)
        const prevTeams = knockoutData.sf || [];
        let html = `<div style="display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 40px 0;">`;
        html += `<h3 style="font-family: 'Playfair Display', serif; color: #ffc107; font-size: 1.8rem;">VM-FINALEN</h3>`;
        prevTeams.forEach(team => {
            const sel = selectedTeams.has(team) ? 'selected' : '';
            html += `<div class="bracket-team ${sel}" style="width: 280px; font-size: 1.2rem; padding: 16px 20px;" onclick="window.toggleBracketTeam('${team}', '${roundKey}')">${fLarge(team)}${team}</div>`;
        });
        html += `</div>`;
        container.innerHTML = html;
    } else {
        let html = `<div class="bracket-grid">`;
        matchups.forEach((match, i) => {
            html += `<div class="bracket-matchup">`;
            html += `<div class="bracket-matchup-label">Match ${i + 1}</div>`;
            match.forEach(team => {
                if (!team) return;
                const sel = selectedTeams.has(team) ? 'selected' : '';
                html += `<div class="bracket-team ${sel}" onclick="window.toggleBracketTeam('${team}', '${roundKey}')">${f(team)}${team}</div>`;
            });
            html += `</div>`;
        });
        html += `</div>`;
        container.innerHTML = html;
    }
}

function fLarge(t) {
    return flags[t] ? `<img src="https://flagcdn.com/32x24/${flags[t]}.png" style="vertical-align:middle; margin-right:10px; border-radius:2px; box-shadow: 0 1px 3px rgba(0,0,0,0.2);" width="32" height="24" alt="">` : '🌍 ';
}

window.toggleBracketTeam = function (team, roundKey) {
    const required = ROUND_PICK_COUNT[roundKey];

    if (selectedTeams.has(team)) {
        selectedTeams.delete(team);
    } else {
        if (roundKey === 'final') {
            selectedTeams.clear(); // Only one champion
        }
        // For matchup-based rounds, only one per matchup
        const matchup = bracketMatchups.find(m => m.includes(team));
        if (matchup) {
            matchup.forEach(t => selectedTeams.delete(t));
        }
        selectedTeams.add(team);
    }

    renderBracketRound(bracketMatchups, roundKey);
    updateBracketSaveBtn(roundKey);
};

function updateBracketSaveBtn(roundKey) {
    const btn = document.getElementById('btn-bracket-save');
    const required = ROUND_PICK_COUNT[roundKey];
    const count = selectedTeams.size;
    btn.textContent = roundKey === 'final' ? `Kröna mästaren!` : `Spara & Nästa (${count}/${required}) ➡`;
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
                <h2>🏆 Ditt VM-Guld 🏆</h2>
                <div style="font-size: 80px; margin: 20px 0;">${bigFlag}</div>
                <div class="champion-name" style="font-size: 2.5rem; font-weight: 800; color: #ffc107;">${team}</div>
                <p style="color: #aaa; margin-top: 20px;">Du har tippat att ${team} vinner VM 2026!</p>
                <button class="btn" style="margin-top: 20px; background: rgba(255,255,255,0.1); color: white;" onclick="document.getElementById('bracket-champion').style.display='none'; document.getElementById('bracket-content').style.display='block';">Ändra tips</button>
            </div>
        </div>`;
}
