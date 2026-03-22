import { db, auth } from './config.js';
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f, flags } from './wizard.js';

const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

// Default scoring config - admin can override via _settings.scoring
const DEFAULT_SCORING = {
    matchResult: 1,   // Rätt 1X2
    matchHomeGoals: 1, // Rätt hemmalag mål
    matchAwayGoals: 1, // Rätt bortalag mål
    groupWinner: 1,    // Rätt gruppetta
    groupRunnerUp: 1,  // Rätt grupptvåa
    koR32: 2,          // Rätt lag vidare R32
    koR16: 2,          // Rätt lag vidare R16
    koQF: 2,           // Rätt lag vidare KF
    koSF: 5,           // Rätt lag vidare SF
    koFinal: 10,       // Rätt VM-mästare
    exactScore: 0,     // Bonus för exakt rätt resultat (alla 3 ovan)
    groupThird: 0,     // Rätt grupptrea
};

export { DEFAULT_SCORING };

// Cached data for full leaderboard view
let _cachedScores = null;
let _cachedUsers = null;
let _cachedScoring = null;
let _cachedSettings = null;

export async function loadCommunityStats() {
    const container = document.getElementById('community-stats');
    container.innerHTML = '<p style="text-align:center; color:#999;">Laddar...</p>';

    // Load official results + bracket + settings
    const [resultsSnap, bracketSnap, settingsSnap] = await Promise.all([
        getDoc(doc(db, "matches", "_results")),
        getDoc(doc(db, "matches", "_bracket")),
        getDoc(doc(db, "matches", "_settings"))
    ]);
    const results = resultsSnap.exists() ? resultsSnap.data() : {};
    const bracket = bracketSnap.exists() ? bracketSnap.data() : null;
    const settings = settingsSnap.exists() ? settingsSnap.data() : {};
    const scoring = { ...DEFAULT_SCORING, ...(settings.scoring || {}) };
    const tipsVisible = settings.tipsVisible !== false; // default true

    _cachedSettings = settings;
    _cachedScoring = scoring;

    // Load all users' tips via parent user docs
    const usersSnap = await getDocs(collection(db, "users"));
    const users = [];

    for (const userDoc of usersSnap.docs) {
        const userId = userDoc.id;
        const tipsSnap = await getDocs(collection(db, "users", userId, "tips"));
        const u = { userId, name: userId, groupPicks: null, knockoutPicks: null, matchTips: {} };

        tipsSnap.forEach(tipDoc => {
            if (tipDoc.id === '_groupPicks') u.groupPicks = tipDoc.data();
            else if (tipDoc.id === '_knockout') u.knockoutPicks = tipDoc.data();
            else if (tipDoc.id === '_profile') u.name = tipDoc.data().name || userId;
            else u.matchTips[tipDoc.id] = tipDoc.data();
        });

        if (u.groupPicks || Object.keys(u.matchTips).length > 0) users.push(u);
    }

    _cachedUsers = users;

    if (users.length === 0) {
        container.innerHTML = `<div class="stat-card" style="text-align:center;"><p style="color:#999;">Ingen har tippat ännu. Bli den första!</p></div>`;
        return;
    }

    const currentUserId = auth.currentUser?.uid;
    const playedMatches = Object.entries(results).filter(([, r]) => r.homeScore !== undefined);

    // Build official group standings from results for group winner/runner-up scoring
    const officialGroupStandings = buildOfficialGroupStandings(results);

    const scores = calcLeaderboard(users, results, bracket, scoring, officialGroupStandings);
    scores.sort((a, b) => b.total - a.total);
    _cachedScores = scores;

    let html = '';

    // ── DESKTOP LAYOUT: 2-column on wide screens ──────────
    html += `<div class="dashboard-grid">`;

    // ── LEFT COLUMN: Leaderboard + My Tips ──────────
    html += `<div class="dashboard-left">`;

    // ── LEADERBOARD (top 10 + show more) ──────────
    html += `<div class="stat-card leaderboard-card"><h3>Leaderboard</h3>`;
    html += `<table class="group-table" style="font-size:14px;"><thead><tr><th style="text-align:left;">Namn</th><th>Grupp</th><th>Slutspel</th><th>Totalt</th></tr></thead><tbody>`;

    const myRank = scores.findIndex(s => s.userId === currentUserId);
    const showTop = Math.min(scores.length, 10);

    for (let i = 0; i < showTop; i++) {
        const s = scores[i];
        const isMe = s.userId === currentUserId;
        const medal = i === 0 ? '🥇 ' : (i === 1 ? '🥈 ' : (i === 2 ? '🥉 ' : ''));
        const style = isMe ? 'background:rgba(40,167,69,0.08); font-weight:700;' : '';
        html += `<tr style="${style}"><td style="text-align:left;padding-left:6px;">${medal}${s.name}</td><td>${s.groupPts}</td><td>${s.koPts}</td><td><strong>${s.total}</strong></td></tr>`;
    }

    // If user is outside top 10, show separator + their row
    if (myRank >= 10) {
        const s = scores[myRank];
        html += `<tr style="border-top:2px dashed #ddd;"><td colspan="4" style="text-align:center; color:#999; font-size:11px; padding:4px;">···</td></tr>`;
        html += `<tr style="background:rgba(40,167,69,0.08); font-weight:700;"><td style="text-align:left;padding-left:6px;">${myRank + 1}. ${s.name}</td><td>${s.groupPts}</td><td>${s.koPts}</td><td><strong>${s.total}</strong></td></tr>`;
    }

    html += `</tbody></table>`;
    if (scores.length > 10) {
        html += `<button class="btn" id="btn-full-leaderboard" style="width:100%; margin-top:8px; background:#6c757d; font-size:13px;">Visa hela listan (${scores.length} st)</button>`;
    }
    html += `</div>`;

    // ── MY TIPS (table-aligned) ──────────────────────
    const me = users.find(u => u.userId === currentUserId);
    if (me && me.groupPicks) {
        html += `<h3 style="margin-top:20px;">Min tipsrad</h3>`;
        html += `<div class="stat-card"><table class="my-tips-table">`;
        GROUP_LETTERS.forEach(letter => {
            const pick = me.groupPicks[letter];
            if (!pick) return;
            html += `<tr>
                <td class="mtt-label">Grupp ${letter}</td>
                <td class="mtt-team">${f(pick.first)}${pick.first}</td>
                <td class="mtt-sep">·</td>
                <td class="mtt-team">${f(pick.second)}${pick.second}</td>
            </tr>`;
        });
        html += `</table>`;
        if (me.knockoutPicks?.final) {
            html += `<div style="margin-top:10px; padding-top:8px; border-top:1px solid #eee; font-size:14px; font-weight:700;">🏆 VM-mästare: ${f(me.knockoutPicks.final)}${me.knockoutPicks.final}</div>`;
        }
        html += `</div>`;
    }

    html += `</div>`; // end dashboard-left

    // ── RIGHT COLUMN: Recent Results + Champion Chart ──────
    html += `<div class="dashboard-right">`;

    // ── RECENT RESULTS ──────────────────────────────
    if (playedMatches.length > 0) {
        html += `<h3>Senaste resultat</h3>`;
        const sorted = playedMatches.sort((a, b) => {
            const da = a[1].date || '', db2 = b[1].date || '';
            return db2.localeCompare(da);
        }).slice(0, 6);

        sorted.forEach(([matchId, r]) => {
            const h = r.homeScore, a = r.awayScore;
            const exactTippers = [], winnerTippers = [];

            users.forEach(u => {
                const tip = u.matchTips[matchId];
                if (!tip) return;
                if (tip.homeScore === h && tip.awayScore === a) {
                    exactTippers.push(u.name);
                } else if (sign(tip.homeScore - tip.awayScore) === sign(h - a)) {
                    winnerTippers.push(u.name);
                }
            });

            const hw = h > a ? 'font-weight:800;' : '', aw = a > h ? 'font-weight:800;' : '';
            html += `<div class="stat-card result-card" style="padding:14px; margin-bottom:10px;">`;
            html += `<div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="${hw}">${f(r.homeTeam)}${r.homeTeam}</span>
                <span style="font-size:1.3rem; font-weight:800; letter-spacing:2px;">${h} - ${a}</span>
                <span style="${aw}">${r.awayTeam}${f(r.awayTeam)}</span>
            </div>`;
            if (exactTippers.length > 0) {
                html += `<div style="font-size:12px; color:#28a745; margin-top:4px;">🎯 ${exactTippers.join(' & ')} tipsade exakt rätt!</div>`;
            }
            if (winnerTippers.length > 0) {
                const names = winnerTippers.join(', ');
                html += `<div class="tipper-hover" style="font-size:12px; color:#17a2b8; margin-top:2px; cursor:default; position:relative;">
                    ✓ ${winnerTippers.length} ${winnerTippers.length === 1 ? 'person' : 'andra'} tippade rätt vinnare
                    <span class="tipper-tooltip">${names}</span>
                </div>`;
            }
            if (exactTippers.length === 0 && winnerTippers.length === 0) {
                html += `<div style="font-size:12px; color:#999; margin-top:4px;">Ingen tippade rätt</div>`;
            }
            html += `</div>`;
        });
    }

    // Champion picks
    const champCounts = {};
    users.forEach(u => { if (u.knockoutPicks?.final) champCounts[u.knockoutPicks.final] = (champCounts[u.knockoutPicks.final] || 0) + 1; });
    if (Object.keys(champCounts).length > 0) {
        html += `<div class="stat-card" style="margin-top:10px;"><h3>🏆 Tippade VM-mästare</h3>`;
        const totalC = Object.values(champCounts).reduce((a, b) => a + b, 0);
        Object.entries(champCounts).sort((a, b) => b[1] - a[1]).forEach(([team, count]) => {
            html += renderStatBar(team, Math.round((count / totalC) * 100));
        });
        html += `</div>`;
    }

    // Alla tipsare link (only if tips visible)
    if (tipsVisible) {
        html += `<button class="btn" id="btn-show-all-tips" style="width:100%; margin-top:12px; background:#6c757d; font-size:13px;">Visa alla tipsare (${users.length} st)</button>`;
    }

    html += `</div>`; // end dashboard-right
    html += `</div>`; // end dashboard-grid

    container.innerHTML = html;
    window._allPicks = users.map(u => ({ userId: u.userId, name: u.name, picks: u.groupPicks || {} }));

    // Wire buttons
    const fullLbBtn = document.getElementById('btn-full-leaderboard');
    if (fullLbBtn) fullLbBtn.addEventListener('click', showFullLeaderboard);

    const allTipsBtn = document.getElementById('btn-show-all-tips');
    if (allTipsBtn) allTipsBtn.addEventListener('click', showAllTips);
}

// ── FULL LEADERBOARD VIEW ──────────────────────────
function showFullLeaderboard() {
    const container = document.getElementById('community-stats');
    const scores = _cachedScores;
    const scoring = _cachedScoring;
    if (!scores) return;

    let html = `<button class="btn" id="btn-back-from-lb" style="background:#6c757d; font-size:13px; margin-bottom:12px;">← Tillbaka</button>`;
    html += `<div class="stat-card"><h3>Leaderboard — Detaljerad</h3>`;
    html += `<div style="overflow-x:auto;">`;
    html += `<table class="group-table full-leaderboard" style="font-size:13px;">`;
    html += `<thead><tr>
        <th style="text-align:left;">#</th>
        <th style="text-align:left;">Namn</th>
        <th title="Rätt 1X2">1X2</th>
        <th title="Rätt mål">Mål</th>
        <th title="Exakt resultat">Exakt</th>
        <th title="Rätt gruppetta/tvåa">Grupp</th>
        <th title="Slutspelspoäng">Slutspel</th>
        <th>Totalt</th>
    </tr></thead><tbody>`;

    const currentUserId = auth.currentUser?.uid;
    scores.forEach((s, i) => {
        const isMe = s.userId === currentUserId;
        const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : `${i + 1}`));
        const style = isMe ? 'background:rgba(40,167,69,0.08); font-weight:700;' : '';
        html += `<tr style="${style}">
            <td style="text-align:left;">${medal}</td>
            <td style="text-align:left;">${s.name}</td>
            <td>${s.detail.matchResult || 0}</td>
            <td>${s.detail.matchGoals || 0}</td>
            <td>${s.detail.exactScore || 0}</td>
            <td>${s.detail.groupPlace || 0}</td>
            <td>${s.koPts}</td>
            <td><strong>${s.total}</strong></td>
        </tr>`;
    });

    html += `</tbody></table></div>`;

    // Show scoring legend
    html += `<div style="margin-top:12px; font-size:11px; color:#888;">`;
    html += `<strong>Poängregler:</strong> `;
    html += `1X2 = ${scoring.matchResult}p/match · `;
    html += `Rätt mål = ${scoring.matchHomeGoals}p + ${scoring.matchAwayGoals}p · `;
    if (scoring.exactScore > 0) html += `Exakt = +${scoring.exactScore}p bonus · `;
    html += `Gruppetta = ${scoring.groupWinner}p · Grupptvåa = ${scoring.groupRunnerUp}p · `;
    html += `R32 = ${scoring.koR32}p · R16 = ${scoring.koR16}p · KF = ${scoring.koQF}p · SF = ${scoring.koSF}p · Final = ${scoring.koFinal}p`;
    html += `</div>`;

    html += `</div>`;
    container.innerHTML = html;

    document.getElementById('btn-back-from-lb').addEventListener('click', () => loadCommunityStats());
}

// ── ALL TIPPERS VIEW ──────────────────────────────
function showAllTips() {
    const container = document.getElementById('community-stats');
    const users = _cachedUsers;
    if (!users) return;

    let html = `<button class="btn" id="btn-back-from-tips" style="background:#6c757d; font-size:13px; margin-bottom:12px;">← Tillbaka</button>`;
    html += `<h3>Alla tipsare (${users.length} st)</h3>`;
    html += `<div class="stats-grid" style="margin-bottom: 20px;">`;
    users.forEach(u => {
        const completed = u.groupPicks?.completedAt ? '✅ Klar' : '⏳ Pågår';
        const mode = u.groupPicks?.mode === 'detailed' ? '📊 Detaljerat' : '🎯 Snabbtips';
        html += `<div class="user-tip-card" onclick="window.toggleUserDetail('${u.userId}')">
            <h4>${u.name}</h4>
            <div class="tip-summary">${completed} · ${mode}</div>
            <div id="user-detail-${u.userId}" style="display:none; margin-top:10px;"></div>
        </div>`;
    });
    html += `</div>`;
    container.innerHTML = html;
    window._allPicks = users.map(u => ({ userId: u.userId, name: u.name, picks: u.groupPicks || {} }));

    document.getElementById('btn-back-from-tips').addEventListener('click', () => loadCommunityStats());
}

// ── BUILD OFFICIAL GROUP STANDINGS FROM RESULTS ──────────
function buildOfficialGroupStandings(results) {
    const standings = {};
    const groupResults = {};
    Object.entries(results).forEach(([, r]) => {
        if (!r.stage || !r.stage.startsWith('Grupp ')) return;
        if (r.homeScore === undefined) return;
        const letter = r.stage.replace('Grupp ', '');
        if (!groupResults[letter]) groupResults[letter] = [];
        groupResults[letter].push(r);
    });

    Object.entries(groupResults).forEach(([letter, matches]) => {
        const teams = {};
        matches.forEach(m => {
            if (!teams[m.homeTeam]) teams[m.homeTeam] = { pts: 0, gd: 0, gf: 0 };
            if (!teams[m.awayTeam]) teams[m.awayTeam] = { pts: 0, gd: 0, gf: 0 };
            const h = m.homeScore, a = m.awayScore;
            teams[m.homeTeam].gf += h; teams[m.homeTeam].gd += (h - a);
            teams[m.awayTeam].gf += a; teams[m.awayTeam].gd += (a - h);
            if (h > a) { teams[m.homeTeam].pts += 3; }
            else if (a > h) { teams[m.awayTeam].pts += 3; }
            else { teams[m.homeTeam].pts += 1; teams[m.awayTeam].pts += 1; }
        });
        const sorted = Object.entries(teams).sort((a, b) => b[1].pts - a[1].pts || b[1].gd - a[1].gd || b[1].gf - a[1].gf);
        standings[letter] = { first: sorted[0]?.[0] || null, second: sorted[1]?.[0] || null, third: sorted[2]?.[0] || null };
    });
    return standings;
}

// ── SCORING (returns detailed breakdown) ──────────────
function calcLeaderboard(users, results, bracket, scoring, officialGroupStandings) {
    const officialWinners = {};
    if (bracket?.rounds) {
        ['R32', 'R16', 'KF', 'SF', 'Final'].forEach(round => {
            const key = round === 'KF' ? 'qf' : round.toLowerCase();
            officialWinners[key] = [];
            (bracket.rounds[round] || []).forEach(m => {
                if (m.winner) officialWinners[key].push(m.winner);
            });
        });
    }

    return users.map(u => {
        let groupPts = 0;
        const detail = { matchResult: 0, matchGoals: 0, exactScore: 0, groupPlace: 0 };

        // Score individual match tips
        Object.entries(u.matchTips).forEach(([matchId, tip]) => {
            const r = results[matchId];
            if (!r || r.homeScore === undefined) return;
            const tipSign = sign(tip.homeScore - tip.awayScore);
            const realSign = sign(r.homeScore - r.awayScore);
            if (tipSign === realSign) { groupPts += scoring.matchResult; detail.matchResult += scoring.matchResult; }
            if (tip.homeScore === r.homeScore) { groupPts += scoring.matchHomeGoals; detail.matchGoals += scoring.matchHomeGoals; }
            if (tip.awayScore === r.awayScore) { groupPts += scoring.matchAwayGoals; detail.matchGoals += scoring.matchAwayGoals; }
            if (scoring.exactScore > 0 && tip.homeScore === r.homeScore && tip.awayScore === r.awayScore) {
                groupPts += scoring.exactScore; detail.exactScore += scoring.exactScore;
            }
        });

        // Score group winner/runner-up predictions
        if (u.groupPicks) {
            GROUP_LETTERS.forEach(letter => {
                const pick = u.groupPicks[letter];
                const official = officialGroupStandings[letter];
                if (!pick || !official) return;
                if (official.first && pick.first === official.first) { groupPts += scoring.groupWinner; detail.groupPlace += scoring.groupWinner; }
                if (official.second && pick.second === official.second) { groupPts += scoring.groupRunnerUp; detail.groupPlace += scoring.groupRunnerUp; }
                if (scoring.groupThird > 0 && official.third && pick.third === official.third) { groupPts += scoring.groupThird; detail.groupPlace += scoring.groupThird; }
            });
        }

        let koPts = 0;
        const koKeyMap = { r32: 'koR32', r16: 'koR16', qf: 'koQF', sf: 'koSF', final: 'koFinal' };
        if (u.knockoutPicks) {
            Object.entries(koKeyMap).forEach(([round, scoreKey]) => {
                const winners = officialWinners[round] || [];
                if (winners.length === 0) return;
                const pts = scoring[scoreKey] || 0;
                if (round === 'final') {
                    if (u.knockoutPicks.final && winners.includes(u.knockoutPicks.final)) koPts += pts;
                } else {
                    const userPicks = u.knockoutPicks[round] || [];
                    userPicks.forEach(team => { if (winners.includes(team)) koPts += pts; });
                }
            });
        }

        return { userId: u.userId, name: u.name, groupPts, koPts, total: groupPts + koPts, detail };
    });
}

function sign(n) { return n > 0 ? 1 : (n < 0 ? -1 : 0); }

function renderStatBar(team, pct) {
    return `<div class="stat-bar">
        <span class="stat-bar-label">${f(team)}${team}</span>
        <div style="flex:1; margin: 0 8px;"><div class="stat-bar-fill" style="width: ${Math.max(pct, 3)}%;">${pct > 15 ? pct + '%' : ''}</div></div>
        <span class="stat-bar-pct">${pct}%</span>
    </div>`;
}

window.toggleUserDetail = function (userId) {
    const el = document.getElementById(`user-detail-${userId}`);
    if (el.style.display !== 'none') { el.style.display = 'none'; return; }
    const userPick = window._allPicks?.find(p => p.userId === userId);
    if (!userPick) return;
    let html = '<table class="my-tips-table" style="font-size:12px;">';
    GROUP_LETTERS.forEach(letter => {
        if (userPick.picks[letter]) {
            html += `<tr>
                <td class="mtt-label">Grupp ${letter}</td>
                <td class="mtt-team">${f(userPick.picks[letter].first)}${userPick.picks[letter].first}</td>
                <td class="mtt-sep">·</td>
                <td class="mtt-team">${f(userPick.picks[letter].second)}${userPick.picks[letter].second}</td>
            </tr>`;
        }
    });
    html += '</table>';
    el.innerHTML = html;
    el.style.display = 'block';
};
