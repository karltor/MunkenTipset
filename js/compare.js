import { auth } from './config.js';
import { f } from './wizard.js';
import { sign } from './scoring.js';
import { getGroupLetters, getKnockoutRounds, getFinalRound, getTournamentName, isTwoLegged, hasSpecialQuestions, getSpecialQuestionsConfig } from './tournament-config.js';

let _comparisonState = {
    selectedUsers: [],
    viewMode: 'simple'
};

// References set by stats.js before calling
let _cachedUsers = null;
let _cachedScores = null;
let _cachedScoring = null;
let _loadCommunityStats = null;
let _cachedResults = null;
let _cachedBracket = null;
let _cachedOfficialGroupStandings = null;
let _viewerIsPotMember = false;

export function initCompareState(users, scores, scoring, loadFn, extra) {
    _cachedUsers = users;
    _cachedScores = scores;
    _cachedScoring = scoring;
    _loadCommunityStats = loadFn;
    if (extra) {
        _cachedResults = extra.results || null;
        _cachedBracket = extra.bracket || null;
        _cachedOfficialGroupStandings = extra.officialGroupStandings || null;
        _viewerIsPotMember = !!extra.viewerIsPotMember;
    }
}

// See stats.js: only show 💰 to viewers who are themselves in the pot.
function potMark(isPot) {
    return (_viewerIsPotMember && isPot) ? ' <span title="I prispotten" style="font-size:0.85em;">💰</span>' : '';
}

// ── FULL LEADERBOARD VIEW ──────────────────────────
export function showFullLeaderboard() {
    const container = document.getElementById('community-stats');
    const scores = _cachedScores;
    const scoring = _cachedScoring;
    if (!scores) return;

    let html = `<button class="btn" id="btn-back-from-lb" style="background:#6c757d; font-size:13px; margin-bottom:12px;">← Tillbaka</button>`;
    html += `<div class="stat-card"><h3>Leaderboard — Detaljerad</h3>`;
    html += `<div style="overflow-x:auto;">`;
    html += `<table class="group-table full-leaderboard" style="font-size:13px;">`;
    const _hasSpecial = hasSpecialQuestions();
    const _specialLabel = _hasSpecial ? (getSpecialQuestionsConfig()?.label || 'Special') : '';
    html += `<thead><tr>
        <th style="text-align:left;">#</th>
        <th style="text-align:left;">Namn</th>
        <th title="Rätt 1X2">1X2</th>
        <th title="Rätt mål">Mål</th>
        <th title="Exakt resultat">Exakt</th>
        <th title="Rätt gruppetta/tvåa">Grupp</th>
        <th title="Slutspelspoäng">Slutspel</th>
        ${_hasSpecial ? `<th title="${_specialLabel}">${_specialLabel}</th>` : ''}
        <th>Totalt</th>
    </tr></thead><tbody>`;

    const currentUserId = auth.currentUser?.uid;
    scores.forEach((s, i) => {
        const isMe = s.userId === currentUserId;
        const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : `${i + 1}`));
        const style = isMe ? 'background:rgba(40,167,69,0.08); font-weight:700;' : '';
        html += `<tr style="${style}">
            <td style="text-align:left;">${medal}</td>
            <td style="text-align:left;">${s.name}${potMark(s.potMember)}</td>
            <td>${s.detail.matchResult || 0}</td>
            <td>${s.detail.matchGoals || 0}</td>
            <td>${s.detail.exactScore || 0}</td>
            <td>${s.detail.groupPlace || 0}</td>
            <td>${s.koPts}</td>
            ${_hasSpecial ? `<td>${s.specialPts || 0}</td>` : ''}
            <td><strong>${s.total}</strong></td>
        </tr>`;
    });

    html += `</tbody></table></div>`;

    html += `<div style="margin-top:12px; font-size:11px; color:color-mix(in srgb, var(--color-text) 55%, transparent);">`;
    html += `<strong>Poängregler:</strong> `;
    html += `1X2 = ${scoring.matchResult}p/match · `;
    html += `Rätt mål = ${scoring.matchHomeGoals}p + ${scoring.matchAwayGoals}p · `;
    if (scoring.exactScore > 0) html += `Exakt = +${scoring.exactScore}p bonus · `;
    html += `Gruppetta = ${scoring.groupWinner}p · Grupptvåa = ${scoring.groupRunnerUp}p · `;
    getKnockoutRounds().forEach((r, i) => {
        html += `${i > 0 ? ' · ' : ''}${r.label} = ${scoring[`ko_${r.key}`] || 0}p`;
    });
    html += `</div>`;

    html += `</div>`;
    container.innerHTML = html;

    document.getElementById('btn-back-from-lb').addEventListener('click', () => _loadCommunityStats());
}

// ── ALL TIPPERS VIEW ──────────────────────────────
export function showAllTips() {
    const container = document.getElementById('community-stats');
    const users = _cachedUsers;
    if (!users) return;

    const sortedUsers = [...users].sort((a, b) => a.name.localeCompare(b.name));

    let html = `<button class="btn" id="btn-back-from-tips" style="background:#6c757d; font-size:13px; margin-bottom:12px;">← Tillbaka</button>`;
    html += `<h3>Jämför Tipsare (${users.length} st)</h3>`;

    html += `<div class="stat-card" style="margin-bottom:20px; display:flex; flex-wrap:wrap; gap:20px;">`;
    html += `<div style="flex:1; min-width:200px;">
        <label style="font-weight:700; font-size:13px; display:block; margin-bottom:8px; color:color-mix(in srgb, var(--color-text) 75%, transparent);">1. Välj vy:</label>
        <div class="tabs" style="border:none; margin:0; padding:0; gap:5px;">
            <button class="tab-btn active" id="btn-view-simple" style="padding:8px 12px; font-size:13px; flex:1;">Grupper</button>
            <button class="tab-btn" id="btn-view-knockout" style="padding:8px 12px; font-size:13px; flex:1;">Slutspel</button>
            <button class="tab-btn" id="btn-view-advanced" style="padding:8px 12px; font-size:13px; flex:1;">Matcher</button>
        </div>
    </div>`;

    html += `<div style="flex:2; min-width:250px;">
        <label style="font-weight:700; font-size:13px; display:block; margin-bottom:8px; color:color-mix(in srgb, var(--color-text) 75%, transparent);">2. Välj tipsare att jämföra:</label>
        <div style="max-height:140px; overflow-y:auto; border:1px solid var(--color-card-border); border-radius:8px; padding:10px; background:color-mix(in srgb, var(--color-text) 3%, var(--color-card-bg)); display:grid; grid-template-columns:repeat(auto-fill, minmax(160px, 1fr)); gap:8px;">`;

    sortedUsers.forEach(u => {
        const isChecked = _comparisonState.selectedUsers.includes(u.userId) ? 'checked' : '';
        html += `<label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer; background:var(--color-card-bg); padding:4px 8px; border-radius:4px; border:1px solid var(--color-card-border);">
            <input type="checkbox" class="user-compare-cb" value="${u.userId}" ${isChecked}>
            <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${u.name}">${u.name}${potMark(u.potMember)}</span>
        </label>`;
    });

    html += `</div></div>`;
    html += `</div>`;

    html += `<div id="comparison-table-container" class="stat-card" style="padding:0; overflow-x:auto;">
        <p style="text-align:center; color:color-mix(in srgb, var(--color-text) 55%, transparent); padding:30px;">Välj minst en tipsare ovan för att se tabellen.</p>
    </div>`;

    container.innerHTML = html;

    document.getElementById('btn-back-from-tips').addEventListener('click', () => _loadCommunityStats());

    const simpleBtn = document.getElementById('btn-view-simple');
    const koBtn = document.getElementById('btn-view-knockout');
    const advBtn = document.getElementById('btn-view-advanced');
    const allViewBtns = [simpleBtn, koBtn, advBtn];

    function setActiveView(mode, activeBtn) {
        _comparisonState.viewMode = mode;
        allViewBtns.forEach(b => b.classList.remove('active'));
        activeBtn.classList.add('active');
        renderComparisonTable();
    }

    simpleBtn.addEventListener('click', () => setActiveView('simple', simpleBtn));
    koBtn.addEventListener('click', () => setActiveView('knockout', koBtn));
    advBtn.addEventListener('click', () => setActiveView('advanced', advBtn));

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

    const currentUserId = auth.currentUser?.uid;
    if (currentUserId && _comparisonState.selectedUsers.length === 0) {
        const myCb = document.querySelector(`.user-compare-cb[value="${currentUserId}"]`);
        if (myCb) {
            myCb.checked = true;
            _comparisonState.selectedUsers.push(currentUserId);
        }
    }

    if (_comparisonState.selectedUsers.length > 0) {
        renderComparisonTable();
    }
}

function renderComparisonTable() {
    const container = document.getElementById('comparison-table-container');
    const selectedIds = _comparisonState.selectedUsers;

    if (selectedIds.length === 0) {
        container.innerHTML = `<p style="text-align:center; color:color-mix(in srgb, var(--color-text) 55%, transparent); padding:30px;">Välj minst en tipsare ovan för att se tabellen.</p>`;
        return;
    }

    const users = _cachedUsers.filter(u => selectedIds.includes(u.userId));

    let html = `<table class="group-table" style="width:100%; min-width:${selectedIds.length * 140 + 200}px; border-collapse: separate; border-spacing: 0;">`;

    html += `<thead><tr>`;
    html += `<th style="text-align:left; position:sticky; left:0; background:var(--color-table-header-bg); color:var(--color-table-header-text); z-index:2; box-shadow: 2px 0 5px rgba(0,0,0,0.1);">Fas</th>`;
    users.forEach(u => {
        html += `<th style="background:var(--color-table-header-bg); color:var(--color-table-header-text); font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:140px;">${u.name}${potMark(u.potMember)}</th>`;
    });
    html += `</tr></thead><tbody style="font-size:13px;">`;

    if (_comparisonState.viewMode === 'simple') {
        html += renderSimpleView(users);
    } else if (_comparisonState.viewMode === 'knockout') {
        html += renderKnockoutView(users);
    } else {
        html += renderAdvancedView(users);
    }

    html += `</tbody></table>`;
    container.innerHTML = html;
}

function renderSimpleView(users) {
    let html = '';
    const official = _cachedOfficialGroupStandings || {};

    getGroupLetters().forEach(letter => {
        const og = official[letter];
        html += `<tr>`;
        html += `<td style="font-weight:700; position:sticky; left:0; background:color-mix(in srgb, var(--color-text) 5%, var(--color-card-bg)); z-index:1; border-right:2px solid var(--color-card-border); box-shadow: 2px 0 5px rgba(0,0,0,0.05);">Grupp ${letter}</td>`;
        users.forEach(u => {
            const picks = u.groupPicks ? u.groupPicks[letter] : null;
            if (picks && picks.first && picks.second) {
                let firstStyle = '', secondStyle = '';
                if (og && og.complete) {
                    firstStyle = picks.first === og.first ? 'color:#28a745;' : 'color:#dc3545;';
                    secondStyle = picks.second === og.second ? 'color:#28a745;' : 'color:#dc3545;';
                }
                html += `<td style="background:var(--color-card-bg);">
                    <div style="display:flex; flex-direction:column; gap:6px; align-items:flex-start; padding-left:10px;">
                        <span style="white-space:nowrap; ${firstStyle}" title="Etta">🥇 ${f(picks.first)}${picks.first}</span>
                        <span style="white-space:nowrap; ${secondStyle}" title="Tvåa">🥈 ${f(picks.second)}${picks.second}</span>
                    </div>
                </td>`;
            } else {
                html += `<td style="color:color-mix(in srgb, var(--color-text) 35%, transparent); text-align:center; background:var(--color-card-bg);">-</td>`;
            }
        });
        html += `</tr>`;
    });

    // Champion row with color-coding
    const finalWinners = [];
    const _finalRd = getFinalRound();
    const _finalAdminKey = _finalRd?.adminKey || 'Final';
    const _finalKey = _finalRd?.key || 'final';
    if (_cachedBracket?.rounds?.[_finalAdminKey]) {
        _cachedBracket.rounds[_finalAdminKey].forEach(m => { if (m.winner) finalWinners.push(m.winner); });
    }

    html += `<tr>`;
    html += `<td style="font-weight:700; position:sticky; left:0; background:color-mix(in srgb, #ffc107 10%, var(--color-card-bg)); z-index:1; border-right:2px solid var(--color-card-border); color:#d4a017; box-shadow: 2px 0 5px rgba(0,0,0,0.05);">🏆 Tippade mästare</td>`;
    users.forEach(u => {
        const fin = u.knockoutPicks?.[_finalKey];
        if (fin) {
            let champColor = 'color:#d4a017;';
            if (finalWinners.length > 0) {
                champColor = finalWinners.includes(fin) ? 'color:#28a745;' : 'color:#dc3545;';
            }
            html += `<td style="background:color-mix(in srgb, #ffc107 10%, var(--color-card-bg)); font-weight:700; ${champColor}">${f(fin)}${fin}</td>`;
        } else {
            html += `<td style="background:color-mix(in srgb, #ffc107 10%, var(--color-card-bg)); color:color-mix(in srgb, var(--color-text) 35%, transparent); text-align:center;">-</td>`;
        }
    });
    html += `</tr>`;
    return html;
}

function renderKnockoutView(users) {
    let html = '';
    const koRounds = getKnockoutRounds();
    const finalRd = getFinalRound();
    const koRoundDefs = koRounds.map(r => ({
        key: r.key,
        bracketKey: r.adminKey,
        label: r === finalRd ? `🏆 ${getTournamentName()} mästare` : `${r.label} (${r.teams / 2} lag)`
    }));

    // Build official winners per round
    const officialWinners = {};
    if (_cachedBracket?.rounds) {
        koRoundDefs.forEach(rd => {
            officialWinners[rd.key] = [];
            (_cachedBracket.rounds[rd.bracketKey] || []).forEach(m => {
                if (m.winner) officialWinners[rd.key].push(m.winner);
            });
        });
    }

    koRoundDefs.forEach(round => {
        const winners = officialWinners[round.key] || [];
        const hasResults = winners.length > 0;

        html += `<tr><td colspan="${users.length + 1}" style="background:#1f1f3a; color:#ffc107; font-weight:700; text-align:center; padding:8px; font-size:13px; position:sticky; left:0; z-index:1;">${round.label}</td></tr>`;

        const teamPickCount = {};
        const isFinal = typeof users[0]?.knockoutPicks?.[round.key] === 'string' || round.key === getFinalRound()?.key;
        users.forEach(u => {
            if (!u.knockoutPicks) return;
            const picks = u.knockoutPicks[round.key];
            if (isFinal) {
                if (picks) teamPickCount[picks] = (teamPickCount[picks] || 0) + 1;
            } else {
                (picks || []).forEach(t => { teamPickCount[t] = (teamPickCount[t] || 0) + 1; });
            }
        });

        const teamList = Object.keys(teamPickCount).sort((a, b) => {
            const aAll = teamPickCount[a] === users.length ? 1 : 0;
            const bAll = teamPickCount[b] === users.length ? 1 : 0;
            if (bAll !== aAll) return bAll - aAll;
            if (teamPickCount[b] !== teamPickCount[a]) return teamPickCount[b] - teamPickCount[a];
            return a.localeCompare(b);
        });

        if (teamList.length === 0) {
            html += `<tr><td colspan="${users.length + 1}" style="text-align:center; color:color-mix(in srgb, var(--color-text) 55%, transparent); padding:10px; background:var(--color-card-bg);">Inga tips registrerade</td></tr>`;
            return;
        }

        let shownDivider = false;
        teamList.forEach(team => {
            const isShared = teamPickCount[team] === users.length;
            if (!isShared && !shownDivider && users.length > 1) {
                shownDivider = true;
                html += `<tr><td colspan="${users.length + 1}" style="background:#2b2b52; color:#aaa; text-align:center; font-size:11px; padding:4px; font-style:italic;">Skiljer sig</td></tr>`;
            }

            // Color-code the team label if results exist
            const teamCorrect = hasResults && winners.includes(team);
            const teamWrong = hasResults && !winners.includes(team);
            let labelBg = isShared ? 'color-mix(in srgb, #28a745 18%, var(--color-card-bg))' : 'color-mix(in srgb, var(--color-text) 5%, var(--color-card-bg))';
            let labelColor = '';
            if (teamCorrect) { labelBg = 'color-mix(in srgb, #28a745 18%, var(--color-card-bg))'; labelColor = 'color:#28a745;'; }
            else if (teamWrong) { labelBg = 'color-mix(in srgb, #dc3545 18%, var(--color-card-bg))'; labelColor = 'color:#dc3545;'; }

            const rowBg = isShared ? 'color-mix(in srgb, #28a745 10%, var(--color-card-bg))' : 'var(--color-card-bg)';
            html += `<tr>`;
            html += `<td style="font-weight:600; position:sticky; left:0; background:${labelBg}; ${labelColor} z-index:1; border-right:2px solid var(--color-card-border); box-shadow: 2px 0 5px rgba(0,0,0,0.05); white-space:nowrap; font-size:12px;">${f(team)}${team}</td>`;

            users.forEach(u => {
                if (!u.knockoutPicks) { html += `<td style="background:${rowBg}; text-align:center; color:color-mix(in srgb, var(--color-text) 35%, transparent);">-</td>`; return; }
                const hasPick = isFinal
                    ? u.knockoutPicks[round.key] === team
                    : (u.knockoutPicks[round.key] || []).includes(team);

                if (hasPick) {
                    if (hasResults) {
                        if (teamCorrect) {
                            html += `<td style="background:color-mix(in srgb, #28a745 18%, var(--color-card-bg)); text-align:center; font-size:16px;">✅</td>`;
                        } else {
                            html += `<td style="background:color-mix(in srgb, #dc3545 18%, var(--color-card-bg)); text-align:center; font-size:16px;">❌</td>`;
                        }
                    } else {
                        html += `<td style="background:${isShared ? 'color-mix(in srgb, #28a745 18%, var(--color-card-bg))' : 'color-mix(in srgb, #ffc107 15%, var(--color-card-bg))'}; text-align:center; font-size:16px;">${isShared ? '✅' : '⚡'}</td>`;
                    }
                } else {
                    html += `<td style="background:${rowBg}; text-align:center; color:color-mix(in srgb, var(--color-text) 25%, transparent);">–</td>`;
                }
            });
            html += `</tr>`;
        });
    });
    return html;
}

function renderAdvancedView(users) {
    let html = '';
    const matchDocs = window._cachedMatchDocs || [];
    const results = _cachedResults || {};
    const bracket = _cachedBracket;

    // Group stage matches
    const groupedMatches = {};
    matchDocs.forEach(m => {
        const stage = m.stage || 'Övrigt';
        if (!groupedMatches[stage]) groupedMatches[stage] = [];
        groupedMatches[stage].push(m);
    });

    const stages = Object.keys(groupedMatches).sort();

    stages.forEach(stage => {
        html += `<tr><td colspan="${users.length + 1}" style="background:color-mix(in srgb, var(--color-text) 8%, var(--color-card-bg)); font-weight:700; text-align:center; padding:6px; font-size:12px; position:sticky; left:0; z-index:1;">${stage}</td></tr>`;

        groupedMatches[stage].sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true })).forEach(m => {
            const r = results[m.id];
            const hasResult = r && r.homeScore !== undefined;

            html += `<tr>`;

            const scorePart = hasResult
                ? `<span style="font-weight:800; padding:0 6px; min-width:36px; text-align:center;">${r.homeScore} - ${r.awayScore}</span>`
                : `<span class="compare-team-sep">-</span>`;
            html += `<td class="compare-match-cell" style="position:sticky; left:0; background:color-mix(in srgb, var(--color-text) 5%, var(--color-card-bg)); z-index:1; border-right:2px solid var(--color-card-border); box-shadow: 2px 0 5px rgba(0,0,0,0.05);">
                <div class="compare-match-date">${m.date || ''}</div>
                <div class="compare-match-teams">
                    <span class="compare-team-flag">${f(m.homeTeam)}</span><span class="compare-team-name">${m.homeTeam}</span>
                    ${scorePart}
                    <span class="compare-team-name">${m.awayTeam}</span><span class="compare-team-flag">${f(m.awayTeam)}</span>
                </div>
            </td>`;

            users.forEach(u => {
                const tip = u.matchTips ? u.matchTips[m.id] : null;
                if (tip && tip.homeScore !== undefined) {
                    let bg = 'var(--color-card-bg)', color = '';
                    if (hasResult) {
                        const exact = tip.homeScore === r.homeScore && tip.awayScore === r.awayScore;
                        const rightWinner = !exact && sign(tip.homeScore - tip.awayScore) === sign(r.homeScore - r.awayScore);
                        if (exact) { bg = 'color-mix(in srgb, #28a745 18%, var(--color-card-bg))'; color = 'color:#28a745;'; }
                        else if (rightWinner) { bg = 'color-mix(in srgb, #1976d2 18%, var(--color-card-bg))'; color = 'color:#1976d2;'; }
                        else { bg = 'color-mix(in srgb, #dc3545 18%, var(--color-card-bg))'; color = 'color:#dc3545;'; }
                    }
                    html += `<td style="font-size:16px; font-weight:800; text-align:center; background:${bg}; ${color}">
                        ${tip.homeScore} - ${tip.awayScore}
                    </td>`;
                } else {
                    html += `<td style="color:color-mix(in srgb, var(--color-text) 35%, transparent); text-align:center; background:var(--color-card-bg);">-</td>`;
                }
            });
            html += `</tr>`;
        });
    });

    // Knockout matches from bracket (each leg = separate row)
    if (bracket?.rounds) {
        getKnockoutRounds().forEach(rd => {
            const twoLeg = isTwoLegged(rd.key);
            const matches = bracket.rounds[rd.adminKey] || [];
            if (matches.length === 0 || !matches.some(m => m.team1 && m.team2)) return;

            html += `<tr><td colspan="${users.length + 1}" style="background:#1f1f3a; color:#ffc107; font-weight:700; text-align:center; padding:6px; font-size:12px; position:sticky; left:0; z-index:1;">${rd.label}</td></tr>`;

            matches.forEach((m, mi) => {
                if (!m.team1 || !m.team2) return;

                // Leg 1
                const hasL1 = m.score1 !== undefined;
                const l1Score = hasL1 ? `<span style="font-weight:800; padding:0 6px; min-width:36px; text-align:center;">${m.score1} - ${m.score2}</span>` : `<span class="compare-team-sep">-</span>`;
                const l1Label = twoLeg ? ` – Match 1` : '';
                html += `<tr>`;
                html += `<td class="compare-match-cell" style="position:sticky; left:0; background:color-mix(in srgb, var(--color-text) 5%, var(--color-card-bg)); z-index:1; border-right:2px solid var(--color-card-border); box-shadow: 2px 0 5px rgba(0,0,0,0.05);">
                    <div class="compare-match-date">${m.date || ''}${l1Label}</div>
                    <div class="compare-match-teams">
                        <span class="compare-team-flag">${f(m.team1)}</span><span class="compare-team-name">${m.team1}</span>
                        ${l1Score}
                        <span class="compare-team-name">${m.team2}</span><span class="compare-team-flag">${f(m.team2)}</span>
                    </div>
                </td>`;
                users.forEach(u => {
                    const tip = u.knockoutScores?.[rd.key]?.[mi];
                    if (tip && tip.score1 != null && tip.score2 != null) {
                        let bg = 'var(--color-card-bg)', color = '';
                        if (hasL1) {
                            const exact = tip.score1 === m.score1 && tip.score2 === m.score2;
                            const rightWinner = !exact && sign(tip.score1 - tip.score2) === sign(m.score1 - m.score2);
                            if (exact) { bg = 'color-mix(in srgb, #28a745 18%, var(--color-card-bg))'; color = 'color:#28a745;'; }
                            else if (rightWinner) { bg = 'color-mix(in srgb, #1976d2 18%, var(--color-card-bg))'; color = 'color:#1976d2;'; }
                            else { bg = 'color-mix(in srgb, #dc3545 18%, var(--color-card-bg))'; color = 'color:#dc3545;'; }
                        }
                        html += `<td style="font-size:16px; font-weight:800; text-align:center; background:${bg}; ${color}">${tip.score1} - ${tip.score2}</td>`;
                    } else {
                        html += `<td style="color:color-mix(in srgb, var(--color-text) 35%, transparent); text-align:center; background:var(--color-card-bg);">-</td>`;
                    }
                });
                html += `</tr>`;

                // Leg 2 (if two-legged)
                if (twoLeg) {
                    const hasL2 = m.score1_leg2 !== undefined;
                    const l2Score = hasL2 ? `<span style="font-weight:800; padding:0 6px; min-width:36px; text-align:center;">${m.score1_leg2} - ${m.score2_leg2}</span>` : `<span class="compare-team-sep">-</span>`;
                    html += `<tr>`;
                    html += `<td class="compare-match-cell" style="position:sticky; left:0; background:color-mix(in srgb, var(--color-text) 5%, var(--color-card-bg)); z-index:1; border-right:2px solid var(--color-card-border); box-shadow: 2px 0 5px rgba(0,0,0,0.05);">
                        <div class="compare-match-date">${m.date_leg2 || ''} – Match 2 (retur)</div>
                        <div class="compare-match-teams">
                            <span class="compare-team-flag">${f(m.team2)}</span><span class="compare-team-name">${m.team2}</span>
                            ${l2Score}
                            <span class="compare-team-name">${m.team1}</span><span class="compare-team-flag">${f(m.team1)}</span>
                        </div>
                    </td>`;
                    users.forEach(u => {
                        const tip = u.knockoutScores?.[rd.key]?.[mi];
                        if (tip && tip.score1_leg2 != null && tip.score2_leg2 != null) {
                            let bg = 'var(--color-card-bg)', color = '';
                            if (hasL2) {
                                const exact = tip.score1_leg2 === m.score1_leg2 && tip.score2_leg2 === m.score2_leg2;
                                const rightWinner = !exact && sign(tip.score1_leg2 - tip.score2_leg2) === sign(m.score1_leg2 - m.score2_leg2);
                                if (exact) { bg = 'color-mix(in srgb, #28a745 18%, var(--color-card-bg))'; color = 'color:#28a745;'; }
                                else if (rightWinner) { bg = 'color-mix(in srgb, #1976d2 18%, var(--color-card-bg))'; color = 'color:#1976d2;'; }
                                else { bg = 'color-mix(in srgb, #dc3545 18%, var(--color-card-bg))'; color = 'color:#dc3545;'; }
                            }
                            html += `<td style="font-size:16px; font-weight:800; text-align:center; background:${bg}; ${color}">${tip.score1_leg2} - ${tip.score2_leg2}</td>`;
                        } else {
                            html += `<td style="color:color-mix(in srgb, var(--color-text) 35%, transparent); text-align:center; background:var(--color-card-bg);">-</td>`;
                        }
                    });
                    html += `</tr>`;
                }
            });
        });
    }

    if (stages.length === 0 && (!bracket?.rounds || !Object.values(bracket.rounds).some(r => r?.some(m => m.team1)))) {
        html += `<tr><td colspan="${users.length + 1}" style="text-align:center; color:color-mix(in srgb, var(--color-text) 55%, transparent);">Inga matcher hittades.</td></tr>`;
    }

    return html;
}
