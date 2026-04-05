import { db } from './config.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { bumpDataVersion } from './admin.js';
import { editState, getTeamsNeeded } from './admin-tournament.js';
import { isTwoLegged } from './tournament-config.js';
import { f } from './wizard.js';

const ALL_KO_ROUNDS = [
    { key: "r32", label: "Sextondelsfinal", adminKey: "R32", teams: 32 },
    { key: "r16", label: "Åttondelsfinal",  adminKey: "R16", teams: 16 },
    { key: "qf",  label: "Kvartsfinal",      adminKey: "KF",  teams: 8  },
    { key: "sf",  label: "Semifinal",         adminKey: "SF",  teams: 4  },
    { key: "final", label: "Final",           adminKey: "Final", teams: 2 },
];

let existingBracket = null;
let bracketLoaded = false;
let bracketAssignments = {}; // { "KF-0-1": "PSG", "KF-0-2": "Valencia", ... }

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

function getAssignedTeams() {
    return new Set(Object.values(bracketAssignments).filter(Boolean));
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

    // Initialize assignments from existing bracket data (first round only)
    bracketAssignments = {};
    const firstRoundMatches = rd[firstRound.adminKey] || [];
    for (let i = 0; i < matchCount; i++) {
        const m = firstRoundMatches[i] || {};
        if (m.team1) bracketAssignments[`${firstRound.adminKey}-${i}-1`] = m.team1;
        if (m.team2) bracketAssignments[`${firstRound.adminKey}-${i}-2`] = m.team2;
    }

    let html = `<div class="admin-card" style="margin-bottom:16px;">`;
    html += `<h3 style="margin-top:0;">Bracket</h3>`;

    if (editState.teams.length < needed) {
        html += `<p style="color:#dc3545; font-size:13px;">Lägg till ${needed - editState.teams.length} lag till (behöver ${needed} för ${firstRound.label.toLowerCase()}).</p>`;
    }

    // ── Team pool (unassigned teams) ──
    html += `<div class="bb-team-pool" id="bb-team-pool">`;
    html += `<div style="font-size:12px; font-weight:700; color:#666; margin-bottom:6px;">Dra lag till bracketen:</div>`;
    html += `<div class="bb-pool-tags" id="bb-pool-tags"></div>`;
    html += `</div>`;

    // ── Visual bracket ──
    html += `<div class="bb-bracket-wrap">`;
    html += renderVisualBracket(rounds, rd, firstRound, matchCount);
    html += `</div>`;

    html += `<button class="btn" id="bb-save" style="margin-top:12px; background:#ffc107; color:#000; font-size:13px; width:100%;">Spara bracket & lag</button>`;
    html += `<span id="bb-status" style="margin-left:8px; font-size:12px;"></span>`;
    html += `</div>`;

    section.innerHTML = html;
    refreshPoolTags();
    wireDropZones(section);
    document.getElementById('bb-save')?.addEventListener('click', () => saveBracketFromBuilder());
}

function renderVisualBracket(rounds, rd, firstRound, matchCount) {
    const finalRound = rounds[rounds.length - 1];
    const nonFinal = rounds.filter(r => r !== finalRound);

    // For small brackets (e.g. QF start), left side gets first half, right gets second
    const leftRounds = nonFinal.map(r => ({
        key: r.adminKey, userKey: r.key, label: r.label, start: 0, count: r.teams / 4
    }));
    const rightRounds = [...nonFinal].reverse().map(r => ({
        key: r.adminKey, userKey: r.key, label: r.label, start: r.teams / 4, count: r.teams / 4
    }));

    let html = `<div style="background: linear-gradient(135deg, #1f1f3a, #2b2b52); border-radius: 12px; padding: 16px; overflow-x: auto;">`;
    html += `<div class="br-tree" style="min-height:${Math.max(300, matchCount * 80)}px;">`;

    // Left half
    leftRounds.forEach((round, ri) => {
        const isFirstRound = round.key === firstRound.adminKey;
        const twoLeg = isTwoLegged(round.userKey);
        html += `<div class="br-round br-left">`;
        html += `<div class="br-round-label">${round.label}${twoLeg ? ' <span style="font-size:9px; color:#ffc107;">(2m)</span>' : ''}</div>`;
        html += `<div class="br-round-matches">`;
        html += buildBracketSlots(rd, round, ri, 'left', isFirstRound);
        html += `</div></div>`;
    });

    // Final (center)
    const finalAdminKey = finalRound?.adminKey || 'Final';
    const isFirstRound = finalAdminKey === firstRound.adminKey;
    const finalMatch = (rd[finalAdminKey] || [])[0] || {};
    html += `<div class="br-round br-final-round">`;
    html += `<div class="br-round-label br-final-label">${(finalRound?.label || 'FINAL').toUpperCase()}</div>`;
    html += `<div class="br-round-matches">`;
    html += `<div class="br-slot">${renderBracketSlotMatch(finalAdminKey, 0, finalMatch, true, isFirstRound)}</div>`;
    html += `</div></div>`;

    // Right half (mirrored)
    rightRounds.forEach((round, ri) => {
        const depth = nonFinal.length - 1 - ri;
        const isFirst = round.key === firstRound.adminKey;
        html += `<div class="br-round br-right">`;
        html += `<div class="br-round-label">${round.label}</div>`;
        html += `<div class="br-round-matches">`;
        html += buildBracketSlots(rd, round, depth, 'right', isFirst);
        html += `</div></div>`;
    });

    html += `</div></div>`;
    return html;
}

function buildBracketSlots(rd, round, depth, side, isFirstRound) {
    const matches = [];
    for (let i = 0; i < round.count; i++) {
        matches.push({ idx: round.start + i, data: (rd[round.key] || [])[round.start + i] || {} });
    }
    if (matches.length === 1) {
        return `<div class="br-slot br-conn-${side}">${renderBracketSlotMatch(round.key, matches[0].idx, matches[0].data, false, isFirstRound)}</div>`;
    }
    let html = '';
    for (let i = 0; i < matches.length; i += 2) {
        html += `<div class="br-pair br-pair-${side}">`;
        html += `<div class="br-slot">${renderBracketSlotMatch(round.key, matches[i].idx, matches[i].data, false, isFirstRound)}</div>`;
        if (i + 1 < matches.length) {
            html += `<div class="br-slot">${renderBracketSlotMatch(round.key, matches[i + 1].idx, matches[i + 1].data, false, isFirstRound)}</div>`;
        }
        html += `</div>`;
    }
    return html;
}

function renderBracketSlotMatch(roundKey, matchIdx, match, isFinal, isFirstRound) {
    const key1 = `${roundKey}-${matchIdx}-1`;
    const key2 = `${roundKey}-${matchIdx}-2`;
    const t1 = bracketAssignments[key1] || match.team1 || '';
    const t2 = bracketAssignments[key2] || match.team2 || '';
    const sz = isFinal ? 'font-size:13px; padding:6px 10px;' : '';
    const dropStyle = isFirstRound ? 'cursor:pointer;' : '';

    let html = `<div class="abt-match bb-match" data-round="${roundKey}" data-idx="${matchIdx}">`;

    // Team 1 row
    html += `<div class="abt-team-row bb-drop-zone ${isFirstRound ? 'bb-droppable' : ''}" data-key="${key1}" style="${sz}${dropStyle}">`;
    if (t1) {
        html += `<span style="flex:1;" class="${isFirstRound ? 'bb-assigned-team' : ''}" ${isFirstRound ? `draggable="true" data-team="${t1}" data-from="${key1}"` : ''}>${f(t1)}${t1}</span>`;
        if (isFirstRound) html += `<span class="bb-remove" data-key="${key1}" style="cursor:pointer; color:#dc3545; font-size:14px; padding:0 4px;" title="Ta bort">×</span>`;
    } else {
        html += `<span style="flex:1; color:${isFirstRound ? '#ffc107' : '#555'}; font-style:italic; font-size:11px;">${isFirstRound ? 'Dra hit lag' : 'TBD'}</span>`;
    }
    html += `</div>`;

    // Team 2 row
    html += `<div class="abt-team-row bb-drop-zone ${isFirstRound ? 'bb-droppable' : ''}" data-key="${key2}" style="${sz}${dropStyle}">`;
    if (t2) {
        html += `<span style="flex:1;" class="${isFirstRound ? 'bb-assigned-team' : ''}" ${isFirstRound ? `draggable="true" data-team="${t2}" data-from="${key2}"` : ''}>${f(t2)}${t2}</span>`;
        if (isFirstRound) html += `<span class="bb-remove" data-key="${key2}" style="cursor:pointer; color:#dc3545; font-size:14px; padding:0 4px;" title="Ta bort">×</span>`;
    } else {
        html += `<span style="flex:1; color:${isFirstRound ? '#ffc107' : '#555'}; font-style:italic; font-size:11px;">${isFirstRound ? 'Dra hit lag' : 'TBD'}</span>`;
    }
    html += `</div>`;

    html += `</div>`;
    return html;
}

// ── Pool tags (unassigned teams) ──────────────────────────────────────
function refreshPoolTags() {
    const pool = document.getElementById('bb-pool-tags');
    if (!pool) return;
    const assigned = getAssignedTeams();
    const unassigned = editState.teams.filter(t => !assigned.has(t));

    if (unassigned.length === 0 && editState.teams.length > 0) {
        pool.innerHTML = `<span style="font-size:12px; color:#28a745;">✓ Alla lag placerade</span>`;
        return;
    }

    pool.innerHTML = unassigned.map(t =>
        `<span class="bb-pool-tag" draggable="true" data-team="${t}">${f(t)}${t}</span>`
    ).join('');

    // Wire drag on pool tags
    pool.querySelectorAll('.bb-pool-tag').forEach(tag => {
        tag.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', tag.dataset.team);
            e.dataTransfer.setData('from', '');
            tag.classList.add('dragging');
        });
        tag.addEventListener('dragend', () => tag.classList.remove('dragging'));
    });
}

// ── Drop zone wiring ──────────────────────────────────────────────────
function wireDropZones(section) {
    // Wire drag from assigned teams in bracket
    section.querySelectorAll('.bb-assigned-team[draggable="true"]').forEach(el => {
        el.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', el.dataset.team);
            e.dataTransfer.setData('from', el.dataset.from);
            el.closest('.abt-team-row').classList.add('dragging');
        });
        el.addEventListener('dragend', () => {
            section.querySelectorAll('.dragging').forEach(d => d.classList.remove('dragging'));
        });
    });

    // Wire drop zones (first round slots)
    section.querySelectorAll('.bb-droppable').forEach(zone => {
        zone.addEventListener('dragover', e => {
            e.preventDefault();
            zone.classList.add('bb-drag-over');
        });
        zone.addEventListener('dragleave', () => zone.classList.remove('bb-drag-over'));
        zone.addEventListener('drop', e => {
            e.preventDefault();
            zone.classList.remove('bb-drag-over');
            const team = e.dataTransfer.getData('text/plain');
            const fromKey = e.dataTransfer.getData('from');
            const toKey = zone.dataset.key;

            if (!team || !toKey) return;

            // If dropping on a slot that already has a team, swap
            const existingTeam = bracketAssignments[toKey];
            if (fromKey) {
                // Moving from another bracket slot
                bracketAssignments[toKey] = team;
                if (existingTeam && existingTeam !== team) {
                    bracketAssignments[fromKey] = existingTeam; // swap
                } else {
                    delete bracketAssignments[fromKey];
                }
            } else {
                // From pool
                if (existingTeam) {
                    // Existing team goes back to pool
                    delete bracketAssignments[toKey];
                }
                bracketAssignments[toKey] = team;
            }

            rebuildBracketUI();
        });
    });

    // Wire remove buttons
    section.querySelectorAll('.bb-remove').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const key = btn.dataset.key;
            delete bracketAssignments[key];
            rebuildBracketUI();
        });
    });
}

function rebuildBracketUI() {
    const section = document.getElementById('bracket-builder-section');
    if (!section) return;

    const rounds = getActiveRounds();
    const firstRound = rounds[0];
    const matchCount = firstRound.teams / 2;
    const rd = existingBracket?.rounds || {};

    const wrap = section.querySelector('.bb-bracket-wrap');
    if (wrap) {
        wrap.innerHTML = renderVisualBracket(rounds, rd, firstRound, matchCount);
        wireDropZones(section);
    }
    refreshPoolTags();
}

export async function saveBracketFromBuilder() {
    const rounds = getActiveRounds();
    const firstRound = rounds[0];
    const matchCount = firstRound.teams / 2;

    const bracket = { teams: [...editState.teams], rounds: {} };

    // Build first round from assignments
    bracket.rounds[firstRound.adminKey] = [];
    for (let i = 0; i < matchCount; i++) {
        const t1 = bracketAssignments[`${firstRound.adminKey}-${i}-1`] || '';
        const t2 = bracketAssignments[`${firstRound.adminKey}-${i}-2`] || '';
        bracket.rounds[firstRound.adminKey].push({ team1: t1, team2: t2 });
    }

    // Initialize empty subsequent rounds (keep existing data)
    for (let ri = 1; ri < rounds.length; ri++) {
        const round = rounds[ri];
        const mc = round.teams / 2;
        bracket.rounds[round.adminKey] = (existingBracket?.rounds?.[round.adminKey] || []).slice(0, mc);
        while (bracket.rounds[round.adminKey].length < mc) bracket.rounds[round.adminKey].push({});
    }

    await setDoc(doc(db, "matches", "_bracket"), bracket);
    await bumpDataVersion();
    existingBracket = bracket;

    const s = document.getElementById('bb-status');
    if (s) { s.textContent = '✓ Sparat!'; s.style.color = '#28a745'; setTimeout(() => { s.textContent = ''; }, 2500); }
}
