import { db } from './config.js';
import { getAllTeamNames, teamImg } from './team-data.js';
import { collection, getDocs, doc, setDoc, writeBatch }
    from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { bumpDataVersion } from './admin.js';
import { getConfig, getGroupLetters, hasStageType, getSpecialQuestionsConfig } from './tournament-config.js';
import { renderBracketBuilder, saveBracketFromBuilder } from './admin-tournament-bracket.js';
import { renderGroupBuilder } from './admin-tournament-groups.js';
import { discoverLogos, generateBgSuggestions, pickTextColor } from './admin-tournament-logo.js';

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
    hasGroups: false, hasKnockout: true, hasSpecial: false,
    groupLetters: [], teamsPerGroup: 4, perGroup: 2, bestOfRest: 0,
    koStart: 'qf', twoLegged: {},
    teams: [], // all team names
    groupAssignments: {}, // { A: ['team1','team2'], B: [...] }
    scoring: {},
    specialLabel: 'Specialtips',
    specialQuestions: [], // { id, text, type, options[], points, correctAnswer }
    logoType: 'text', // 'text' | 'image'
    logoImage: '',    // filename of selected *-logo.webp
    navbarBg: '',     // optional navbar bg override (hex)
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
    const sp = cfg.stages?.find(s => s.type === 'special-questions');
    editState.hasSpecial = !!sp;
    editState.specialLabel = sp?.label || 'Specialtips';
    editState.specialQuestions = sp?.questions ? JSON.parse(JSON.stringify(sp.questions)) : [];
    const logo = cfg.logo || {};
    editState.logoType = logo.type === 'image' ? 'image' : 'text';
    editState.logoImage = logo.image || '';
    editState.navbarBg = logo.navbarBg || '';
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
    if (editState.hasSpecial && editState.specialQuestions.length > 0) {
        stages.push({
            id: "special", type: "special-questions",
            label: editState.specialLabel || 'Specialtips',
            questions: editState.specialQuestions,
        });
    }
    const logo = { type: editState.logoType === 'image' ? 'image' : 'text' };
    if (logo.type === 'image' && editState.logoImage) logo.image = editState.logoImage;
    if (editState.navbarBg) logo.navbarBg = editState.navbarBg;
    return { name: editState.name, championLabel: editState.championLabel, year: editState.year, logo, stages };
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

    // ─── Logo / titel-typ ───
    html += `<div style="background:#f8f9fa; padding:12px; border-radius:8px; margin-bottom:12px;">`;
    html += `<div style="font-size:13px; font-weight:600; margin-bottom:8px;">Titel i navbaren</div>`;
    html += `<div style="display:flex; gap:16px; margin-bottom:10px;">`;
    html += `<label style="font-size:13px; cursor:pointer;"><input type="radio" name="tc-logo-type" value="text" ${editState.logoType === 'text' ? 'checked' : ''}> Text (namnet ovan)</label>`;
    html += `<label style="font-size:13px; cursor:pointer;"><input type="radio" name="tc-logo-type" value="image" ${editState.logoType === 'image' ? 'checked' : ''}> Bild</label>`;
    html += `</div>`;
    html += `<div id="tc-logo-image-config" style="display:${editState.logoType === 'image' ? 'block' : 'none'};">`;
    html += `<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:8px;">`;
    html += `<label style="font-size:13px;">Filnamn:</label>`;
    html += `<input type="text" id="tc-logo-image" value="${editState.logoImage || ''}" placeholder="t.ex. min-logo.webp" style="flex:1; min-width:200px; padding:4px 8px; border:1px solid #ddd; border-radius:6px; font-size:13px;">`;
    html += `</div>`;
    html += `<div style="font-size:11px; color:#888; margin-bottom:10px;">Hittade i repot (klicka för att välja):</div>`;
    html += `<div id="tc-logo-discover" style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;"><span style="color:#999; font-size:12px;">Söker…</span></div>`;
    html += `<div style="font-size:12px; color:#666; margin-bottom:8px;">Förhandsvisning (klicka en färg nedan för att prova den som navbar-bakgrund):</div>`;
    html += `<div id="tc-logo-preview" style="display:inline-block; padding:10px 16px; border-radius:8px; background:${editState.navbarBg || '#1a1a1a'}; transition:background 0.2s;"></div>`;
    html += `<div style="font-size:12px; font-weight:600; margin:12px 0 6px;">Föreslagna bakgrundsfärger</div>`;
    html += `<div id="tc-bg-suggestions" style="display:flex; gap:8px; flex-wrap:wrap;"><span style="color:#999; font-size:12px;">Laddar förslag…</span></div>`;
    html += `<div style="display:flex; gap:8px; align-items:center; margin-top:10px; flex-wrap:wrap;">`;
    html += `<label style="font-size:12px;">Egen färg:</label>`;
    html += `<input type="color" id="tc-navbar-bg" value="${editState.navbarBg || '#1a1a1a'}" style="width:40px; height:30px; border:1px solid #ddd; border-radius:6px; cursor:pointer; padding:0;">`;
    html += `<button class="btn" id="tc-navbar-bg-reset" style="background:#6c757d; font-size:11px; padding:4px 10px;">Återställ till tema</button>`;
    html += `</div>`;
    html += `</div></div>`;

    // Format toggles
    html += `<div style="display:flex; gap:16px; margin-bottom:12px;">`;
    html += `<label style="font-size:13px; cursor:pointer;"><input type="checkbox" id="tc-groups" ${editState.hasGroups ? 'checked' : ''}> Gruppspel</label>`;
    html += `<label style="font-size:13px; cursor:pointer;"><input type="checkbox" id="tc-knockout" ${editState.hasKnockout ? 'checked' : ''}> Slutspel</label>`;
    html += `<label style="font-size:13px; cursor:pointer;"><input type="checkbox" id="tc-special" ${editState.hasSpecial ? 'checked' : ''}> Specialtips</label>`;
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

    // Special questions config
    html += `<div id="tc-special-config" style="display:${editState.hasSpecial ? 'block' : 'none'}; background:#f8f9fa; padding:12px; border-radius:8px; margin-bottom:12px;">`;
    html += `<div style="display:flex; gap:12px; align-items:center; margin-bottom:12px;">`;
    html += `<label style="font-size:13px; font-weight:600;">Titel:</label>`;
    html += `<input type="text" id="tc-special-label" value="${editState.specialLabel}" placeholder="t.ex. Sverigetipset" style="flex:1; padding:4px 8px; border:1px solid #ddd; border-radius:6px; font-size:13px;">`;
    html += `</div>`;
    html += `<div id="tc-special-questions"></div>`;
    html += `<button class="btn" id="tc-add-question" style="background:#28a745; font-size:12px; margin-top:8px;">+ Lägg till fråga</button>`;
    html += `</div>`;

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
    renderSpecialQuestions();
    renderLogoPreview();
    refreshBgSuggestions();
    renderDiscoveredLogos();
}

async function renderDiscoveredLogos() {
    const el = document.getElementById('tc-logo-discover');
    if (!el) return;
    const logos = await discoverLogos();
    if (!logos.length) {
        el.innerHTML = '<span style="color:#999; font-size:12px;">Inga *-logo-filer hittades. Skriv filnamnet manuellt ovan.</span>';
        return;
    }
    el.innerHTML = logos.map(l =>
        `<button type="button" class="tc-logo-chip" data-file="${l.file}" style="display:flex; align-items:center; gap:6px; padding:4px 8px; border:1px solid ${editState.logoImage === l.file ? '#17a2b8' : '#ddd'}; border-radius:999px; background:${editState.logoImage === l.file ? '#e6f7f9' : 'white'}; cursor:pointer; font-size:12px;">
            <img src="${l.file}" alt="" style="height:20px; width:auto; display:block;">
            ${l.file}
        </button>`
    ).join('');
    el.querySelectorAll('.tc-logo-chip').forEach(btn => {
        btn.addEventListener('click', () => selectLogoFile(btn.dataset.file));
    });
}

function selectLogoFile(file) {
    editState.logoImage = file;
    const input = document.getElementById('tc-logo-image');
    if (input) input.value = file;
    renderLogoPreview();
    renderDiscoveredLogos(); // re-render chips to update active state
    refreshBgSuggestions();
}

function renderLogoPreview() {
    const el = document.getElementById('tc-logo-preview');
    if (!el) return;
    const src = editState.logoImage;
    const bg = editState.navbarBg || '#1a1a1a';
    el.style.background = bg;
    el.innerHTML = src
        ? `<img src="${src}" alt="logo" style="height:48px; display:block;">`
        : `<span style="color:${pickTextColor(bg)}; font-family: var(--font-heading); font-size:24px;">${editState.name || 'MunkenTipset'}</span>`;
}

async function refreshBgSuggestions() {
    const el = document.getElementById('tc-bg-suggestions');
    if (!el) return;
    if (!editState.logoImage) {
        el.innerHTML = '<span style="color:#999; font-size:12px;">Välj en bild först.</span>';
        return;
    }
    const suggestions = await generateBgSuggestions(editState.logoImage);
    el.innerHTML = suggestions.map(s =>
        `<button type="button" class="tc-bg-swatch" data-bg="${s.bg}" title="${s.label}" style="display:flex; align-items:center; gap:6px; padding:6px 10px; border:1px solid #ddd; border-radius:8px; background:white; cursor:pointer; font-size:12px;">
            <span style="display:inline-block; width:20px; height:20px; border-radius:4px; background:${s.bg}; border:1px solid rgba(0,0,0,0.1);"></span>
            ${s.label}
        </button>`
    ).join('');
    el.querySelectorAll('.tc-bg-swatch').forEach(btn => {
        btn.addEventListener('click', () => applyNavbarBg(btn.dataset.bg));
    });
}

function applyNavbarBg(hex) {
    editState.navbarBg = hex;
    const picker = document.getElementById('tc-navbar-bg');
    if (picker) picker.value = hex;
    renderLogoPreview();
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
    // When groups exist, every group team must be in the roster; knockout teams
    // come from groups, so group total is what's actually needed. Fall back to
    // knockout's starting-round count when it's a knockout-only tournament.
    const needed = editState.hasGroups
        ? editState.groupLetters.length * editState.teamsPerGroup
        : (editState.hasKnockout ? getTeamsNeeded() : 0);
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
    document.getElementById('tc-special').addEventListener('change', e => {
        editState.hasSpecial = e.target.checked;
        document.getElementById('tc-special-config').style.display = e.target.checked ? 'block' : 'none';
        if (e.target.checked && editState.specialQuestions.length === 0) {
            addQuestion();
        }
    });
    document.getElementById('tc-add-question').addEventListener('click', () => addQuestion());
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

    // Logo type toggle
    container.querySelectorAll('input[name="tc-logo-type"]').forEach(r => {
        r.addEventListener('change', e => {
            editState.logoType = e.target.value === 'image' ? 'image' : 'text';
            document.getElementById('tc-logo-image-config').style.display =
                editState.logoType === 'image' ? 'block' : 'none';
            renderLogoPreview();
            if (editState.logoType === 'image') refreshBgSuggestions();
        });
    });
    // Logo image filename input
    const logoInput = document.getElementById('tc-logo-image');
    if (logoInput) {
        let logoDebounce;
        logoInput.addEventListener('input', e => {
            editState.logoImage = e.target.value.trim();
            renderLogoPreview();
            clearTimeout(logoDebounce);
            logoDebounce = setTimeout(() => {
                renderDiscoveredLogos();
                refreshBgSuggestions();
            }, 350);
        });
    }
    // Navbar bg color picker
    const bgPicker = document.getElementById('tc-navbar-bg');
    if (bgPicker) bgPicker.addEventListener('input', e => applyNavbarBg(e.target.value));
    const bgReset = document.getElementById('tc-navbar-bg-reset');
    if (bgReset) bgReset.addEventListener('click', () => {
        editState.navbarBg = '';
        if (bgPicker) bgPicker.value = '#1a1a1a';
        renderLogoPreview();
    });
    // Also update preview when name changes
    const nameInput = document.getElementById('tc-name');
    if (nameInput) nameInput.addEventListener('input', e => {
        editState.name = e.target.value;
        renderLogoPreview();
    });
}

async function saveConfig() {
    editState.name = document.getElementById('tc-name').value.trim();
    editState.championLabel = document.getElementById('tc-champ').value.trim();
    if (editState.hasGroups) {
        const numGroups = parseInt(document.getElementById('tc-num-groups').value) || 4;
        editState.groupLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, numGroups).split('');
        editState.teamsPerGroup = parseInt(document.getElementById('tc-teams-per-group').value) || 4;
    }
    if (editState.hasSpecial) {
        editState.specialLabel = document.getElementById('tc-special-label')?.value.trim() || 'Specialtips';
        syncQuestionsFromDOM();
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
        editState.hasSpecial = false; editState.specialLabel = 'Specialtips'; editState.specialQuestions = [];
        editState.koStart = p.koStart; editState.twoLegged = { ...p.twoLegged };
        editState.teams = []; editState.groupAssignments = {};
        editState.logoType = 'text'; editState.logoImage = ''; editState.navbarBg = '';
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
        userSnap.docs.slice(i, i + 500).forEach(d => batch.update(d.ref, { groupPicks: {}, matchTips: {}, knockout: {}, specialPicks: {} }));
        await batch.commit();
    }
}

// ── Special Questions Editor ──────────────────────────────────────
function nextQuestionId() {
    let max = 0;
    editState.specialQuestions.forEach(q => {
        const n = parseInt(String(q.id).replace('q', ''));
        if (!isNaN(n) && n > max) max = n;
    });
    return 'q' + (max + 1);
}

function addQuestion() {
    // Sync any in-progress edits before re-rendering, or they'd be lost
    syncQuestionsFromDOM();
    editState.specialQuestions.push({
        id: nextQuestionId(),
        text: '',
        type: 'yesno',
        options: ['Ja', 'Nej'],
        points: 5,
        correctAnswer: null,
    });
    renderSpecialQuestions();
}

function removeQuestion(qId) {
    syncQuestionsFromDOM();
    editState.specialQuestions = editState.specialQuestions.filter(q => q.id !== qId);
    renderSpecialQuestions();
}

function syncQuestionsFromDOM() {
    const container = document.getElementById('tc-special-questions');
    if (!container) return;
    container.querySelectorAll('.sq-card').forEach(card => {
        const qId = card.dataset.qid;
        const q = editState.specialQuestions.find(x => x.id === qId);
        if (!q) return;
        q.text = card.querySelector('.sq-text')?.value.trim() || '';
        q.type = card.querySelector('.sq-type')?.value || 'yesno';
        q.points = parseInt(card.querySelector('.sq-points')?.value) || 5;
        if (q.type === 'yesno') {
            q.options = ['Ja', 'Nej'];
        } else if (q.type === 'multi') {
            const optInput = card.querySelector('.sq-options');
            q.options = optInput ? optInput.value.split(',').map(s => s.trim()).filter(Boolean) : [];
        } else {
            q.options = [];
        }
        const correctEl = card.querySelector('.sq-correct');
        if (correctEl) {
            q.correctAnswer = correctEl.value.trim() || null;
            if (q.type === 'numeric' && q.correctAnswer !== null) {
                q.correctAnswer = Number(q.correctAnswer);
                if (isNaN(q.correctAnswer)) q.correctAnswer = null;
            }
        }
    });
}

function renderSpecialQuestions() {
    const container = document.getElementById('tc-special-questions');
    if (!container) return;

    if (editState.specialQuestions.length === 0) {
        container.innerHTML = '<p style="color:#999; font-size:12px;">Inga frågor tillagda.</p>';
        return;
    }

    let html = '';
    editState.specialQuestions.forEach((q, i) => {
        const isYesNo = q.type === 'yesno';
        const isMulti = q.type === 'multi';
        const isNumeric = q.type === 'numeric';
        html += `<div class="sq-card" data-qid="${q.id}" style="background:white; border:1px solid #e1e5eb; border-radius:8px; padding:10px 12px; margin-bottom:8px;">`;
        html += `<div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">`;
        html += `<span style="font-size:12px; font-weight:700; color:#888;">#${i + 1}</span>`;
        html += `<input type="text" class="sq-text" value="${(q.text || '').replace(/"/g, '&quot;')}" placeholder="Skriv din fråga..." style="flex:1; padding:4px 8px; border:1px solid #ddd; border-radius:6px; font-size:13px;">`;
        html += `<button class="sq-remove" data-qid="${q.id}" style="background:none; border:none; color:#dc3545; font-size:18px; cursor:pointer; padding:0 4px;" title="Ta bort">&times;</button>`;
        html += `</div>`;
        html += `<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">`;
        html += `<select class="sq-type" style="padding:4px 8px; border:1px solid #ddd; border-radius:6px; font-size:12px;">`;
        html += `<option value="yesno" ${isYesNo ? 'selected' : ''}>Ja / Nej</option>`;
        html += `<option value="multi" ${isMulti ? 'selected' : ''}>Flerval</option>`;
        html += `<option value="numeric" ${isNumeric ? 'selected' : ''}>Numeriskt</option>`;
        html += `</select>`;
        if (isMulti) {
            html += `<input type="text" class="sq-options" value="${(q.options || []).join(', ')}" placeholder="Alt1, Alt2, Alt3" style="flex:1; padding:4px 8px; border:1px solid #ddd; border-radius:6px; font-size:12px;">`;
        }
        html += `<label style="font-size:12px; display:flex; align-items:center; gap:4px;">Poäng: <input type="number" class="sq-points" min="0" value="${q.points || 5}" style="width:50px; padding:4px; border:1px solid #ddd; border-radius:6px; font-size:12px; text-align:center;"></label>`;
        html += `</div>`;
        // Correct answer field
        html += `<div style="margin-top:8px; display:flex; align-items:center; gap:6px;">`;
        html += `<label style="font-size:11px; color:#888; white-space:nowrap;">Rätt svar:</label>`;
        if (isYesNo) {
            html += `<select class="sq-correct" style="padding:3px 6px; border:1px solid #ddd; border-radius:6px; font-size:12px;">`;
            html += `<option value="" ${!q.correctAnswer ? 'selected' : ''}>Ej avgjort</option>`;
            html += `<option value="Ja" ${q.correctAnswer === 'Ja' ? 'selected' : ''}>Ja</option>`;
            html += `<option value="Nej" ${q.correctAnswer === 'Nej' ? 'selected' : ''}>Nej</option>`;
            html += `</select>`;
        } else if (isMulti) {
            html += `<select class="sq-correct" style="padding:3px 6px; border:1px solid #ddd; border-radius:6px; font-size:12px;">`;
            html += `<option value="" ${!q.correctAnswer ? 'selected' : ''}>Ej avgjort</option>`;
            (q.options || []).forEach(opt => {
                html += `<option value="${opt}" ${q.correctAnswer === opt ? 'selected' : ''}>${opt}</option>`;
            });
            html += `</select>`;
        } else {
            html += `<input type="number" class="sq-correct" value="${q.correctAnswer != null ? q.correctAnswer : ''}" placeholder="—" style="width:70px; padding:3px 6px; border:1px solid #ddd; border-radius:6px; font-size:12px; text-align:center;">`;
        }
        html += `</div>`;
        html += `</div>`;
    });
    container.innerHTML = html;

    // Attach listeners
    container.querySelectorAll('.sq-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            syncQuestionsFromDOM();
            removeQuestion(btn.dataset.qid);
        });
    });
    container.querySelectorAll('.sq-type').forEach(sel => {
        sel.addEventListener('change', () => {
            syncQuestionsFromDOM();
            renderSpecialQuestions();
        });
    });
}

export function initTournament() {
    renderTournamentTab();
}
