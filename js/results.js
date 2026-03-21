import { db } from './config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f, flags } from './wizard.js';

const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

export async function loadResults(allMatches) {
    const container = document.getElementById('results-container');
    container.innerHTML = '<p style="text-align:center; color:#999;">Laddar matchresultat...</p>';

    // Load official results from admin
    const resultsRef = doc(db, "matches", "_results");
    const resultsSnap = await getDoc(resultsRef);
    const results = resultsSnap.exists() ? resultsSnap.data() : {};

    // Load official bracket
    const bracketRef = doc(db, "matches", "_bracket");
    const bracketSnap = await getDoc(bracketRef);
    const bracket = bracketSnap.exists() ? bracketSnap.data() : null;

    let html = '<h2>Matchresultat</h2>';

    // Group tables
    html += '<h3>Gruppspel</h3><div class="tables-grid">';
    GROUP_LETTERS.forEach(letter => {
        const groupMatches = allMatches.filter(m => m.stage === `Grupp ${letter}`);
        if (groupMatches.length === 0) return;

        const teams = Array.from(new Set(groupMatches.flatMap(m => [m.homeTeam, m.awayTeam])));
        const tData = {};
        teams.forEach(t => tData[t] = { name: t, pld: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 });

        let hasAnyResult = false;

        // Build table + match list
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

                matchListHtml += `<div style="font-size:12px; padding:3px 0; display:flex; justify-content:space-between;">
                    <span>${f(m.homeTeam)}${m.homeTeam}</span><span style="font-weight:700;">${h} - ${a}</span><span>${m.awayTeam}${f(m.awayTeam)}</span>
                </div>`;
            } else {
                const dateStr = m.date || '';
                matchListHtml += `<div style="font-size:12px; padding:3px 0; color:#aaa; display:flex; justify-content:space-between;">
                    <span>${f(m.homeTeam)}${m.homeTeam}</span><span>${dateStr || '— : —'}</span><span>${m.awayTeam}${f(m.awayTeam)}</span>
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

    // Official bracket
    html += '<h3 style="margin-top: 30px;">Slutspel</h3>';
    if (bracket && bracket.teams && bracket.teams.length > 0) {
        html += renderOfficialBracket(bracket);
    } else {
        html += '<div style="background:white; padding: 2rem; border-radius: 12px; text-align: center; color: #999;">Slutspelet har inte startats ännu.</div>';
    }

    container.innerHTML = html;
}

function renderOfficialBracket(bracket) {
    const rounds = ['R32', 'R16', 'KF', 'SF', 'Final'];
    const roundData = bracket.rounds || {};

    let html = `<div style="background: linear-gradient(135deg, #1f1f3a, #2b2b52); border-radius: 16px; padding: 20px; overflow-x: auto;">`;
    html += `<div class="bracket-visual">`;

    // Left side rounds
    for (let r = 0; r < rounds.length; r++) {
        const roundName = rounds[r];
        const matches = roundData[roundName] || [];
        const isCenter = r === rounds.length - 1;

        html += `<div class="bracket-round">`;
        html += `<div class="bracket-round-header" style="color: ${isCenter ? '#ffc107' : '#aaa'};">${roundName}</div>`;

        if (matches.length === 0) {
            const expectedMatches = Math.pow(2, rounds.length - 1 - r);
            for (let i = 0; i < expectedMatches; i++) {
                html += `<div class="bracket-match">`;
                html += `<div class="bracket-slot empty" style="color:#666;">TBD</div>`;
                html += `<div class="bracket-slot empty" style="color:#666;">TBD</div>`;
                html += `</div>`;
            }
        } else {
            matches.forEach(match => {
                const t1 = match.team1 || 'TBD';
                const t2 = match.team2 || 'TBD';
                const s1 = match.score1 ?? '';
                const s2 = match.score2 ?? '';
                const w = match.winner;
                const t1Style = w === t1 ? 'font-weight:800;' : (w ? 'opacity:0.5;' : '');
                const t2Style = w === t2 ? 'font-weight:800;' : (w ? 'opacity:0.5;' : '');

                html += `<div class="bracket-match">`;
                html += `<div class="bracket-slot" style="${t1Style}">${f(t1)}${t1}<span style="margin-left:auto;font-weight:700;">${s1}</span></div>`;
                html += `<div class="bracket-slot" style="${t2Style}">${f(t2)}${t2}<span style="margin-left:auto;font-weight:700;">${s2}</span></div>`;
                html += `</div>`;
            });
        }
        html += `</div>`;
    }

    html += `</div></div>`;
    return html;
}
