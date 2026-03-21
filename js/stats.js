import { db } from './config.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f, flags } from './wizard.js';

const groupLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

export async function loadCommunityStats() {
    const container = document.getElementById('community-stats');
    container.innerHTML = '<p style="text-align:center; color:#999;">Laddar tipsstatistik...</p>';

    const usersSnap = await getDocs(collection(db, "users"));
    const allPicks = [];
    const allKnockouts = [];
    const userNames = {};

    for (const userDoc of usersSnap.docs) {
        const userId = userDoc.id;
        const tipsSnap = await getDocs(collection(db, "users", userId, "tips"));
        let groupPicks = null;
        let knockoutPicks = null;
        let displayName = userId;

        tipsSnap.forEach(tipDoc => {
            if (tipDoc.id === '_groupPicks') groupPicks = tipDoc.data();
            else if (tipDoc.id === '_knockout') knockoutPicks = tipDoc.data();
            else if (tipDoc.id === '_profile') displayName = tipDoc.data().name || userId;
        });

        if (groupPicks) {
            allPicks.push({ userId, name: displayName, picks: groupPicks });
        }
        if (knockoutPicks) {
            allKnockouts.push({ userId, name: displayName, picks: knockoutPicks });
        }
        userNames[userId] = displayName;
    }

    if (allPicks.length === 0) {
        container.innerHTML = `
            <div style="background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); text-align: center;">
                <p style="color: #999;">Ingen har tippat ännu. Bli den första!</p>
            </div>`;
        return;
    }

    let html = '';

    // Section: All users' tips
    html += `<h3 style="margin-top: 20px;">Alla tipsare (${allPicks.length} st)</h3>`;
    html += `<div class="stats-grid" style="margin-bottom: 30px;">`;
    allPicks.forEach(p => {
        const completed = p.picks.completedAt ? '✅ Klar' : '⏳ Pågår';
        const mode = p.picks.mode === 'detailed' ? '📊 Detaljerat' : '🎯 Snabbtips';
        html += `
            <div class="user-tip-card" onclick="window.toggleUserDetail('${p.userId}')">
                <h4>${p.name}</h4>
                <div class="tip-summary">${completed} · ${mode}</div>
                <div id="user-detail-${p.userId}" style="display:none; margin-top: 10px;"></div>
            </div>`;
    });
    html += `</div>`;

    // Section: Group statistics
    html += `<h3>Gruppspelsstatistik</h3>`;
    html += `<div class="stats-grid">`;

    groupLetters.forEach(letter => {
        const teamCounts = { first: {}, second: {} };
        let total = 0;

        allPicks.forEach(p => {
            if (p.picks[letter]) {
                total++;
                const first = p.picks[letter].first;
                const second = p.picks[letter].second;
                teamCounts.first[first] = (teamCounts.first[first] || 0) + 1;
                teamCounts.second[second] = (teamCounts.second[second] || 0) + 1;
            }
        });

        if (total === 0) return;

        html += `<div class="stat-card"><h3>Grupp ${letter}</h3>`;
        html += `<p style="font-size:12px; color:#999; margin-top:-5px;">Tippade grupettor:</p>`;
        const sortedFirst = Object.entries(teamCounts.first).sort((a, b) => b[1] - a[1]);
        sortedFirst.forEach(([team, count]) => {
            const pct = Math.round((count / total) * 100);
            html += renderStatBar(team, pct);
        });

        html += `<p style="font-size:12px; color:#999; margin-top:10px;">Tippade grupptvåor:</p>`;
        const sortedSecond = Object.entries(teamCounts.second).sort((a, b) => b[1] - a[1]);
        sortedSecond.forEach(([team, count]) => {
            const pct = Math.round((count / total) * 100);
            html += renderStatBar(team, pct);
        });
        html += `</div>`;
    });
    html += `</div>`;

    // Section: Knockout statistics
    if (allKnockouts.length > 0) {
        html += `<h3 style="margin-top: 30px;">Slutspelsstatistik</h3>`;
        html += `<div class="stats-grid">`;

        // Champions
        const champCounts = {};
        allKnockouts.forEach(k => {
            if (k.picks.final) {
                champCounts[k.picks.final] = (champCounts[k.picks.final] || 0) + 1;
            }
        });
        if (Object.keys(champCounts).length > 0) {
            html += `<div class="stat-card"><h3>🏆 Tippade VM-mästare</h3>`;
            const sortedChamps = Object.entries(champCounts).sort((a, b) => b[1] - a[1]);
            const totalChamps = allKnockouts.filter(k => k.picks.final).length;
            sortedChamps.forEach(([team, count]) => {
                const pct = Math.round((count / totalChamps) * 100);
                html += renderStatBar(team, pct);
            });
            html += `</div>`;
        }

        // Semifinalists
        const sfCounts = {};
        allKnockouts.forEach(k => {
            if (k.picks.sf) k.picks.sf.forEach(t => sfCounts[t] = (sfCounts[t] || 0) + 1);
        });
        if (Object.keys(sfCounts).length > 0) {
            html += `<div class="stat-card"><h3>Tippade semifinalister</h3>`;
            const sortedSf = Object.entries(sfCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
            const totalSf = allKnockouts.filter(k => k.picks.sf).length || 1;
            sortedSf.forEach(([team, count]) => {
                const pct = Math.round((count / totalSf) * 100);
                html += renderStatBar(team, pct);
            });
            html += `</div>`;
        }

        html += `</div>`;
    }

    container.innerHTML = html;

    // Store for detail toggling
    window._allPicks = allPicks;
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
    if (el.style.display !== 'none') {
        el.style.display = 'none';
        return;
    }

    const userPick = window._allPicks?.find(p => p.userId === userId);
    if (!userPick) return;

    let html = '<div style="font-size: 13px;">';
    groupLetters.forEach(letter => {
        if (userPick.picks[letter]) {
            html += `<div style="margin-bottom: 4px;"><strong>Grupp ${letter}:</strong> ${f(userPick.picks[letter].first)}${userPick.picks[letter].first} · ${f(userPick.picks[letter].second)}${userPick.picks[letter].second}</div>`;
        }
    });
    html += '</div>';
    el.innerHTML = html;
    el.style.display = 'block';
};
