import { db } from './config.js';
import { doc, getDoc, setDoc, collection, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { bumpDataVersion, allMatches, existingResults, currentAdminGroup, renderGroupButtons, renderAdminMatches } from './admin.js';
import { getGroupStandings, renderAdminBracket } from './admin-bracket.js';
import { getGroupLetters, getKnockoutRounds, getFinalRound, getGroupStageConfig, hasStageType, isTwoLegged } from './tournament-config.js';

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

        // Knockout picks + scores
        const shuffled = [...allTeamsList].sort(() => Math.random() - 0.5);
        const knockout = {};
        const knockoutScores = {};
        const koRounds = getKnockoutRounds();
        const finalRd = getFinalRound();
        koRounds.forEach(r => {
            const pickCount = r.teams / 2;
            const picks = r === finalRd ? shuffled[0] : shuffled.slice(0, pickCount);
            knockout[r.key] = picks;
            // Generate random scores for each matchup
            const twoLeg = isTwoLegged(r.key);
            const scores = [];
            for (let mi = 0; mi < pickCount; mi++) {
                const s = { score1: Math.floor(Math.random() * 4), score2: Math.floor(Math.random() * 4) };
                if (twoLeg) {
                    s.score1_leg2 = Math.floor(Math.random() * 4);
                    s.score2_leg2 = Math.floor(Math.random() * 4);
                }
                scores.push(s);
            }
            knockoutScores[r.key] = scores;
        });
        userData.knockout = knockout;
        userData.knockoutScores = knockoutScores;

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

    const roundUserKey = koRounds.find(r => r.adminKey === targetRound)?.key || '';
    const twoLeg = isTwoLegged(roundUserKey);
    const count = matchCounts[targetRound];
    let filled = 0;
    for (let i = 0; i < count; i++) {
        if (!bracket.rounds[targetRound]) bracket.rounds[targetRound] = [];
        if (!bracket.rounds[targetRound][i]) bracket.rounds[targetRound][i] = {};
        const match = bracket.rounds[targetRound][i];
        if (!match.team1 || !match.team2) continue;
        if (match.winner) continue;

        if (twoLeg) {
            match.score1 = Math.floor(Math.random() * 4);
            match.score2 = Math.floor(Math.random() * 4);
            match.score1_leg2 = Math.floor(Math.random() * 4);
            match.score2_leg2 = Math.floor(Math.random() * 4);
            const t1agg = match.score1 + match.score2_leg2;
            const t2agg = match.score2 + match.score1_leg2;
            if (t1agg > t2agg) {
                match.winner = match.team1;
            } else if (t2agg > t1agg) {
                match.winner = match.team2;
            } else {
                // Tied aggregate — random penalty winner
                match.penaltyWinner = Math.random() < 0.5 ? match.team1 : match.team2;
                match.winner = match.penaltyWinner;
            }
        } else {
            let s1, s2;
            do {
                s1 = Math.floor(Math.random() * 4);
                s2 = Math.floor(Math.random() * 4);
            } while (s1 === s2);
            match.score1 = s1;
            match.score2 = s2;
            match.winner = s1 > s2 ? match.team1 : match.team2;
        }
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

// renderMatchManager moved to admin-matches.js
