import { db, auth } from './config.js';
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { invalidateStatsCache } from './stats.js';
import { getGroupLetters } from './tournament-config.js';
import { countryFlags, clubCrestIds, teamImg, teamImgLarge } from './team-data.js';
import { isTipsLockedLive } from './lock-check.js';
import { maybeShowTipsCompleteModal } from './tips-complete-modal.js';

// Flagg-hjälpare — backward-compatible exports
// 'flags' maps team name → flag code (countries) or null (clubs handled by teamImg)
export const flags = { ...countryFlags };
// Add club entries as truthy values so existing code like `flags[t]` works for icon checks
Object.keys(clubCrestIds).forEach(name => { if (!flags[name]) flags[name] = `club:${clubCrestIds[name]}`; });

export const f = (t) => teamImg(t);
export const fLarge = (t) => teamImgLarge(t);
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
let pendingPicks = {}; // Preserve unsaved gruppetta/grupptvåa across mode switches and group nav: { letter: { first, second } }

export async function initWizard(matchesData, onComplete, locked, prefetchedUserData) {
    allMatches = matchesData;
    onGroupsComplete = onComplete;
    tipsLocked = locked;
    const userId = auth.currentUser.uid;

    // Reuse the user doc that app.js already fetched. Falling back to a fresh
    // read only if the caller didn't supply it keeps this module decoupled.
    let userData;
    if (prefetchedUserData) {
        userData = prefetchedUserData;
    } else {
        const userSnap = await getDoc(doc(db, "users", userId));
        userData = userSnap.exists() ? userSnap.data() : {};
    }
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
        if (currentIndex > 0) { persistCurrentGroup(); storeCurrentScores(); currentIndex--; loadGroup(currentIndex); }
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
        ? ''
        : 'Tippa resultatet i varje match — tabellen uppdateras live';

    // Toggle casual layout class on the wizard layout container
    const layout = document.querySelector('.wizard-layout');
    if (layout) layout.classList.toggle('casual-mode', isCasual);

    loadGroup(currentIndex);
}

function switchMode() {
    persistCurrentGroup();
    storeCurrentScores();
    currentMode = currentMode === 'casual' ? 'detailed' : 'casual';
    startMode(currentMode);
}

function storeCurrentScores() {
    const letter = getGroupLetters()[currentIndex];
    const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);
    groupMatches.forEach(m => {
        const hEl = document.getElementById(`wizHome-${m.id}`);
        const aEl = document.getElementById(`wizAway-${m.id}`);
        if (hEl && aEl && hEl.value !== '' && aEl.value !== '') {
            savedScores[m.id] = { h: hEl.value, a: aEl.value };
        }
    });
    // Capture the current gruppetta/grupptvåa selection too so it survives mode
    // switches and group navigation. Otherwise loadGroup() would reset selFirst/
    // selSecond to null and only restore them from Firestore (existingGroupPicks),
    // losing any unsaved picks the user made before switching modes.
    pendingPicks[letter] = { first: selFirst, second: selSecond };
}

// ─── UNIFIED GROUP LOADER ────────────────────────────
function loadGroup(index) {
    const letter = getGroupLetters()[index];
    currentIndex = index;
    document.getElementById('wizard-title').textContent = `Grupp ${letter}`;
    const letters = getGroupLetters();
    document.getElementById('wizard-progress').style.width = `${((index + 1) / letters.length) * 100}%`;

    // Render group quick-jump nav
    renderGroupNav(index);

    selFirst = null; selSecond = null;
    prevFirst = null; prevSecond = null;

    if (existingGroupPicks && existingGroupPicks[letter]) {
        selFirst = existingGroupPicks[letter].first;
        selSecond = existingGroupPicks[letter].second;
    }
    // Pending picks (set by storeCurrentScores when leaving a group/mode)
    // override the saved Firestore picks — they reflect the user's most
    // recent intent, including unsaved edits made just before switching.
    if (pendingPicks[letter]) {
        selFirst = pendingPicks[letter].first;
        selSecond = pendingPicks[letter].second;
    }
    prevFirst = selFirst; prevSecond = selSecond;

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
    getGroupLetters().forEach((letter, i) => {
        const btn = document.createElement('button');
        const hasPick = existingGroupPicks && existingGroupPicks[letter];
        btn.style.cssText = `padding:3px 8px; border-radius:4px; font-size:11px; font-weight:700; cursor:pointer; border:2px solid ${i === activeIndex ? '#1a1a1a' : (hasPick ? '#28a745' : '#ddd')}; background:${i === activeIndex ? '#1a1a1a' : (hasPick ? 'rgba(40,167,69,0.08)' : '#fff')}; color:${i === activeIndex ? '#fff' : '#333'};`;
        btn.textContent = letter;
        btn.addEventListener('click', () => {
            if (i !== currentIndex) { persistCurrentGroup(); storeCurrentScores(); loadGroup(i); }
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
    const isCasual = currentMode === 'casual';

    if (isCasual) {
        // Big 2x2 grid for casual mode
        const pickedCount = (selFirst ? 1 : 0) + (selSecond ? 1 : 0);
        let cta = '';
        if (pickedCount === 0) cta = 'Klicka på det lag du tror vinner gruppen';
        else if (pickedCount === 1) cta = 'Bra! Välj nu tvåan i gruppen';

        container.innerHTML = (cta ? `<p class="casual-cta">${cta}</p>` : '') +
            '<div class="casual-team-grid">' +
            currentTeams.map(team => {
                const cls = team === selFirst ? 'rank-1' : (team === selSecond ? 'rank-2' : '');
                return `<div class="casual-team-card ${cls}" onclick="window.toggleWizTeam('${team}')">
                    <div class="casual-team-flag">${fLarge(team)}</div>
                    <div class="casual-team-name">${team}</div>
                </div>`;
            }).join('') +
            '</div>';
    } else {
        // Original list for detailed mode
        container.innerHTML = '';
        currentTeams.forEach(team => {
            const cls = team === selFirst ? 'rank-1' : (team === selSecond ? 'rank-2' : '');
            container.innerHTML += `<div class="team-chip ${cls}" onclick="window.toggleWizTeam('${team}')">${f(team)}${team}</div>`;
        });
    }
}

function renderMatchCards(groupMatches) {
    const container = document.getElementById('wizard-matches');
    const isCasual = currentMode === 'casual';
    container.innerHTML = '';

    if (isCasual) {
        // Compact match list for casual mode
        container.innerHTML = '<div class="casual-match-list">' +
            groupMatches.map(m => `
                <div class="casual-match-row">
                    <span class="casual-match-date">${m.date || ''}</span>
                    <span class="casual-match-home">${f(m.homeTeam)}${m.homeTeam}</span>
                    <span class="casual-match-score">
                        <input type="number" min="0" id="wizHome-${m.id}" class="score-input casual-score" placeholder="-" disabled>
                        <span>-</span>
                        <input type="number" min="0" id="wizAway-${m.id}" class="score-input casual-score" placeholder="-" disabled>
                    </span>
                    <span class="casual-match-away">${m.awayTeam}${f(m.awayTeam)}</span>
                </div>`).join('') +
            '</div>';

        container.querySelectorAll('.casual-match-row').forEach(row => {
            row.addEventListener('click', onLockedCardClick);
        });
    } else {
        // Full match cards for detailed mode
        groupMatches.forEach(m => {
            container.innerHTML += `
                <div class="match-card">
                    <div class="match-header"><span>${m.date || ''}</span></div>
                    <div class="match-teams">
                        <span class="team-name home" id="wizNameHome-${m.id}">${f(m.homeTeam)}${m.homeTeam}</span>
                        <div class="score-input-group">
                            <input type="number" min="0" id="wizHome-${m.id}" class="score-input" placeholder="-"
                                oninput="window.updateWizTable()">
                            <span style="color:#aaa; font-weight:bold; margin: 0 4px;">:</span>
                            <input type="number" min="0" id="wizAway-${m.id}" class="score-input" placeholder="-"
                                oninput="window.updateWizTable()">
                        </div>
                        <span class="team-name away" id="wizNameAway-${m.id}">${f(m.awayTeam)}${m.awayTeam}</span>
                    </div>
                </div>`;
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
    // In detailed mode the group winner/runner-up is decided by the match
    // results, not by tapping a team. Tapping used to move the highlight without
    // touching the scores, so the pick was silently dropped when saving (the
    // save reads placement from the scores). Steer the user to the results.
    if (currentMode === 'detailed') {
        showToast('I detaljerat läge bestäms etta och tvåa av matchresultaten nedan.');
        return;
    }
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
    // targetStandings is ordered best→worst: [gruppetta, grupptvåa, 3:a, 4:a].
    const [first, second] = targetStandings;
    const letter = getGroupLetters()[currentIndex];
    const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);

    // Roll random scorelines — draws included — and keep the first table that
    // leaves the user's gruppetta clearly 1st and grupptvåa clearly 2nd. Each
    // trial is scored with the exact same rules used when saving
    // (calcFullStandings), so an accepted table can't be reshuffled into a
    // different pick. Requiring a real points/goal-difference gap at the 1:a/2:a
    // and 2:a/3:a lines keeps the winners unambiguous (and matching the live
    // table) — the old code rolled blindly and a fluky four-way tie could fall
    // back to group order, silently overwriting the pick with the group's first
    // two teams.
    const clear = (a, b) => (b.pts - a.pts || b.gd - a.gd) < 0;
    let chosen = null;
    for (let attempt = 0; attempt < 150 && !chosen; attempt++) {
        const trial = groupMatches.map(m => ({
            id: m.id, home: m.homeTeam, away: m.awayTeam,
            hs: Math.floor(Math.random() * 4), as: Math.floor(Math.random() * 4)
        }));
        const table = tableFromTrial(groupMatches, trial);
        const secondClear = !table[2] || clear(table[1], table[2]);
        if (table[0]?.name === first && table[1]?.name === second &&
            clear(table[0], table[1]) && secondClear) {
            chosen = trial;
        }
    }

    // Guaranteed fallback (no draws) if the dice never cooperate: a strict
    // 9-6-3-0 win ladder where the higher-ranked side always wins.
    if (!chosen) {
        const rankOf = {};
        targetStandings.forEach((team, i) => { rankOf[team] = i; });
        chosen = groupMatches.map(m => {
            const win = 1 + Math.floor(Math.random() * 3);
            const lose = Math.floor(Math.random() * win);
            const homeWins = rankOf[m.homeTeam] < rankOf[m.awayTeam];
            return { id: m.id, home: m.homeTeam, away: m.awayTeam,
                hs: homeWins ? win : lose, as: homeWins ? lose : win };
        });
    }

    chosen.forEach(s => {
        const hEl = document.getElementById(`wizHome-${s.id}`);
        const aEl = document.getElementById(`wizAway-${s.id}`);
        if (hEl && aEl) {
            hEl.value = s.hs;
            aEl.value = s.as;
            savedScores[s.id] = { h: s.hs.toString(), a: s.as.toString() };
        }
    });
}

// Standings (with stats) for a trial set of scores — mirrors calcFullStandings
// exactly so the acceptance check matches what actually gets saved.
function tableFromTrial(groupMatches, trial) {
    const tData = {};
    const teams = Array.from(new Set(groupMatches.flatMap(m => [m.homeTeam, m.awayTeam])));
    teams.forEach(t => tData[t] = { name: t, pts: 0, gd: 0, gf: 0 });
    trial.forEach(s => {
        const h = s.hs, a = s.as;
        tData[s.home].gf += h; tData[s.away].gf += a;
        tData[s.home].gd += (h - a); tData[s.away].gd += (a - h);
        if (h > a) tData[s.home].pts += 3; else if (h < a) tData[s.away].pts += 3;
        else { tData[s.home].pts++; tData[s.away].pts++; }
    });
    return Object.values(tData).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
}

// ─── LIVE TABLE ──────────────────────────────────────
function updateWizardTable() {
    const letter = getGroupLetters()[currentIndex];
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
    // Live re-check against Firestore (prevents saves after admin locked)
    if (await isTipsLockedLive()) {
        tipsLocked = true;
        return showToast('Tipsraderna har just låsts av admin. Dina ändringar sparades inte.');
    }
    const letter = getGroupLetters()[currentIndex];
    const userId = auth.currentUser.uid;
    // Was this user already finished before this save? A single-group edit by a
    // completed user must NOT bounce them into the bracket — that broke group-to-
    // group editing and pushed users onto the in-memory-only nav path, losing
    // edits on refresh.
    const wasComplete = !!(existingGroupPicks && existingGroupPicks.completedAt);
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

    // First save for this user — initialise the in-memory picks map.
    // We don't re-fetch: the write below uses dot-notation (`groupPicks.${letter}`)
    // so other fields on the user doc can't be clobbered, and a fresh getDoc
    // here would add a full network round-trip to every early save (painful on
    // slow connections like an iPad on mobile data).
    if (!existingGroupPicks) existingGroupPicks = {};

    const groupData = {
        first: standings[0]?.name, second: standings[1]?.name,
        third: standings[2]?.name, fourth: standings[3]?.name,
        thirdPts: standings[2]?.pts || 0, thirdGd: standings[2]?.gd || 0, thirdGf: standings[2]?.gf || 0
    };

    // Use dot-notation to only update the specific group — never replace the entire groupPicks
    updates[`groupPicks.${letter}`] = groupData;
    updates[`groupPicks.mode`] = currentMode;

    // Check completion against the full known state
    existingGroupPicks[letter] = groupData;
    existingGroupPicks.mode = currentMode;
    const allGroupsDone = getGroupLetters().every(l => existingGroupPicks[l]?.first && existingGroupPicks[l]?.second);
    if (allGroupsDone) {
        updates[`groupPicks.completedAt`] = new Date().toISOString();
        existingGroupPicks.completedAt = new Date().toISOString();
    }

    try {
        await updateDoc(doc(db, "users", userId), updates);
        invalidateStatsCache();
    } catch (e) {
        console.error("Fel vid sparning", e);
        return showToast("Kunde inte spara. Försök igen.");
    }

    if (allGroupsDone && !wasComplete) {
        // First-time completion — unlock and jump straight into the bracket.
        showToast("Snyggt! Gruppspelet klart — slutspelet låses upp!");
        if (onGroupsComplete) onGroupsComplete(true);
        maybeShowTipsCompleteModal();
    } else if (allGroupsDone) {
        // Re-editing an already-complete tipset. Keep the bracket in sync but
        // DON'T yank the user to it — let "Spara & Nästa" walk through groups so
        // every save persists and nothing reverts on refresh.
        if (onGroupsComplete) onGroupsComplete(false);
        const letters = getGroupLetters();
        if (currentIndex < letters.length - 1) {
            showToast("Sparat!");
            storeCurrentScores();
            currentIndex++;
            loadGroup(currentIndex);
            window.scrollTo(0, 0);
        } else {
            showToast("Sparat! Alla grupper klara ✓");
        }
    } else {
        // Find next untipped group, or go to next sequential group
        const letters = getGroupLetters();
        const missingIdx = letters.findIndex(l => !existingGroupPicks[l]?.first);
        if (missingIdx !== -1 && missingIdx !== currentIndex) {
            const remaining = letters.filter(l => !existingGroupPicks[l]?.first).length;
            showToast(`Sparat! ${remaining} grupp${remaining > 1 ? 'er' : ''} kvar att tippa.`);
            storeCurrentScores();
            currentIndex = missingIdx;
            loadGroup(currentIndex);
            window.scrollTo(0, 0);
        } else if (currentIndex < letters.length - 1) {
            storeCurrentScores();
            currentIndex++;
            loadGroup(currentIndex);
            window.scrollTo(0, 0);
        } else {
            // On last group but others missing — jump to first missing
            const firstMissing = letters.findIndex(l => !existingGroupPicks[l]?.first);
            if (firstMissing !== -1) {
                const remaining = letters.filter(l => !existingGroupPicks[l]?.first).length;
                showToast(`Sparat! ${remaining} grupp${remaining > 1 ? 'er' : ''} kvar att tippa.`);
                storeCurrentScores();
                currentIndex = firstMissing;
                loadGroup(currentIndex);
                window.scrollTo(0, 0);
            }
        }
    }
}

// Persist the group currently on screen to Firestore — used when the user
// navigates BETWEEN groups (nav buttons / Föregående / mode switch), not just on
// "Spara & Nästa". Without this, those handlers only kept edits in the in-memory
// savedScores, so a refresh reverted every group that wasn't explicitly saved.
// Reads the DOM synchronously before any await, so it's safe to fire-and-forget
// right before loadGroup() swaps the rendered group.
async function persistCurrentGroup() {
    if (tipsLocked) return;
    const userId = auth.currentUser?.uid;
    if (!userId) return;
    const letter = getGroupLetters()[currentIndex];
    const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);

    const updates = {};
    let anyFilled = true, someFilled = false;
    groupMatches.forEach(m => {
        const h = document.getElementById(`wizHome-${m.id}`)?.value;
        const a = document.getElementById(`wizAway-${m.id}`)?.value;
        if (h === '' || a === '' || h === undefined || a === undefined) { anyFilled = false; return; }
        updates[`matchTips.${m.id}`] = { homeScore: parseInt(h), awayScore: parseInt(a), homeTeam: m.homeTeam, awayTeam: m.awayTeam, stage: m.stage };
        someFilled = true;
    });
    if (!someFilled) return; // nothing entered yet — don't touch saved data

    // Only (re)write the gruppetta/grupptvåa once the whole group is filled, so a
    // half-entered table can't overwrite a previously-saved pick with junk.
    if (anyFilled) {
        const standings = calcFullStandings(groupMatches);
        if (standings[0]?.name && standings[1]?.name) {
            const groupData = {
                first: standings[0].name, second: standings[1].name,
                third: standings[2]?.name, fourth: standings[3]?.name,
                thirdPts: standings[2]?.pts || 0, thirdGd: standings[2]?.gd || 0, thirdGf: standings[2]?.gf || 0
            };
            updates[`groupPicks.${letter}`] = groupData;
            updates[`groupPicks.mode`] = currentMode;
            if (!existingGroupPicks) existingGroupPicks = {};
            existingGroupPicks[letter] = groupData;
            existingGroupPicks.mode = currentMode;
        }
    }

    try {
        await updateDoc(doc(db, "users", userId), updates);
        invalidateStatsCache();
    } catch (e) {
        console.error("Fel vid autosparning av grupp", e);
        showToast("Kunde inte spara. Försök igen.");
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

export function setWizardLocked(locked) {
    tipsLocked = !!locked;
    // If save-button is rendered, disable it
    document.querySelectorAll('#wizard-tab .btn-save-group, #wizard-tab .btn-save, #wizard-tab [data-wizard-save]').forEach(b => { b.disabled = !!locked; });
}
