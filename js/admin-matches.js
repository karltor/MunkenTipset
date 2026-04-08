/**
 * Admin Match Management Module
 *
 * Full CRUD for individual matches: add, edit (modal), delete.
 * Date/time input uses native datetime-local for easy entry.
 */

import { db } from './config.js';
import { doc, setDoc, deleteDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f } from './wizard.js';
import { bumpDataVersion, allMatches, existingResults, renderGroupButtons, renderAdminMatches, currentAdminGroup } from './admin.js';
import { getGroupLetters, getTournamentYear } from './tournament-config.js';

// ── Helpers ────────────────────────────────────────────────────────────

const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni',
    'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

function showToast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}

/** Convert "14 juni 21:00" → "2026-06-14T21:00" for datetime-local input */
function matchDateToISO(dateStr) {
    if (!dateStr) return '';
    const m = dateStr.trim().match(/^(\d+)\s+(\w+)\s+(\d{1,2}):(\d{2})$/);
    if (!m) return '';
    const monthIdx = MONTHS.indexOf(m[2].toLowerCase());
    if (monthIdx === -1) return '';
    const year = getTournamentYear();
    const day = m[1].padStart(2, '0');
    const mon = String(monthIdx + 1).padStart(2, '0');
    return `${year}-${mon}-${day}T${m[3].padStart(2, '0')}:${m[4]}`;
}

/** Convert "2026-06-14T21:00" → "14 juni 21:00" */
function isoToMatchDate(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    if (isNaN(d)) return '';
    const day = d.getDate();
    const month = MONTHS[d.getMonth()];
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${month} ${hours}:${mins}`;
}

/** Get all unique stages from current matches */
function getStages() {
    const stages = new Set();
    allMatches.forEach(m => { if (m.stage) stages.add(m.stage); });
    getGroupLetters().forEach(l => stages.add(`Grupp ${l}`));
    return [...stages].sort();
}

/** Find next available numeric match ID */
function nextMatchId() {
    let max = 0;
    allMatches.forEach(m => {
        const n = parseInt(m.id);
        if (!isNaN(n) && n > max) max = n;
    });
    return String(max + 1);
}

// ── Cached docs for instant filter/render ──────────────────────────────

let cachedDocs = [];
let currentFilter = '';

async function fetchDocs() {
    const snap = await getDocs(collection(db, "matches"));
    cachedDocs = snap.docs
        .filter(d => !d.id.startsWith('_'))
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
            const stageA = a.stage || '';
            const stageB = b.stage || '';
            if (stageA !== stageB) return stageA.localeCompare(stageB);
            return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
        });
    return cachedDocs;
}

// ── Add Match Form ─────────────────────────────────────────────────────

export function renderAddMatchForm() {
    const container = document.getElementById('admin-add-match-form');
    if (!container) return;

    const stages = getStages();
    const stageOptions = stages.map(s => `<option value="${s}">${s}</option>`).join('');

    container.innerHTML = `
        <div class="mm-add-form">
            <div class="mm-add-row">
                <div class="mm-field">
                    <label>Hemmalag</label>
                    <input type="text" id="mm-add-home" placeholder="t.ex. Sverige" autocomplete="off">
                </div>
                <div class="mm-field">
                    <label>Bortalag</label>
                    <input type="text" id="mm-add-away" placeholder="t.ex. Tyskland" autocomplete="off">
                </div>
            </div>
            <div class="mm-add-row">
                <div class="mm-field">
                    <label>Fas</label>
                    <div style="display:flex; gap:6px;">
                        <select id="mm-add-stage-select">
                            <option value="">-- Välj fas --</option>
                            ${stageOptions}
                            <option value="__custom">Annan...</option>
                        </select>
                        <input type="text" id="mm-add-stage-custom" placeholder="Egen fas" style="display:none;">
                    </div>
                </div>
                <div class="mm-field">
                    <label>Datum & tid</label>
                    <input type="datetime-local" id="mm-add-datetime">
                </div>
            </div>
            <button class="btn" id="mm-add-btn" style="margin-top:8px;">Lägg till match</button>
        </div>`;

    const stageSelect = document.getElementById('mm-add-stage-select');
    const stageCustom = document.getElementById('mm-add-stage-custom');
    stageSelect.addEventListener('change', () => {
        stageCustom.style.display = stageSelect.value === '__custom' ? '' : 'none';
        if (stageSelect.value !== '__custom') stageCustom.value = '';
    });

    document.getElementById('mm-add-btn').addEventListener('click', addMatch);
}

async function addMatch() {
    const home = document.getElementById('mm-add-home').value.trim();
    const away = document.getElementById('mm-add-away').value.trim();
    const stageSelect = document.getElementById('mm-add-stage-select');
    const stageCustom = document.getElementById('mm-add-stage-custom').value.trim();
    const stage = stageSelect.value === '__custom' ? stageCustom : stageSelect.value;
    const datetime = document.getElementById('mm-add-datetime').value;
    const date = isoToMatchDate(datetime);

    if (!home || !away) { showToast('Ange hemma- och bortalag'); return; }
    if (!stage) { showToast('Välj eller ange en fas'); return; }

    const id = nextMatchId();
    const matchData = { id: parseInt(id), homeTeam: home, awayTeam: away, stage, date };

    await setDoc(doc(db, "matches", id), matchData);
    allMatches.push({ id, ...matchData });
    await bumpDataVersion();

    showToast(`Match #${id} tillagd: ${home} — ${away}`);

    document.getElementById('mm-add-home').value = '';
    document.getElementById('mm-add-away').value = '';
    document.getElementById('mm-add-stage-select').value = '';
    document.getElementById('mm-add-stage-custom').value = '';
    document.getElementById('mm-add-stage-custom').style.display = 'none';
    document.getElementById('mm-add-datetime').value = '';

    renderMatchManager();
    renderAddMatchForm();
    renderGroupButtons();
    renderAdminMatches(currentAdminGroup);
}

// ── Match Manager (list + modal edit) ──────────────────────────────────

export async function renderMatchManager() {
    const container = document.getElementById('admin-match-manager');
    if (!container) return;
    container.innerHTML = '<p style="color:#999;">Laddar matcher...</p>';

    await fetchDocs();
    renderList();
}

function renderList() {
    const container = document.getElementById('admin-match-manager');
    if (!container) return;

    renderFilterButtons();

    if (cachedDocs.length === 0) {
        container.innerHTML = '<p style="color:#999;">Inga matcher i databasen.</p>';
        return;
    }

    const filtered = currentFilter ? cachedDocs.filter(d => d.stage === currentFilter) : cachedDocs;

    let html = '<div class="mm-table-wrap">';
    html += '<table class="mm-table">';
    html += '<thead><tr><th>ID</th><th>Hemma</th><th></th><th>Borta</th><th>Fas</th><th>Datum & tid</th><th></th></tr></thead><tbody>';

    filtered.forEach(m => {
        const home = m.homeTeam || '?';
        const away = m.awayTeam || '?';
        const stage = m.stage || '-';
        const date = m.date || '-';
        html += `<tr class="mm-row" data-id="${m.id}">
            <td class="mm-id">${m.id}</td>
            <td class="mm-team">${f(home)}<span>${home}</span></td>
            <td class="mm-vs">—</td>
            <td class="mm-team">${f(away)}<span>${away}</span></td>
            <td class="mm-stage">${stage}</td>
            <td class="mm-date">${date}</td>
            <td class="mm-actions">
                <button class="btn mm-edit-btn" data-id="${m.id}" title="Redigera">&#9998;</button>
                <button class="btn mm-delete-btn" data-id="${m.id}" title="Ta bort">&#10005;</button>
            </td>
        </tr>`;
    });

    html += '</tbody></table></div>';
    html += `<p style="font-size:12px; color:#888; margin-top:6px;">${filtered.length} av ${cachedDocs.length} matcher</p>`;
    container.innerHTML = html;

    // Edit → open modal
    container.querySelectorAll('.mm-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const m = cachedDocs.find(d => d.id === btn.dataset.id);
            if (m) openEditModal(m);
        });
    });

    // Delete
    container.querySelectorAll('.mm-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteMatch(btn.dataset.id));
    });
}

// ── Edit Modal ─────────────────────────────────────────────────────────

function openEditModal(m) {
    // Remove any existing modal
    document.getElementById('mm-edit-modal')?.remove();

    const stages = getStages();
    const stageOpts = stages.map(s =>
        `<option value="${s}" ${s === (m.stage || '') ? 'selected' : ''}>${s}</option>`
    ).join('');
    const isoDate = matchDateToISO(m.date || '');

    const overlay = document.createElement('div');
    overlay.id = 'mm-edit-modal';
    overlay.className = 'mm-modal-overlay';
    overlay.innerHTML = `
        <div class="mm-modal">
            <div class="mm-modal-header">
                <h3>Redigera match #${m.id}</h3>
                <button class="mm-modal-close" id="mm-modal-close">&times;</button>
            </div>
            <div class="mm-modal-body">
                <div class="mm-add-row">
                    <div class="mm-field">
                        <label>Hemmalag</label>
                        <input type="text" id="mm-modal-home" value="${m.homeTeam || ''}" autocomplete="off">
                    </div>
                    <div class="mm-field">
                        <label>Bortalag</label>
                        <input type="text" id="mm-modal-away" value="${m.awayTeam || ''}" autocomplete="off">
                    </div>
                </div>
                <div class="mm-add-row">
                    <div class="mm-field">
                        <label>Fas</label>
                        <div style="display:flex; gap:6px;">
                            <select id="mm-modal-stage">
                                ${stageOpts}
                                <option value="__custom">Annan...</option>
                            </select>
                            <input type="text" id="mm-modal-stage-custom" placeholder="Egen fas" style="display:none;">
                        </div>
                    </div>
                    <div class="mm-field">
                        <label>Datum & tid</label>
                        <input type="datetime-local" id="mm-modal-date" value="${isoDate}">
                    </div>
                </div>
            </div>
            <div class="mm-modal-footer">
                <button class="btn" id="mm-modal-save">Spara</button>
                <button class="btn" id="mm-modal-cancel" style="background:#6c757d;">Avbryt</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);

    // Focus first field
    document.getElementById('mm-modal-home').focus();

    // Close handlers
    const close = () => overlay.remove();
    document.getElementById('mm-modal-close').addEventListener('click', close);
    document.getElementById('mm-modal-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    // Custom stage toggle
    const stageSel = document.getElementById('mm-modal-stage');
    const stageCust = document.getElementById('mm-modal-stage-custom');
    stageSel.addEventListener('change', () => {
        stageCust.style.display = stageSel.value === '__custom' ? '' : 'none';
    });

    // Save
    document.getElementById('mm-modal-save').addEventListener('click', async () => {
        const homeTeam = document.getElementById('mm-modal-home').value.trim();
        const awayTeam = document.getElementById('mm-modal-away').value.trim();
        const stageVal = stageSel.value === '__custom' ? stageCust.value.trim() : stageSel.value;
        const date = isoToMatchDate(document.getElementById('mm-modal-date').value);

        if (!homeTeam || !awayTeam) { showToast('Ange hemma- och bortalag'); return; }
        if (!stageVal) { showToast('Välj eller ange en fas'); return; }

        const matchData = { id: parseInt(m.id) || m.id, homeTeam, awayTeam, stage: stageVal, date };
        await setDoc(doc(db, "matches", m.id), matchData);

        // Update in-memory
        const idx = allMatches.findIndex(x => String(x.id) === m.id);
        if (idx !== -1) allMatches[idx] = { id: m.id, ...matchData };

        // Update cached docs
        const ci = cachedDocs.findIndex(x => x.id === m.id);
        if (ci !== -1) cachedDocs[ci] = { id: m.id, ...matchData };

        // Update results if they exist
        if (existingResults[m.id]) {
            existingResults[m.id].homeTeam = homeTeam;
            existingResults[m.id].awayTeam = awayTeam;
            existingResults[m.id].stage = stageVal;
            existingResults[m.id].date = date;
            await setDoc(doc(db, "matches", "_results"), existingResults);
        }

        await bumpDataVersion();
        close();
        showToast(`Match #${m.id} uppdaterad!`);
        renderList();
        renderGroupButtons();
        renderAdminMatches(currentAdminGroup);
    });
}

// ── Delete ─────────────────────────────────────────────────────────────

async function deleteMatch(matchId) {
    if (!confirm(`Ta bort match "${matchId}"? Kan inte ångras.`)) return;

    await deleteDoc(doc(db, "matches", matchId));

    if (existingResults[matchId]) {
        delete existingResults[matchId];
        await setDoc(doc(db, "matches", "_results"), existingResults);
    }

    await bumpDataVersion();

    const idx = allMatches.findIndex(m => String(m.id) === matchId);
    if (idx !== -1) allMatches.splice(idx, 1);

    cachedDocs = cachedDocs.filter(d => d.id !== matchId);

    showToast(`Match "${matchId}" borttagen!`);
    renderList();
    renderGroupButtons();
    renderAdminMatches(currentAdminGroup);
}

// ── Filter Buttons ─────────────────────────────────────────────────────

function renderFilterButtons() {
    const filterContainer = document.getElementById('admin-match-filter');
    if (!filterContainer) return;

    const stages = [...new Set(cachedDocs.map(d => d.stage).filter(Boolean))].sort();

    let html = '<div class="mm-filter-bar">';
    html += `<button class="mm-filter-btn ${!currentFilter ? 'active' : ''}" data-filter="">Alla</button>`;
    stages.forEach(s => {
        html += `<button class="mm-filter-btn ${currentFilter === s ? 'active' : ''}" data-filter="${s}">${s}</button>`;
    });
    html += '</div>';
    filterContainer.innerHTML = html;

    filterContainer.querySelectorAll('.mm-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentFilter = btn.dataset.filter;
            renderList(); // instant — no Firestore fetch
        });
    });
}
