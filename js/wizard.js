import { db, auth } from './config.js';
import { doc, getDoc, setDoc, getDocs, collection, writeBatch } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// Flagg-hjälpare
export const flags = { "Mexiko": "mx", "Sydafrika": "za", "Sydkorea": "kr", "Kanada": "ca", "USA": "us", "Paraguay": "py", "Qatar": "qa", "Schweiz": "ch", "Brasilien": "br", "Marocko": "ma", "Haiti": "ht", "Skottland": "gb-sct", "Australien": "au", "Tyskland": "de", "Curaçao": "cw", "Nederländerna": "nl", "Japan": "jp", "Elfenbenskusten": "ci", "Ecuador": "ec", "Tunisien": "tn", "Spanien": "es", "Kap Verde": "cv", "Belgien": "be", "Egypten": "eg", "Saudiarabien": "sa", "Uruguay": "uy", "Iran": "ir", "Nya Zeeland": "nz", "Frankrike": "fr", "Senegal": "sn", "Norge": "no", "Argentina": "ar", "Algeriet": "dz", "Österrike": "at", "Jordanien": "jo", "Portugal": "pt", "England": "gb-eng", "Kroatien": "hr", "Ghana": "gh", "Panama": "pa", "Uzbekistan": "uz", "Colombia": "co" };
export const f = (t) => flags[t] ? `<img src="https://flagcdn.com/20x15/${flags[t]}.png" style="vertical-align:middle; margin-right:6px; border-radius:2px; box-shadow: 0 1px 3px rgba(0,0,0,0.2);" width="20" height="15" alt="">` : '🌍 ';

const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
let currentIndex = 0;
let currentTeams = [];
let selFirst = null;
let selSecond = null;
let prevFirst = null; // Track previous for blink detection
let prevSecond = null;
let allMatches = [];
let currentMode = null; // 'casual' or 'detailed'
let existingGroupPicks = null;
let onGroupsComplete = null;
let tipsLocked = false;

export async function initWizard(matchesData, onComplete, locked) {
    allMatches = matchesData;
    onGroupsComplete = onComplete;
    tipsLocked = locked;

    const userId = auth.currentUser.uid;

    // Check for existing tips in new format (_groupPicks)
    const metaRef = doc(db, "users", userId, "tips", "_groupPicks");
    const metaSnap = await getDoc(metaRef);
    if (metaSnap.exists()) {
        existingGroupPicks = metaSnap.data();
    } else {
        // Fallback: check old format (individual match tips)
        const tipsSnap = await getDocs(collection(db, "users", userId, "tips"));
        const matchTips = [];
        tipsSnap.forEach(d => {
            if (!d.id.startsWith('_')) matchTips.push(d.data());
        });
        if (matchTips.length > 0) {
            // Migrate old tips to new format
            existingGroupPicks = migrateOldTips(matchTips);
            await setDoc(metaRef, existingGroupPicks, { merge: true });
        }
    }

    if (existingGroupPicks && existingGroupPicks.completedAt) {
        document.getElementById('wizard-already-done').style.display = 'flex';
        document.getElementById('wizard-mode-select').style.display = 'none';
        document.getElementById('wizard-content').style.display = 'none';
        document.getElementById('btn-edit-tips').onclick = () => {
            if (tipsLocked) return alert('Tipsraderna är låsta av admin.');
            document.getElementById('wizard-already-done').style.display = 'none';
            startMode(existingGroupPicks.mode || 'casual');
        };
    } else if (existingGroupPicks) {
        // Partially completed — resume
        startMode(existingGroupPicks.mode || 'casual');
    } else {
        document.getElementById('wizard-mode-select').style.display = 'block';
    }

    document.getElementById('mode-casual').addEventListener('click', () => startMode('casual'));
    document.getElementById('mode-detailed').addEventListener('click', () => startMode('detailed'));
    document.getElementById('btn-switch-mode').addEventListener('click', switchMode);
    document.getElementById('btn-smart-random').addEventListener('click', smartAutoFill);
    document.getElementById('btn-save-group').addEventListener('click', saveAndNext);
    document.getElementById('btn-prev-group').addEventListener('click', () => {
        if (currentIndex > 0) { currentIndex--; loadGroup(currentIndex); }
    });
}

function migrateOldTips(matchTips) {
    const picks = { mode: 'detailed' };
    const groups = {};
    matchTips.forEach(m => {
        const letter = m.stage?.replace('Grupp ', '');
        if (!letter || !GROUP_LETTERS.includes(letter)) return;
        if (!groups[letter]) groups[letter] = [];
        groups[letter].push(m);
    });

    Object.keys(groups).forEach(letter => {
        const tData = {};
        groups[letter].forEach(m => {
            [m.homeTeam, m.awayTeam].forEach(t => { if (!tData[t]) tData[t] = { name: t, pts: 0, gd: 0, gf: 0 }; });
            tData[m.homeTeam].gf += m.homeScore; tData[m.awayTeam].gf += m.awayScore;
            tData[m.homeTeam].gd += (m.homeScore - m.awayScore); tData[m.awayTeam].gd += (m.awayScore - m.homeScore);
            if (m.homeScore > m.awayScore) tData[m.homeTeam].pts += 3;
            else if (m.homeScore < m.awayScore) tData[m.awayTeam].pts += 3;
            else { tData[m.homeTeam].pts++; tData[m.awayTeam].pts++; }
        });
        const sorted = Object.values(tData).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
        if (sorted.length >= 2) {
            picks[letter] = { first: sorted[0].name, second: sorted[1].name };
        }
    });

    const completedGroups = Object.keys(picks).filter(k => GROUP_LETTERS.includes(k));
    if (completedGroups.length === 12) picks.completedAt = new Date().toISOString();
    return picks;
}

function startMode(mode) {
    currentMode = mode;
    currentIndex = 0;
    document.getElementById('wizard-mode-select').style.display = 'none';
    document.getElementById('wizard-already-done').style.display = 'none';
    document.getElementById('wizard-content').style.display = 'block';

    const isCasual = mode === 'casual';
    document.getElementById('btn-switch-mode').textContent = isCasual ? '📊 Byt till Detaljerat' : '🎯 Byt till Snabbtips';
    document.getElementById('wizard-mode-label').textContent = isCasual ? 'Snabbtips-läge' : 'Detaljerat läge';
    document.getElementById('btn-smart-random').style.display = isCasual ? 'block' : 'block';

    const cta = document.getElementById('wizard-cta');
    if (isCasual) {
        cta.style.background = '#e8f5e9';
        cta.style.color = '#2e7d32';
        cta.innerHTML = 'Klicka på det lag du tror kommer <strong>etta</strong> 🏆 och sedan <strong>tvåa</strong> 🥈. Matchresultat genereras automatiskt.';
    } else {
        cta.style.background = '#e3f2fd';
        cta.style.color = '#1565c0';
        cta.innerHTML = 'Tippa resultatet i varje match. Tabellen uppdateras live!';
    }

    loadGroup(0);
}

function switchMode() {
    startMode(currentMode === 'casual' ? 'detailed' : 'casual');
}

// ─── UNIFIED GROUP LOADER ────────────────────────────
function loadGroup(index) {
    const letter = GROUP_LETTERS[index];
    currentIndex = index;
    document.getElementById('wizard-title').textContent = `Grupp ${letter}`;
    document.getElementById('wizard-progress').style.width = `${((index + 1) / 12) * 100}%`;

    selFirst = null;
    selSecond = null;
    prevFirst = null;
    prevSecond = null;

    // Restore existing picks
    if (existingGroupPicks && existingGroupPicks[letter]) {
        selFirst = existingGroupPicks[letter].first;
        selSecond = existingGroupPicks[letter].second;
        prevFirst = selFirst;
        prevSecond = selSecond;
    }

    const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);
    currentTeams = Array.from(new Set(groupMatches.flatMap(m => [m.homeTeam, m.awayTeam])));

    renderTeamSelectors();
    renderMatchCards(groupMatches);

    if (currentMode === 'casual' && selFirst && selSecond) {
        autoFillScores();
    }

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

function renderMatchCards(groupMatches) {
    const container = document.getElementById('wizard-matches');
    const isCasual = currentMode === 'casual';
    container.innerHTML = '';

    groupMatches.forEach(m => {
        container.innerHTML += `
            <div class="match-card ${isCasual ? 'locked' : ''}">
                <div class="match-header"><span>${m.date || ''}</span></div>
                <div class="match-teams">
                    <span class="team-name home" id="wizNameHome-${m.id}">${f(m.homeTeam)}${m.homeTeam}</span>
                    <div class="score-input-group">
                        <input type="number" min="0" id="wizHome-${m.id}" class="score-input" placeholder="-"
                            ${isCasual ? 'disabled' : ''} oninput="window.updateWizTable()" onfocus="window.onScoreFocus(this)">
                        <span style="color:#aaa; font-weight:bold; margin: 0 4px;">:</span>
                        <input type="number" min="0" id="wizAway-${m.id}" class="score-input" placeholder="-"
                            ${isCasual ? 'disabled' : ''} oninput="window.updateWizTable()" onfocus="window.onScoreFocus(this)">
                    </div>
                    <span class="team-name away" id="wizNameAway-${m.id}">${f(m.awayTeam)}${m.awayTeam}</span>
                </div>
            </div>`;
    });
}

window.onScoreFocus = function (el) {
    if (currentMode === 'casual' && el.disabled) {
        alert('Byt till Detaljerat läge för att ändra enskilda matchresultat.');
    }
};

window.toggleWizTeam = function (team) {
    if (selFirst === team) selFirst = null;
    else if (selSecond === team) selSecond = null;
    else if (!selFirst) selFirst = team;
    else if (!selSecond) selSecond = team;
    renderTeamSelectors();

    if (currentMode === 'casual' && selFirst && selSecond) {
        autoFillScores();
        updateWizardTable();
        checkForRankChange();
    }
};

function checkForRankChange() {
    if ((prevFirst && prevFirst !== selFirst) || (prevSecond && prevSecond !== selSecond)) {
        const table = document.getElementById('wizard-live-table');
        if (table) {
            table.classList.remove('rank-changed');
            void table.offsetWidth; // Force reflow
            table.classList.add('rank-changed');
            setTimeout(() => table.classList.remove('rank-changed'), 1500);
        }
    }
    prevFirst = selFirst;
    prevSecond = selSecond;
}

// ─── AUTO-FILL SCORES (for casual mode) ──────────────
function autoFillScores() {
    if (!selFirst || !selSecond) return;
    const unselected = currentTeams.filter(t => t !== selFirst && t !== selSecond);
    const target = [selFirst, selSecond, unselected[0], unselected[1]];
    generateAndFillScores(target);
}

function smartAutoFill() {
    if (!selFirst || !selSecond) return alert("Välj gruppetta och grupptvåa först!");
    const unselected = currentTeams.filter(t => t !== selFirst && t !== selSecond);
    generateAndFillScores([selFirst, selSecond, unselected[0], unselected[1]]);
    updateWizardTable();
}

function generateAndFillScores(targetStandings) {
    let slots = [{ id: 0, pts: 0, gd: 0, gf: 0 }, { id: 1, pts: 0, gd: 0, gf: 0 }, { id: 2, pts: 0, gd: 0, gf: 0 }, { id: 3, pts: 0, gd: 0, gf: 0 }];
    const simMatches = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];
    const scores = [];

    simMatches.forEach(match => {
        const hs = Math.floor(Math.random() * 4), as = Math.floor(Math.random() * 4);
        scores.push({ hId: match[0], aId: match[1], h: hs, a: as });
        let h = slots[match[0]], a = slots[match[1]];
        h.gf += hs; a.gf += as; h.gd += (hs - as); a.gd += (as - hs);
        if (hs > as) h.pts += 3; else if (as > hs) a.pts += 3; else { h.pts++; a.pts++; }
    });

    slots.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    const map = {};
    slots.forEach((s, i) => map[s.id] = targetStandings[i]);

    const letter = GROUP_LETTERS[currentIndex];
    const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);

    groupMatches.forEach(m => {
        const sim = scores.find(s =>
            (map[s.hId] === m.homeTeam && map[s.aId] === m.awayTeam) ||
            (map[s.aId] === m.homeTeam && map[s.hId] === m.awayTeam)
        );
        if (sim) {
            const hEl = document.getElementById(`wizHome-${m.id}`);
            const aEl = document.getElementById(`wizAway-${m.id}`);
            if (map[sim.hId] === m.homeTeam) { hEl.value = sim.h; aEl.value = sim.a; }
            else { hEl.value = sim.a; aEl.value = sim.h; }
        }
    });
}

// ─── LIVE TABLE ──────────────────────────────────────
function updateWizardTable() {
    const letter = GROUP_LETTERS[currentIndex];
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

    // In detailed mode, update selFirst/selSecond from table and check for rank changes
    if (currentMode === 'detailed' && sorted[0].pld > 0) {
        const newFirst = sorted[0].name;
        const newSecond = sorted[1].name;
        if (selFirst !== newFirst || selSecond !== newSecond) {
            selFirst = newFirst;
            selSecond = newSecond;
            renderTeamSelectors();
            checkForRankChange();
        }
    }
}

// ─── SAVE TO FIREBASE ────────────────────────────────
async function saveAndNext() {
    if (tipsLocked) return alert('Tipsraderna är låsta av admin.');

    const letter = GROUP_LETTERS[currentIndex];
    const userId = auth.currentUser.uid;

    if (!selFirst || !selSecond) return alert("Välj gruppetta och grupptvåa först!");

    const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);
    const batch = writeBatch(db);

    // Save match scores (both modes — casual has auto-generated scores)
    let allFilled = true;
    groupMatches.forEach(m => {
        const h = document.getElementById(`wizHome-${m.id}`)?.value;
        const a = document.getElementById(`wizAway-${m.id}`)?.value;
        if (h === '' || a === '' || h === undefined) { allFilled = false; return; }
        const tipRef = doc(db, "users", userId, "tips", m.id.toString());
        batch.set(tipRef, { homeScore: parseInt(h), awayScore: parseInt(a), homeTeam: m.homeTeam, awayTeam: m.awayTeam, stage: m.stage });
    });

    if (!allFilled && currentMode === 'detailed') return alert("Fyll i alla matchresultat först!");
    if (!allFilled && currentMode === 'casual') autoFillScores(); // Shouldn't happen but safety

    // Calculate full standings (all 4 positions)
    const standings = calcFullStandings(groupMatches);

    // Save group pick summary
    const picksRef = doc(db, "users", userId, "tips", "_groupPicks");
    const existing = existingGroupPicks || {};
    existing[letter] = {
        first: standings[0]?.name,
        second: standings[1]?.name,
        third: standings[2]?.name,
        fourth: standings[3]?.name,
        thirdPts: standings[2]?.pts || 0,
        thirdGd: standings[2]?.gd || 0,
        thirdGf: standings[2]?.gf || 0
    };
    existing.mode = currentMode;
    if (currentIndex === 11) existing.completedAt = new Date().toISOString();
    batch.set(picksRef, existing, { merge: true });

    try {
        await batch.commit();
        existingGroupPicks = existing;
    } catch (e) {
        console.error("Fel vid sparning", e);
        return alert("Kunde inte spara. Försök igen.");
    }

    if (currentIndex < 11) {
        currentIndex++;
        loadGroup(currentIndex);
        window.scrollTo(0, 0);
    } else {
        alert("Snyggt jobbat! Gruppspelet är färdigtippat. Slutspelet låses upp!");
        if (onGroupsComplete) onGroupsComplete();
    }
}

function calcFullStandings(groupMatches) {
    const tData = {};
    const teams = Array.from(new Set(groupMatches.flatMap(m => [m.homeTeam, m.awayTeam])));
    teams.forEach(t => tData[t] = { name: t, pts: 0, gd: 0, gf: 0 });

    groupMatches.forEach(m => {
        const hVal = document.getElementById(`wizHome-${m.id}`)?.value;
        const aVal = document.getElementById(`wizAway-${m.id}`)?.value;
        if (hVal === '' || aVal === '' || !hVal) return;
        const h = parseInt(hVal), a = parseInt(aVal);
        tData[m.homeTeam].gf += h; tData[m.awayTeam].gf += a;
        tData[m.homeTeam].gd += (h - a); tData[m.awayTeam].gd += (a - h);
        if (h > a) tData[m.homeTeam].pts += 3; else if (h < a) tData[m.awayTeam].pts += 3;
        else { tData[m.homeTeam].pts++; tData[m.awayTeam].pts++; }
    });

    return Object.values(tData).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
}

export function getGroupPicks() { return existingGroupPicks; }
