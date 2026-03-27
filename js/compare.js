import { auth } from './config.js';
import { f } from './wizard.js';

const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

let _comparisonState = {
    selectedUsers: [],
    viewMode: 'simple'
};

// References set by stats.js before calling
let _cachedUsers = null;
let _cachedScores = null;
let _cachedScoring = null;
let _loadCommunityStats = null;

export function initCompareState(users, scores, scoring, loadFn) {
    _cachedUsers = users;
    _cachedScores = scores;
    _cachedScoring = scoring;
    _loadCommunityStats = loadFn;
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
        <label style="font-weight:700; font-size:13px; display:block; margin-bottom:8px; color:#555;">1. Välj vy:</label>
        <div class="tabs" style="border:none; margin:0; padding:0; gap:5px;">
            <button class="tab-btn active" id="btn-view-simple" style="padding:8px 12px; font-size:13px; flex:1;">Grupper</button>
            <button class="tab-btn" id="btn-view-knockout" style="padding:8px 12px; font-size:13px; flex:1;">Slutspel</button>
            <button class="tab-btn" id="btn-view-advanced" style="padding:8px 12px; font-size:13px; flex:1;">Matcher</button>
        </div>
    </div>`;

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
    html += `</div>`;

    html += `<div id="comparison-table-container" class="stat-card" style="padding:0; overflow-x:auto;">
        <p style="text-align:center; color:#888; padding:30px;">Välj minst en tipsare ovan för att se tabellen.</p>
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
        container.innerHTML = `<p style="text-align:center; color:#888; padding:30px;">Välj minst en tipsare ovan för att se tabellen.</p>`;
        return;
    }

    const users = _cachedUsers.filter(u => selectedIds.includes(u.userId));

    let html = `<table class="group-table" style="width:100%; min-width:${selectedIds.length * 140 + 200}px; border-collapse: separate; border-spacing: 0;">`;

    html += `<thead><tr>`;
    html += `<th style="text-align:left; position:sticky; left:0; background:#1a1a1a; color:white; z-index:2; box-shadow: 2px 0 5px rgba(0,0,0,0.1);">Fas</th>`;
    users.forEach(u => {
        html += `<th style="background:#1a1a1a; color:white; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:140px;">${u.name}</th>`;
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

    html += `<tr>`;
    html += `<td style="font-weight:700; position:sticky; left:0; background:#fffdf5; z-index:1; border-right:2px solid #ddd; color:#d4a017; box-shadow: 2px 0 5px rgba(0,0,0,0.05);">🏆 VM-mästare</td>`;
    users.forEach(u => {
        const fin = u.knockoutPicks?.final;
        if (fin) {
            html += `<td style="background:#fffdf5; font-weight:700; color:#d4a017;">${f(fin)}${fin}</td>`;
        } else {
            html += `<td style="background:#fffdf5; color:#ccc; text-align:center;">-</td>`;
        }
    });
    html += `</tr>`;
    return html;
}

function renderKnockoutView(users) {
    let html = '';
    const koRoundDefs = [
        { key: 'r32', label: 'Åttondelsfinal (16 lag)' },
        { key: 'r16', label: 'Kvartsfinal (8 lag)' },
        { key: 'qf', label: 'Semifinal (4 lag)' },
        { key: 'sf', label: 'Final (2 lag)' },
        { key: 'final', label: '🏆 VM-mästare' }
    ];

    koRoundDefs.forEach(round => {
        html += `<tr><td colspan="${users.length + 1}" style="background:#1f1f3a; color:#ffc107; font-weight:700; text-align:center; padding:8px; font-size:13px; position:sticky; left:0; z-index:1;">${round.label}</td></tr>`;

        const teamPickCount = {};
        users.forEach(u => {
            if (!u.knockoutPicks) return;
            if (round.key === 'final') {
                if (u.knockoutPicks.final) teamPickCount[u.knockoutPicks.final] = (teamPickCount[u.knockoutPicks.final] || 0) + 1;
            } else {
                (u.knockoutPicks[round.key] || []).forEach(t => { teamPickCount[t] = (teamPickCount[t] || 0) + 1; });
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
            html += `<tr><td colspan="${users.length + 1}" style="text-align:center; color:#888; padding:10px; background:white;">Inga tips registrerade</td></tr>`;
            return;
        }

        let shownDivider = false;
        teamList.forEach(team => {
            const isShared = teamPickCount[team] === users.length;
            if (!isShared && !shownDivider && users.length > 1) {
                shownDivider = true;
                html += `<tr><td colspan="${users.length + 1}" style="background:#2b2b52; color:#aaa; text-align:center; font-size:11px; padding:4px; font-style:italic;">Skiljer sig</td></tr>`;
            }
            const rowBg = isShared ? '#f0faf0' : 'white';
            html += `<tr>`;
            html += `<td style="font-weight:600; position:sticky; left:0; background:${isShared ? '#e8f5e9' : '#f4f7f6'}; z-index:1; border-right:2px solid #ddd; box-shadow: 2px 0 5px rgba(0,0,0,0.05); white-space:nowrap; font-size:12px;">${f(team)}${team}</td>`;

            users.forEach(u => {
                if (!u.knockoutPicks) { html += `<td style="background:${rowBg}; text-align:center; color:#ccc;">-</td>`; return; }
                const hasPick = round.key === 'final'
                    ? u.knockoutPicks.final === team
                    : (u.knockoutPicks[round.key] || []).includes(team);

                if (hasPick) {
                    html += `<td style="background:${isShared ? '#e8f5e9' : '#fff8e1'}; text-align:center; font-size:16px;">${isShared ? '✅' : '⚡'}</td>`;
                } else {
                    html += `<td style="background:${rowBg}; text-align:center; color:#e0e0e0;">–</td>`;
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
        html += `<tr><td colspan="${users.length + 1}" style="background:#e9ecef; font-weight:700; text-align:center; padding:6px; font-size:12px; position:sticky; left:0; z-index:1;">${stage}</td></tr>`;

        groupedMatches[stage].sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true })).forEach(m => {
            html += `<tr>`;

            html += `<td class="compare-match-cell" style="position:sticky; left:0; background:#f4f7f6; z-index:1; border-right:2px solid #ddd; box-shadow: 2px 0 5px rgba(0,0,0,0.05);">
                <div class="compare-match-date">${m.date || ''}</div>
                <div class="compare-match-teams">
                    <span class="compare-team-flag">${f(m.homeTeam)}</span><span class="compare-team-name">${m.homeTeam}</span>
                    <span class="compare-team-sep">-</span>
                    <span class="compare-team-name">${m.awayTeam}</span><span class="compare-team-flag">${f(m.awayTeam)}</span>
                </div>
            </td>`;

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
    return html;
}
