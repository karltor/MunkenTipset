import { db, auth } from './config.js';
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f } from './wizard.js';
import { DEFAULT_SCORING, buildDefaultScoring, buildOfficialGroupStandings, calcLeaderboard, sign, parseMatchDate, renderStatBar, renderTippersSummary, renderTippersLine } from './scoring.js';
import { initCompareState, showFullLeaderboard, showAllTips } from './compare.js';
import { getGroupLetters, getKnockoutRounds, getTournamentName, getTournamentYear, hasStageType, isTwoLegged, getSpecialQuestionsConfig, hasSpecialQuestions } from './tournament-config.js';

export { DEFAULT_SCORING };

export function invalidateStatsCache() {
    try { localStorage.removeItem(STATS_CACHE_KEY); } catch { /* noop */ }
}

// ── localStorage cache helpers ─────────────────────────────────────────────
const STATS_CACHE_KEY = 'munkentipset_stats_cache_v2';

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
                knockoutScores: d.knockoutScores || null,
                matchTips: d.matchTips || {},
                specialPicks: d.specialPicks || null
            };
            if (u.groupPicks || u.knockoutPicks || Object.keys(u.matchTips).length > 0 || u.specialPicks) users.push(u);
        }

        _saveStatsCache(dataVersion, { results, bracket, users, matchDocs });
    }

    window._cachedMatchDocs = matchDocs;
    window._cachedUsers = users;
    window._cachedResults = results;
    window._cachedBracket = bracket;
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
    const hasGroups = hasStageType('round-robin-groups');
    const hasSpecial = hasSpecialQuestions();
    const specialConfig = getSpecialQuestionsConfig();
    const specialLabel = specialConfig?.label || 'Special';
    const colCount = 2 + (hasGroups ? 1 : 0) + (hasSpecial ? 1 : 0);
    html += `<table class="group-table" style="font-size:14px;"><thead><tr><th style="text-align:left;">Namn</th>${hasGroups ? '<th>Grupp</th>' : ''}<th>Slutspel</th>${hasSpecial ? `<th>${specialLabel}</th>` : ''}<th>Totalt</th></tr></thead><tbody>`;

    const myRank = scores.findIndex(s => s.userId === currentUserId);
    const showTop = Math.min(scores.length, 10);

    for (let i = 0; i < showTop; i++) {
        const s = scores[i];
        const isMe = s.userId === currentUserId;
        const medal = i === 0 ? '🥇 ' : (i === 1 ? '🥈 ' : (i === 2 ? '🥉 ' : `${i + 1}. `));
        const style = isMe ? 'background:rgba(40,167,69,0.08); font-weight:700;' : '';
        html += `<tr style="${style}"><td style="text-align:left;padding-left:6px;">${medal}${s.name}</td>${hasGroups ? `<td>${s.groupPts}</td>` : ''}<td>${s.koPts}</td>${hasSpecial ? `<td>${s.specialPts || 0}</td>` : ''}<td><strong>${s.total}</strong></td></tr>`;
    }

    // If user is outside top 10, show separator + their row
    if (myRank >= 10) {
        const s = scores[myRank];
        html += `<tr style="border-top:2px dashed #ddd;"><td colspan="${colCount + 1}" style="text-align:center; color:#999; font-size:11px; padding:4px;">···</td></tr>`;
        html += `<tr style="background:rgba(40,167,69,0.08); font-weight:700;"><td style="text-align:left;padding-left:6px;">${myRank + 1}. ${s.name}</td>${hasGroups ? `<td>${s.groupPts}</td>` : ''}<td>${s.koPts}</td>${hasSpecial ? `<td>${s.specialPts || 0}</td>` : ''}<td><strong>${s.total}</strong></td></tr>`;
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
        getKnockoutRounds().forEach(rd => {
            officialKoWinners[rd.key] = [];
            (bracket.rounds[rd.adminKey] || []).forEach(m => {
                if (m.winner) officialKoWinners[rd.key].push(m.winner);
            });
        });
    }
    // Build set of teams eliminated per round (lost in that round)
    const eliminatedInRound = {};
    if (bracket?.rounds) {
        getKnockoutRounds().forEach(rd => {
            eliminatedInRound[rd.key] = [];
            (bracket.rounds[rd.adminKey] || []).forEach(m => {
                if (m.winner && m.team1 && m.team2) {
                    const loser = m.winner === m.team1 ? m.team2 : m.team1;
                    eliminatedInRound[rd.key].push(loser);
                }
            });
        });
    }
    // Teams that qualified for R32 (from admin bracket) — used to detect group-stage elimination
    const qualifiedForKnockout = new Set(bracket?.teams || []);

    // Helper: build group standings tooltip (same layout as Matchresultat tab)
    function buildGroupTooltip(letter, allMatchDocs, allResults) {
        const groupMatches = (allMatchDocs || []).filter(m => m.stage === `Grupp ${letter}`);
        if (groupMatches.length === 0) return '';
        const teams = Array.from(new Set(groupMatches.flatMap(m => [m.homeTeam, m.awayTeam])));
        const tData = {};
        teams.forEach(t => tData[t] = { name: t, pld: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 });
        let hasResult = false;
        let matchListHtml = '';
        groupMatches.forEach(m => {
            const r = allResults[m.id];
            if (r && r.homeScore !== undefined) {
                hasResult = true;
                const h = r.homeScore, a = r.awayScore;
                tData[m.homeTeam].pld++; tData[m.awayTeam].pld++;
                tData[m.homeTeam].gf += h; tData[m.homeTeam].ga += a;
                tData[m.awayTeam].gf += a; tData[m.awayTeam].ga += h;
                tData[m.homeTeam].gd += (h - a); tData[m.awayTeam].gd += (a - h);
                if (h > a) { tData[m.homeTeam].w++; tData[m.homeTeam].pts += 3; tData[m.awayTeam].l++; }
                else if (a > h) { tData[m.awayTeam].w++; tData[m.awayTeam].pts += 3; tData[m.homeTeam].l++; }
                else { tData[m.homeTeam].d++; tData[m.awayTeam].d++; tData[m.homeTeam].pts++; tData[m.awayTeam].pts++; }
                const hw = h > a ? 'font-weight:700;' : '', aw = a > h ? 'font-weight:700;' : '';
                matchListHtml += `<div style="font-size:11px; padding:2px 0; display:flex; align-items:center;">
                    <span style="flex:1; text-align:left; ${hw}">${f(m.homeTeam)}${m.homeTeam}</span>
                    <span style="flex:0 0 auto; font-weight:700; padding:0 6px;">${h} - ${a}</span>
                    <span style="flex:1; text-align:right; ${aw}">${m.awayTeam}${f(m.awayTeam)}</span>
                </div>`;
            }
        });
        if (!hasResult) return '';
        const sorted = Object.values(tData).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
        let tip = `<div class="group-table-header" style="padding:6px 8px; font-size:12px;">Grupp ${letter}</div>`;
        tip += '<table class="group-table" style="font-size:11px;"><thead><tr><th style="text-align:left;">Lag</th><th>S</th><th>V</th><th>O</th><th>F</th><th>+/-</th><th>P</th></tr></thead><tbody>';
        sorted.forEach((t, i) => {
            const bg = i < 2 ? 'background-color:rgba(40,167,69,0.06);' : '';
            tip += `<tr style="${bg}"><td style="text-align:left;padding-left:4px;">${f(t.name)}${t.name}</td><td>${t.pld}</td><td>${t.w}</td><td>${t.d}</td><td>${t.l}</td><td>${t.gd > 0 ? '+' + t.gd : t.gd}</td><td><strong>${t.pts}</strong></td></tr>`;
        });
        tip += '</tbody></table>';
        if (matchListHtml) tip += `<div style="padding:6px 8px; border-top:1px solid #eee;">${matchListHtml}</div>`;
        return tip;
    }

    const me = users.find(u => u.userId === currentUserId);
if (me && (me.groupPicks || me.knockoutPicks)) {
        html += '<h3 style="margin-top:0; margin-bottom:10px;">Min tipsrad</h3>';
        html += '<div class="stat-card">';

        // Check if all group stage matches have official results
        const allGroupsDone = hasGroups && getGroupLetters().every(l => officialGroupStandings[l]?.complete);

        // --- Build group stage HTML ---
        let groupHtml = '';
        if (me.groupPicks && hasGroups) {
        groupHtml += '<table class="my-tips-table" style="width:100%; border-collapse:collapse; text-align:left; font-size:12px;">';
        groupHtml += '<thead><tr>';
        groupHtml += '<th style="padding-bottom:4px; font-size:10px; color:#888; text-transform:uppercase; font-weight:700;">Tippad</th>';
        groupHtml += '<th style="padding-bottom:4px; font-size:10px; color:#888; text-transform:uppercase; font-weight:700;">Gruppetta</th>';
        groupHtml += '<th style="padding-bottom:4px; font-size:10px; color:#888; text-transform:uppercase; font-weight:700;">Grupptvåa</th>';
        groupHtml += '</tr></thead><tbody>';

        getGroupLetters().forEach(letter => {
            const pick = me.groupPicks[letter];
            if (!pick) return;
            const official = officialGroupStandings[letter];
            let firstColor = '', secondColor = '';
            if (official && official.complete) {
                // Check for swapped picks (user's 1st = official 2nd AND user's 2nd = official 1st)
                const swapped = pick.first === official.second && pick.second === official.first;
                if (swapped) {
                    firstColor = 'color:#e67e22;';  // orange
                    secondColor = 'color:#e67e22;';
                } else {
                    firstColor = pick.first === official.first ? 'color:#28a745;' : 'color:#dc3545;';
                    secondColor = pick.second === official.second ? 'color:#28a745;' : 'color:#dc3545;';
                }
            }

            // Build hover tooltip with group standings table
            const tooltipHtml = buildGroupTooltip(letter, matchDocs, results);

            groupHtml += '<tr class="mtt-row" style="border-top:1px solid #f1f1f1;">';
            groupHtml += '<td class="mtt-label" style="padding:4px 0; font-weight:700; color:#555; position:relative;">Grupp ' + letter;
            if (tooltipHtml) groupHtml += '<div class="mtt-tooltip">' + tooltipHtml + '</div>';
            groupHtml += '</td>';
            groupHtml += '<td class="mtt-team" style="padding:4px 0; ' + firstColor + '">' + f(pick.first) + ' ' + pick.first + '</td>';
            groupHtml += '<td class="mtt-team" style="padding:4px 0; ' + secondColor + '">' + f(pick.second) + ' ' + pick.second + '</td>';
            groupHtml += '</tr>';
        });
        groupHtml += '</tbody></table>';
        }

        // --- Build knockout HTML ---
        let koHtml = '';
        if (me.knockoutPicks) {
            const ko = me.knockoutPicks;
            const koRoundsAll = getKnockoutRounds();
            const finalRd = koRoundsAll[koRoundsAll.length - 1];
            const gold = finalRd ? (typeof ko[finalRd.key] === 'string' ? ko[finalRd.key] : null) : null;

            // Silver = the other SF pick that isn't gold
            const sfRound = koRoundsAll.length >= 2 ? koRoundsAll[koRoundsAll.length - 2] : null;
            const sfPicks = sfRound ? (ko[sfRound.key] || []) : [];
            const silver = Array.isArray(sfPicks) ? sfPicks.find(t => t !== gold) : null;

            // Build eliminated-per-round: teams in round N but not in round N+1
            const eliminatedPerRound = [];
            for (let ri = 0; ri <= koRoundsAll.length - 3; ri++) {
                const thisRound = koRoundsAll[ri];
                const nextRound = koRoundsAll[ri + 1];
                const thisPicks = ko[thisRound.key] || [];
                const nextPicks = typeof ko[nextRound.key] === 'string' ? [ko[nextRound.key]] : (ko[nextRound.key] || []);
                const eliminated = (Array.isArray(thisPicks) ? thisPicks : [thisPicks]).filter(t => !nextPicks.includes(t));
                if (eliminated.length > 0) {
                    eliminatedPerRound.push({ round: nextRound, statusRoundKey: thisRound.key, eliminated });
                }
            }

            const getStatusColor = (team, roundKey) => {
                if (!team) return '';
                const winners = officialKoWinners[roundKey] || [];
                const roundOrder = koRoundsAll.map(r => r.key);
                const thisIdx = roundOrder.indexOf(roundKey);
                // Only check group-stage elimination if ALL groups are done
                if (allGroupsDone) {
                    const eliminatedInGroups = qualifiedForKnockout.size > 0 && !qualifiedForKnockout.has(team);
                    if (eliminatedInGroups) return 'color:#dc3545;';
                }
                const eliminatedBefore = new Set();
                for (let ri = 0; ri < thisIdx; ri++) {
                    (eliminatedInRound[roundOrder[ri]] || []).forEach(t => eliminatedBefore.add(t));
                }
                if (winners.length > 0 && winners.includes(team)) return 'color:#28a745;';
                if (eliminatedBefore.has(team)) return 'color:#dc3545;';
                if (winners.length > 0 && !winners.includes(team)) {
                    if ((eliminatedInRound[roundKey] || []).includes(team)) return 'color:#dc3545;';
                }
                return '';
            };

            koHtml += '<div style="margin-top:16px; padding-top:12px; border-top:1px dashed #ddd;">';

            // Eliminated teams per round (ÅF → KF → SF, ascending)
            eliminatedPerRound.forEach(({ round, statusRoundKey, eliminated }) => {
                koHtml += `<div style="font-size:9px; font-weight:700; color:#9ba4b5; text-align:center; letter-spacing:1px; margin:8px 0 4px;">UTSLAGNA I ${round.label.toUpperCase()}</div>`;
                koHtml += '<div style="display:grid; grid-template-columns:1fr 1fr; gap:4px;">';
                eliminated.forEach(team => {
                    const c = getStatusColor(team, statusRoundKey);
                    koHtml += '<div style="background:#f4f6f9; border:1px solid #e1e5eb; border-radius:4px; padding:3px 6px; display:flex; align-items:center; gap:4px;">';
                    koHtml += '<span style="font-size:11px; color:#444; ' + c + '">' + f(team) + ' ' + team + '</span>';
                    koHtml += '</div>';
                });
                koHtml += '</div>';
            });

            // Guld & Silver (at the bottom)
            koHtml += '<div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:12px;">';
            if (gold) {
                const c = getStatusColor(gold, finalRd.key);
                koHtml += '<div style="background:#f1c40f; border-radius:4px; padding:8px; text-align:center;">';
                koHtml += '<div style="font-size:9px; font-weight:800; color:#a67c00; letter-spacing:1px; margin-bottom:4px;">GULD</div>';
                koHtml += '<div style="font-size:13px; font-weight:800; color:#333; ' + c + '">' + f(gold) + ' ' + gold + '</div>';
                koHtml += '</div>';
            }
            if (silver) {
                const c = getStatusColor(silver, sfRound.key);
                koHtml += '<div style="background:#d1d8e0; border-radius:4px; padding:8px; text-align:center;">';
                koHtml += '<div style="font-size:9px; font-weight:800; color:#6b7c93; letter-spacing:1px; margin-bottom:4px;">SILVER</div>';
                koHtml += '<div style="font-size:13px; font-weight:800; color:#333; ' + c + '">' + f(silver) + ' ' + silver + '</div>';
                koHtml += '</div>';
            }
            koHtml += '</div>';

            koHtml += '</div>';
        }

        // --- Build special tips HTML ---
        let specialHtml = '';
        if (hasSpecial && me.specialPicks && specialConfig?.questions?.length) {
            specialHtml += '<div style="margin-top:16px; padding-top:12px; border-top:1px dashed #ddd;">';
            specialHtml += `<div style="font-size:9px; font-weight:700; color:#9ba4b5; text-align:center; letter-spacing:1px; margin-bottom:8px;">${specialLabel.toUpperCase()}</div>`;
            specialConfig.questions.forEach(q => {
                const pick = me.specialPicks[q.id];
                if (pick == null) return;
                const isResolved = q.correctAnswer != null;
                let correct = false;
                if (isResolved) {
                    correct = q.type === 'numeric'
                        ? Number(pick) === Number(q.correctAnswer)
                        : String(pick) === String(q.correctAnswer);
                }
                const color = isResolved ? (correct ? 'color:#28a745;' : 'color:#dc3545;') : '';
                const icon = isResolved ? (correct ? '&#10003; ' : '&#10007; ') : '';
                specialHtml += `<div style="display:flex; justify-content:space-between; align-items:center; padding:3px 0; font-size:12px; border-bottom:1px solid #f1f1f1;">`;
                specialHtml += `<span style="flex:1; color:#555;">${q.text}</span>`;
                specialHtml += `<span style="font-weight:700; ${color} white-space:nowrap; margin-left:8px;">${icon}${pick}</span>`;
                specialHtml += `</div>`;
            });
            specialHtml += '</div>';
        }

        // Order: groups first during group stage, knockout first after groups are done
        if (allGroupsDone) {
            html += koHtml + groupHtml + specialHtml;
        } else {
            html += groupHtml + koHtml + specialHtml;
        }

        html += '</div>';
    }
    html += `</div>`; // end dashboard-left

    // ── RIGHT COLUMN: Recent Results + Upcoming + Champion Chart ──────
    html += `<div class="dashboard-right">`;

    const now = new Date();
    const roundNames = {};
    getKnockoutRounds().forEach(r => { roundNames[r.adminKey] = r.label; });

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

    // Knockout results from bracket (two-legged = two separate results)
    if (bracket?.rounds) {
        getKnockoutRounds().forEach((rd, ri) => {
            const twoLeg = isTwoLegged(rd.key);
            (bracket.rounds[rd.adminKey] || []).forEach((m, mi) => {
                if (!m.team1 || !m.team2) return;
                if (twoLeg) {
                    // Leg 1 result
                    if (m.score1 !== undefined) {
                        allPlayedMatches.push({
                            matchId: `ko_${rd.adminKey}_${mi}_L1`, homeTeam: m.team1, awayTeam: m.team2,
                            homeScore: m.score1, awayScore: m.score2,
                            stage: `${rd.label} – Match 1`, date: m.date,
                            _parsed: m.date ? parseMatchDate(m.date) : new Date(getTournamentYear(), 6, 1 + ri, mi),
                            _isKnockout: true, _koRound: rd.adminKey, _koRoundKey: rd.key,
                            _koMatchIdx: mi, _koLeg: 1, _winner: m.winner
                        });
                    }
                    // Leg 2 result
                    if (m.score1_leg2 !== undefined) {
                        allPlayedMatches.push({
                            matchId: `ko_${rd.adminKey}_${mi}_L2`, homeTeam: m.team2, awayTeam: m.team1,
                            homeScore: m.score1_leg2, awayScore: m.score2_leg2,
                            stage: `${rd.label} – Match 2 (retur)`, date: m.date_leg2,
                            _parsed: m.date_leg2 ? parseMatchDate(m.date_leg2) : new Date(getTournamentYear(), 6, 2 + ri, mi),
                            _isKnockout: true, _koRound: rd.adminKey, _koRoundKey: rd.key,
                            _koMatchIdx: mi, _koLeg: 2, _winner: m.winner
                        });
                    }
                } else {
                    // Single leg
                    if (m.winner && m.score1 !== undefined) {
                        allPlayedMatches.push({
                            matchId: `ko_${rd.adminKey}_${mi}`, homeTeam: m.team1, awayTeam: m.team2,
                            homeScore: m.score1, awayScore: m.score2,
                            stage: rd.label, date: m.date,
                            _parsed: m.date ? parseMatchDate(m.date) : new Date(getTournamentYear(), 6, 1 + ri, mi),
                            _isKnockout: true, _koRound: rd.adminKey, _koRoundKey: rd.key,
                            _koMatchIdx: mi, _koLeg: 0, _winner: m.winner
                        });
                    }
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
                } else if (me.knockoutScores || me.knockoutPicks) {
                    const roundKey = match._koRoundKey;
                    const mi = match._koMatchIdx;
                    const leg = match._koLeg;
                    const tip = me.knockoutScores?.[roundKey]?.[mi];

                    // Show per-leg score comparison
                    if (tip) {
                        let tipH, tipA;
                        if (leg === 1) { tipH = tip.score1; tipA = tip.score2; }
                        else if (leg === 2) { tipH = tip.score1_leg2; tipA = tip.score2_leg2; }
                        if (tipH != null && tipA != null) {
                            const myExact = tipH === h && tipA === a2;
                            const myWinner = !myExact && sign(tipH - tipA) === sign(h - a2);
                            const tipStyle = myExact ? 'color:#28a745; font-weight:700;' : (myWinner ? 'color:#17a2b8;' : 'color:#dc3545;');
                            html += `<div style="font-size:12px; ${tipStyle} margin-top:6px; text-align:center;">Ditt tips: ${tipH} – ${tipA}${myExact ? ' ✨' : (myWinner ? ' ✓' : '')}</div>`;
                        }
                    }

                    // Show advancement pick (on leg 2 or single-leg, when winner is known)
                    if (me.knockoutPicks && match._winner && (leg === 2 || leg === 0)) {
                        const picks = typeof me.knockoutPicks[roundKey] === 'string' ? [me.knockoutPicks[roundKey]] : (me.knockoutPicks[roundKey] || []);
                        const origTeam1 = leg === 2 ? match.awayTeam : match.homeTeam;
                        const origTeam2 = leg === 2 ? match.homeTeam : match.awayTeam;
                        const picked = picks.find(t => t === origTeam1 || t === origTeam2);
                        if (picked) {
                            const correct = picked === match._winner;
                            const advStyle = correct ? 'color:#28a745; font-weight:700;' : 'color:#dc3545;';
                            html += `<div style="font-size:12px; ${advStyle} margin-top:2px; text-align:center;">Tippat vidare: ${f(picked)}${picked}${correct ? ' ✓' : ''}</div>`;
                        }
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
                const roundKey = match._koRoundKey;
                const mi = match._koMatchIdx;
                const leg = match._koLeg;
                const exactTippers = [], winnerTippers = [];
                users.forEach(u => {
                    if (u.userId === currentUserId) return;
                    const tip = u.knockoutScores?.[roundKey]?.[mi];
                    if (tip) {
                        let tipH, tipA;
                        if (leg === 1) { tipH = tip.score1; tipA = tip.score2; }
                        else if (leg === 2) { tipH = tip.score1_leg2; tipA = tip.score2_leg2; }
                        else { tipH = tip.score1; tipA = tip.score2; }
                        if (tipH != null && tipA != null) {
                            if (tipH === h && tipA === a2) exactTippers.push(u.name);
                            else if (sign(tipH - tipA) === sign(h - a2)) winnerTippers.push(u.name);
                        }
                    }
                });
                html += renderTippersSummary(exactTippers, winnerTippers);
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

    // Unplayed knockout matches from bracket (two-legged = two separate entries)
    if (bracket?.rounds) {
        getKnockoutRounds().forEach((rd, ri) => {
            const twoLeg = isTwoLegged(rd.key);
            (bracket.rounds[rd.adminKey] || []).forEach((m, mi) => {
                if (!m.team1 || !m.team2) return;
                if (twoLeg) {
                    // Leg 1: upcoming if no leg 1 result yet
                    if (m.score1 === undefined) {
                        allUpcoming.push({
                            matchId: `ko_${rd.adminKey}_${mi}_L1`, homeTeam: m.team1, awayTeam: m.team2,
                            date: m.date, stage: `${rd.label} – Match 1`,
                            _parsed: m.date ? parseMatchDate(m.date) : new Date(getTournamentYear(), 6, 1 + ri, mi),
                            _isKnockout: true, _koRoundKey: rd.key, _koMatchIdx: mi, _koLeg: 1
                        });
                    }
                    // Leg 2: upcoming if no leg 2 result yet
                    if (m.score1_leg2 === undefined) {
                        allUpcoming.push({
                            matchId: `ko_${rd.adminKey}_${mi}_L2`, homeTeam: m.team2, awayTeam: m.team1,
                            date: m.date_leg2, stage: `${rd.label} – Match 2 (retur)`,
                            _parsed: m.date_leg2 ? parseMatchDate(m.date_leg2) : new Date(getTournamentYear(), 6, 2 + ri, mi),
                            _isKnockout: true, _koRoundKey: rd.key, _koMatchIdx: mi, _koLeg: 2
                        });
                    }
                } else {
                    // Single leg: upcoming if no winner
                    if (!m.winner) {
                        allUpcoming.push({
                            matchId: `ko_${rd.adminKey}_${mi}`, homeTeam: m.team1, awayTeam: m.team2,
                            date: m.date, stage: rd.label,
                            _parsed: m.date ? parseMatchDate(m.date) : new Date(getTournamentYear(), 6, 1 + ri, mi),
                            _isKnockout: true, _koRoundKey: rd.key, _koMatchIdx: mi, _koLeg: 0
                        });
                    }
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
                } else if (me.knockoutScores || me.knockoutPicks) {
                    const roundKey = match._koRoundKey;
                    const mi = match._koMatchIdx;
                    const leg = match._koLeg;
                    const roundScores = me.knockoutScores?.[roundKey] || [];
                    const tip = roundScores[mi];

                    // Show per-leg score tip
                    if (tip && leg === 1 && tip.score1 != null) {
                        html += `<div style="font-size:12px; color:#555; margin-top:6px; text-align:center;">Ditt tips: <strong>${tip.score1} – ${tip.score2}</strong></div>`;
                    } else if (tip && leg === 2 && tip.score1_leg2 != null) {
                        html += `<div style="font-size:12px; color:#555; margin-top:6px; text-align:center;">Ditt tips: <strong>${tip.score1_leg2} – ${tip.score2_leg2}</strong></div>`;
                    }

                    // Show advancement pick (on leg 2 or single-leg)
                    if (me.knockoutPicks && (leg === 2 || leg === 0)) {
                        const picks = typeof me.knockoutPicks[roundKey] === 'string' ? [me.knockoutPicks[roundKey]] : (me.knockoutPicks[roundKey] || []);
                        // For leg 2, homeTeam/awayTeam are swapped; check both original teams
                        const origTeam1 = leg === 2 ? match.awayTeam : match.homeTeam;
                        const origTeam2 = leg === 2 ? match.homeTeam : match.awayTeam;
                        const picked = picks.find(t => t === origTeam1 || t === origTeam2);
                        if (picked) {
                            html += `<div style="font-size:12px; color:#888; margin-top:2px; text-align:center;">Tippat vidare: ${f(picked)}<strong>${picked}</strong></div>`;
                        }
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
    const _finalKey = getKnockoutRounds().length > 0 ? getKnockoutRounds()[getKnockoutRounds().length - 1].key : 'final';
    users.forEach(u => {
        const pick = u.knockoutPicks?.[_finalKey];
        if (pick) champCounts[pick] = (champCounts[pick] || 0) + 1;
    });
    if (Object.keys(champCounts).length > 0) {
        html += `<div class="stat-card" style="margin-top:10px;"><h3>🏆 Tippade mästare</h3>`;
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
    initCompareState(users, scores, scoring, loadCommunityStats, {
        results, bracket, officialGroupStandings
    });

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

