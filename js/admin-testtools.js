import { db } from './config.js';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f } from './wizard.js';
import { bumpDataVersion, allMatches, existingResults, currentAdminGroup, renderGroupButtons, renderAdminMatches } from './admin.js';
import { getGroupStandings, renderAdminBracket } from './admin-bracket.js';
import { getGroupLetters, getKnockoutRounds, getFinalRound, getGroupStageConfig, hasStageType } from './tournament-config.js';

const FAKE_NAMES = [
    'Lure Drejeri', 'Bo Ring', 'Anna Conda', 'Sansen Dansen',
    'Bert-Ove Trollström', 'Göran-Göran Sansen', 'Ella Fansen',
    'Nansen Klansen', 'Bansen Kranström', 'Pransen Fjällqvist',
    'Hjansen Vransen', 'Stansen Brankvist', 'Fansen Grenqvist',
    'Dransen Ljungström', 'Klansen Glansen', 'Vransen Panström',
    'Gransen Bansen', 'Transen Kanström', 'Ljansen Stanström',
    'Bransen Pranström', 'Kansen Nansen', 'Glansen Fanström',
    'Fjansen Dranström', 'Pansen Granström', 'Dansen Hjanström',
    'Sansen Trollqvist', 'Kransen Vransen', 'Bert-Ansen Dansen',
    'Göran Granström', 'Nansen Nilström'
];
let fakeNameIdx = 0;

function showToast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}

export async function addFakeTeachers() {
    const statusEl = document.getElementById('admin-fake-status');
    statusEl.textContent = 'Skapar fejklärare...';

    const hasGroups = hasStageType('round-robin-groups');

    // Get teams from groups or from bracket
    let allTeamsList = [];
    const groupTeams = {};
    const groupMatches = allMatches.filter(m => m.stage?.startsWith('Grupp'));

    if (hasGroups) {
        getGroupLetters().forEach(letter => {
            const teams = new Set();
            allMatches.filter(m => m.stage === `Grupp ${letter}`).forEach(m => {
                teams.add(m.homeTeam);
                teams.add(m.awayTeam);
            });
            groupTeams[letter] = Array.from(teams);
        });
        allTeamsList = [...new Set(groupMatches.flatMap(m => [m.homeTeam, m.awayTeam]))];
    } else {
        // Knockout-only: get teams from bracket
        const bracketSnap = await getDoc(doc(db, "matches", "_bracket"));
        const bracket = bracketSnap.exists() ? bracketSnap.data() : { teams: [], rounds: {} };
        allTeamsList = bracket.teams || [];
        if (allTeamsList.length === 0) {
            // Fallback: extract from first round matchups
            const koRounds = getKnockoutRounds();
            if (koRounds.length > 0) {
                const firstRound = bracket.rounds?.[koRounds[0].adminKey] || [];
                firstRound.forEach(m => {
                    if (m.team1) allTeamsList.push(m.team1);
                    if (m.team2) allTeamsList.push(m.team2);
                });
            }
        }
    }

    if (allTeamsList.length === 0) {
        statusEl.textContent = 'Inga lag hittades. Skapa en bracket eller lägg till matcher först.';
        statusEl.style.color = '#dc3545';
        setTimeout(() => { statusEl.textContent = ''; }, 4000);
        return;
    }

    const usersSnap = await getDocs(collection(db, "users"));
    const existingFakeCount = usersSnap.docs.filter(d => d.id.startsWith('fake_')).length;
    fakeNameIdx = existingFakeCount;

    for (let i = 0; i < 10; i++) {
        const name = FAKE_NAMES[(fakeNameIdx + i) % FAKE_NAMES.length];
        const fakeId = `fake_${Date.now()}_${i}`;

        const userData = { email: `${fakeId}@fake.test`, name };

        // Group picks (only if groups exist)
        if (hasGroups) {
            const groupPicks = { mode: 'detailed', completedAt: new Date().toISOString() };
            getGroupLetters().forEach(letter => {
                const teams = [...(groupTeams[letter] || [])].sort(() => Math.random() - 0.5);
                groupPicks[letter] = { first: teams[0], second: teams[1], third: teams[2], fourth: teams[3] };
            });
            userData.groupPicks = groupPicks;

            const matchTips = {};
            groupMatches.forEach(m => {
                matchTips[String(m.id)] = {
                    homeScore: Math.floor(Math.random() * 4),
                    awayScore: Math.floor(Math.random() * 4),
                    homeTeam: m.homeTeam, awayTeam: m.awayTeam,
                    stage: m.stage
                };
            });
            userData.matchTips = matchTips;
        }

        // Knockout picks
        const shuffled = [...allTeamsList].sort(() => Math.random() - 0.5);
        const knockout = {};
        const koRounds = getKnockoutRounds();
        const finalRd = getFinalRound();
        koRounds.forEach(r => {
            const pickCount = r.teams / 2;
            knockout[r.key] = r === finalRd ? shuffled[0] : shuffled.slice(0, pickCount);
        });
        userData.knockout = knockout;

        await setDoc(doc(db, "users", fakeId), userData);
    }

    fakeNameIdx += 10;
    await bumpDataVersion();
    statusEl.textContent = `✓ 10 fejklärare tillagda! (${fakeNameIdx} totalt)`;
    setTimeout(() => { statusEl.textContent = ''; }, 4000);
}

export async function removeFakeTeachers() {
    const statusEl = document.getElementById('admin-fake-status');
    statusEl.textContent = 'Tar bort fejklärare...';

    const usersSnap = await getDocs(collection(db, "users"));
    let removed = 0;

    for (const userDoc of usersSnap.docs) {
        if (!userDoc.id.startsWith('fake_')) continue;

        const tipsSnap = await getDocs(collection(db, "users", userDoc.id, "tips"));
        if (!tipsSnap.empty) {
            const batch = writeBatch(db);
            tipsSnap.forEach(tipDoc => {
                batch.delete(doc(db, "users", userDoc.id, "tips", tipDoc.id));
            });
            await batch.commit();
        }
        const delBatch = writeBatch(db);
        delBatch.delete(doc(db, "users", userDoc.id));
        await delBatch.commit();
        removed++;
    }

    fakeNameIdx = 0;
    await bumpDataVersion();
    statusEl.textContent = `✓ ${removed} fejklärare borttagna!`;
    setTimeout(() => { statusEl.textContent = ''; }, 4000);
}

export async function autoFillGroupResults() {
    const resultsSnap = await getDoc(doc(db, "matches", "_results"));
    const results = resultsSnap.exists() ? resultsSnap.data() : {};

    const groupMatches = allMatches.filter(m => m.stage?.startsWith('Grupp'));
    let filled = 0;
    groupMatches.forEach(m => {
        if (results[m.id]?.homeScore !== undefined) return;
        results[m.id] = {
            homeScore: Math.floor(Math.random() * 5),
            awayScore: Math.floor(Math.random() * 5),
            homeTeam: m.homeTeam, awayTeam: m.awayTeam,
            stage: m.stage, date: m.date
        };
        filled++;
    });

    await setDoc(doc(db, "matches", "_results"), results);
    await bumpDataVersion();
    Object.assign(existingResults, results);
    renderGroupButtons();
    renderAdminMatches(currentAdminGroup);
    showToast(`${filled} gruppresultat autofyllda!`);
}

export async function clearGroupResults() {
    await setDoc(doc(db, "matches", "_results"), {});
    await bumpDataVersion();
    Object.keys(existingResults).forEach(k => delete existingResults[k]);
    renderGroupButtons();
    renderAdminMatches(currentAdminGroup);
    showToast('Alla gruppresultat rensade!');
}

export async function autoFillKnockoutRound(targetRound) {
    const bracketSnap = await getDoc(doc(db, "matches", "_bracket"));
    const bracket = bracketSnap.exists() ? bracketSnap.data() : { teams: [], rounds: {} };
    if (!bracket.rounds) bracket.rounds = {};

    const koRounds = getKnockoutRounds();
    const rounds = koRounds.map(r => r.adminKey);
    const matchCounts = {};
    koRounds.forEach(r => { matchCounts[r.adminKey] = r.teams / 2; });

    const firstRoundKey = rounds[0];
    if (targetRound === firstRoundKey) {
        if (!bracket.rounds[firstRoundKey]) bracket.rounds[firstRoundKey] = [];
        const hasTeams = bracket.rounds[firstRoundKey].some(m => m?.team1);
        if (!hasTeams) {
            if (hasStageType('round-robin-groups')) {
                // Build from group standings
                const standings = getGroupStandings();
                const firsts = [], seconds = [], thirds = [];
                getGroupLetters().forEach(letter => {
                    const s = standings[letter];
                    if (!s || s.length < 2) return;
                    firsts.push(s[0].name);
                    seconds.push(s[1].name);
                    if (s.length >= 3) thirds.push(s[2]);
                });
                thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
                const bestOfRest = getGroupStageConfig()?.qualification?.bestOfRest || 0;
                const qualifiedThirds = thirds.slice(0, bestOfRest).map(t => t.name);
                const allQualified = [...firsts, ...seconds, ...qualifiedThirds];
                const firstMatchCount = matchCounts[firstRoundKey];
                for (let i = 0; i < firstMatchCount; i++) {
                    if (!bracket.rounds[firstRoundKey][i]) bracket.rounds[firstRoundKey][i] = {};
                    bracket.rounds[firstRoundKey][i].team1 = allQualified[i] || '';
                    bracket.rounds[firstRoundKey][i].team2 = allQualified[i + firstMatchCount] || '';
                }
            }
            // For knockout-only: teams are already set from bracket builder, nothing to populate
        }
    } else {
        const prevRoundIdx = rounds.indexOf(targetRound) - 1;
        if (prevRoundIdx >= 0) {
            const prevRound = rounds[prevRoundIdx];
            if (!bracket.rounds[targetRound]) bracket.rounds[targetRound] = [];
            const prevMatches = bracket.rounds[prevRound] || [];
            for (let i = 0; i < prevMatches.length; i++) {
                const m = prevMatches[i];
                if (m?.winner) {
                    const nextIdx = Math.floor(i / 2);
                    if (!bracket.rounds[targetRound][nextIdx]) bracket.rounds[targetRound][nextIdx] = {};
                    if (i % 2 === 0) {
                        bracket.rounds[targetRound][nextIdx].team1 = m.winner;
                    } else {
                        bracket.rounds[targetRound][nextIdx].team2 = m.winner;
                    }
                }
            }
        }
    }

    const count = matchCounts[targetRound];
    let filled = 0;
    for (let i = 0; i < count; i++) {
        if (!bracket.rounds[targetRound]) bracket.rounds[targetRound] = [];
        if (!bracket.rounds[targetRound][i]) bracket.rounds[targetRound][i] = {};
        const match = bracket.rounds[targetRound][i];
        if (!match.team1 || !match.team2) continue;
        if (match.winner) continue;

        let s1, s2;
        do {
            s1 = Math.floor(Math.random() * 4);
            s2 = Math.floor(Math.random() * 4);
        } while (s1 === s2);

        match.score1 = s1;
        match.score2 = s2;
        match.winner = s1 > s2 ? match.team1 : match.team2;
        filled++;
    }

    const roundIdx = rounds.indexOf(targetRound);
    if (roundIdx < rounds.length - 1) {
        const nextRound = rounds[roundIdx + 1];
        if (!bracket.rounds[nextRound]) bracket.rounds[nextRound] = [];
        for (let i = 0; i < count; i++) {
            const match = bracket.rounds[targetRound][i];
            if (!match?.winner) continue;
            const nextIdx = Math.floor(i / 2);
            if (!bracket.rounds[nextRound][nextIdx]) bracket.rounds[nextRound][nextIdx] = {};
            if (i % 2 === 0) {
                bracket.rounds[nextRound][nextIdx].team1 = match.winner;
            } else {
                bracket.rounds[nextRound][nextIdx].team2 = match.winner;
            }
        }
    }

    const fKey = getKnockoutRounds()[0]?.adminKey || 'R32';
    bracket.teams = (bracket.rounds[fKey] || []).flatMap(m => [m.team1, m.team2].filter(Boolean));
    await setDoc(doc(db, "matches", "_bracket"), bracket);
    await bumpDataVersion();
    await renderAdminBracket();
    showToast(`${targetRound}: ${filled} matcher autofyllda!`);
}

export async function clearKnockoutResults() {
    const bracketSnap = await getDoc(doc(db, "matches", "_bracket"));
    const bracket = bracketSnap.exists() ? bracketSnap.data() : { teams: [], rounds: {} };

    const koRounds = getKnockoutRounds();
    koRounds.forEach(r => {
        (bracket.rounds[r.adminKey] || []).forEach(m => {
            delete m.score1; delete m.score2; delete m.winner;
            delete m.score1_leg2; delete m.score2_leg2; delete m.date_leg2;
        });
    });
    koRounds.slice(1).forEach(r => {
        (bracket.rounds[r.adminKey] || []).forEach(m => {
            m.team1 = ''; m.team2 = '';
        });
    });

    await setDoc(doc(db, "matches", "_bracket"), bracket);
    await bumpDataVersion();
    await renderAdminBracket();
    showToast('Slutspelsresultat rensade!');
}

export async function clearKnockoutTeams() {
    await setDoc(doc(db, "matches", "_bracket"), { teams: [], rounds: {} });
    await bumpDataVersion();
    await renderAdminBracket();
    showToast('Hela bracketen rensad!');
}

export async function renderMatchManager() {
    const container = document.getElementById('admin-match-manager');
    container.innerHTML = '<p style="color:#999;">Laddar matcher...</p>';

    const snap = await getDocs(collection(db, "matches"));
    const docs = snap.docs
        .filter(d => !d.id.startsWith('_'))
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
            const stageA = a.stage || '';
            const stageB = b.stage || '';
            if (stageA !== stageB) return stageA.localeCompare(stageB);
            return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
        });

    if (docs.length === 0) {
        container.innerHTML = '<p style="color:#999;">Inga matcher i databasen.</p>';
        return;
    }

    let html = '<div style="max-height: 400px; overflow-y: auto; border: 1px solid #eee; border-radius: 8px;">';
    html += '<table style="width:100%; border-collapse:collapse; font-size:13px;">';
    html += '<thead style="position:sticky; top:0; background:#f8f9fa;"><tr><th style="text-align:left;padding:8px;">ID</th><th style="text-align:left;padding:8px;">Match</th><th style="text-align:left;padding:8px;">Fas</th><th style="text-align:left;padding:8px;">Datum</th><th style="padding:8px;">Ta bort</th></tr></thead><tbody>';

    docs.forEach(m => {
        const home = m.homeTeam || '?';
        const away = m.awayTeam || '?';
        const stage = m.stage || '-';
        const date = m.date || '-';
        html += `<tr style="border-top:1px solid #eee;">
            <td style="padding:6px 8px; font-family:monospace; font-weight:600;">${m.id}</td>
            <td style="padding:6px 8px;">${f(home)}${home} — ${f(away)}${away}</td>
            <td style="padding:6px 8px; color:#666;">${stage}</td>
            <td style="padding:6px 8px; color:#888; font-size:12px;">${date}</td>
            <td style="padding:6px 8px; text-align:center;"><button class="btn btn-delete-match" data-match-id="${m.id}" style="background:#dc3545; font-size:11px; padding:3px 10px;">✕</button></td>
        </tr>`;
    });

    html += '</tbody></table></div>';
    html += `<p style="font-size:12px; color:#888; margin-top:6px;">${docs.length} matcher totalt</p>`;
    container.innerHTML = html;

    container.querySelectorAll('.btn-delete-match').forEach(btn => {
        btn.addEventListener('click', async () => {
            const matchId = btn.dataset.matchId;
            if (!confirm(`Ta bort match "${matchId}"? Denna åtgärd kan inte ångras.`)) return;

            await deleteDoc(doc(db, "matches", matchId));

            if (existingResults[matchId]) {
                delete existingResults[matchId];
                await setDoc(doc(db, "matches", "_results"), existingResults);
            }

            await bumpDataVersion();

            const idx = allMatches.findIndex(m => String(m.id) === matchId);
            if (idx !== -1) allMatches.splice(idx, 1);

            showToast(`Match "${matchId}" borttagen!`);
            renderMatchManager();
            renderGroupButtons();
            renderAdminMatches(currentAdminGroup);
        });
    });
}
