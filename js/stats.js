import { db, auth } from './config.js';
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f } from './wizard.js';
import { DEFAULT_SCORING, buildOfficialGroupStandings, calcLeaderboard, sign, parseMatchDate, renderStatBar, renderTippersSummary, renderTippersLine } from './scoring.js';
import { initCompareState, showFullLeaderboard, showAllTips } from './compare.js';

export { DEFAULT_SCORING };

export function invalidateStatsCache() {
    try { localStorage.removeItem(STATS_CACHE_KEY); } catch { /* noop */ }
}

const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

// ── localStorage cache helpers ─────────────────────────────────────────────
const STATS_CACHE_KEY = 'munkentipset_stats_cache_v1';

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

export async function loadCommunityStats(prefetchedSettings) {
    const container = document.getElementById('community-stats');
    container.innerHTML = '<p style="text-align:center; color:#999;">Laddar...</p>';

    // Reuse settings from app.js if available, otherwise fetch (1 read)
    let settings;
    if (prefetchedSettings) {
        settings = prefetchedSettings;
    } else {
        const settingsSnap = await getDoc(doc(db, "matches", "_settings"));
        settings = settingsSnap.exists() ? settingsSnap.data() : {};
    }
    const dataVersion = settings.dataVersion || 0;
    const scoring = { ...DEFAULT_SCORING, ...(settings.scoring || {}) };
    const tipsVisible = settings.tipsVisible !== false; // default true
    // Settings and scoring are passed to compare module via initCompareState

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

    if (users.length === 0) {
        container.innerHTML = `<div class="stat-card" style="text-align:center;"><p style="color:#999;">Ingen har tippat ännu. Bli den första!</p></div>`;
        return;
    }

    const currentUserId = auth.currentUser?.uid;
    const playedMatches = Object.entries(results).filter(([, r]) => r.homeScore !== undefined);

    // Build official group standings from results for group winner/runner-up scoring
    const officialGroupStandings = buildOfficialGroupStandings(results, matchDocs);

    const scores = calcLeaderboard(users, results, bracket, scoring, officialGroupStandings);
    scores.sort((a, b) => b.total - a.total);

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
    // Build official knockout winners for color-coding
    const officialKoWinners = {};
    if (bracket?.rounds) {
        ['R32', 'R16', 'KF', 'SF', 'Final'].forEach(round => {
            const key = round === 'KF' ? 'qf' : round.toLowerCase();
            officialKoWinners[key] = [];
            (bracket.rounds[round] || []).forEach(m => {
                if (m.winner) officialKoWinners[key].push(m.winner);
            });
        });
    }
    // Build set of teams eliminated per round (lost in that round)
    const eliminatedInRound = {};
    if (bracket?.rounds) {
        ['R32', 'R16', 'KF', 'SF', 'Final'].forEach(round => {
            const key = round === 'KF' ? 'qf' : round.toLowerCase();
            eliminatedInRound[key] = [];
            (bracket.rounds[round] || []).forEach(m => {
                if (m.winner && m.team1 && m.team2) {
                    const loser = m.winner === m.team1 ? m.team2 : m.team1;
                    eliminatedInRound[key].push(loser);
                }
            });
        });
    }

    const me = users.find(u => u.userId === currentUserId);
    if (me && me.groupPicks) {
        html += `<h3 style="margin-top:20px;">Min tipsrad</h3>`;
        html += `<div class="stat-card"><table class="my-tips-table">`;
        GROUP_LETTERS.forEach(letter => {
            const pick = me.groupPicks[letter];
            if (!pick) return;
            const official = officialGroupStandings[letter];
            let firstColor = '', secondColor = '';
            if (official && official.complete) {
                firstColor = pick.first === official.first ? 'color:#28a745;' : 'color:#dc3545;';
                secondColor = pick.second === official.second ? 'color:#28a745;' : 'color:#dc3545;';
            }
            html += `<tr>
                <td class="mtt-label">Grupp ${letter}</td>
                <td class="mtt-team" style="${firstColor}">${f(pick.first)}${pick.first}</td>
                <td class="mtt-sep">·</td>
                <td class="mtt-team" style="${secondColor}">${f(pick.second)}${pick.second}</td>
            </tr>`;
        });
        html += `</table>`;

        // Show knockout picks summary with color-coding
        if (me.knockoutPicks) {
            const ko = me.knockoutPicks;
            const koRounds = [
                { key: 'r32', label: 'Åttondelsfinal' },
                { key: 'r16', label: 'Kvartsfinal' },
                { key: 'qf', label: 'Semifinal' },
                { key: 'sf', label: 'Final' }
            ];

            html += `<div style="margin-top:12px; padding-top:10px; border-top:1px solid #eee;">`;
            html += `<h4 style="margin:0 0 8px; font-size:14px; color:#555;">Slutspelstips</h4>`;

            koRounds.forEach(round => {
                const picks = ko[round.key];
                if (!picks || picks.length === 0) return;
                const winners = officialKoWinners[round.key] || [];
                // A team is wrong if it was eliminated in a previous round (never reached this round)
                // Collect all teams eliminated before this round
                const roundOrder = ['r32', 'r16', 'qf', 'sf', 'final'];
                const thisIdx = roundOrder.indexOf(round.key);
                const eliminatedBefore = new Set();
                for (let ri = 0; ri < thisIdx; ri++) {
                    (eliminatedInRound[roundOrder[ri]] || []).forEach(t => eliminatedBefore.add(t));
                }

                html += `<div style="margin-bottom:8px;">`;
                html += `<div style="font-size:11px; font-weight:700; color:#888; margin-bottom:4px;">Vidare till ${round.label} (${picks.length} lag)</div>`;
                html += `<div style="display:flex; flex-wrap:wrap; gap:4px;">`;
                picks.forEach(team => {
                    let color = '';
                    if (winners.length > 0 && winners.includes(team)) {
                        color = 'color:#28a745; border-color:#28a745;'; // correct - advanced
                    } else if (eliminatedBefore.has(team)) {
                        color = 'color:#dc3545; border-color:#dc3545;'; // eliminated before reaching this round
                    } else if (winners.length > 0 && !winners.includes(team)) {
                        // Round has results but team not in winners — could still be pending if not all matches played
                        // Check if team was eliminated in this round
                        if ((eliminatedInRound[round.key] || []).includes(team)) {
                            color = 'color:#dc3545; border-color:#dc3545;';
                        }
                    }
                    html += `<span style="font-size:12px; background:#f4f7f6; padding:2px 8px; border-radius:4px; border:1px solid #e0e0e0; white-space:nowrap; ${color}">${f(team)}${team}</span>`;
                });
                html += `</div></div>`;
            });

            if (ko.final) {
                const finalWinners = officialKoWinners['final'] || [];
                let champStyle = 'background:linear-gradient(135deg, #fffdf5, #fff8e1); border:1px solid #ffc107;';
                if (finalWinners.length > 0) {
                    champStyle = finalWinners.includes(ko.final)
                        ? 'background:linear-gradient(135deg, #e8f5e9, #c8e6c9); border:2px solid #28a745; color:#28a745;'
                        : 'background:linear-gradient(135deg, #fce8e6, #f8d7da); border:2px solid #dc3545; color:#dc3545;';
                }
                html += `<div style="margin-top:10px; padding:10px; border-radius:8px; text-align:center; font-size:15px; font-weight:700; ${champStyle}">🏆 VM-mästare: ${f(ko.final)}${ko.final}</div>`;
            }
            html += `</div>`;
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

    // Once knockout has started, only show knockout results
    const hasKnockoutResults = allPlayedMatches.some(m => m._isKnockout);
    const relevantMatches = hasKnockoutResults ? allPlayedMatches.filter(m => m._isKnockout) : allPlayedMatches;

    // Select last 4: prefer past matches, fallback to future (testing)
    const pastResults = relevantMatches.filter(m => m._parsed && m._parsed <= now);
    const recentResults = pastResults.length > 0 ? pastResults.slice(0, 4) : relevantMatches.slice(0, 4);

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
    matchDocs.forEach(m => {
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
    const allGroupsDone = matchDocs.length > 0 && matchDocs.every(m => results[m.id] && results[m.id].homeScore !== undefined);
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

    // Update compare module state
    initCompareState(users, scores, scoring, loadCommunityStats);

    // Wire buttons
    const fullLbBtn = document.getElementById('btn-full-leaderboard');
    if (fullLbBtn) fullLbBtn.addEventListener('click', showFullLeaderboard);

    const allTipsBtn = document.getElementById('btn-show-all-tips');
    if (allTipsBtn) allTipsBtn.addEventListener('click', showAllTips);
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

