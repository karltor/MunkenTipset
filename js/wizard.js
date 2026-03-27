import { db, auth } from './config.js';
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// Flagg-hjälpare
export const flags = { "Mexiko": "mx", "Sydafrika": "za", "Sydkorea": "kr", "Kanada": "ca", "USA": "us", "Paraguay": "py", "Qatar": "qa", "Schweiz": "ch", "Brasilien": "br", "Marocko": "ma", "Haiti": "ht", "Skottland": "gb-sct", "Australien": "au", "Tyskland": "de", "Curaçao": "cw", "Nederländerna": "nl", "Japan": "jp", "Elfenbenskusten": "ci", "Ecuador": "ec", "Tunisien": "tn", "Spanien": "es", "Kap Verde": "cv", "Belgien": "be", "Egypten": "eg", "Saudiarabien": "sa", "Uruguay": "uy", "Iran": "ir", "Nya Zeeland": "nz", "Frankrike": "fr", "Senegal": "sn", "Norge": "no", "Argentina": "ar", "Algeriet": "dz", "Österrike": "at", "Jordanien": "jo", "Portugal": "pt", "England": "gb-eng", "Kroatien": "hr", "Ghana": "gh", "Panama": "pa", "Uzbekistan": "uz", "Colombia": "co" };
export const f = (t) => flags[t] ? `<img src="https://flagcdn.com/20x15/${flags[t]}.png" style="vertical-align:middle; margin-right:6px; border-radius:2px; box-shadow: 0 1px 3px rgba(0,0,0,0.2);" width="20" height="15" alt="">` : '🌍 ';

const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
let currentIndex = 0;
let currentTeams = [];
let selFirst = null, selSecond = null;
let prevFirst = null, prevSecond = null;
let allMatches = [];
let currentMode = null;
let existingGroupPicks = null;
let onGroupsComplete = null;
let tipsLocked = false;
let savedScores = {}; // Preserve scores across mode switches: { matchId: { h, a } }

export async function initWizard(matchesData, onComplete, locked) {
    allMatches = matchesData;
    onGroupsComplete = onComplete;
    tipsLocked = locked;
    const userId = auth.currentUser.uid;

    // Read all tips from the user doc (single read)
    const userSnap = await getDoc(doc(db, "users", userId));
    const userData = userSnap.exists() ? userSnap.data() : {};
    existingGroupPicks = userData.groupPicks || null;
    const storedTips = userData.matchTips || {};

    // Populate savedScores so they show when editing
    Object.entries(storedTips).forEach(([matchId, data]) => {
        if (data.homeScore !== undefined && data.awayScore !== undefined) {
            savedScores[matchId] = { h: data.homeScore.toString(), a: data.awayScore.toString() };
        }
    });

    if (existingGroupPicks && existingGroupPicks.completedAt) {
        document.getElementById('wizard-already-done').style.display = 'flex';
        document.getElementById('wizard-mode-select').style.display = 'none';
        document.getElementById('wizard-content').style.display = 'none';
        document.getElementById('btn-edit-tips').onclick = () => {
            if (tipsLocked) return showToast('Tipsraderna är låsta av admin.');
            document.getElementById('wizard-already-done').style.display = 'none';
            startMode(existingGroupPicks.mode || 'casual');
        };
    } else if (existingGroupPicks) {
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
        if (currentIndex > 0) { storeCurrentScores(); currentIndex--; loadGroup(currentIndex); }
    });
}

// ─── TOAST ───────────────────────────────────────────
function showToast(msg) {
    let toast = document.getElementById('wiz-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'wiz-toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.remove('show');
    void toast.offsetWidth;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// ─── MODE MANAGEMENT ─────────────────────────────────
function startMode(mode) {
    currentMode = mode;
    document.getElementById('wizard-mode-select').style.display = 'none';
    document.getElementById('wizard-already-done').style.display = 'none';
    document.getElementById('wizard-content').style.display = 'block';

    const isCasual = mode === 'casual';
    document.getElementById('btn-switch-mode').textContent = isCasual ? '📊 Byt till Detaljerat' : '🎯 Byt till Snabbtips';
    document.getElementById('wizard-mode-label').textContent = isCasual
        ? 'Klicka på etta 🏆 och tvåa 🥈 — resultat genereras automatiskt'
        : 'Tippa resultatet i varje match — tabellen uppdateras live';
    loadGroup(currentIndex);
}

function switchMode() {
    storeCurrentScores();
    currentMode = currentMode === 'casual' ? 'detailed' : 'casual';
    startMode(currentMode);
}

function storeCurrentScores() {
    const letter = GROUP_LETTERS[currentIndex];
    const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);
    groupMatches.forEach(m => {
        const hEl = document.getElementById(`wizHome-${m.id}`);
        const aEl = document.getElementById(`wizAway-${m.id}`);
        if (hEl && aEl && hEl.value !== '' && aEl.value !== '') {
            savedScores[m.id] = { h: hEl.value, a: aEl.value };
        }
    });
}

// ─── UNIFIED GROUP LOADER ────────────────────────────
function loadGroup(index) {
    const letter = GROUP_LETTERS[index];
    currentIndex = index;
    document.getElementById('wizard-title').textContent = `Grupp ${letter}`;
    document.getElementById('wizard-progress').style.width = `${((index + 1) / 12) * 100}%`;

    // Render group quick-jump nav
    renderGroupNav(index);

    selFirst = null; selSecond = null;
    prevFirst = null; prevSecond = null;

    if (existingGroupPicks && existingGroupPicks[letter]) {
        selFirst = existingGroupPicks[letter].first;
        selSecond = existingGroupPicks[letter].second;
        prevFirst = selFirst; prevSecond = selSecond;
    }

    const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);
    currentTeams = Array.from(new Set(groupMatches.flatMap(m => [m.homeTeam, m.awayTeam])));

    renderTeamSelectors();
    renderMatchCards(groupMatches);

    // Restore saved scores first, then auto-fill only if no scores exist
    let hasScores = restoreSavedScores(groupMatches);
    if (!hasScores && currentMode === 'casual' && selFirst && selSecond) {
        autoFillScores();
    }

    window.updateWizTable = updateWizardTable;
    updateWizardTable();

    // When switching to casual with existing scores, derive selFirst/selSecond from actual standings
    if (hasScores && currentMode === 'casual') {
        const standings = calcFullStandings(groupMatches);
        if (standings[0]?.pts > 0) {
            selFirst = standings[0].name;
            selSecond = standings[1].name;
            renderTeamSelectors();
        }
    }
}

function renderGroupNav(activeIndex) {
    let nav = document.getElementById('wizard-group-nav');
    if (!nav) {
        nav = document.createElement('div');
        nav.id = 'wizard-group-nav';
        nav.style.cssText = 'display:flex; gap:4px; flex-wrap:wrap; margin-bottom:8px;';
        const titleEl = document.getElementById('wizard-title');
        titleEl.parentNode.insertBefore(nav, titleEl);
    }
    nav.innerHTML = '';
    GROUP_LETTERS.forEach((letter, i) => {
        const btn = document.createElement('button');
        const hasPick = existingGroupPicks && existingGroupPicks[letter];
        btn.style.cssText = `padding:3px 8px; border-radius:4px; font-size:11px; font-weight:700; cursor:pointer; border:2px solid ${i === activeIndex ? '#1a1a1a' : (hasPick ? '#28a745' : '#ddd')}; background:${i === activeIndex ? '#1a1a1a' : (hasPick ? 'rgba(40,167,69,0.08)' : '#fff')}; color:${i === activeIndex ? '#fff' : '#333'};`;
        btn.textContent = letter;
        btn.addEventListener('click', () => {
            if (i !== currentIndex) { storeCurrentScores(); loadGroup(i); }
        });
        nav.appendChild(btn);
    });
}

function restoreSavedScores(groupMatches) {
    let restored = false;
    groupMatches.forEach(m => {
        if (savedScores[m.id]) {
            const hEl = document.getElementById(`wizHome-${m.id}`);
            const aEl = document.getElementById(`wizAway-${m.id}`);
            if (hEl && aEl) { hEl.value = savedScores[m.id].h; aEl.value = savedScores[m.id].a; restored = true; }
        }
    });
    return restored;
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
                            ${isCasual ? 'disabled' : ''} oninput="window.updateWizTable()">
                        <span style="color:#aaa; font-weight:bold; margin: 0 4px;">:</span>
                        <input type="number" min="0" id="wizAway-${m.id}" class="score-input" placeholder="-"
                            ${isCasual ? 'disabled' : ''} oninput="window.updateWizTable()">
                    </div>
                    <span class="team-name away" id="wizNameAway-${m.id}">${f(m.awayTeam)}${m.awayTeam}</span>
                </div>
            </div>`;
    });

    // Attach click listeners on locked cards for toast
    if (isCasual) {
        container.querySelectorAll('.match-card.locked').forEach(card => {
            card.addEventListener('click', onLockedCardClick);
        });
    }
}

function onLockedCardClick() {
    showToast('Byt till Detaljerat läge för att ändra matchresultat');
    const btn = document.getElementById('btn-switch-mode');
    btn.classList.add('highlight-pulse');
    setTimeout(() => btn.classList.remove('highlight-pulse'), 1500);
}

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
    const changed = (prevFirst && prevFirst !== selFirst) || (prevSecond && prevSecond !== selSecond);
    prevFirst = selFirst; prevSecond = selSecond;
    if (!changed) return;
    // Trigger smooth re-render of table rows (handled by CSS transition)
    const rows = document.querySelectorAll('#wizard-live-table tr[data-team]');
    rows.forEach(r => { r.classList.add('row-shift'); setTimeout(() => r.classList.remove('row-shift'), 500); });
}

// ─── SCORE GENERATION ────────────────────────────────
function autoFillScores() {
    if (!selFirst || !selSecond) return;
    const unselected = currentTeams.filter(t => t !== selFirst && t !== selSecond);
    generateAndFillScores([selFirst, selSecond, unselected[0], unselected[1]]);
}

function smartAutoFill() {
    if (!selFirst || !selSecond) return showToast("Välj gruppetta och grupptvåa först!");
    autoFillScores();
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
    allMatches.filter(m => m.stage === `Grupp ${letter}`).forEach(m => {
        const sim = scores.find(s =>
            (map[s.hId] === m.homeTeam && map[s.aId] === m.awayTeam) ||
            (map[s.aId] === m.homeTeam && map[s.hId] === m.awayTeam)
        );
        if (sim) {
            const hEl = document.getElementById(`wizHome-${m.id}`);
            const aEl = document.getElementById(`wizAway-${m.id}`);
            if (map[sim.hId] === m.homeTeam) { hEl.value = sim.h; aEl.value = sim.a; }
            else { hEl.value = sim.a; aEl.value = sim.h; }
            savedScores[m.id] = { h: hEl.value, a: aEl.value };
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
        const bg = i === 0 ? 'background-color: rgba(40,167,69,0.1);' : (i === 1 ? 'background-color: rgba(23,162,184,0.05);' : '');
        html += `<tr data-team="${t.name}" class="table-row-anim" style="${bg}"><td style="padding-left:5px;">${f(t.name)}${t.name}</td><td>${t.pld}</td><td>${t.gd > 0 ? '+' + t.gd : t.gd}</td><td><strong>${t.pts}</strong></td></tr>`;
    });
    const liveTable = document.getElementById('wizard-live-table');
    if (liveTable) liveTable.innerHTML = html + `</tbody></table>`;

    if (currentMode === 'detailed' && sorted[0].pld > 0) {
        const newFirst = sorted[0].name, newSecond = sorted[1].name;
        if (selFirst !== newFirst || selSecond !== newSecond) {
            selFirst = newFirst; selSecond = newSecond;
            renderTeamSelectors();
            checkForRankChange();
        }
    }
}

// ─── SAVE ────────────────────────────────────────────
async function saveAndNext() {
    if (tipsLocked) return showToast('Tipsraderna är låsta av admin.');
    const letter = GROUP_LETTERS[currentIndex];
    const userId = auth.currentUser.uid;
    if (!selFirst || !selSecond) return showToast("Välj gruppetta och grupptvåa först!");

    const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);
    let allFilled = true;
    const updates = {};
    groupMatches.forEach(m => {
        const h = document.getElementById(`wizHome-${m.id}`)?.value;
        const a = document.getElementById(`wizAway-${m.id}`)?.value;
        if (h === '' || a === '' || h === undefined) { allFilled = false; return; }
        updates[`matchTips.${m.id}`] = { homeScore: parseInt(h), awayScore: parseInt(a), homeTeam: m.homeTeam, awayTeam: m.awayTeam, stage: m.stage };
    });

    if (!allFilled && currentMode === 'detailed') return showToast("Fyll i alla matchresultat först!");
    if (!allFilled && currentMode === 'casual') autoFillScores();

    const standings = calcFullStandings(groupMatches);
    const existing = existingGroupPicks || {};
    existing[letter] = {
        first: standings[0]?.name, second: standings[1]?.name,
        third: standings[2]?.name, fourth: standings[3]?.name,
        thirdPts: standings[2]?.pts || 0, thirdGd: standings[2]?.gd || 0, thirdGf: standings[2]?.gf || 0
    };
    existing.mode = currentMode;
    if (currentIndex === 11) existing.completedAt = new Date().toISOString();
    updates.groupPicks = existing;

    try {
        await updateDoc(doc(db, "users", userId), updates);
        existingGroupPicks = existing;
    } catch (e) {
        console.error("Fel vid sparning", e);
        return showToast("Kunde inte spara. Försök igen.");
    }

    if (currentIndex < 11) {
        storeCurrentScores();
        currentIndex++;
        loadGroup(currentIndex);
        window.scrollTo(0, 0);
    } else {
        showToast("Snyggt! Gruppspelet klart — slutspelet låses upp!");
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
        if (!hVal || hVal === '' || aVal === '') return;
        const h = parseInt(hVal), a = parseInt(aVal);
        tData[m.homeTeam].gf += h; tData[m.awayTeam].gf += a;
        tData[m.homeTeam].gd += (h - a); tData[m.awayTeam].gd += (a - h);
        if (h > a) tData[m.homeTeam].pts += 3; else if (h < a) tData[m.awayTeam].pts += 3;
        else { tData[m.homeTeam].pts++; tData[m.awayTeam].pts++; }
    });
    return Object.values(tData).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
}

export function getGroupPicks() { return existingGroupPicks; }
