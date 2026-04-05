import { db } from './config.js';
import { getAllTeamNames, teamImg } from './team-data.js';
import { collection, getDocs, doc, setDoc, writeBatch }
    from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { bumpDataVersion } from './admin.js';
import { getConfig, getGroupLetters, hasStageType } from './tournament-config.js';
import { renderBracketBuilder, saveBracketFromBuilder } from './admin-tournament-bracket.js';
import { renderGroupBuilder } from './admin-tournament-groups.js';

// ── All possible knockout rounds ───────────────────────────────────
const ALL_KO_ROUNDS = [
    { key: "r32", label: "Sextondelsfinal", adminKey: "R32", teams: 32 },
    { key: "r16", label: "Åttondelsfinal",  adminKey: "R16", teams: 16 },
    { key: "qf",  label: "Kvartsfinal",      adminKey: "KF",  teams: 8  },
    { key: "sf",  label: "Semifinal",         adminKey: "SF",  teams: 4  },
    { key: "final", label: "Final",           adminKey: "Final", teams: 2 },
];

const PRESETS = {
    wc2026: { name: "VM 2026", championLabel: "Ditt VM-Guld 2026", year: 2026, groupLetters: 'A,B,C,D,E,F,G,H,I,J,K,L', teamsPerGroup: 4, perGroup: 2, bestOfRest: 8, koStart: 'r32', twoLegged: {}, scoring: { matchResult:1, matchHomeGoals:1, matchAwayGoals:1, exactScore:0, groupWinner:1, groupRunnerUp:1, groupThird:0 } },
    cl_slutspel: { name: "Champions League Slutspel", championLabel: "Ditt CL-Guld", year: 2026, groupLetters: '', teamsPerGroup: 0, koStart: 'qf', twoLegged: { qf: true, sf: true } },
    em2028: { name: "EM 2028", championLabel: "Ditt EM-Guld 2028", year: 2028, groupLetters: 'A,B,C,D,E,F', teamsPerGroup: 4, perGroup: 2, bestOfRest: 4, koStart: 'r16', twoLegged: {}, scoring: { matchResult:1, matchHomeGoals:1, matchAwayGoals:1, exactScore:0, groupWinner:1, groupRunnerUp:1, groupThird:0 } },
};

// ── Editable state ─────────────────────────────────────────────────
export let editState = {
    name: '', championLabel: '', year: 2026,
    hasGroups: false, hasKnockout: true,
    groupLetters: [], teamsPerGroup: 4, perGroup: 2, bestOfRest: 0,
    koStart: 'qf', twoLegged: {},
    teams: [], // all team names
    groupAssignments: {}, // { A: ['team1','team2'], B: [...] }
    scoring: {},
};

function loadStateFromConfig() {
    const cfg = getConfig();
    const gs = cfg.stages?.find(s => s.type === 'round-robin-groups');
    const ko = cfg.stages?.find(s => s.type === 'single-elimination');
    editState.name = cfg.name || '';
    editState.championLabel = cfg.championLabel || '';
    editState.year = cfg.year || 2026;
    editState.hasGroups = !!gs;
    editState.hasKnockout = !!ko;
    editState.groupLetters = gs?.groups?.letters || [];
    editState.teamsPerGroup = gs?.groups?.teamsPerGroup || 4;
    editState.perGroup = gs?.qualification?.perGroup || 2;
    editState.bestOfRest = gs?.qualification?.bestOfRest || 0;
    editState.scoring = gs?.scoring || {};
    if (ko?.rounds?.length) {
        editState.koStart = ko.rounds[0].key;
        editState.twoLegged = {};
        ko.rounds.forEach(r => { if (r.twoLegged) editState.twoLegged[r.key] = true; });
    }
}

function getActiveKoRounds() {
    const startIdx = ALL_KO_ROUNDS.findIndex(r => r.key === editState.koStart);
    if (startIdx < 0) return [ALL_KO_ROUNDS[ALL_KO_ROUNDS.length - 1]];
    return ALL_KO_ROUNDS.slice(startIdx);
}

export function getTeamsNeeded() {
    const rounds = getActiveKoRounds();
    return rounds[0]?.teams || 2;
}

function buildTournamentConfig() {
    const stages = [];
    if (editState.hasGroups && editState.groupLetters.length > 0) {
        stages.push({
            id: "groups", type: "round-robin-groups", label: "Gruppspel",
            groups: { letters: editState.groupLetters, teamsPerGroup: editState.teamsPerGroup },
            qualification: { perGroup: editState.perGroup, bestOfRest: editState.bestOfRest },
            scoring: editState.scoring,
        });
    }
    if (editState.hasKnockout) {
        const rounds = getActiveKoRounds().map(r => ({
            ...r,
            points: r.key === 'final' ? 10 : (r.key === 'sf' ? 5 : 2),
            twoLegged: editState.twoLegged[r.key] || false,
        }));
        stages.push({
            id: "knockout", type: "single-elimination", label: "Slutspel",
            twoLegged: Object.values(editState.twoLegged).some(v => v),
            rounds,
        });
    }
    return { name: editState.name, championLabel: editState.championLabel, year: editState.year, stages };
}

// ── Render ──────────────────────────────────────────────────────────
export function renderTournamentTab() {
    const container = document.getElementById('admin-tournament-content');
    loadStateFromConfig();
    let html = '';

    // ─── Preset cards ───
    html += `<div class="admin-card" style="margin-bottom:16px;">`;
    html += `<h3 style="margin-top:0;">Välj turnering</h3>`;
    html += `<p style="color:#dc3545; font-size:12px; margin:0 0 10px;">Att byta rensar alla matcher, resultat och tips!</p>`;
    html += `<div style="display:flex; gap:8px; flex-wrap:wrap;">`;
    for (const [key, p] of Object.entries(PRESETS)) {
        const active = editState.name === p.name;
        html += `<button class="btn preset-btn" data-preset="${key}" style="background:${active ? '#6c757d' : '#17a2b8'}; font-size:13px;">${p.name}${active ? ' ✓' : ''}</button>`;
    }
    html += `</div><div id="tournament-switch-status" style="margin-top:8px; font-size:12px; color:#888;"></div></div>`;

    // ─── Config editor ───
    html += `<div class="admin-card" style="margin-bottom:16px;">`;
    html += `<h3 style="margin-top:0;">Turneringsinställningar</h3>`;
    html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; max-width:400px; margin-bottom:12px;">`;
    html += `<label style="font-size:13px;">Namn</label><input id="tc-name" value="${editState.name}" style="padding:4px 8px; border:1px solid #ddd; border-radius:6px; font-size:13px;">`;
    html += `<label style="font-size:13px;">Mästaretitel</label><input id="tc-champ" value="${editState.championLabel}" style="padding:4px 8px; border:1px solid #ddd; border-radius:6px; font-size:13px;">`;
    html += `</div>`;

    // Format toggles
    html += `<div style="display:flex; gap:16px; margin-bottom:12px;">`;
    html += `<label style="font-size:13px; cursor:pointer;"><input type="checkbox" id="tc-groups" ${editState.hasGroups ? 'checked' : ''}> Gruppspel</label>`;
    html += `<label style="font-size:13px; cursor:pointer;"><input type="checkbox" id="tc-knockout" ${editState.hasKnockout ? 'checked' : ''}> Slutspel</label>`;
    html += `</div>`;

    // Knockout config
    html += `<div id="tc-ko-config" style="display:${editState.hasKnockout ? 'block' : 'none'}; background:#f8f9fa; padding:12px; border-radius:8px; margin-bottom:12px;">`;
    html += `<label style="font-size:13px; font-weight:600;">Slutspelet startar från:</label>`;
    html += `<select id="tc-ko-start" style="margin-left:8px; padding:4px 8px; border:1px solid #ddd; border-radius:6px; font-size:13px;">`;
    ALL_KO_ROUNDS.filter(r => r.key !== 'final').forEach(r => {
        html += `<option value="${r.key}" ${r.key === editState.koStart ? 'selected' : ''}>${r.label} (${r.teams} lag)</option>`;
    });
    html += `</select>`;
    html += `<div style="margin-top:8px;"><span style="font-size:13px; font-weight:600;">Dubbelmöten:</span></div>`;
    html += `<div id="tc-twolegged" style="display:flex; gap:12px; margin-top:4px; flex-wrap:wrap;"></div>`;
    html += `</div>`;

    // Group config
    html += `<div id="tc-group-config" style="display:${editState.hasGroups ? 'block' : 'none'}; background:#f8f9fa; padding:12px; border-radius:8px; margin-bottom:12px;">`;
    html += `<div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">`;
    html += `<label style="font-size:13px;">Antal grupper:</label><input type="number" id="tc-num-groups" min="1" max="26" value="${editState.groupLetters.length || 4}" style="width:60px; padding:4px; border:1px solid #ddd; border-radius:6px; font-size:13px;">`;
    html += `<label style="font-size:13px;">Lag per grupp:</label><input type="number" id="tc-teams-per-group" min="2" max="8" value="${editState.teamsPerGroup}" style="width:60px; padding:4px; border:1px solid #ddd; border-radius:6px; font-size:13px;">`;
    html += `</div></div>`;

    html += `<button class="btn" id="tc-save-config" style="background:#ffc107; color:#000; font-size:13px;">Spara inställningar</button>`;
    html += `<span id="tc-config-status" style="margin-left:8px; font-size:12px; color:#888;"></span>`;
    html += `</div>`;

    // ─── Team roster ───
    html += `<div class="admin-card" style="margin-bottom:16px;">`;
    html += `<h3 style="margin-top:0;">Lag <span id="team-count-badge" style="font-size:12px; font-weight:400; color:#888;"></span></h3>`;
    html += `<div style="display:flex; gap:8px; margin-bottom:10px;">`;
    html += `<input type="text" id="add-team-input" placeholder="Lagnamn" list="team-name-suggestions" autocomplete="off" style="flex:1; padding:6px 8px; border:1px solid #ddd; border-radius:6px; font-size:13px;">`;
    html += `<datalist id="team-name-suggestions">`;
    getAllTeamNames().forEach(name => { html += `<option value="${name}">`; });
    html += `</datalist>`;
    html += `<button class="btn" id="add-team-btn" style="background:#28a745; font-size:13px;">+</button>`;
    html += `</div>`;
    html += `<details style="margin-bottom:10px;"><summary style="font-size:12px; color:#888; cursor:pointer;">Lägg till flera (ett per rad)</summary>`;
    html += `<textarea id="bulk-team-input" rows="4" style="width:100%; padding:6px; border:1px solid #ddd; border-radius:6px; font-size:12px; font-family:monospace; box-sizing:border-box; margin-top:6px;" placeholder="Arsenal&#10;Barcelona&#10;Bayern München"></textarea>`;
    html += `<button class="btn" id="bulk-team-btn" style="background:#28a745; font-size:12px; margin-top:4px;">Lägg till alla</button>`;
    html += `</details>`;
    html += `<div id="team-roster" style="display:flex; flex-wrap:wrap; gap:6px;"></div>`;
    html += `</div>`;

    // ─── Bracket builder (knockout) or Group builder (groups) ───
    html += `<div id="bracket-builder-section"></div>`;
    html += `<div id="group-builder-section"></div>`;

    // ─── Danger zone ───
    html += `<div class="admin-card" style="border:2px dashed #dc3545; margin-top:16px;">`;
    html += `<h3 style="margin-top:0; color:#dc3545;">Rensa all data</h3>`;
    html += `<p style="color:#888; font-size:12px; margin:0 0 8px;">Tar bort matcher, resultat, bracket och tips. Turneringskonfigurationen behålls.</p>`;
    html += `<button class="btn" id="clear-all-btn" style="background:#dc3545; font-size:13px;">Rensa allt</button>`;
    html += `<span id="clear-all-status" style="margin-left:8px; font-size:12px;"></span>`;
    html += `</div>`;

    container.innerHTML = html;
    attachListeners(container);
    loadTeamsFromBracket();
    renderTwoLeggedCheckboxes();
    renderTeamRoster();
}

function renderTwoLeggedCheckboxes() {
    const el = document.getElementById('tc-twolegged');
    if (!el) return;
    const rounds = getActiveKoRounds().filter(r => r.key !== 'final');
    el.innerHTML = rounds.map(r =>
        `<label style="font-size:12px; cursor:pointer;"><input type="checkbox" class="tc-tl-cb" data-round="${r.key}" ${editState.twoLegged[r.key] ? 'checked' : ''}> ${r.label}</label>`
    ).join('');
}

async function loadTeamsFromBracket() {
    try {
        const { getDoc, doc: fbDoc } = await import("https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js");
        const snap = await getDoc(fbDoc(db, "matches", "_bracket"));
        const bracket = snap.exists() ? snap.data() : {};
        if (bracket.teams?.length) {
            editState.teams = [...new Set([...editState.teams, ...bracket.teams])];
            renderTeamRoster();
        }
        // Load group assignments from existing matches
        if (editState.hasGroups) {
            const matchSnap = await getDocs(collection(db, "matches"));
            editState.groupAssignments = {};
            editState.groupLetters.forEach(l => { editState.groupAssignments[l] = []; });
            const seen = new Set();
            matchSnap.docs.filter(d => !d.id.startsWith('_')).forEach(d => {
                const m = d.data();
                if (m.stage?.startsWith('Grupp ')) {
                    const letter = m.stage.replace('Grupp ', '');
                    if (!editState.groupAssignments[letter]) editState.groupAssignments[letter] = [];
                    [m.homeTeam, m.awayTeam].forEach(t => {
                        if (t && !seen.has(t)) { seen.add(t); editState.groupAssignments[letter].push(t); if (!editState.teams.includes(t)) editState.teams.push(t); }
                    });
                }
            });
            renderTeamRoster();
        }
        renderBuilders();
    } catch { renderBuilders(); }
}

function renderBuilders() {
    if (editState.hasKnockout) renderBracketBuilder();
    if (editState.hasGroups) renderGroupBuilder();
}

export function renderTeamRoster() {
    const el = document.getElementById('team-roster');
    const badge = document.getElementById('team-count-badge');
    if (!el) return;
    const needed = editState.hasKnockout ? getTeamsNeeded() : editState.groupLetters.length * editState.teamsPerGroup;
    if (badge) badge.textContent = `(${editState.teams.length}${needed ? ' / ' + needed + ' behövs' : ''})`;
    el.innerHTML = editState.teams.map(t =>
        `<span class="team-tag" draggable="true" data-team="${t}">${teamImg(t, { size: 16, height: 12, style: 'margin:0 4px 0 0;' })}${t} <span class="team-tag-x" data-team="${t}">&times;</span></span>`
    ).join('') || '<span style="color:#999; font-size:12px;">Inga lag tillagda ännu</span>';
    // Remove buttons
    el.querySelectorAll('.team-tag-x').forEach(x => {
        x.addEventListener('click', e => { e.stopPropagation(); removeTeam(x.dataset.team); });
    });
    // Drag start for group builder
    el.querySelectorAll('.team-tag').forEach(tag => {
        tag.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', tag.dataset.team);
            tag.classList.add('dragging');
        });
        tag.addEventListener('dragend', () => tag.classList.remove('dragging'));
    });
}

function addTeam(name) {
    name = name.trim();
    if (!name || editState.teams.includes(name)) return;
    editState.teams.push(name);
    renderTeamRoster();
    renderBuilders();
}

function removeTeam(name) {
    editState.teams = editState.teams.filter(t => t !== name);
    // Also remove from group assignments
    Object.values(editState.groupAssignments).forEach(arr => {
        const i = arr.indexOf(name);
        if (i >= 0) arr.splice(i, 1);
    });
    renderTeamRoster();
    renderBuilders();
}

function attachListeners(container) {
    // Presets
    container.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTournament(btn.dataset.preset));
    });
    // Add team
    document.getElementById('add-team-btn').addEventListener('click', () => {
        const input = document.getElementById('add-team-input');
        addTeam(input.value); input.value = ''; input.focus();
    });
    document.getElementById('add-team-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') { addTeam(e.target.value); e.target.value = ''; }
    });
    // Bulk add
    document.getElementById('bulk-team-btn').addEventListener('click', () => {
        const ta = document.getElementById('bulk-team-input');
        ta.value.split('\n').map(s => s.trim()).filter(Boolean).forEach(t => addTeam(t));
        ta.value = '';
    });
    // Config toggles
    document.getElementById('tc-groups').addEventListener('change', e => {
        editState.hasGroups = e.target.checked;
        document.getElementById('tc-group-config').style.display = e.target.checked ? 'block' : 'none';
        renderBuilders();
    });
    document.getElementById('tc-knockout').addEventListener('change', e => {
        editState.hasKnockout = e.target.checked;
        document.getElementById('tc-ko-config').style.display = e.target.checked ? 'block' : 'none';
        renderBuilders();
    });
    document.getElementById('tc-ko-start').addEventListener('change', e => {
        editState.koStart = e.target.value;
        renderTwoLeggedCheckboxes();
        renderBuilders();
        renderTeamRoster();
    });
    container.addEventListener('change', e => {
        if (e.target.classList.contains('tc-tl-cb')) {
            editState.twoLegged[e.target.dataset.round] = e.target.checked;
        }
    });
    // Save config
    document.getElementById('tc-save-config').addEventListener('click', saveConfig);
    // Clear
    document.getElementById('clear-all-btn').addEventListener('click', clearAllData);
}

async function saveConfig() {
    editState.name = document.getElementById('tc-name').value.trim();
    editState.championLabel = document.getElementById('tc-champ').value.trim();
    if (editState.hasGroups) {
        const numGroups = parseInt(document.getElementById('tc-num-groups').value) || 4;
        editState.groupLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, numGroups).split('');
        editState.teamsPerGroup = parseInt(document.getElementById('tc-teams-per-group').value) || 4;
    }
    const cfg = buildTournamentConfig();
    await setDoc(doc(db, "matches", "_tournament"), cfg);
    await bumpDataVersion();
    const s = document.getElementById('tc-config-status');
    s.textContent = '✓ Sparat!'; s.style.color = '#28a745';
    setTimeout(() => { s.textContent = ''; }, 2500);
}

async function switchTournament(presetKey) {
    const p = PRESETS[presetKey];
    if (!p || !confirm(`Byt till "${p.name}"?\n\nDetta rensar alla matcher, resultat, bracket och tips.`)) return;
    const s = document.getElementById('tournament-switch-status');
    s.textContent = 'Byter...'; s.style.color = '#888';
    try {
        await clearAllDataInternal();
        editState.name = p.name; editState.championLabel = p.championLabel; editState.year = p.year;
        editState.hasGroups = !!p.groupLetters; editState.hasKnockout = true;
        editState.koStart = p.koStart; editState.twoLegged = { ...p.twoLegged };
        editState.teams = []; editState.groupAssignments = {};
        if (p.groupLetters) {
            editState.groupLetters = p.groupLetters.split(',');
            editState.teamsPerGroup = p.teamsPerGroup;
            editState.perGroup = p.perGroup || 2; editState.bestOfRest = p.bestOfRest || 0;
            editState.scoring = p.scoring || {};
        } else { editState.groupLetters = []; }
        const cfg = buildTournamentConfig();
        await setDoc(doc(db, "matches", "_tournament"), cfg);
        await setDoc(doc(db, "matches", "_settings"), { tipsLocked: false, tipsVisible: true, dataVersion: Date.now() });
        s.textContent = '✓ Laddar om...'; s.style.color = '#28a745';
        setTimeout(() => window.location.reload(), 1000);
    } catch (err) { s.textContent = 'Fel: ' + err.message; s.style.color = '#dc3545'; }
}

async function clearAllData() {
    if (!confirm('Rensa ALL data? Matcher, resultat, bracket och tips tas bort.')) return;
    const s = document.getElementById('clear-all-status');
    s.textContent = 'Rensar...'; s.style.color = '#888';
    try {
        await clearAllDataInternal();
        await bumpDataVersion();
        s.textContent = '✓ Rensad!'; s.style.color = '#28a745';
        setTimeout(() => window.location.reload(), 1000);
    } catch (err) { s.textContent = 'Fel: ' + err.message; s.style.color = '#dc3545'; }
}

async function clearAllDataInternal() {
    const matchSnap = await getDocs(collection(db, "matches"));
    const matchDocs = matchSnap.docs.filter(d => !d.id.startsWith('_'));
    for (let i = 0; i < matchDocs.length; i += 500) {
        const batch = writeBatch(db);
        matchDocs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
        await batch.commit();
    }
    await setDoc(doc(db, "matches", "_results"), {});
    await setDoc(doc(db, "matches", "_bracket"), { teams: [], rounds: {} });
    const userSnap = await getDocs(collection(db, "users"));
    for (let i = 0; i < userSnap.docs.length; i += 500) {
        const batch = writeBatch(db);
        userSnap.docs.slice(i, i + 500).forEach(d => batch.update(d.ref, { groupPicks: {}, matchTips: {}, knockout: {} }));
        await batch.commit();
    }
}

export function initTournament() {
    renderTournamentTab();
}
