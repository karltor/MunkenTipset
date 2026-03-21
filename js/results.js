import { db } from './config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f } from './wizard.js';

const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
let subTabsWired = false;

export async function loadResults(allMatches) {
    const groupsContainer = document.getElementById('results-groups');
    const knockoutContainer = document.getElementById('results-knockout');
    groupsContainer.innerHTML = '<p style="text-align:center; color:#999;">Laddar...</p>';
    knockoutContainer.innerHTML = '<p style="text-align:center; color:#999;">Laddar...</p>';

    const resultsSnap = await getDoc(doc(db, "matches", "_results"));
    const results = resultsSnap.exists() ? resultsSnap.data() : {};

    const bracketSnap = await getDoc(doc(db, "matches", "_bracket"));
    const bracket = bracketSnap.exists() ? bracketSnap.data() : null;

    // Render groups
    groupsContainer.innerHTML = renderGroupTables(allMatches, results);

    // Render knockout
    if (bracket && bracket.teams && bracket.teams.length > 0) {
        knockoutContainer.innerHTML = renderOfficialBracket(bracket);
    } else {
        knockoutContainer.innerHTML = '<div style="background:white; padding: 2rem; border-radius: 12px; text-align: center; color: #999;">Slutspelet har inte startats ännu.</div>';
    }

    // Auto-select sub-tab: show knockout if all group matches are played
    const allGroupMatches = allMatches.filter(m => m.stage?.startsWith('Grupp'));
    const allGroupsDone = allGroupMatches.length > 0 && allGroupMatches.every(m => results[m.id]);
    if (allGroupsDone && bracket?.teams?.length > 0) {
        setActiveSubTab('knockout');
    } else {
        setActiveSubTab('groups');
    }

    // Wire sub-tab buttons once
    if (!subTabsWired) {
        document.querySelectorAll('.results-sub-btn').forEach(btn => {
            btn.addEventListener('click', () => setActiveSubTab(btn.dataset.sub));
        });
        subTabsWired = true;
    }
}

function setActiveSubTab(which) {
    document.querySelectorAll('.results-sub-btn').forEach(b => b.classList.toggle('active', b.dataset.sub === which));
    document.getElementById('results-groups').classList.toggle('active', which === 'groups');
    document.getElementById('results-knockout').classList.toggle('active', which === 'knockout');
}

function renderGroupTables(allMatches, results) {
    let html = '<div class="tables-grid">';
    GROUP_LETTERS.forEach(letter => {
        const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);
        if (groupMatches.length === 0) return;

        const teams = Array.from(new Set(groupMatches.flatMap(m => [m.homeTeam, m.awayTeam])));
        const tData = {};
        teams.forEach(t => tData[t] = { name: t, pld: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 });

        let hasAnyResult = false;
        let matchListHtml = '';

        groupMatches.forEach(m => {
            const r = results[m.id];
            if (r && r.homeScore !== undefined) {
                hasAnyResult = true;
                const h = r.homeScore, a = r.awayScore;
                tData[m.homeTeam].pld++; tData[m.awayTeam].pld++;
                tData[m.homeTeam].gf += h; tData[m.homeTeam].ga += a;
                tData[m.awayTeam].gf += a; tData[m.awayTeam].ga += h;
                tData[m.homeTeam].gd += (h - a); tData[m.awayTeam].gd += (a - h);
                if (h > a) { tData[m.homeTeam].w++; tData[m.homeTeam].pts += 3; tData[m.awayTeam].l++; }
                else if (a > h) { tData[m.awayTeam].w++; tData[m.awayTeam].pts += 3; tData[m.homeTeam].l++; }
                else { tData[m.homeTeam].d++; tData[m.awayTeam].d++; tData[m.homeTeam].pts++; tData[m.awayTeam].pts++; }
                const hw = h > a ? 'font-weight:700;' : '', aw = a > h ? 'font-weight:700;' : '';
                matchListHtml += `<div style="font-size:12px; padding:3px 0; display:flex; justify-content:space-between;">
                    <span style="${hw}">${f(m.homeTeam)}${m.homeTeam}</span><span style="font-weight:700;">${h} - ${a}</span><span style="${aw}">${m.awayTeam}${f(m.awayTeam)}</span>
                </div>`;
            } else {
                matchListHtml += `<div style="font-size:12px; padding:3px 0; color:#aaa; display:flex; justify-content:space-between;">
                    <span>${f(m.homeTeam)}${m.homeTeam}</span><span>${m.date || '— : —'}</span><span>${m.awayTeam}${f(m.awayTeam)}</span>
                </div>`;
            }
        });

        const sorted = Object.values(tData).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
        html += `<div class="group-table-card">
            <div class="group-table-header">Grupp ${letter}</div>
            <table class="group-table">
                <thead><tr><th style="text-align:left;">Lag</th><th>S</th><th>V</th><th>O</th><th>F</th><th>+/-</th><th>P</th></tr></thead>
                <tbody>`;
        sorted.forEach((t, i) => {
            const bg = i < 2 ? 'background-color: rgba(40,167,69,0.06);' : '';
            html += `<tr style="${bg}"><td style="text-align:left;padding-left:6px;">${f(t.name)}${t.name}</td>
                <td>${t.pld}</td><td>${t.w}</td><td>${t.d}</td><td>${t.l}</td>
                <td>${t.gd > 0 ? '+' + t.gd : t.gd}</td><td><strong>${t.pts}</strong></td></tr>`;
        });
        html += `</tbody></table>`;
        if (hasAnyResult) html += `<div style="padding: 8px 12px; border-top: 1px solid #eee;">${matchListHtml}</div>`;
        html += `</div>`;
    });
    html += '</div>';
    return html;
}

function renderOfficialBracket(bracket) {
    const rounds = ['R32', 'R16', 'KF', 'SF', 'Final'];
    const roundLabels = { R32: 'Åttondelsfinaler', R16: 'Kvartsfinaler', KF: 'Kvartsfinaler', SF: 'Semifinaler', Final: 'Final' };
    const rd = bracket.rounds || {};

    // Build proper bracket tree - left side (top half) and right side (bottom half)
    // R32 has 16 matches, split 8 left + 8 right, converging to center final
    let html = `<div style="background: linear-gradient(135deg, #1f1f3a, #2b2b52); border-radius: 16px; padding: 20px; overflow-x: auto;">`;
    html += `<div class="bracket-tree">`;

    // Left half: matches 0-7 of each round
    html += `<div class="bracket-half bracket-left">`;
    for (let r = 0; r < rounds.length - 1; r++) {
        const roundName = rounds[r];
        const matches = rd[roundName] || [];
        const halfCount = Math.pow(2, 3 - r); // 8,4,2,1
        html += `<div class="bracket-round-col">`;
        if (r === 0) html += `<div class="bracket-round-label">${roundLabels[roundName] || roundName}</div>`;
        for (let i = 0; i < halfCount; i++) {
            const m = matches[i] || {};
            html += renderBracketMatch(m);
        }
        html += `</div>`;
    }
    // Final in center
    const finalMatch = (rd['Final'] || [])[0] || {};
    html += `<div class="bracket-round-col bracket-final-col">`;
    html += `<div class="bracket-round-label" style="color:#ffc107;">Final</div>`;
    html += renderBracketMatch(finalMatch, true);
    html += `</div>`;
    // Right half: matches 8-15 (reversed order for mirror effect)
    for (let r = rounds.length - 2; r >= 0; r--) {
        const roundName = rounds[r];
        const matches = rd[roundName] || [];
        const halfCount = Math.pow(2, 3 - r);
        const offset = halfCount; // second half of matches
        html += `<div class="bracket-round-col">`;
        if (r === 0) html += `<div class="bracket-round-label">${roundLabels[roundName] || roundName}</div>`;
        for (let i = 0; i < halfCount; i++) {
            const m = matches[offset + i] || {};
            html += renderBracketMatch(m);
        }
        html += `</div>`;
    }
    html += `</div>`; // bracket-half
    html += `</div></div>`;
    return html;
}

function renderBracketMatch(match, isFinal) {
    const t1 = match.team1 || 'TBD';
    const t2 = match.team2 || 'TBD';
    const s1 = match.score1 ?? '';
    const s2 = match.score2 ?? '';
    const w = match.winner;
    const t1w = w === t1, t2w = w === t2;
    const sz = isFinal ? 'font-size:13px; padding:6px 10px;' : '';

    return `<div class="bracket-matchup${isFinal ? ' bracket-matchup-final' : ''}">
        <div class="bracket-slot${t1w ? ' winner' : ''}${!match.team1 ? ' empty' : ''}" style="${sz}">
            <span>${match.team1 ? f(t1) : ''}${t1}</span><span class="bracket-score">${s1}</span>
        </div>
        <div class="bracket-slot${t2w ? ' winner' : ''}${!match.team2 ? ' empty' : ''}" style="${sz}">
            <span>${match.team2 ? f(t2) : ''}${t2}</span><span class="bracket-score">${s2}</span>
        </div>
    </div>`;
}
