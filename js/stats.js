import { db, auth } from './config.js';
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f, flags } from './wizard.js';

const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

export async function loadCommunityStats() {
    const container = document.getElementById('community-stats');
    container.innerHTML = '<p style="text-align:center; color:#999;">Laddar...</p>';

    // Load official results + bracket
    const [resultsSnap, bracketSnap] = await Promise.all([
        getDoc(doc(db, "matches", "_results")),
        getDoc(doc(db, "matches", "_bracket"))
    ]);
    const results = resultsSnap.exists() ? resultsSnap.data() : {};
    const bracket = bracketSnap.exists() ? bracketSnap.data() : null;

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

    if (users.length === 0) {
        container.innerHTML = `<div class="stat-card" style="text-align:center;"><p style="color:#999;">Ingen har tippat ännu. Bli den första!</p></div>`;
        return;
    }

    const currentUserId = auth.currentUser?.uid;
    const playedMatches = Object.entries(results).filter(([, r]) => r.homeScore !== undefined);
    let html = '';

    // ── LEADERBOARD ──────────────────────────────────
    const scores = calcLeaderboard(users, results, bracket);
    html += `<div class="stat-card"><h3>Leaderboard</h3>`;
    html += `<table class="group-table" style="font-size:14px;"><thead><tr><th style="text-align:left;">Namn</th><th>Grupp</th><th>Slutspel</th><th>Totalt</th></tr></thead><tbody>`;
    scores.sort((a, b) => b.total - a.total);
    scores.forEach((s, i) => {
        const isMe = s.userId === currentUserId;
        const medal = i === 0 ? '🥇 ' : (i === 1 ? '🥈 ' : (i === 2 ? '🥉 ' : ''));
        const style = isMe ? 'background:rgba(40,167,69,0.08); font-weight:700;' : '';
        html += `<tr style="${style}"><td style="text-align:left;padding-left:6px;">${medal}${s.name}</td><td>${s.groupPts}</td><td>${s.koPts}</td><td><strong>${s.total}</strong></td></tr>`;
    });
    html += `</tbody></table></div>`;

    // ── RECENT RESULTS ──────────────────────────────
    if (playedMatches.length > 0) {
        html += `<h3 style="margin-top:20px;">Senaste resultat</h3>`;
        // Sort by date descending (latest first), show max 6
        const sorted = playedMatches.sort((a, b) => {
            const da = a[1].date || '', db2 = b[1].date || '';
            return db2.localeCompare(da);
        }).slice(0, 6);

        html += `<div class="stats-grid">`;
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
            html += `<div class="stat-card" style="padding:14px;">`;
            html += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="${hw}">${f(r.homeTeam)}${r.homeTeam}</span>
                <span style="font-size:1.3rem; font-weight:800; letter-spacing:2px;">${h} - ${a}</span>
                <span style="${aw}">${r.awayTeam}${f(r.awayTeam)}</span>
            </div>`;
            if (exactTippers.length > 0) {
                html += `<div style="font-size:12px; color:#28a745; margin-top:4px;">🎯 ${exactTippers.join(' & ')} tipsade exakt rätt!</div>`;
            }
            if (winnerTippers.length > 0) {
                html += `<div style="font-size:12px; color:#17a2b8; margin-top:2px;">✓ ${winnerTippers.length} ${winnerTippers.length === 1 ? 'person' : 'andra'} tippade rätt vinnare</div>`;
            }
            if (exactTippers.length === 0 && winnerTippers.length === 0) {
                html += `<div style="font-size:12px; color:#999; margin-top:4px;">Ingen tippade rätt</div>`;
            }
            html += `</div>`;
        });
        html += `</div>`;
    }

    // ── MY TIPS ──────────────────────────────────────
    const me = users.find(u => u.userId === currentUserId);
    if (me && me.groupPicks) {
        html += `<h3 style="margin-top:20px;">Min tipsrad</h3>`;
        html += `<div class="stat-card"><div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:6px; font-size:13px;">`;
        GROUP_LETTERS.forEach(letter => {
            const pick = me.groupPicks[letter];
            if (!pick) return;
            html += `<div><strong>Grupp ${letter}:</strong> ${f(pick.first)}${pick.first} · ${f(pick.second)}${pick.second}</div>`;
        });
        html += `</div>`;
        if (me.knockoutPicks?.final) {
            html += `<div style="margin-top:10px; font-size:14px; font-weight:700;">🏆 VM-mästare: ${f(me.knockoutPicks.final)}${me.knockoutPicks.final}</div>`;
        }
        html += `</div>`;
    }

    // ── COMMUNITY STATS ──────────────────────────────
    html += `<h3 style="margin-top:20px;">Alla tipsare (${users.length} st)</h3>`;
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

    // Champion picks
    const champCounts = {};
    users.forEach(u => { if (u.knockoutPicks?.final) champCounts[u.knockoutPicks.final] = (champCounts[u.knockoutPicks.final] || 0) + 1; });
    if (Object.keys(champCounts).length > 0) {
        html += `<div class="stat-card"><h3>🏆 Tippade VM-mästare</h3>`;
        const totalC = Object.values(champCounts).reduce((a, b) => a + b, 0);
        Object.entries(champCounts).sort((a, b) => b[1] - a[1]).forEach(([team, count]) => {
            html += renderStatBar(team, Math.round((count / totalC) * 100));
        });
        html += `</div>`;
    }

    container.innerHTML = html;
    window._allPicks = users.map(u => ({ userId: u.userId, name: u.name, picks: u.groupPicks || {} }));
}

// ── SCORING ──────────────────────────────────────────
function calcLeaderboard(users, results, bracket) {
    const koPointMap = { r32: 2, r16: 2, qf: 2, sf: 5, final: 10 };
    // Get official bracket winners per round
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
        // Score individual match tips against official results
        Object.entries(u.matchTips).forEach(([matchId, tip]) => {
            const r = results[matchId];
            if (!r || r.homeScore === undefined) return;
            const tipSign = sign(tip.homeScore - tip.awayScore);
            const realSign = sign(r.homeScore - r.awayScore);
            if (tipSign === realSign) groupPts += 1; // correct 1X2
            if (tip.homeScore === r.homeScore) groupPts += 1; // correct home goals
            if (tip.awayScore === r.awayScore) groupPts += 1; // correct away goals
        });

        let koPts = 0;
        if (u.knockoutPicks) {
            Object.entries(koPointMap).forEach(([round, pts]) => {
                const winners = officialWinners[round] || [];
                if (winners.length === 0) return;
                if (round === 'final') {
                    if (u.knockoutPicks.final && winners.includes(u.knockoutPicks.final)) koPts += pts;
                } else {
                    const userPicks = u.knockoutPicks[round] || [];
                    userPicks.forEach(team => { if (winners.includes(team)) koPts += pts; });
                }
            });
        }

        return { userId: u.userId, name: u.name, groupPts, koPts, total: groupPts + koPts };
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
    let html = '<div style="font-size: 13px;">';
    GROUP_LETTERS.forEach(letter => {
        if (userPick.picks[letter]) {
            html += `<div style="margin-bottom:4px;"><strong>Grupp ${letter}:</strong> ${f(userPick.picks[letter].first)}${userPick.picks[letter].first} · ${f(userPick.picks[letter].second)}${userPick.picks[letter].second}</div>`;
        }
    });
    html += '</div>';
    el.innerHTML = html;
    el.style.display = 'block';
};
