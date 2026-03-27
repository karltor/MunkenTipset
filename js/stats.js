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
let _comparisonState = {
    selectedUsers: [],
    viewMode: 'simple' // 'simple' eller 'advanced'
};

// ── localStorage cache helpers ─────────────────────────────────────────────
const STATS_CACHE_KEY = 'munkenbollen_stats_cache_v1';

function _loadStatsCache() {
    try {
        const raw = localStorage.getItem(STATS_CACHE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function _saveStatsCache(dataVersion, payload) {
    try {
        localStorage.setItem(STATS_CACHE_KEY, JSON.stringify({ dataVersion, ...payload }));
    } catch { /* quota exceeded or localStorage unavailable */ }
}

export async function loadCommunityStats() {
    const container = document.getElementById('community-stats');
    container.innerHTML = '<p style="text-align:center; color:#999;">Laddar...</p>';

    // Single cheap read to check if data has changed since last visit
    const settingsSnap = await getDoc(doc(db, "matches", "_settings"));
    const settings = settingsSnap.exists() ? settingsSnap.data() : {};
    const dataVersion = settings.dataVersion || 0;
    const scoring = { ...DEFAULT_SCORING, ...(settings.scoring || {}) };
    const tipsVisible = settings.tipsVisible !== false; // default true
    _cachedSettings = settings;
    _cachedScoring = scoring;

    let results, bracket, users, matchDocs;

    const cached = _loadStatsCache();
    if (cached && cached.dataVersion === dataVersion && Array.isArray(cached.users) && cached.results !== undefined) {
        // Cache hit – no additional reads needed
        results = cached.results;
        bracket = cached.bracket;
        users = cached.users;
        matchDocs = cached.matchDocs;
    } else {
        // Cache miss – full fetch (results, bracket, matches, all user tips)
        const [resultsSnap, bracketSnap, matchesColSnap] = await Promise.all([
            getDoc(doc(db, "matches", "_results")),
            getDoc(doc(db, "matches", "_bracket")),
            getDocs(collection(db, "matches"))
        ]);
        results = resultsSnap.exists() ? resultsSnap.data() : {};
        bracket = bracketSnap.exists() ? bracketSnap.data() : null;
        matchDocs = matchesColSnap.docs.filter(d => !d.id.startsWith('_')).map(d => ({ id: d.id, ...d.data() }));

        // All tips are stored directly on the user doc — one read per user, no subcollections
        const usersSnap = await getDocs(collection(db, "users"));
        users = [];
        for (const userDoc of usersSnap.docs) {
            const d = userDoc.data();
            const u = {
                userId: userDoc.id,
                name: d.name || userDoc.id,
                groupPicks: d.groupPicks || null,
                knockoutPicks: d.knockout || null,
                matchTips: d.matchTips || {}
            };
            if (u.groupPicks || Object.keys(u.matchTips).length > 0) users.push(u);
        }

        _saveStatsCache(dataVersion, { results, bracket, users, matchDocs });
    }

    window._cachedMatchDocs = matchDocs;
    const matchDocMap = {};
    matchDocs.forEach(m => matchDocMap[String(m.id)] = m);

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

    // ── RIGHT COLUMN: Recent Results + Upcoming + Champion Chart ──────
    html += `<div class="dashboard-right">`;

    const now = new Date();
    const roundNames = { 'R32': '32-delsfinal', 'R16': '16-delsfinal', 'KF': 'Kvartsfinal', 'SF': 'Semifinal', 'Final': 'Final' };

    // ── Build combined played matches list ──────────
    const allPlayedMatches = [];

    // Group results (fallback date from match docs for old results without date)
    playedMatches.forEach(([matchId, r]) => {
        const date = r.date || matchDocMap[matchId]?.date;
        allPlayedMatches.push({
            matchId, homeTeam: r.homeTeam, awayTeam: r.awayTeam,
            homeScore: r.homeScore, awayScore: r.awayScore,
            stage: r.stage, date,
            _parsed: parseMatchDate(date), _isKnockout: false
        });
    });

    // Knockout results from bracket
    if (bracket?.rounds) {
        ['R32', 'R16', 'KF', 'SF', 'Final'].forEach((round, ri) => {
            (bracket.rounds[round] || []).forEach((m, mi) => {
                if (m.winner && m.team1 && m.team2 && m.score1 !== undefined) {
                    allPlayedMatches.push({
                        matchId: `ko_${round}_${mi}`, homeTeam: m.team1, awayTeam: m.team2,
                        homeScore: m.score1, awayScore: m.score2,
                        stage: roundNames[round], date: m.date,
                        _parsed: m.date ? parseMatchDate(m.date) : new Date(2026, 6, 1 + ri, mi),
                        _isKnockout: true, _koRound: round,
                        _koRoundKey: round === 'KF' ? 'qf' : round.toLowerCase(),
                        _winner: m.winner
                    });
                }
            });
        });
    }

    allPlayedMatches.sort((a, b) => (b._parsed || 0) - (a._parsed || 0));

    // Select last 4: prefer past matches, fallback to future (testing)
    const pastResults = allPlayedMatches.filter(m => m._parsed && m._parsed <= now);
    const recentResults = pastResults.length > 0 ? pastResults.slice(0, 4) : allPlayedMatches.slice(0, 4);

    // ── RECENT RESULTS (4 senaste) ──────────────────────────────
    if (recentResults.length > 0) {
        html += `<h3>Senaste resultat</h3>`;
        recentResults.forEach(match => {
            const h = match.homeScore, a2 = match.awayScore;
            const hw = h > a2 ? 'font-weight:800;' : '', aw = a2 > h ? 'font-weight:800;' : '';

            html += `<div class="stat-card result-card" style="padding:14px; margin-bottom:10px;">`;

            // Stage + date label
            if (match.stage) {
                html += `<div style="font-size:11px; color:#999; margin-bottom:6px; text-align:center;">${match.stage}${match.date ? ' · ' + match.date : ''}</div>`;
            }

            // Score row — CENTERED with flex:1 on both sides
            html += `<div style="display:flex; align-items:center;">
                <span style="flex:1; text-align:right; ${hw} white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${f(match.homeTeam)}${match.homeTeam}</span>
                <span style="flex:0 0 auto; min-width:80px; text-align:center; font-size:1.3rem; font-weight:800; letter-spacing:2px;">${h} - ${a2}</span>
                <span style="flex:1; text-align:left; ${aw} white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${match.awayTeam}${f(match.awayTeam)}</span>
            </div>`;

            // My tip
            if (me) {
                if (!match._isKnockout) {
                    const myTip = me.matchTips[match.matchId];
                    if (myTip) {
                        const myExact = myTip.homeScore === h && myTip.awayScore === a2;
                        const myWinner = !myExact && sign(myTip.homeScore - myTip.awayScore) === sign(h - a2);
                        const tipStyle = myExact ? 'color:#28a745; font-weight:700;' : (myWinner ? 'color:#17a2b8;' : 'color:#dc3545;');
                        html += `<div style="font-size:12px; ${tipStyle} margin-top:6px; text-align:center;">Ditt tips: ${myTip.homeScore} - ${myTip.awayScore}${myExact ? ' ✨' : (myWinner ? ' ✓' : '')}</div>`;
                    }
                } else if (me.knockoutPicks) {
                    const roundKey = match._koRoundKey;
                    const picks = roundKey === 'final' ? (me.knockoutPicks.final ? [me.knockoutPicks.final] : []) : (me.knockoutPicks[roundKey] || []);
                    const pickedHome = picks.includes(match.homeTeam);
                    const pickedAway = picks.includes(match.awayTeam);
                    if (pickedHome || pickedAway) {
                        const team = pickedHome ? match.homeTeam : match.awayTeam;
                        const correctPick = (pickedHome && match._winner === match.homeTeam) || (pickedAway && match._winner === match.awayTeam);
                        const tipStyle = correctPick ? 'color:#28a745; font-weight:700;' : 'color:#dc3545;';
                        html += `<div style="font-size:12px; ${tipStyle} margin-top:6px; text-align:center;">Du tippade: ${f(team)}${team} vidare${correctPick ? ' ✓' : ''}</div>`;
                    }
                }
            }

            // Tippers analysis
            if (!match._isKnockout) {
                const exactTippers = [], winnerTippers = [];
                users.forEach(u => {
                    if (u.userId === currentUserId) return;
                    const tip = u.matchTips[match.matchId];
                    if (!tip) return;
                    if (tip.homeScore === h && tip.awayScore === a2) exactTippers.push(u.name);
                    else if (sign(tip.homeScore - tip.awayScore) === sign(h - a2)) winnerTippers.push(u.name);
                });
                html += renderTippersSummary(exactTippers, winnerTippers);
            } else {
                const correctPickers = [];
                const roundKey = match._koRoundKey;
                users.forEach(u => {
                    if (u.userId === currentUserId) return;
                    if (!u.knockoutPicks) return;
                    const picks = roundKey === 'final' ? (u.knockoutPicks.final ? [u.knockoutPicks.final] : []) : (u.knockoutPicks[roundKey] || []);
                    if (picks.includes(match._winner)) correctPickers.push(u.name);
                });
                if (correctPickers.length > 0) {
                    html += renderTippersLine('✓', correctPickers, 'tippade rätt', '#17a2b8');
                }
            }

            html += `</div>`;
        });
    }

    // ── UPCOMING MATCHES (4 nästkommande) ──────────────────────────────
    const allUpcoming = [];

    // Unplayed group matches
    allMatchDocs.forEach(m => {
        const hasResult = results[m.id] && results[m.id].homeScore !== undefined;
        if (!hasResult) {
            allUpcoming.push({
                matchId: String(m.id), homeTeam: m.homeTeam, awayTeam: m.awayTeam,
                date: m.date, stage: m.stage,
                _parsed: parseMatchDate(m.date), _isKnockout: false
            });
        }
    });

    // Unplayed knockout matches from bracket
    if (bracket?.rounds) {
        ['R32', 'R16', 'KF', 'SF', 'Final'].forEach((round, ri) => {
            (bracket.rounds[round] || []).forEach((m, mi) => {
                if (m.team1 && m.team2 && !m.winner) {
                    allUpcoming.push({
                        matchId: `ko_${round}_${mi}`, homeTeam: m.team1, awayTeam: m.team2,
                        date: m.date, stage: roundNames[round],
                        _parsed: m.date ? parseMatchDate(m.date) : new Date(2026, 6, 1 + ri, mi),
                        _isKnockout: true,
                        _koRoundKey: round === 'KF' ? 'qf' : round.toLowerCase()
                    });
                }
            });
        });
    }

    allUpcoming.sort((a, b) => (a._parsed || Infinity) - (b._parsed || Infinity));
    const futureUpcoming = allUpcoming.filter(m => m._parsed && m._parsed > now);
    const upcomingMatches = futureUpcoming.length > 0 ? futureUpcoming.slice(0, 4) : allUpcoming.slice(0, 4);

    // Tournament state detection
    const tournamentOver = bracket?.rounds?.Final?.some(m => m.winner) || false;
    const allGroupsDone = allMatchDocs.length > 0 && allMatchDocs.every(m => results[m.id] && results[m.id].homeScore !== undefined);
    const hasKnockoutScheduled = bracket?.rounds && Object.values(bracket.rounds).some(round => round?.some(m => m.team1 && m.team2));

    html += `<h3>Kommande matcher</h3>`;
    if (upcomingMatches.length > 0) {
        upcomingMatches.forEach(match => {
            html += `<div class="stat-card upcoming-card" style="padding:14px; margin-bottom:10px; border-left:3px solid #ffc107;">`;

            // Stage + date
            html += `<div style="font-size:11px; color:#999; margin-bottom:6px; text-align:center;">${match.stage || ''}${match.date ? ' · ' + match.date : ''}</div>`;

            // Teams row — centered with "vs"
            html += `<div style="display:flex; align-items:center;">
                <span style="flex:1; text-align:right; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${f(match.homeTeam)}${match.homeTeam}</span>
                <span style="flex:0 0 auto; min-width:80px; text-align:center; font-size:1rem; color:#999; font-weight:600;">vs</span>
                <span style="flex:1; text-align:left; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${match.awayTeam}${f(match.awayTeam)}</span>
            </div>`;

            // My tip
            if (me) {
                if (!match._isKnockout) {
                    const myTip = me.matchTips[match.matchId];
                    if (myTip) {
                        html += `<div style="font-size:12px; color:#555; margin-top:6px; text-align:center;">Ditt tips: <strong>${myTip.homeScore} - ${myTip.awayScore}</strong></div>`;
                    } else {
                        html += `<div style="font-size:12px; color:#ccc; margin-top:6px; text-align:center;">Inte tippat ännu</div>`;
                    }
                } else if (me.knockoutPicks) {
                    const roundKey = match._koRoundKey;
                    const picks = roundKey === 'final' ? (me.knockoutPicks.final ? [me.knockoutPicks.final] : []) : (me.knockoutPicks[roundKey] || []);
                    const pickedHome = picks.includes(match.homeTeam);
                    const pickedAway = picks.includes(match.awayTeam);
                    if (pickedHome || pickedAway) {
                        const team = pickedHome ? match.homeTeam : match.awayTeam;
                        html += `<div style="font-size:12px; color:#555; margin-top:6px; text-align:center;">Du tippade: ${f(team)}${team} vidare</div>`;
                    }
                }
            }

            html += `</div>`;
        });
    } else if (tournamentOver) {
        html += `<div class="stat-card" style="text-align:center; padding:30px;">
            <div style="font-size:2.5rem; margin-bottom:12px;">⚽🏆</div>
            <p style="font-size:16px; font-weight:700; margin:0;">Nästa match? Dröm vidare!</p>
            <p style="color:#888; margin:8px 0 0; font-size:14px;">Vi ses om 4 år i nästa upplaga av MunkenTipset 🍻</p>
        </div>`;
    } else if (allGroupsDone && !hasKnockoutScheduled) {
        html += `<div class="stat-card" style="text-align:center; padding:30px;">
            <div style="font-size:2rem; margin-bottom:12px;">⏳</div>
            <p style="font-size:15px; font-weight:700; margin:0;">Inväntar att Jonas publicerar slutspelsmatcher...</p>
            <p style="color:#888; margin:8px 0 0; font-size:13px;">Gruppspelet är avklarat! Slutspelet kommer snart.</p>
        </div>`;
    } else {
        html += `<div class="stat-card" style="text-align:center; padding:20px;">
            <p style="color:#999; margin:0;">Inga kommande matcher just nu</p>
        </div>`;
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

    // Sortera användare alfabetiskt
    const sortedUsers = [...users].sort((a, b) => a.name.localeCompare(b.name));

    let html = `<button class="btn" id="btn-back-from-tips" style="background:#6c757d; font-size:13px; margin-bottom:12px;">← Tillbaka</button>`;
    html += `<h3>Jämför Tipsare (${users.length} st)</h3>`;

    // ── KONTROLLPANEL ──
    html += `<div class="stat-card" style="margin-bottom:20px; display:flex; flex-wrap:wrap; gap:20px;">`;

    // Val av Vy
    html += `<div style="flex:1; min-width:200px;">
        <label style="font-weight:700; font-size:13px; display:block; margin-bottom:8px; color:#555;">1. Välj vy:</label>
        <div class="tabs" style="border:none; margin:0; padding:0; gap:5px;">
            <button class="tab-btn active" id="btn-view-simple" style="padding:8px 12px; font-size:13px; flex:1;">Enkel (Grupper)</button>
            <button class="tab-btn" id="btn-view-advanced" style="padding:8px 12px; font-size:13px; flex:1;">Avancerad (Matcher)</button>
        </div>
    </div>`;

    // Val av Användare (Scrollbar Multiselect)
    html += `<div style="flex:2; min-width:250px;">
        <label style="font-weight:700; font-size:13px; display:block; margin-bottom:8px; color:#555;">2. Välj tipsare att jämföra:</label>
        <div style="max-height:140px; overflow-y:auto; border:1px solid #e0e0e0; border-radius:8px; padding:10px; background:#fbfbfb; display:grid; grid-template-columns:repeat(auto-fill, minmax(160px, 1fr)); gap:8px;">`;

    sortedUsers.forEach(u => {
        const isChecked = _comparisonState.selectedUsers.includes(u.userId) ? 'checked' : '';
        html += `<label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer; background:white; padding:4px 8px; border-radius:4px; border:1px solid #eee;">
            <input type="checkbox" class="user-compare-cb" value="${u.userId}" ${isChecked}>
            <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${u.name}">${u.name}</span>
        </label>`;
    });

    html += `</div></div>`;
    html += `</div>`; // Slut Kontrollpanel

    // Container för själva tabellen
    html += `<div id="comparison-table-container" class="stat-card" style="padding:0; overflow-x:auto;">
        <p style="text-align:center; color:#888; padding:30px;">Välj minst en tipsare ovan för att se tabellen.</p>
    </div>`;

    container.innerHTML = html;

    // ── EVENT LISTENERS ──
    document.getElementById('btn-back-from-tips').addEventListener('click', () => loadCommunityStats());

    const simpleBtn = document.getElementById('btn-view-simple');
    const advBtn = document.getElementById('btn-view-advanced');

    simpleBtn.addEventListener('click', () => {
        _comparisonState.viewMode = 'simple';
        simpleBtn.classList.add('active');
        advBtn.classList.remove('active');
        renderComparisonTable();
    });

    advBtn.addEventListener('click', () => {
        _comparisonState.viewMode = 'advanced';
        advBtn.classList.add('active');
        simpleBtn.classList.remove('active');
        renderComparisonTable();
    });

    const checkboxes = document.querySelectorAll('.user-compare-cb');
    checkboxes.forEach(cb => {
        cb.addEventListener('change', (e) => {
            const id = e.target.value;
            if (e.target.checked) {
                if (!_comparisonState.selectedUsers.includes(id)) _comparisonState.selectedUsers.push(id);
            } else {
                _comparisonState.selectedUsers = _comparisonState.selectedUsers.filter(uid => uid !== id);
            }
            renderComparisonTable();
        });
    });

    // Förivälj inloggad användare om listan är tom
    const currentUserId = auth.currentUser?.uid;
    if (currentUserId && _comparisonState.selectedUsers.length === 0) {
        const myCb = document.querySelector(`.user-compare-cb[value="${currentUserId}"]`);
        if (myCb) {
            myCb.checked = true;
            _comparisonState.selectedUsers.push(currentUserId);
        }
    }

    // Rita ut direkt om användare finns i statet
    if (_comparisonState.selectedUsers.length > 0) {
        renderComparisonTable();
    }
}

function renderComparisonTable() {
    const container = document.getElementById('comparison-table-container');
    const selectedIds = _comparisonState.selectedUsers;

    if (selectedIds.length === 0) {
        container.innerHTML = `<p style="text-align:center; color:#888; padding:30px;">Välj minst en tipsare ovan för att se tabellen.</p>`;
        return;
    }

    const users = _cachedUsers.filter(u => selectedIds.includes(u.userId));

    // Skapa en tabell som stöder horisontell scroll
    let html = `<table class="group-table" style="width:100%; min-width:${selectedIds.length * 140 + 200}px; border-collapse: separate; border-spacing: 0;">`;

    // ── HEADER (Sticky Left) ──
    html += `<thead><tr>`;
    html += `<th style="text-align:left; position:sticky; left:0; background:#1a1a1a; color:white; z-index:2; box-shadow: 2px 0 5px rgba(0,0,0,0.1);">Fas</th>`;
    users.forEach(u => {
        html += `<th style="background:#1a1a1a; color:white; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:140px;">${u.name}</th>`;
    });
    html += `</tr></thead><tbody style="font-size:13px;">`;

    if (_comparisonState.viewMode === 'simple') {
        // --- ENKEL VY (Bara Grupper + Finalist) ---
        GROUP_LETTERS.forEach(letter => {
            html += `<tr>`;
            html += `<td style="font-weight:700; position:sticky; left:0; background:#f4f7f6; z-index:1; border-right:2px solid #ddd; box-shadow: 2px 0 5px rgba(0,0,0,0.05);">Grupp ${letter}</td>`;
            
            users.forEach(u => {
                const picks = u.groupPicks ? u.groupPicks[letter] : null;
                if (picks && picks.first && picks.second) {
                    html += `<td style="background:white;">
                        <div style="display:flex; flex-direction:column; gap:6px; align-items:flex-start; padding-left:10px;">
                            <span style="white-space:nowrap;" title="Etta">🥇 ${f(picks.first)}${picks.first}</span>
                            <span style="white-space:nowrap; color:#555;" title="Tvåa">🥈 ${f(picks.second)}${picks.second}</span>
                        </div>
                    </td>`;
                } else {
                    html += `<td style="color:#ccc; text-align:center; background:white;">-</td>`;
                }
            });
            html += `</tr>`;
        });

        // Vinnare
        html += `<tr>`;
        html += `<td style="font-weight:700; position:sticky; left:0; background:#fffdf5; z-index:1; border-right:2px solid #ddd; color:#d4a017; box-shadow: 2px 0 5px rgba(0,0,0,0.05);">🏆 VM-mästare</td>`;
        users.forEach(u => {
            const final = u.knockoutPicks?.final;
            if (final) {
                html += `<td style="background:#fffdf5; font-weight:700; color:#d4a017;">${f(final)}${final}</td>`;
            } else {
                html += `<td style="background:#fffdf5; color:#ccc; text-align:center;">-</td>`;
            }
        });
        html += `</tr>`;

    } else {
        // --- AVANCERAD VY (Alla Matcher) ---
        const matchDocs = window._cachedMatchDocs || [];
        
        // Gruppera efter stage (Grupp A, Grupp B osv)
        const groupedMatches = {};
        matchDocs.forEach(m => {
            const stage = m.stage || 'Övrigt';
            if (!groupedMatches[stage]) groupedMatches[stage] = [];
            groupedMatches[stage].push(m);
        });

        const stages = Object.keys(groupedMatches).sort();

        if (stages.length === 0) {
             html += `<tr><td colspan="${users.length + 1}" style="text-align:center; color:#888;">Laddar matcher... / Inga matcher hittades.</td></tr>`;
        }

        stages.forEach(stage => {
            // Sektionsrubrik (T.ex. "Grupp A")
            html += `<tr><td colspan="${users.length + 1}" style="background:#e9ecef; font-weight:700; text-align:center; padding:6px; font-size:12px; position:sticky; left:0; z-index:1;">${stage}</td></tr>`;

        groupedMatches[stage].sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true })).forEach(m => {
                html += `<tr>`;
                
                // Matchinfo (Sticky)
                html += `<td style="position:sticky; left:0; background:#f4f7f6; z-index:1; border-right:2px solid #ddd; box-shadow: 2px 0 5px rgba(0,0,0,0.05);">
                    <div style="font-size:10px; color:#888; margin-bottom:4px;">${m.date || ''}</div>
                    <div style="display:flex; justify-content:space-between; font-weight:600; font-size:12px;">
                        <span>${f(m.homeTeam)}${m.homeTeam}</span>
                        <span style="color:#aaa; margin:0 4px;">-</span>
                        <span>${m.awayTeam}${f(m.awayTeam)}</span>
                    </div>
                </td>`;

                // Tipsarens resultat
                users.forEach(u => {
                    const tip = u.matchTips ? u.matchTips[m.id] : null;
                    if (tip && tip.homeScore !== undefined) {
                        html += `<td style="font-size:16px; font-weight:800; text-align:center; background:white;">
                            ${tip.homeScore} - ${tip.awayScore}
                        </td>`;
                    } else {
                        html += `<td style="color:#ccc; text-align:center; background:white;">-</td>`;
                    }
                });
                html += `</tr>`;
            });
        });
    }

    html += `</tbody></table>`;
    container.innerHTML = html;
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

// Parse date like "18 juni 21:00" relative to 2026
function parseMatchDate(dateStr) {
    if (!dateStr) return null;
    const months = { 'januari': 0, 'februari': 1, 'mars': 2, 'april': 3, 'maj': 4, 'juni': 5, 'juli': 6, 'augusti': 7, 'september': 8, 'oktober': 9, 'november': 10, 'december': 11 };
    const parts = dateStr.trim().match(/^(\d+)\s+(\w+)\s+(\d{1,2}):(\d{2})$/);
    if (!parts) return null;
    const day = parseInt(parts[1]);
    const month = months[parts[2].toLowerCase()];
    if (month === undefined) return null;
    return new Date(2026, month, day, parseInt(parts[3]), parseInt(parts[4]));
}

function renderTippersSummary(exactTippers, winnerTippers) {
    let html = '';
    if (exactTippers.length > 0) {
        html += renderTippersLine('🎯', exactTippers, 'tippade exakt rätt', '#28a745');
    }
    if (winnerTippers.length > 0) {
        html += renderTippersLine('✓', winnerTippers, 'tippade rätt vinnare', '#17a2b8');
    }
    if (exactTippers.length === 0 && winnerTippers.length === 0) {
        html += `<div style="font-size:12px; color:#999; margin-top:4px; text-align:center;">Ingen tippade rätt</div>`;
    }
    return html;
}

function renderTippersLine(icon, names, suffix, color) {
    if (names.length <= 3) {
        const joined = names.length <= 2 ? names.join(' & ') : names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1];
        return `<div style="font-size:12px; color:${color}; margin-top:4px; text-align:center;">${icon} ${joined} ${suffix}</div>`;
    }

    // Skapa en kopia och slumpa ordningen på namnen
    let displayNames = [...names].sort(() => 0.5 - Math.random());
    
    let tooltipText = "";
    const MAX_NAMES = 10; // Max antal namn att visa i rutan
    
    if (displayNames.length > MAX_NAMES) {
        const selected = displayNames.slice(0, MAX_NAMES);
        const hiddenCount = displayNames.length - MAX_NAMES;
        // Ex: "Anna, Bert, Carl (och 12 fler)"
        tooltipText = selected.join(', ') + ` <br><span style="color:#aaa;">(och ${hiddenCount} fler)</span>`;
    } else {
        tooltipText = displayNames.join(', ');
    }

    return `<div class="tipper-hover" style="font-size:12px; color:${color}; margin-top:4px; cursor:default; text-align:center;">
        ${icon} ${names.length} st ${suffix}
        <span class="tipper-tooltip">${tooltipText}</span>
    </div>`;
}

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
