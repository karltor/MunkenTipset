import { db } from './config.js';
import { collection, getDocs, doc, setDoc, writeBatch }
    from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { bumpDataVersion } from './admin.js';
import { editState, renderTeamRoster } from './admin-tournament.js';

export function renderGroupBuilder() {
    const section = document.getElementById('group-builder-section');
    if (!section || !editState.hasGroups || editState.groupLetters.length === 0) {
        if (section) section.innerHTML = '';
        return;
    }

    // Initialize groupAssignments
    editState.groupLetters.forEach(l => {
        if (!editState.groupAssignments[l]) editState.groupAssignments[l] = [];
    });

    const assignedTeams = new Set(Object.values(editState.groupAssignments).flat());
    const unsorted = editState.teams.filter(t => !assignedTeams.has(t));

    let html = `<div class="admin-card" style="margin-bottom:16px;">`;
    html += `<h3 style="margin-top:0;">Grupper</h3>`;
    html += `<p style="color:#888; font-size:12px; margin:0 0 12px;">Dra lag till rätt grupp, eller klicka på ett lag och sedan på en grupp.</p>`;

    // Unsorted pool
    html += `<div class="group-pool" id="group-unsorted">`;
    html += `<div style="font-size:12px; color:#888; margin-bottom:6px; font-weight:600;">Osorterade lag (${unsorted.length})</div>`;
    html += `<div class="group-pool-teams" id="unsorted-teams" data-group="unsorted">`;
    unsorted.forEach(t => {
        html += `<span class="team-tag team-draggable" draggable="true" data-team="${t}">${t}</span>`;
    });
    if (unsorted.length === 0) html += `<span style="color:#999; font-size:12px;">Alla lag placerade!</span>`;
    html += `</div></div>`;

    // Group grid
    const cols = editState.groupLetters.length <= 6 ? Math.min(editState.groupLetters.length, 3) : 4;
    html += `<div style="display:grid; grid-template-columns:repeat(${cols}, 1fr); gap:10px; margin-top:12px;">`;
    editState.groupLetters.forEach(letter => {
        const teams = editState.groupAssignments[letter] || [];
        const full = teams.length >= editState.teamsPerGroup;
        html += `<div class="group-drop-zone ${full ? 'group-full' : ''}" data-group="${letter}">`;
        html += `<div class="group-drop-label">Grupp ${letter} <span style="font-size:10px; color:#888;">(${teams.length}/${editState.teamsPerGroup})</span></div>`;
        html += `<div class="group-drop-teams" data-group="${letter}">`;
        teams.forEach(t => {
            html += `<span class="team-tag team-draggable team-in-group" draggable="true" data-team="${t}" data-from="${letter}">${t} <span class="team-tag-x" data-team="${t}" data-group="${letter}">&times;</span></span>`;
        });
        html += `</div></div>`;
    });
    html += `</div>`;

    html += `<div style="display:flex; gap:8px; margin-top:12px;">`;
    html += `<button class="btn" id="gb-save" style="background:#ffc107; color:#000; font-size:13px; flex:1;">Spara grupper & generera matcher</button>`;
    html += `<button class="btn" id="gb-clear" style="background:#6c757d; font-size:13px;">Nollställ grupper</button>`;
    html += `</div>`;
    html += `<span id="gb-status" style="font-size:12px; margin-top:6px; display:block;"></span>`;
    html += `</div>`;

    section.innerHTML = html;
    attachGroupListeners(section);
}

function attachGroupListeners(section) {
    // Drag and drop
    section.querySelectorAll('.team-draggable').forEach(tag => {
        tag.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', tag.dataset.team);
            e.dataTransfer.setData('from-group', tag.dataset.from || 'unsorted');
            tag.classList.add('dragging');
        });
        tag.addEventListener('dragend', () => tag.classList.remove('dragging'));
    });

    // Drop zones
    section.querySelectorAll('.group-drop-zone, .group-pool').forEach(zone => {
        zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', e => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            const team = e.dataTransfer.getData('text/plain');
            const fromGroup = e.dataTransfer.getData('from-group');
            const toGroup = zone.dataset.group || zone.querySelector('[data-group]')?.dataset.group;
            if (!team || !toGroup) return;
            moveTeam(team, fromGroup, toGroup);
        });
    });

    // Click to remove from group (×)
    section.querySelectorAll('.team-tag-x').forEach(x => {
        x.addEventListener('click', e => {
            e.stopPropagation();
            const team = x.dataset.team;
            const group = x.dataset.group;
            moveTeam(team, group, 'unsorted');
        });
    });

    // Save
    document.getElementById('gb-save')?.addEventListener('click', saveGroupsAndGenerate);
    document.getElementById('gb-clear')?.addEventListener('click', () => {
        editState.groupLetters.forEach(l => { editState.groupAssignments[l] = []; });
        renderGroupBuilder();
    });
}

function moveTeam(team, fromGroup, toGroup) {
    if (fromGroup === toGroup) return;

    // Remove from source
    if (fromGroup && fromGroup !== 'unsorted') {
        const arr = editState.groupAssignments[fromGroup];
        if (arr) {
            const idx = arr.indexOf(team);
            if (idx >= 0) arr.splice(idx, 1);
        }
    }

    // Add to target
    if (toGroup && toGroup !== 'unsorted') {
        if (!editState.groupAssignments[toGroup]) editState.groupAssignments[toGroup] = [];
        const arr = editState.groupAssignments[toGroup];
        if (arr.length >= editState.teamsPerGroup) return; // group full
        if (!arr.includes(team)) arr.push(team);
    }

    renderGroupBuilder();
}

async function saveGroupsAndGenerate() {
    const s = document.getElementById('gb-status');

    // Validate all teams placed
    const assignedCount = Object.values(editState.groupAssignments).reduce((sum, arr) => sum + arr.length, 0);
    const totalNeeded = editState.groupLetters.length * editState.teamsPerGroup;
    if (assignedCount < totalNeeded) {
        s.textContent = `Placera alla lag i grupper (${assignedCount}/${totalNeeded}).`;
        s.style.color = '#dc3545';
        return;
    }

    s.textContent = 'Genererar matcher...';
    s.style.color = '#888';

    try {
        // Delete existing group matches
        const matchSnap = await getDocs(collection(db, "matches"));
        const existing = matchSnap.docs.filter(d => !d.id.startsWith('_') && d.data().stage?.startsWith('Grupp'));
        if (existing.length > 0) {
            for (let i = 0; i < existing.length; i += 500) {
                const batch = writeBatch(db);
                existing.slice(i, i + 500).forEach(d => batch.delete(d.ref));
                await batch.commit();
            }
        }

        // Generate round-robin matches for each group
        let nextId = 1;
        const snap2 = await getDocs(collection(db, "matches"));
        snap2.docs.forEach(d => {
            if (d.id.startsWith('_')) return;
            const n = parseInt(d.id);
            if (!isNaN(n) && n >= nextId) nextId = n + 1;
        });

        const allMatches = [];
        editState.groupLetters.forEach(letter => {
            const teams = editState.groupAssignments[letter] || [];
            for (let i = 0; i < teams.length; i++) {
                for (let j = i + 1; j < teams.length; j++) {
                    allMatches.push({
                        id: nextId++,
                        homeTeam: teams[i],
                        awayTeam: teams[j],
                        stage: `Grupp ${letter}`,
                        date: ''
                    });
                }
            }
        });

        // Write in batches
        for (let i = 0; i < allMatches.length; i += 500) {
            const batch = writeBatch(db);
            allMatches.slice(i, i + 500).forEach(m => {
                batch.set(doc(db, "matches", String(m.id)), m);
            });
            await batch.commit();
        }

        await bumpDataVersion();
        s.textContent = `✓ ${allMatches.length} matcher genererade!`;
        s.style.color = '#28a745';
    } catch (err) {
        console.error('Generate matches failed:', err);
        s.textContent = 'Fel: ' + err.message;
        s.style.color = '#dc3545';
    }
}
