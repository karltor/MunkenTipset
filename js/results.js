import { db } from './config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f } from './wizard.js';
import { getGroupLetters, getKnockoutRounds, getFinalRound, hasStageType } from './tournament-config.js';
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

    // Hide groups sub-tab when no group stage exists
    const hasGroups = hasStageType('round-robin-groups');
    const groupsBtn = document.querySelector('.results-sub-btn[data-sub="groups"]');
    if (groupsBtn) groupsBtn.style.display = hasGroups ? '' : 'none';

    // Auto-select sub-tab: show knockout if no groups or all group matches are played
    if (!hasGroups) {
        setActiveSubTab('knockout');
    } else {
        const allGroupMatches = allMatches.filter(m => m.stage?.startsWith('Grupp'));
        const allGroupsDone = allGroupMatches.length > 0 && allGroupMatches.every(m => results[m.id]);
        if (allGroupsDone && bracket?.teams?.length > 0) {
            setActiveSubTab('knockout');
        } else {
            setActiveSubTab('groups');
        }
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
    getGroupLetters().forEach(letter => {
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
                matchListHtml += `<div style="font-size:12px; padding:3px 0; display:flex; align-items:center;">
                    <span style="flex:1; text-align:left; ${hw}">${f(m.homeTeam)}${m.homeTeam}</span><span style="flex:0 0 auto; font-weight:700; padding:0 8px;">${h} - ${a}</span><span style="flex:1; text-align:right; ${aw}">${m.awayTeam}${f(m.awayTeam)}</span>
                </div>`;
            } else {
                matchListHtml += `<div style="font-size:12px; padding:3px 0; color:#aaa; display:flex; align-items:center;">
                    <span style="flex:1; text-align:left;">${f(m.homeTeam)}${m.homeTeam}</span><span style="flex:0 0 auto; padding:0 8px;">${m.date || '— : —'}</span><span style="flex:1; text-align:right;">${m.awayTeam}${f(m.awayTeam)}</span>
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
    const rd = bracket.rounds || {};

    const koRounds = getKnockoutRounds();
    const finalRound = getFinalRound();
    const nonFinal = koRounds.filter(r => r !== finalRound);
    const leftRounds = nonFinal.map(r => ({
        key: r.adminKey, label: r.label, start: 0, count: r.teams / 4
    }));
    const rightRounds = [...nonFinal].reverse().map(r => ({
        key: r.adminKey, label: r.label, start: r.teams / 4, count: r.teams / 4
    }));

    let html = `<div style="background: linear-gradient(135deg, #1f1f3a, #2b2b52); border-radius: 16px; padding: 20px; overflow-x: auto;">`;
    html += `<div class="br-tree">`;

    // Left half
    leftRounds.forEach((round, ri) => {
        html += `<div class="br-round br-left">`;
        html += `<div class="br-round-label">${round.label}</div>`;
        html += `<div class="br-round-matches">`;
        html += buildPairedMatches(rd, round, ri, 'left');
        html += `</div></div>`;
    });

    // Final (center)
    const finalAdminKey = finalRound?.adminKey || 'Final';
    const finalMatch = (rd[finalAdminKey] || [])[0] || {};
    html += `<div class="br-round br-final-round">`;
    html += `<div class="br-round-label br-final-label">${(finalRound?.label || 'FINAL').toUpperCase()}</div>`;
    html += `<div class="br-round-matches">`;
    html += `<div class="br-slot">${renderBracketMatch(finalMatch, true)}</div>`;
    html += `</div></div>`;

    // Right half (mirrored)
    rightRounds.forEach((round, ri) => {
        const depth = nonFinal.length - 1 - ri;
        html += `<div class="br-round br-right">`;
        html += `<div class="br-round-label">${round.label}</div>`;
        html += `<div class="br-round-matches">`;
        html += buildPairedMatches(rd, round, depth, 'right');
        html += `</div></div>`;
    });

    html += `</div></div>`;
    return html;
}

function buildPairedMatches(rd, round, depth, side) {
    const matches = [];
    for (let i = 0; i < round.count; i++) {
        matches.push((rd[round.key] || [])[round.start + i] || {});
    }
    // If only 1 match, no pairing needed — just a single slot with connector
    if (matches.length === 1) {
        return `<div class="br-slot br-conn-${side}">${renderBracketMatch(matches[0])}</div>`;
    }
    // Wrap matches in pairs: [0,1], [2,3], etc.
    let html = '';
    for (let i = 0; i < matches.length; i += 2) {
        html += `<div class="br-pair br-pair-${side}">`;
        html += `<div class="br-slot">${renderBracketMatch(matches[i])}</div>`;
        if (i + 1 < matches.length) {
            html += `<div class="br-slot">${renderBracketMatch(matches[i + 1])}</div>`;
        }
        html += `</div>`;
    }
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
    const dateStr = match.date ? `<div style="font-size:10px; color:#aaa; text-align:center; padding:2px 0;">${match.date}</div>` : '';
    const hasTwoLegs = match.score1_leg2 !== undefined && match.score2_leg2 !== undefined;

    let html = `<div class="abt-match" style="pointer-events:none;">`;

    if (hasTwoLegs) {
        html += `<div style="font-size:9px; color:#17a2b8; font-weight:600; text-align:center; padding:2px 0;">MATCH 1</div>`;
    }
    html += dateStr;
    html += `<div class="abt-team-row" style="${sz}${t1w ? 'background:rgba(40,167,69,0.15);' : ''}${!match.team1 ? 'opacity:0.4;' : ''}">
            <span style="flex:1;">${match.team1 ? f(t1) : ''}${t1}</span><span style="font-weight:700; min-width:20px; text-align:right;">${s1}</span>
        </div>
        <div class="abt-team-row" style="${sz}${t2w ? 'background:rgba(40,167,69,0.15);' : ''}${!match.team2 ? 'opacity:0.4;' : ''}">
            <span style="flex:1;">${match.team2 ? f(t2) : ''}${t2}</span><span style="font-weight:700; min-width:20px; text-align:right;">${s2}</span>
        </div>`;

    if (hasTwoLegs) {
        const dateStr2 = match.date_leg2 ? `<div style="font-size:10px; color:#aaa; text-align:center; padding:2px 0;">${match.date_leg2}</div>` : '';
        html += `<div style="border-top:1px dashed rgba(255,255,255,0.1); margin:3px 0;"></div>`;
        html += `<div style="font-size:9px; color:#ffc107; font-weight:600; text-align:center; padding:2px 0;">MATCH 2</div>`;
        html += dateStr2;
        html += `<div class="abt-team-row" style="${sz}${t2w ? 'background:rgba(40,167,69,0.15);' : ''}">
            <span style="flex:1;">${match.team2 ? f(t2) : ''}${t2}</span><span style="font-weight:700; min-width:20px; text-align:right;">${match.score1_leg2}</span>
        </div>
        <div class="abt-team-row" style="${sz}${t1w ? 'background:rgba(40,167,69,0.15);' : ''}">
            <span style="flex:1;">${match.team1 ? f(t1) : ''}${t1}</span><span style="font-weight:700; min-width:20px; text-align:right;">${match.score2_leg2}</span>
        </div>`;

        const t1agg = (match.score1 || 0) + (match.score2_leg2 || 0);
        const t2agg = (match.score2 || 0) + (match.score1_leg2 || 0);
        let aggText = `${t1} ${t1agg} – ${t2agg} ${t2}`;
        if (t1agg === t2agg && w) aggText += ` (str.)`;
        html += `<div style="font-size:10px; color:#ccc; text-align:center; padding:4px 0; border-top:1px solid rgba(255,255,255,0.05);">Totalt: ${aggText}</div>`;
    }

    html += `</div>`;
    return html;
}
