import { db } from './config.js';
import { doc, getDoc, setDoc, getDocs, collection, writeBatch } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f } from './wizard.js';

const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
let allMatches = [];
let currentAdminGroup = 'A';

export async function initAdmin(matchesData) {
    allMatches = matchesData;

    // Load lock status
    await refreshLockStatus();

    // Render group selector buttons
    const groupSelect = document.getElementById('admin-group-select');
    groupSelect.innerHTML = '';
    GROUP_LETTERS.forEach(letter => {
        const btn = document.createElement('button');
        btn.className = 'admin-group-btn' + (letter === currentAdminGroup ? ' active' : '');
        btn.textContent = `Grupp ${letter}`;
        btn.addEventListener('click', () => {
            currentAdminGroup = letter;
            groupSelect.querySelectorAll('.admin-group-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderAdminMatches(letter);
        });
        groupSelect.appendChild(btn);
    });

    renderAdminMatches(currentAdminGroup);

    // Lock/unlock buttons
    document.getElementById('admin-lock-tips').addEventListener('click', () => toggleLock(true));
    document.getElementById('admin-unlock-tips').addEventListener('click', () => toggleLock(false));
    document.getElementById('admin-save-results').addEventListener('click', saveAdminResults);
}

async function refreshLockStatus() {
    const statusEl = document.getElementById('admin-lock-status');
    const settingsRef = doc(db, "matches", "_settings");
    const snap = await getDoc(settingsRef);
    const locked = snap.exists() && snap.data().tipsLocked;

    if (locked) {
        statusEl.textContent = '🔒 Tipsraderna är LÅSTA. Användare kan inte ändra sina tips.';
        statusEl.style.background = '#fce8e6';
        statusEl.style.color = '#c62828';
    } else {
        statusEl.textContent = '🔓 Tipsraderna är öppna. Användare kan tippa fritt.';
        statusEl.style.background = '#e8f5e9';
        statusEl.style.color = '#2e7d32';
    }
    return locked;
}

async function toggleLock(lock) {
    const settingsRef = doc(db, "matches", "_settings");
    await setDoc(settingsRef, { tipsLocked: lock }, { merge: true });
    await refreshLockStatus();
    alert(lock ? 'Alla tipsrader är nu låsta!' : 'Tipsraderna är nu upplåsta!');
}

async function renderAdminMatches(letter) {
    const container = document.getElementById('admin-matches');
    const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);

    if (groupMatches.length === 0) {
        container.innerHTML = '<p style="color: #999;">Inga matcher hittades för denna grupp.</p>';
        return;
    }

    // Load existing official results
    const resultsRef = doc(db, "matches", "_results");
    const resultsSnap = await getDoc(resultsRef);
    const existingResults = resultsSnap.exists() ? resultsSnap.data() : {};

    container.innerHTML = '';
    groupMatches.forEach(m => {
        const existing = existingResults[m.id] || {};
        const div = document.createElement('div');
        div.className = 'admin-match-card';
        div.innerHTML = `
            <span style="flex:1; font-weight: 600;">${f(m.homeTeam)}${m.homeTeam}</span>
            <input type="number" min="0" class="score-input" id="adminHome-${m.id}" value="${existing.homeScore ?? ''}" placeholder="-">
            <span style="color:#aaa; font-weight:bold;">:</span>
            <input type="number" min="0" class="score-input" id="adminAway-${m.id}" value="${existing.awayScore ?? ''}" placeholder="-">
            <span style="flex:1; text-align:right; font-weight: 600;">${m.awayTeam}${f(m.awayTeam)}</span>
        `;
        container.appendChild(div);
    });
}

async function saveAdminResults() {
    const groupMatches = allMatches.filter(m => m.stage === `Grupp ${currentAdminGroup}`);
    const resultsRef = doc(db, "matches", "_results");
    const resultsSnap = await getDoc(resultsRef);
    const existingResults = resultsSnap.exists() ? resultsSnap.data() : {};

    let hasResults = false;
    groupMatches.forEach(m => {
        const hEl = document.getElementById(`adminHome-${m.id}`);
        const aEl = document.getElementById(`adminAway-${m.id}`);
        if (hEl.value !== '' && aEl.value !== '') {
            existingResults[m.id] = {
                homeScore: parseInt(hEl.value),
                awayScore: parseInt(aEl.value),
                homeTeam: m.homeTeam,
                awayTeam: m.awayTeam,
                stage: m.stage
            };
            hasResults = true;
        }
    });

    if (!hasResults) return alert('Fyll i minst ett matchresultat.');

    await setDoc(resultsRef, existingResults, { merge: true });
    alert(`Resultat för Grupp ${currentAdminGroup} sparade!`);
}

export async function checkTipsLocked() {
    const settingsRef = doc(db, "matches", "_settings");
    const snap = await getDoc(settingsRef);
    return snap.exists() && snap.data().tipsLocked === true;
}
