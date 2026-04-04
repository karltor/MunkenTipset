import { db } from './config.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { bumpDataVersion } from './admin.js';
import { editState, getTeamsNeeded } from './admin-tournament.js';
import { isTwoLegged } from './tournament-config.js';

const ALL_KO_ROUNDS = [
    { key: "r32", label: "Sextondelsfinal", adminKey: "R32", teams: 32 },
    { key: "r16", label: "Åttondelsfinal",  adminKey: "R16", teams: 16 },
    { key: "qf",  label: "Kvartsfinal",      adminKey: "KF",  teams: 8  },
    { key: "sf",  label: "Semifinal",         adminKey: "SF",  teams: 4  },
    { key: "final", label: "Final",           adminKey: "Final", teams: 2 },
];

let existingBracket = null;
let bracketLoaded = false;

function getActiveRounds() {
    const startIdx = ALL_KO_ROUNDS.findIndex(r => r.key === editState.koStart);
    return startIdx >= 0 ? ALL_KO_ROUNDS.slice(startIdx) : [ALL_KO_ROUNDS[ALL_KO_ROUNDS.length - 1]];
}

async function ensureBracketLoaded() {
    if (bracketLoaded) return;
    try {
        const snap = await getDoc(doc(db, "matches", "_bracket"));
        existingBracket = snap.exists() ? snap.data() : { teams: [], rounds: {} };
    } catch { existingBracket = { teams: [], rounds: {} }; }
    bracketLoaded = true;
}

function teamOptions(selected, usedTeams) {
    let html = `<option value="">— Välj lag —</option>`;
    editState.teams.forEach(t => {
        const disabled = usedTeams.has(t) && t !== selected ? 'disabled style="color:#ccc;"' : '';
        html += `<option value="${t}" ${t === selected ? 'selected' : ''} ${disabled}>${t}</option>`;
    });
    return html;
}

export async function renderBracketBuilder() {
    const section = document.getElementById('bracket-builder-section');
    if (!section || !editState.hasKnockout) { if (section) section.innerHTML = ''; return; }

    await ensureBracketLoaded();
    const rounds = getActiveRounds();
    const needed = getTeamsNeeded();
    const firstRound = rounds[0];
    const matchCount = firstRound.teams / 2;
    const rd = existingBracket?.rounds || {};

    let html = `<div class="admin-card" style="margin-bottom:16px;">`;
    html += `<h3 style="margin-top:0;">Bracket</h3>`;

    if (editState.teams.length < needed) {
        html += `<p style="color:#dc3545; font-size:13px;">Lägg till ${needed - editState.teams.length} lag till (behöver ${needed} för ${firstRound.label.toLowerCase()}).</p>`;
    }

    // First round: dropdown matchups
    const usedTeams = new Set();
    const firstRoundMatches = rd[firstRound.adminKey] || [];

    html += `<div class="bracket-builder-round">`;
    html += `<div class="bracket-builder-round-label">${firstRound.label}</div>`;
    for (let i = 0; i < matchCount; i++) {
        const m = firstRoundMatches[i] || {};
        const t1 = m.team1 || '';
        const t2 = m.team2 || '';
        if (t1) usedTeams.add(t1);
        if (t2) usedTeams.add(t2);
    }
    // Re-render with used tracking
    const allUsed = new Set();
    for (let i = 0; i < matchCount; i++) {
        const m = firstRoundMatches[i] || {};
        const t1 = m.team1 || '';
        const t2 = m.team2 || '';
        const twoLeg = editState.twoLegged[firstRound.key];
        html += `<div class="bracket-builder-match">`;
        html += `<span class="bracket-builder-num">${i + 1}.</span>`;
        html += `<select class="bb-team" data-round="${firstRound.adminKey}" data-match="${i}" data-side="1">${teamOptions(t1, allUsed)}</select>`;
        html += `<span style="color:#888; font-size:12px;">vs</span>`;
        html += `<select class="bb-team" data-round="${firstRound.adminKey}" data-match="${i}" data-side="2">${teamOptions(t2, allUsed)}</select>`;
        if (twoLeg) html += `<span style="font-size:10px; color:#ffc107; margin-left:4px;">2 möten</span>`;
        html += `</div>`;
        if (t1) allUsed.add(t1);
        if (t2) allUsed.add(t2);
    }
    html += `</div>`;

    // Subsequent rounds: auto-populated (read-only preview)
    for (let ri = 1; ri < rounds.length; ri++) {
        const round = rounds[ri];
        const mc = round.teams / 2;
        const roundMatches = rd[round.adminKey] || [];
        html += `<div class="bracket-builder-round" style="opacity:0.6;">`;
        html += `<div class="bracket-builder-round-label">${round.label} <span style="font-size:11px; color:#888;">(fylls i automatiskt)</span></div>`;
        for (let i = 0; i < mc; i++) {
            const m = roundMatches[i] || {};
            html += `<div class="bracket-builder-match">`;
            html += `<span class="bracket-builder-num">${i + 1}.</span>`;
            html += `<span style="color:#888; font-size:13px;">${m.team1 || '?'} vs ${m.team2 || '?'}</span>`;
            html += `</div>`;
        }
        html += `</div>`;
    }

    html += `<button class="btn" id="bb-save" style="margin-top:12px; background:#ffc107; color:#000; font-size:13px; width:100%;">Spara bracket & lag</button>`;
    html += `<span id="bb-status" style="margin-left:8px; font-size:12px;"></span>`;
    html += `</div>`;

    section.innerHTML = html;

    // Refresh dropdowns when selection changes
    section.querySelectorAll('.bb-team').forEach(sel => {
        sel.addEventListener('change', () => refreshDropdowns(section, firstRound, matchCount));
    });
    document.getElementById('bb-save')?.addEventListener('click', () => saveBracketFromBuilder());
}

function refreshDropdowns(section, firstRound, matchCount) {
    // Collect all currently selected teams
    const selected = {};
    const allUsed = new Set();
    for (let i = 0; i < matchCount; i++) {
        const s1 = section.querySelector(`.bb-team[data-round="${firstRound.adminKey}"][data-match="${i}"][data-side="1"]`);
        const s2 = section.querySelector(`.bb-team[data-round="${firstRound.adminKey}"][data-match="${i}"][data-side="2"]`);
        const v1 = s1?.value || '';
        const v2 = s2?.value || '';
        selected[`${i}-1`] = v1;
        selected[`${i}-2`] = v2;
        if (v1) allUsed.add(v1);
        if (v2) allUsed.add(v2);
    }
    // Update each dropdown's disabled state
    for (let i = 0; i < matchCount; i++) {
        [1, 2].forEach(side => {
            const sel = section.querySelector(`.bb-team[data-round="${firstRound.adminKey}"][data-match="${i}"][data-side="${side}"]`);
            if (!sel) return;
            const myVal = sel.value;
            Array.from(sel.options).forEach(opt => {
                if (!opt.value) return;
                opt.disabled = allUsed.has(opt.value) && opt.value !== myVal;
            });
        });
    }
}

export async function saveBracketFromBuilder() {
    const section = document.getElementById('bracket-builder-section');
    const rounds = getActiveRounds();
    const firstRound = rounds[0];
    const matchCount = firstRound.teams / 2;

    const bracket = { teams: [...editState.teams], rounds: {} };

    // Read first round from dropdowns
    bracket.rounds[firstRound.adminKey] = [];
    for (let i = 0; i < matchCount; i++) {
        const t1 = section.querySelector(`.bb-team[data-round="${firstRound.adminKey}"][data-match="${i}"][data-side="1"]`)?.value || '';
        const t2 = section.querySelector(`.bb-team[data-round="${firstRound.adminKey}"][data-match="${i}"][data-side="2"]`)?.value || '';
        bracket.rounds[firstRound.adminKey].push({ team1: t1, team2: t2 });
    }

    // Initialize empty subsequent rounds
    for (let ri = 1; ri < rounds.length; ri++) {
        const round = rounds[ri];
        const mc = round.teams / 2;
        // Keep existing data if present
        bracket.rounds[round.adminKey] = (existingBracket?.rounds?.[round.adminKey] || []).slice(0, mc);
        while (bracket.rounds[round.adminKey].length < mc) bracket.rounds[round.adminKey].push({});
    }

    await setDoc(doc(db, "matches", "_bracket"), bracket);
    await bumpDataVersion();
    existingBracket = bracket;

    const s = document.getElementById('bb-status');
    if (s) { s.textContent = '✓ Sparat!'; s.style.color = '#28a745'; setTimeout(() => { s.textContent = ''; }, 2500); }
}
