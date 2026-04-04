import { db } from './config.js';
import { collection, getDocs, doc, getDoc, setDoc, deleteDoc, writeBatch, updateDoc }
    from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { bumpDataVersion } from './admin.js';
import { loadTournamentConfig, getConfig, getGroupLetters } from './tournament-config.js';

// ── Tournament Presets ─────────────────────────────────────────────
const PRESETS = {
    wc2026: {
        name: "VM 2026",
        championLabel: "Ditt VM-Guld 2026",
        year: 2026,
        stages: [
            {
                id: "groups",
                type: "round-robin-groups",
                label: "Gruppspel",
                groups: { letters: ['A','B','C','D','E','F','G','H','I','J','K','L'], teamsPerGroup: 4 },
                qualification: { perGroup: 2, bestOfRest: 8 },
                scoring: { matchResult: 1, matchHomeGoals: 1, matchAwayGoals: 1, exactScore: 0, groupWinner: 1, groupRunnerUp: 1, groupThird: 0 },
            },
            {
                id: "knockout",
                type: "single-elimination",
                label: "Slutspel",
                twoLegged: false,
                rounds: [
                    { key: "r32", label: "Sextondelsfinal", adminKey: "R32", teams: 32, points: 2 },
                    { key: "r16", label: "Åttondelsfinal",  adminKey: "R16", teams: 16, points: 2 },
                    { key: "qf",  label: "Kvartsfinal",      adminKey: "KF",  teams: 8,  points: 2 },
                    { key: "sf",  label: "Semifinal",         adminKey: "SF",  teams: 4,  points: 5 },
                    { key: "final", label: "Final",           adminKey: "Final", teams: 2, points: 10 },
                ],
            },
        ],
    },
    cl_slutspel: {
        name: "Champions League Slutspel",
        championLabel: "Ditt CL-Guld",
        year: 2026,
        stages: [
            {
                id: "knockout",
                type: "single-elimination",
                label: "Slutspel",
                twoLegged: true,
                rounds: [
                    { key: "qf",  label: "Kvartsfinal", adminKey: "KF",  teams: 8,  points: 2, twoLegged: true },
                    { key: "sf",  label: "Semifinal",    adminKey: "SF",  teams: 4,  points: 5, twoLegged: true },
                    { key: "final", label: "Final",      adminKey: "Final", teams: 2, points: 10, twoLegged: false },
                ],
            },
        ],
    },
    em2028: {
        name: "EM 2028",
        championLabel: "Ditt EM-Guld 2028",
        year: 2028,
        stages: [
            {
                id: "groups",
                type: "round-robin-groups",
                label: "Gruppspel",
                groups: { letters: ['A','B','C','D','E','F'], teamsPerGroup: 4 },
                qualification: { perGroup: 2, bestOfRest: 4 },
                scoring: { matchResult: 1, matchHomeGoals: 1, matchAwayGoals: 1, exactScore: 0, groupWinner: 1, groupRunnerUp: 1, groupThird: 0 },
            },
            {
                id: "knockout",
                type: "single-elimination",
                label: "Slutspel",
                twoLegged: false,
                rounds: [
                    { key: "r16", label: "Åttondelsfinal",  adminKey: "R16", teams: 16, points: 2 },
                    { key: "qf",  label: "Kvartsfinal",      adminKey: "KF",  teams: 8,  points: 2 },
                    { key: "sf",  label: "Semifinal",         adminKey: "SF",  teams: 4,  points: 5 },
                    { key: "final", label: "Final",           adminKey: "Final", teams: 2, points: 10 },
                ],
            },
        ],
    },
};

function showToast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}

// ── Render Tournament Tab ──────────────────────────────────────────
function renderTournamentTab() {
    const container = document.getElementById('admin-tournament-content');
    const cfg = getConfig();

    // Current tournament info
    const stages = cfg.stages || [];
    const stageLabels = stages.map(s => {
        if (s.type === 'round-robin-groups') return `Gruppspel (${s.groups?.letters?.length || '?'} grupper)`;
        if (s.type === 'single-elimination') {
            const rounds = s.rounds?.map(r => r.label).join(', ') || '';
            const tl = s.twoLegged ? ' (dubbelmöten)' : '';
            return `Slutspel${tl}: ${rounds}`;
        }
        return s.label || s.type;
    }).join('<br>');

    let html = '';

    // Active tournament display
    html += `<div class="admin-card" style="border-left: 4px solid #28a745; margin-bottom:16px;">`;
    html += `<h3 style="margin-top:0;">Aktiv turnering: ${cfg.name || 'Okänd'}</h3>`;
    html += `<p style="color:#666; font-size:13px; margin:0;">${stageLabels}</p>`;
    html += `</div>`;

    // Preset selector
    html += `<div class="admin-card" style="margin-bottom:16px;">`;
    html += `<h3 style="margin-top:0;">Byt turnering</h3>`;
    html += `<p style="color:#888; font-size:12px; margin:0 0 12px;">Välj en fördefinierad turnering eller skapa en anpassad. <strong style="color:#dc3545;">OBS: Detta rensar alla matcher, resultat, bracket och användartips!</strong></p>`;
    html += `<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">`;
    for (const [key, preset] of Object.entries(PRESETS)) {
        const isActive = cfg.name === preset.name;
        const bg = isActive ? '#6c757d' : '#17a2b8';
        html += `<button class="btn preset-btn" data-preset="${key}" style="background:${bg}; font-size:13px;">${preset.name}${isActive ? ' (aktiv)' : ''}</button>`;
    }
    html += `</div>`;
    html += `<div id="tournament-switch-status" style="font-size:12px; color:#888;"></div>`;
    html += `</div>`;

    // Add group match form (only show if current tournament has groups)
    const hasGroups = stages.some(s => s.type === 'round-robin-groups');
    html += `<div class="admin-card" style="margin-bottom:16px;">`;
    html += `<h3 style="margin-top:0;">Lägg till match</h3>`;
    html += `<p style="color:#888; font-size:12px; margin:0 0 12px;">Lägg till en enskild match i databasen.</p>`;
    if (hasGroups) {
        const letters = getGroupLetters();
        const groupOpts = letters.map(l => `<option value="Grupp ${l}">Grupp ${l}</option>`).join('');
        html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; max-width:400px;">`;
        html += `<input type="text" id="add-match-home" placeholder="Hemmalag" style="padding:6px 8px; border:1px solid #ddd; border-radius:6px; font-size:13px;">`;
        html += `<input type="text" id="add-match-away" placeholder="Bortalag" style="padding:6px 8px; border:1px solid #ddd; border-radius:6px; font-size:13px;">`;
        html += `<select id="add-match-stage" style="padding:6px 8px; border:1px solid #ddd; border-radius:6px; font-size:13px;">${groupOpts}</select>`;
        html += `<input type="text" id="add-match-date" placeholder="t.ex. 14 juni 21:00" style="padding:6px 8px; border:1px solid #ddd; border-radius:6px; font-size:13px;">`;
        html += `</div>`;
    } else {
        html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; max-width:400px;">`;
        html += `<input type="text" id="add-match-home" placeholder="Hemmalag" style="padding:6px 8px; border:1px solid #ddd; border-radius:6px; font-size:13px;">`;
        html += `<input type="text" id="add-match-away" placeholder="Bortalag" style="padding:6px 8px; border:1px solid #ddd; border-radius:6px; font-size:13px;">`;
        html += `<input type="text" id="add-match-stage" placeholder="t.ex. Kvartsfinal" style="padding:6px 8px; border:1px solid #ddd; border-radius:6px; font-size:13px;">`;
        html += `<input type="text" id="add-match-date" placeholder="t.ex. 8 april 21:00" style="padding:6px 8px; border:1px solid #ddd; border-radius:6px; font-size:13px;">`;
        html += `</div>`;
    }
    html += `<button class="btn" id="add-match-btn" style="margin-top:10px; background:#28a745; font-size:13px;">Lägg till match</button>`;
    html += `<div id="add-match-status" style="margin-top:6px; font-size:12px; color:#888;"></div>`;
    html += `</div>`;

    // Bulk add matches
    html += `<div class="admin-card" style="margin-bottom:16px;">`;
    html += `<h3 style="margin-top:0;">Lägg till flera matcher</h3>`;
    html += `<p style="color:#888; font-size:12px; margin:0 0 8px;">Klistra in matcher i formatet: <code>Hemmalag - Bortalag, Grupp X, 14 juni 21:00</code> (en per rad)</p>`;
    html += `<textarea id="bulk-match-input" rows="6" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:6px; font-size:12px; font-family:monospace; box-sizing:border-box;" placeholder="Sverige - Norge, Grupp A, 14 juni 21:00&#10;Danmark - Finland, Grupp A, 14 juni 18:00"></textarea>`;
    html += `<button class="btn" id="bulk-match-btn" style="margin-top:8px; background:#28a745; font-size:13px;">Lägg till alla</button>`;
    html += `<div id="bulk-match-status" style="margin-top:6px; font-size:12px; color:#888;"></div>`;
    html += `</div>`;

    // Danger zone: clear all
    html += `<div class="admin-card" style="border: 2px dashed #dc3545;">`;
    html += `<h3 style="margin-top:0; color:#dc3545;">Rensa all data</h3>`;
    html += `<p style="color:#888; font-size:12px; margin:0 0 12px;">Tar bort alla matcher, resultat, bracket och användartips. Turneringskonfigurationen behålls.</p>`;
    html += `<button class="btn" id="clear-all-btn" style="background:#dc3545; font-size:13px;">Rensa allt</button>`;
    html += `<div id="clear-all-status" style="margin-top:6px; font-size:12px; color:#888;"></div>`;
    html += `</div>`;

    container.innerHTML = html;

    // Attach listeners
    container.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTournament(btn.dataset.preset));
    });
    document.getElementById('add-match-btn').addEventListener('click', addSingleMatch);
    document.getElementById('bulk-match-btn').addEventListener('click', addBulkMatches);
    document.getElementById('clear-all-btn').addEventListener('click', clearAllData);
}

// ── Switch Tournament ──────────────────────────────────────────────
async function switchTournament(presetKey) {
    const preset = PRESETS[presetKey];
    if (!preset) return;

    const ok = confirm(
        `Byt till "${preset.name}"?\n\n` +
        `Detta kommer:\n` +
        `• Ta bort alla matcher\n` +
        `• Rensa alla resultat och bracket\n` +
        `• Rensa alla användartips\n` +
        `• Sätta ny turneringskonfiguration\n\n` +
        `Har du exporterat en backup? Denna åtgärd kan inte ångras.`
    );
    if (!ok) return;

    const statusEl = document.getElementById('tournament-switch-status');
    statusEl.textContent = 'Byter turnering...';
    statusEl.style.color = '#888';

    try {
        await clearAllDataInternal(statusEl);

        // Write new tournament config
        statusEl.textContent = 'Skriver turneringskonfiguration...';
        await setDoc(doc(db, "matches", "_tournament"), preset);

        // Reset settings
        await setDoc(doc(db, "matches", "_settings"), {
            tipsLocked: false,
            tipsVisible: true,
            dataVersion: Date.now()
        });

        statusEl.textContent = `✓ Bytt till "${preset.name}"! Laddar om...`;
        statusEl.style.color = '#28a745';
        setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
        console.error('Switch tournament failed:', err);
        statusEl.textContent = 'Fel: ' + err.message;
        statusEl.style.color = '#dc3545';
    }
}

// ── Clear All Data ─────────────────────────────────────────────────
async function clearAllData() {
    const ok = confirm(
        'Rensa ALL data?\n\n' +
        '• Alla matcher tas bort\n' +
        '• Alla resultat och bracket rensas\n' +
        '• Alla användartips rensas\n\n' +
        'Turneringskonfigurationen behålls. Denna åtgärd kan inte ångras.'
    );
    if (!ok) return;

    const statusEl = document.getElementById('clear-all-status');
    statusEl.textContent = 'Rensar...';
    statusEl.style.color = '#888';

    try {
        await clearAllDataInternal(statusEl);
        await bumpDataVersion();
        statusEl.textContent = '✓ All data rensad! Laddar om...';
        statusEl.style.color = '#28a745';
        setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
        console.error('Clear all failed:', err);
        statusEl.textContent = 'Fel: ' + err.message;
        statusEl.style.color = '#dc3545';
    }
}

async function clearAllDataInternal(statusEl) {
    // 1. Delete all match documents (not _ prefixed system docs)
    statusEl.textContent = 'Tar bort matcher...';
    const matchSnap = await getDocs(collection(db, "matches"));
    const matchDocs = matchSnap.docs.filter(d => !d.id.startsWith('_'));
    for (let i = 0; i < matchDocs.length; i += 500) {
        const batch = writeBatch(db);
        matchDocs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
        await batch.commit();
    }

    // 2. Clear results and bracket
    statusEl.textContent = 'Rensar resultat och bracket...';
    await setDoc(doc(db, "matches", "_results"), {});
    await setDoc(doc(db, "matches", "_bracket"), { teams: [], rounds: {} });

    // 3. Clear all user tips
    statusEl.textContent = 'Rensar användartips...';
    const userSnap = await getDocs(collection(db, "users"));
    const userDocs = userSnap.docs;
    for (let i = 0; i < userDocs.length; i += 500) {
        const batch = writeBatch(db);
        userDocs.slice(i, i + 500).forEach(d => {
            batch.update(d.ref, {
                groupPicks: {},
                matchTips: {},
                knockout: {}
            });
        });
        await batch.commit();
    }
}

// ── Add Single Match ───────────────────────────────────────────────
async function addSingleMatch() {
    const homeEl = document.getElementById('add-match-home');
    const awayEl = document.getElementById('add-match-away');
    const stageEl = document.getElementById('add-match-stage');
    const dateEl = document.getElementById('add-match-date');
    const statusEl = document.getElementById('add-match-status');

    const homeTeam = homeEl.value.trim();
    const awayTeam = awayEl.value.trim();
    const stage = stageEl.value.trim();
    const date = dateEl.value.trim();

    if (!homeTeam || !awayTeam) {
        statusEl.textContent = 'Ange både hemma- och bortalag.';
        statusEl.style.color = '#dc3545';
        return;
    }

    try {
        const id = await getNextMatchId();
        const matchData = { id, homeTeam, awayTeam, stage, date };
        await setDoc(doc(db, "matches", String(id)), matchData);
        await bumpDataVersion();

        homeEl.value = '';
        awayEl.value = '';
        dateEl.value = '';
        statusEl.textContent = `✓ Match ${id} tillagd: ${homeTeam} - ${awayTeam}`;
        statusEl.style.color = '#28a745';
        showToast(`Match tillagd: ${homeTeam} - ${awayTeam}`);
        setTimeout(() => { statusEl.textContent = ''; }, 4000);
    } catch (err) {
        console.error('Add match failed:', err);
        statusEl.textContent = 'Fel: ' + err.message;
        statusEl.style.color = '#dc3545';
    }
}

// ── Bulk Add Matches ───────────────────────────────────────────────
async function addBulkMatches() {
    const textarea = document.getElementById('bulk-match-input');
    const statusEl = document.getElementById('bulk-match-status');
    const lines = textarea.value.split('\n').map(l => l.trim()).filter(Boolean);

    if (lines.length === 0) {
        statusEl.textContent = 'Skriv minst en match.';
        statusEl.style.color = '#dc3545';
        return;
    }

    const matches = [];
    for (let i = 0; i < lines.length; i++) {
        const parsed = parseBulkLine(lines[i]);
        if (!parsed) {
            statusEl.textContent = `Rad ${i + 1} har fel format: "${lines[i]}"`;
            statusEl.style.color = '#dc3545';
            return;
        }
        matches.push(parsed);
    }

    statusEl.textContent = 'Lägger till matcher...';
    statusEl.style.color = '#888';

    try {
        let nextId = await getNextMatchId();
        for (let i = 0; i < matches.length; i += 500) {
            const batch = writeBatch(db);
            const chunk = matches.slice(i, i + 500);
            chunk.forEach(m => {
                const id = nextId++;
                batch.set(doc(db, "matches", String(id)), { id, homeTeam: m.home, awayTeam: m.away, stage: m.stage, date: m.date });
            });
            await batch.commit();
        }
        await bumpDataVersion();

        textarea.value = '';
        statusEl.textContent = `✓ ${matches.length} matcher tillagda!`;
        statusEl.style.color = '#28a745';
        showToast(`${matches.length} matcher tillagda!`);
        setTimeout(() => { statusEl.textContent = ''; }, 4000);
    } catch (err) {
        console.error('Bulk add failed:', err);
        statusEl.textContent = 'Fel: ' + err.message;
        statusEl.style.color = '#dc3545';
    }
}

function parseBulkLine(line) {
    // Format: "Hemmalag - Bortalag, Grupp A, 14 juni 21:00"
    // or:     "Hemmalag - Bortalag, 14 juni 21:00"  (no stage)
    const parts = line.split(',').map(s => s.trim());
    if (parts.length < 2) return null;

    const teamPart = parts[0];
    const dashIdx = teamPart.indexOf(' - ');
    if (dashIdx < 0) return null;

    const home = teamPart.substring(0, dashIdx).trim();
    const away = teamPart.substring(dashIdx + 3).trim();
    if (!home || !away) return null;

    if (parts.length >= 3) {
        return { home, away, stage: parts[1], date: parts.slice(2).join(', ') };
    } else {
        return { home, away, stage: '', date: parts[1] };
    }
}

async function getNextMatchId() {
    const snap = await getDocs(collection(db, "matches"));
    let maxId = 0;
    snap.docs.forEach(d => {
        if (d.id.startsWith('_')) return;
        const num = parseInt(d.id);
        if (!isNaN(num) && num > maxId) maxId = num;
    });
    return maxId + 1;
}

// ── Init ───────────────────────────────────────────────────────────
export function initTournament() {
    renderTournamentTab();
}
