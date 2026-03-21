import { db, auth } from './config.js';
import { doc, getDoc, setDoc, getDocs, collection, writeBatch } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// Flagg-hjälpare
export const flags = { "Mexiko": "mx", "Sydafrika": "za", "Sydkorea": "kr", "Kanada": "ca", "USA": "us", "Paraguay": "py", "Qatar": "qa", "Schweiz": "ch", "Brasilien": "br", "Marocko": "ma", "Haiti": "ht", "Skottland": "gb-sct", "Australien": "au", "Tyskland": "de", "Curaçao": "cw", "Nederländerna": "nl", "Japan": "jp", "Elfenbenskusten": "ci", "Ecuador": "ec", "Tunisien": "tn", "Spanien": "es", "Kap Verde": "cv", "Belgien": "be", "Egypten": "eg", "Saudiarabien": "sa", "Uruguay": "uy", "Iran": "ir", "Nya Zeeland": "nz", "Frankrike": "fr", "Senegal": "sn", "Norge": "no", "Argentina": "ar", "Algeriet": "dz", "Österrike": "at", "Jordanien": "jo", "Portugal": "pt", "England": "gb-eng", "Kroatien": "hr", "Ghana": "gh", "Panama": "pa", "Uzbekistan": "uz", "Colombia": "co" };
export const f = (t) => flags[t] ? `<img src="https://flagcdn.com/20x15/${flags[t]}.png" style="vertical-align:middle; margin-right:6px; border-radius:2px; box-shadow: 0 1px 3px rgba(0,0,0,0.2);" width="20" height="15" alt="">` : '🌍 ';

const groupLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
let currentIndex = 0;
let currentTeams = [];
let selFirst = null;
let selSecond = null;
let allMatches = [];
let currentMode = null; // 'casual' or 'detailed'
let existingGroupPicks = null; // Loaded from DB
let onGroupsComplete = null; // Callback when all groups done

export async function initWizard(matchesData, onComplete) {
    allMatches = matchesData;
    onGroupsComplete = onComplete;

    const userId = auth.currentUser.uid;
    const metaRef = doc(db, "users", userId, "tips", "_groupPicks");
    const metaSnap = await getDoc(metaRef);

    if (metaSnap.exists()) {
        existingGroupPicks = metaSnap.data();
        // User already has tips - show banner
        document.getElementById('wizard-already-done').style.display = 'flex';
        document.getElementById('wizard-mode-select').style.display = 'none';
        document.getElementById('wizard-content').style.display = 'none';

        document.getElementById('btn-edit-tips').addEventListener('click', () => {
            document.getElementById('wizard-already-done').style.display = 'none';
            startMode(existingGroupPicks.mode || 'casual');
        });
    } else {
        // New user - show mode selection
        document.getElementById('wizard-mode-select').style.display = 'block';
    }

    // Mode selection handlers
    document.getElementById('mode-casual').addEventListener('click', () => startMode('casual'));
    document.getElementById('mode-detailed').addEventListener('click', () => startMode('detailed'));
    document.getElementById('btn-switch-mode').addEventListener('click', switchMode);

    // Detailed mode buttons
    const btnSmart = document.getElementById('btn-smart-random');
    if (btnSmart) btnSmart.addEventListener('click', smartAutoFill);
    const btnSave = document.getElementById('btn-save-group');
    if (btnSave) btnSave.addEventListener('click', () => saveAndNext('detailed'));
    const btnPrev = document.getElementById('btn-prev-group');
    if (btnPrev) btnPrev.addEventListener('click', () => { if (currentIndex > 0) { currentIndex--; loadDetailedGroup(currentIndex); } });

    // Casual mode buttons
    const btnCasualSave = document.getElementById('btn-casual-save');
    if (btnCasualSave) btnCasualSave.addEventListener('click', () => saveAndNext('casual'));
    const btnCasualPrev = document.getElementById('btn-casual-prev');
    if (btnCasualPrev) btnCasualPrev.addEventListener('click', () => { if (currentIndex > 0) { currentIndex--; loadCasualGroup(currentIndex); } });
}

function startMode(mode) {
    currentMode = mode;
    currentIndex = 0;
    document.getElementById('wizard-mode-select').style.display = 'none';
    document.getElementById('wizard-already-done').style.display = 'none';
    document.getElementById('wizard-content').style.display = 'block';
    document.getElementById('btn-switch-mode').textContent = mode === 'casual' ? '📊 Byt till Detaljerat' : '🎯 Byt till Snabbtips';

    if (mode === 'casual') {
        document.getElementById('casual-mode').style.display = 'block';
        document.getElementById('detailed-mode').style.display = 'none';
        loadCasualGroup(0);
    } else {
        document.getElementById('casual-mode').style.display = 'none';
        document.getElementById('detailed-mode').style.display = 'block';
        loadDetailedGroup(0);
    }
}

function switchMode() {
    const newMode = currentMode === 'casual' ? 'detailed' : 'casual';
    startMode(newMode);
}

// ─── CASUAL MODE ─────────────────────────────────────
function loadCasualGroup(index) {
    const letter = groupLetters[index];
    currentIndex = index;
    document.getElementById('casual-title').textContent = `Grupp ${letter}`;
    document.getElementById('wizard-progress').style.width = `${((index + 1) / 12) * 100}%`;

    selFirst = null;
    selSecond = null;

    // Restore existing picks if available
    if (existingGroupPicks && existingGroupPicks[letter]) {
        selFirst = existingGroupPicks[letter].first;
        selSecond = existingGroupPicks[letter].second;
    }

    const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);
    currentTeams = Array.from(new Set(groupMatches.flatMap(m => [m.homeTeam, m.awayTeam])));
    renderCasualSelectors();
}

function renderCasualSelectors() {
    const container = document.getElementById('casual-team-selectors');
    container.innerHTML = '';
    currentTeams.forEach(team => {
        const cls = team === selFirst ? 'rank-1' : (team === selSecond ? 'rank-2' : '');
        container.innerHTML += `<div class="team-chip ${cls}" onclick="window.toggleCasualTeam('${team}')">${f(team)}${team}</div>`;
    });
}

window.toggleCasualTeam = function (team) {
    if (selFirst === team) selFirst = null;
    else if (selSecond === team) selSecond = null;
    else if (!selFirst) selFirst = team;
    else if (!selSecond) selSecond = team;
    renderCasualSelectors();
};

// ─── DETAILED MODE ───────────────────────────────────
function loadDetailedGroup(index) {
    const letter = groupLetters[index];
    currentIndex = index;
    document.getElementById('wizard-title').textContent = `Grupp ${letter}`;
    document.getElementById('wizard-progress').style.width = `${((index + 1) / 12) * 100}%`;

    selFirst = null;
    selSecond = null;

    const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);
    currentTeams = Array.from(new Set(groupMatches.flatMap(m => [m.homeTeam, m.awayTeam])));

    renderTeamSelectors();

    const container = document.getElementById('wizard-matches');
    container.innerHTML = '';

    groupMatches.forEach(m => {
        container.innerHTML += `
            <div class="match-card">
                <div class="match-header"><span>${m.date || ''}</span></div>
                <div class="match-teams">
                    <span class="team-name home" id="wizNameHome-${m.id}">${f(m.homeTeam)}${m.homeTeam}</span>
                    <div class="score-input-group">
                        <input type="number" min="0" id="wizHome-${m.id}" class="score-input" placeholder="-" oninput="window.updateWizTable()">
                        <span style="color:#aaa; font-weight:bold; margin: 0 4px;">:</span>
                        <input type="number" min="0" id="wizAway-${m.id}" class="score-input" placeholder="-" oninput="window.updateWizTable()">
                    </div>
                    <span class="team-name away" id="wizNameAway-${m.id}">${f(m.awayTeam)}${m.awayTeam}</span>
                </div>
            </div>`;
    });

    window.updateWizTable = updateWizardTable;
    updateWizardTable();
}

function renderTeamSelectors() {
    const container = document.getElementById('wizard-team-selectors');
    container.innerHTML = '';
    currentTeams.forEach(team => {
        const cls = team === selFirst ? 'rank-1' : (team === selSecond ? 'rank-2' : '');
        container.innerHTML += `<div class="team-chip ${cls}" onclick="window.toggleWizTeam('${team}')">${f(team)}${team}</div>`;
    });
}

window.toggleWizTeam = function (team) {
    if (selFirst === team) selFirst = null;
    else if (selSecond === team) selSecond = null;
    else if (!selFirst) selFirst = team;
    else if (!selSecond) selSecond = team;
    renderTeamSelectors();
};

// ─── SMART AUTO-FILL ─────────────────────────────────
function smartAutoFill() {
    if (!selFirst || !selSecond) return alert("Klicka på två lag ovanför för att välja ettan och tvåan först!");

    const unselected = currentTeams.filter(t => t !== selFirst && t !== selSecond);
    const targetStandings = [selFirst, selSecond, unselected[0], unselected[1]];

    let slots = [{ id: 0, pts: 0, gd: 0, gf: 0 }, { id: 1, pts: 0, gd: 0, gf: 0 }, { id: 2, pts: 0, gd: 0, gf: 0 }, { id: 3, pts: 0, gd: 0, gf: 0 }];
    const simMatches = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];
    const generatedScores = [];

    simMatches.forEach(match => {
        const homeScore = Math.floor(Math.random() * 4);
        const awayScore = Math.floor(Math.random() * 4);
        generatedScores.push({ hId: match[0], aId: match[1], h: homeScore, a: awayScore });
        let h = slots[match[0]], a = slots[match[1]];
        h.gf += homeScore; a.gf += awayScore; h.gd += (homeScore - awayScore); a.gd += (awayScore - homeScore);
        if (homeScore > awayScore) h.pts += 3; else if (awayScore > homeScore) a.pts += 3; else { h.pts++; a.pts++; }
    });

    slots.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    const slotToTeamMap = {};
    slots.forEach((s, i) => slotToTeamMap[s.id] = targetStandings[i]);

    const letter = groupLetters[currentIndex];
    const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);

    groupMatches.forEach(m => {
        const simM = generatedScores.find(sim =>
            (slotToTeamMap[sim.hId] === m.homeTeam && slotToTeamMap[sim.aId] === m.awayTeam) ||
            (slotToTeamMap[sim.aId] === m.homeTeam && slotToTeamMap[sim.hId] === m.awayTeam)
        );
        if (simM) {
            if (slotToTeamMap[simM.hId] === m.homeTeam) {
                document.getElementById(`wizHome-${m.id}`).value = simM.h;
                document.getElementById(`wizAway-${m.id}`).value = simM.a;
            } else {
                document.getElementById(`wizHome-${m.id}`).value = simM.a;
                document.getElementById(`wizAway-${m.id}`).value = simM.h;
            }
        }
    });
    updateWizardTable();
}

// ─── LIVE TABLE ──────────────────────────────────────
function updateWizardTable() {
    const letter = groupLetters[currentIndex];
    const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);
    const tData = {};
    currentTeams.forEach(t => tData[t] = { name: t, pld: 0, pts: 0, gd: 0 });

    groupMatches.forEach(m => {
        const hEl = document.getElementById(`wizHome-${m.id}`);
        const aEl = document.getElementById(`wizAway-${m.id}`);
        if (!hEl || !aEl) return;
        const hInp = hEl.value, aInp = aEl.value;
        const hText = document.getElementById(`wizNameHome-${m.id}`);
        const aText = document.getElementById(`wizNameAway-${m.id}`);
        if (hText && aText) { hText.className = "team-name home"; aText.className = "team-name away"; }

        if (hInp !== '' && aInp !== '') {
            const h = parseInt(hInp), a = parseInt(aInp);
            if (hText && aText) {
                if (h > a) { hText.classList.add('is-winner'); aText.classList.add('is-loser'); }
                else if (a > h) { aText.classList.add('is-winner'); hText.classList.add('is-loser'); }
                else { hText.classList.add('is-draw'); aText.classList.add('is-draw'); }
            }
            let ht = tData[m.homeTeam], at = tData[m.awayTeam];
            ht.pld++; at.pld++; ht.gd += (h - a); at.gd += (a - h);
            if (h > a) ht.pts += 3; else if (h < a) at.pts += 3; else { ht.pts++; at.pts++; }
        }
    });

    const sorted = Object.values(tData).sort((a, b) => b.pts - a.pts || b.gd - a.gd);
    let html = `<table class="group-table" style="background:transparent;"><thead><tr><th>Lag</th><th>S</th><th>+/-</th><th>P</th></tr></thead><tbody>`;
    sorted.forEach((t, i) => {
        const bg = i === 0 ? 'background-color: rgba(40, 167, 69, 0.1);' : (i === 1 ? 'background-color: rgba(23, 162, 184, 0.05);' : '');
        html += `<tr style="${bg}"><td style="padding-left: 5px;">${f(t.name)}${t.name}</td><td>${t.pld}</td><td>${t.gd > 0 ? '+' + t.gd : t.gd}</td><td><strong>${t.pts}</strong></td></tr>`;
    });
    const liveTable = document.getElementById('wizard-live-table');
    if (liveTable) liveTable.innerHTML = html + `</tbody></table>`;
}

// ─── SAVE TO FIREBASE ────────────────────────────────
async function saveAndNext(mode) {
    const letter = groupLetters[currentIndex];
    const userId = auth.currentUser.uid;

    if (mode === 'casual') {
        if (!selFirst || !selSecond) return alert("Välj gruppetta och grupptvåa först!");
        // Save casual pick
        const picksRef = doc(db, "users", userId, "tips", "_groupPicks");
        const existing = existingGroupPicks || {};
        existing[letter] = { first: selFirst, second: selSecond };
        existing.mode = 'casual';

        if (currentIndex === 11) existing.completedAt = new Date().toISOString();
        await setDoc(picksRef, existing, { merge: true });
        existingGroupPicks = existing;
    } else {
        // Detailed mode: save match scores + derived picks
        const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);
        const batch = writeBatch(db);

        let allFilled = true;
        groupMatches.forEach(m => {
            const h = document.getElementById(`wizHome-${m.id}`).value;
            const a = document.getElementById(`wizAway-${m.id}`).value;
            if (h === '' || a === '') { allFilled = false; return; }
            const tipRef = doc(db, "users", userId, "tips", m.id.toString());
            batch.set(tipRef, { homeScore: parseInt(h), awayScore: parseInt(a), homeTeam: m.homeTeam, awayTeam: m.awayTeam, stage: m.stage });
        });

        if (!allFilled) return alert("Fyll i alla matchresultat först!");

        // Calculate standings for this group and save as group pick
        const standings = calcGroupStandings(groupMatches);
        const picksRef = doc(db, "users", userId, "tips", "_groupPicks");
        const existing = existingGroupPicks || {};
        existing[letter] = { first: standings[0], second: standings[1] };
        existing.mode = 'detailed';
        if (currentIndex === 11) existing.completedAt = new Date().toISOString();
        batch.set(picksRef, existing, { merge: true });

        await batch.commit();
        existingGroupPicks = existing;
    }

    if (currentIndex < 11) {
        currentIndex++;
        if (mode === 'casual') loadCasualGroup(currentIndex);
        else loadDetailedGroup(currentIndex);
        window.scrollTo(0, 0);
    } else {
        alert("Snyggt jobbat! Gruppspelet är färdigtippat. Slutspelet låses upp!");
        if (onGroupsComplete) onGroupsComplete();
    }
}

function calcGroupStandings(groupMatches) {
    const tData = {};
    groupMatches.forEach(m => {
        [m.homeTeam, m.awayTeam].forEach(t => { if (!tData[t]) tData[t] = { name: t, pts: 0, gd: 0, gf: 0 }; });
        const h = parseInt(document.getElementById(`wizHome-${m.id}`).value);
        const a = parseInt(document.getElementById(`wizAway-${m.id}`).value);
        tData[m.homeTeam].gf += h; tData[m.awayTeam].gf += a;
        tData[m.homeTeam].gd += (h - a); tData[m.awayTeam].gd += (a - h);
        if (h > a) tData[m.homeTeam].pts += 3; else if (h < a) tData[m.awayTeam].pts += 3; else { tData[m.homeTeam].pts++; tData[m.awayTeam].pts++; }
    });
    return Object.values(tData).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf).map(t => t.name);
}

// Export for bracket to use
export function getGroupPicks() { return existingGroupPicks; }
