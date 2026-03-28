import { db } from './config.js';
import { doc, getDoc, setDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { flags } from './wizard.js';
import { DEFAULT_SCORING, buildOfficialGroupStandings, calcLeaderboard, sign, parseMatchDate } from './scoring.js';

const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const ROUND_NAMES = { 'R32': 'Sextondelsfinal', 'R16': 'Åttondelsfinal', 'KF': 'Kvartsfinal', 'SF': 'Semifinal', 'Final': 'Final' };

export async function initEmailDraft() {
    const snap = await getDoc(doc(db, "matches", "_settings"));
    const settings = snap.exists() ? snap.data() : {};
    const lastGen = settings.lastEmailGenerated || null;

    const el = document.getElementById('email-last-generated');
    if (lastGen) {
        const d = new Date(lastGen);
        el.textContent = `Senast genererat: ${d.toLocaleDateString('sv-SE')} ${d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`;
        document.getElementById('email-since-date').value = d.toISOString().slice(0, 10);
    }

    document.getElementById('email-reset-since').addEventListener('click', () => {
        document.getElementById('email-since-date').value = '';
    });
    document.getElementById('admin-generate-email').addEventListener('click', generateEmailDraft);
    document.getElementById('admin-copy-email').addEventListener('click', copyEmailDraft);
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatSwedishDate(date) {
    const months = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function h2(text) {
    return `<h2 style="font-size:18px; border-bottom:2px solid #1a1a1a; padding-bottom:6px; margin-top:24px;">${text}</h2>`;
}

function matchRow(home, away, homeScore, awayScore, meta) {
    const hw = homeScore > awayScore ? 'font-weight:700;' : '';
    const aw = awayScore > homeScore ? 'font-weight:700;' : '';
    let html = `<div style="padding:4px 0; font-size:14px;">`;
    html += `<div style="display:flex; align-items:center;">`;
    html += `<span style="flex:1; text-align:right; ${hw}">${home}</span>`;
    html += `<span style="font-weight:800; padding:0 12px; min-width:50px; text-align:center;">${homeScore} - ${awayScore}</span>`;
    html += `<span style="flex:1; text-align:left; ${aw}">${away}</span>`;
    html += `</div>`;
    if (meta) {
        html += `<div style="text-align:center; font-size:11px; color:#aaa; margin-top:1px;">${meta}</div>`;
    }
    html += `</div>`;
    return html;
}

function upcomingRow(home, away, meta) {
    let html = `<div style="padding:4px 0; font-size:14px;">`;
    html += `<div style="display:flex; align-items:center;">`;
    html += `<span style="flex:1; text-align:right; font-weight:600;">${home}</span>`;
    html += `<span style="padding:0 12px; color:#999; min-width:50px; text-align:center;">vs</span>`;
    html += `<span style="flex:1; text-align:left; font-weight:600;">${away}</span>`;
    html += `</div>`;
    if (meta) {
        html += `<div style="text-align:center; font-size:11px; color:#aaa; margin-top:1px;">${meta}</div>`;
    }
    html += `</div>`;
    return html;
}

// ── Data gathering ──────────────────────────────────────────────────

function getAllPlayedMatches(results, matchDocs, bracket, sinceDate) {
    const played = [];

    Object.entries(results).forEach(([matchId, r]) => {
        if (r.homeScore === undefined) return;
        const mDoc = matchDocs.find(m => String(m.id) === matchId);
        const dateStr = r.date || mDoc?.date;
        const parsed = parseMatchDate(dateStr);
        if (sinceDate && parsed && parsed < sinceDate) return;
        played.push({
            matchId, homeTeam: r.homeTeam, awayTeam: r.awayTeam,
            homeScore: r.homeScore, awayScore: r.awayScore,
            stage: r.stage, date: dateStr, _parsed: parsed, _isKo: false
        });
    });

    if (bracket?.rounds) {
        Object.entries(ROUND_NAMES).forEach(([round, label]) => {
            (bracket.rounds[round] || []).forEach(m => {
                if (!m.winner || !m.team1 || !m.team2 || m.score1 === undefined) return;
                const parsed = m.date ? parseMatchDate(m.date) : null;
                if (sinceDate && parsed && parsed < sinceDate) return;
                played.push({
                    matchId: `ko_${round}`, homeTeam: m.team1, awayTeam: m.team2,
                    homeScore: m.score1, awayScore: m.score2,
                    stage: label, date: m.date, _parsed: parsed, _isKo: true
                });
            });
        });
    }

    played.sort((a, b) => (b._parsed || 0) - (a._parsed || 0));
    return played;
}

function getAllUpcomingMatches(results, matchDocs, bracket) {
    const upcoming = [];
    const now = new Date();

    matchDocs.forEach(m => {
        if (results[m.id]?.homeScore !== undefined) return;
        const parsed = parseMatchDate(m.date);
        if (parsed && parsed <= now) return;
        upcoming.push({ homeTeam: m.homeTeam, awayTeam: m.awayTeam, date: m.date, stage: m.stage, _parsed: parsed });
    });

    if (bracket?.rounds) {
        Object.entries(ROUND_NAMES).forEach(([round, label]) => {
            (bracket.rounds[round] || []).forEach(m => {
                if (!m.team1 || !m.team2 || m.winner) return;
                const parsed = m.date ? parseMatchDate(m.date) : null;
                if (parsed && parsed <= now) return;
                upcoming.push({ homeTeam: m.team1, awayTeam: m.team2, date: m.date, stage: label, _parsed: parsed });
            });
        });
    }

    upcoming.sort((a, b) => (a._parsed || Infinity) - (b._parsed || Infinity));
    return upcoming;
}

// ── Section builders ────────────────────────────────────────────────

function buildResultsSection(played, maxCount) {
    const limited = played.slice(0, maxCount);
    if (limited.length === 0) return '';

    let html = h2('Senaste resultat');

    // Group by stage
    const byStage = {};
    limited.forEach(m => {
        const stage = m.stage || 'Övrigt';
        if (!byStage[stage]) byStage[stage] = [];
        byStage[stage].push(m);
    });

    Object.entries(byStage).forEach(([stage, matches]) => {
        html += `<h3 style="font-size:14px; color:#888; margin:14px 0 6px;">${stage}</h3>`;
        matches.forEach(m => {
            html += matchRow(m.homeTeam, m.awayTeam, m.homeScore, m.awayScore, m.date || null);
        });
    });

    return html;
}

function buildLeaderboardSection(scores, count) {
    if (scores.length === 0) return '';
    const top = Math.min(scores.length, count);

    let html = h2('Leaderboard');
    html += `<table style="width:100%; border-collapse:collapse; font-size:14px; margin:8px 0;">`;
    html += `<thead><tr style="border-bottom:2px solid #ddd;">`;
    html += `<th style="text-align:left; padding:6px;">#</th>`;
    html += `<th style="text-align:left; padding:6px;">Namn</th>`;
    html += `<th style="text-align:center; padding:6px;">Grupp</th>`;
    html += `<th style="text-align:center; padding:6px;">Slutspel</th>`;
    html += `<th style="text-align:center; padding:6px; font-weight:800;">Totalt</th>`;
    html += `</tr></thead><tbody>`;

    for (let i = 0; i < top; i++) {
        const s = scores[i];
        const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : `${i + 1}`));
        const bg = i < 3 ? 'background:rgba(40,167,69,0.06);' : '';
        html += `<tr style="border-bottom:1px solid #eee; ${bg}">`;
        html += `<td style="padding:6px;">${medal}</td>`;
        html += `<td style="padding:6px; font-weight:${i < 3 ? '700' : '400'};">${s.name}</td>`;
        html += `<td style="padding:6px; text-align:center;">${s.groupPts}</td>`;
        html += `<td style="padding:6px; text-align:center;">${s.koPts}</td>`;
        html += `<td style="padding:6px; text-align:center; font-weight:800;">${s.total}</td>`;
        html += `</tr>`;
    }
    html += `</tbody></table>`;
    if (scores.length > top) {
        html += `<p style="font-size:12px; color:#888;">...och ${scores.length - top} till</p>`;
    }
    return html;
}

function buildUpcomingSection(upcoming, maxCount) {
    const limited = upcoming.slice(0, maxCount);
    if (limited.length === 0) return '';

    let html = h2('Kommande matcher');
    limited.forEach(m => {
        const meta = [m.stage, m.date].filter(Boolean).join(' · ');
        html += upcomingRow(m.homeTeam, m.awayTeam, meta || null);
    });
    return html;
}

function buildChampionSection(users) {
    const champCounts = {};
    users.forEach(u => {
        if (u.knockoutPicks?.final) champCounts[u.knockoutPicks.final] = (champCounts[u.knockoutPicks.final] || 0) + 1;
    });
    if (Object.keys(champCounts).length === 0) return '';

    const sorted = Object.entries(champCounts).sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((s, [, c]) => s + c, 0);

    let html = h2('Tippade VM-mästare');
    html += `<table style="width:100%; max-width:400px; border-collapse:collapse; font-size:14px;">`;
    sorted.forEach(([team, count]) => {
        const pct = Math.round((count / total) * 100);
        html += `<tr style="border-bottom:1px solid #eee;">`;
        html += `<td style="padding:6px; font-weight:600;">${team}</td>`;
        html += `<td style="padding:6px; text-align:right; color:#888;">${count} st (${pct}%)</td>`;
        html += `</tr>`;
    });
    html += `</table>`;
    return html;
}

function buildHighlightsSection(users, allPlayed, bracket, officialGroupStandings) {
    const highlights = [];

    // Goal fests — summarize instead of listing each
    const goalFests = allPlayed.filter(m => (m.homeScore + m.awayScore) >= 5);
    if (goalFests.length > 0) {
        if (goalFests.length === 1) {
            const m = goalFests[0];
            highlights.push(`Målkalas i <strong>${m.homeTeam} ${m.homeScore} - ${m.awayScore} ${m.awayTeam}</strong> (${m.homeScore + m.awayScore} mål!)`);
        } else {
            const best = goalFests.sort((a, b) => (b.homeScore + b.awayScore) - (a.homeScore + a.awayScore));
            const topMatch = best[0];
            highlights.push(`${goalFests.length} målkalasmatcher (5+ mål) — vildast var <strong>${topMatch.homeTeam} ${topMatch.homeScore} - ${topMatch.awayScore} ${topMatch.awayTeam}</strong>`);
        }
    }

    // Group surprises
    GROUP_LETTERS.forEach(letter => {
        const og = officialGroupStandings[letter];
        if (!og || !og.complete) return;
        const total = users.filter(u => u.groupPicks?.[letter]).length;
        if (total === 0) return;

        const correctFirst = users.filter(u => u.groupPicks?.[letter]?.first === og.first).length;
        if (correctFirst === 0) {
            highlights.push(`Ingen tippade rätt etta i Grupp ${letter}! <strong>${og.first}</strong> vann gruppen`);
        } else if (correctFirst <= 2) {
            const names = users.filter(u => u.groupPicks?.[letter]?.first === og.first).map(u => u.name);
            highlights.push(`Bara ${names.map(n => `<strong>${n}</strong>`).join(' & ')} tippade rätt etta i Grupp ${letter} (${og.first})`);
        }
    });

    // Perfect knockout rounds
    if (bracket?.rounds) {
        const roundLabels = { 'R32': 'sextondelsfinalen', 'R16': 'åttondelsfinalen', 'KF': 'kvartsfinalen', 'SF': 'semifinalen', 'Final': 'finalen' };
        ['R32', 'R16', 'KF', 'SF', 'Final'].forEach(round => {
            const matches = (bracket.rounds[round] || []).filter(m => m.winner);
            if (matches.length < 2) return;
            const koKey = round === 'KF' ? 'qf' : round.toLowerCase();
            const winners = matches.map(m => m.winner);
            users.forEach(u => {
                if (!u.knockoutPicks) return;
                const picks = koKey === 'final' ? (u.knockoutPicks.final ? [u.knockoutPicks.final] : []) : (u.knockoutPicks[koKey] || []);
                const correct = picks.filter(t => winners.includes(t)).length;
                if (correct === winners.length) {
                    highlights.push(`<strong>${u.name}</strong> tippade alla ${winners.length} rätt i ${roundLabels[round]}!`);
                }
            });
        });
    }

    if (highlights.length === 0) return '';

    let html = h2('Höjdpunkter');
    html += `<ul style="padding-left:20px; font-size:14px; line-height:1.8;">`;
    highlights.forEach(h => { html += `<li>${h}</li>`; });
    html += `</ul>`;
    return html;
}

function buildKuriosaSection(users, allResults, matchDocs) {
    // allResults = full results object (unfiltered), for full-tournament stats
    const items = [];

    // Gather all played matches (all time, not filtered by sinceDate)
    const playedMatches = [];
    Object.entries(allResults).forEach(([matchId, r]) => {
        if (r.homeScore === undefined) return;
        playedMatches.push({ matchId, ...r });
    });

    if (playedMatches.length < 3) return '';

    // Best at 1X2
    const winnerStats = users.map(u => {
        let correct = 0;
        playedMatches.forEach(r => {
            const tip = u.matchTips[r.matchId];
            if (tip && sign(tip.homeScore - tip.awayScore) === sign(r.homeScore - r.awayScore)) correct++;
        });
        return { name: u.name, correct, total: playedMatches.length };
    }).sort((a, b) => b.correct - a.correct);

    if (winnerStats.length > 0 && winnerStats[0].correct > 0) {
        const best = winnerStats[0];
        const pct = Math.round((best.correct / best.total) * 100);
        items.push(`<strong>Bäst på 1X2:</strong> ${best.name} med ${best.correct}/${best.total} rätt (${pct}%)`);
    }

    // Best at exact scores
    const exactStats = users.map(u => {
        let correct = 0;
        playedMatches.forEach(r => {
            const tip = u.matchTips[r.matchId];
            if (tip && tip.homeScore === r.homeScore && tip.awayScore === r.awayScore) correct++;
        });
        return { name: u.name, correct };
    }).sort((a, b) => b.correct - a.correct);

    if (exactStats.length > 0 && exactStats[0].correct >= 2) {
        const top3 = exactStats.filter(s => s.correct > 0).slice(0, 3);
        const list = top3.map(s => `${s.name} (${s.correct} st)`).join(', ');
        items.push(`<strong>Flest exakta resultat:</strong> ${list}`);
    }

    // Country expertise — find users who nailed a specific country's matches
    const teamMatches = {}; // team -> [{matchId, homeScore, awayScore, homeTeam, awayTeam}]
    playedMatches.forEach(r => {
        [r.homeTeam, r.awayTeam].forEach(team => {
            if (!team) return;
            if (!teamMatches[team]) teamMatches[team] = [];
            teamMatches[team].push(r);
        });
    });

    const countryExperts = [];
    users.forEach(u => {
        Object.entries(teamMatches).forEach(([team, matches]) => {
            if (matches.length < 3) return; // need enough matches to be meaningful
            let correctWinner = 0;
            let correctExact = 0;
            matches.forEach(r => {
                const tip = u.matchTips[r.matchId];
                if (!tip) return;
                if (tip.homeScore === r.homeScore && tip.awayScore === r.awayScore) {
                    correctExact++;
                    correctWinner++;
                } else if (sign(tip.homeScore - tip.awayScore) === sign(r.homeScore - r.awayScore)) {
                    correctWinner++;
                }
            });
            const ratio = correctWinner / matches.length;
            if (ratio >= 0.7 && correctWinner >= 3) {
                countryExperts.push({ name: u.name, team, correctWinner, correctExact, total: matches.length, ratio });
            }
        });
    });

    // Sort by ratio, then by count, pick the best ones
    countryExperts.sort((a, b) => b.ratio - a.ratio || b.correctWinner - a.correctWinner);
    const shownExperts = new Set();
    countryExperts.slice(0, 3).forEach(e => {
        if (shownExperts.has(e.name)) return; // one per person max
        shownExperts.add(e.name);
        const detail = e.correctExact > 0
            ? `${e.correctWinner} av ${e.total} rätt 1X2, varav ${e.correctExact} exakta`
            : `${e.correctWinner} av ${e.total} rätt 1X2`;
        items.push(`<strong>${e.name}</strong> har koll på <strong>${e.team}</strong> — ${detail}`);
    });

    // Worst tipper (fun stat, if enough data)
    if (playedMatches.length >= 6 && winnerStats.length > 1) {
        const worst = winnerStats[winnerStats.length - 1];
        const pct = Math.round((worst.correct / worst.total) * 100);
        if (pct < 35) {
            items.push(`<strong>Sämst på 1X2:</strong> ${worst.name} med ${worst.correct}/${worst.total} rätt (${pct}%) — det kan bara bli bättre!`);
        }
    }

    if (items.length === 0) return '';

    let html = h2('Kuriosa');
    html += `<ul style="padding-left:20px; font-size:14px; line-height:1.8;">`;
    items.forEach(item => { html += `<li>${item}</li>`; });
    html += `</ul>`;
    return html;
}

// ── Main generation ─────────────────────────────────────────────────

async function generateEmailDraft() {
    const btn = document.getElementById('admin-generate-email');
    btn.disabled = true;
    btn.textContent = 'Genererar...';

    try {
        const opts = {
            leaderboard: document.getElementById('email-opt-leaderboard').checked,
            lbCount: parseInt(document.getElementById('email-opt-lb-count').value) || 10,
            results: document.getElementById('email-opt-results').checked,
            resultsCount: parseInt(document.getElementById('email-opt-results-count').value) || 10,
            highlights: document.getElementById('email-opt-highlights').checked,
            kuriosa: document.getElementById('email-opt-kuriosa').checked,
            upcoming: document.getElementById('email-opt-upcoming').checked,
            upcomingCount: parseInt(document.getElementById('email-opt-upcoming-count').value) || 6,
            champion: document.getElementById('email-opt-champion').checked,
        };

        const sinceInput = document.getElementById('email-since-date').value;
        const sinceDate = sinceInput ? new Date(sinceInput + 'T00:00:00') : null;

        // Fetch all data
        const [resultsSnap, bracketSnap, matchesSnap, usersSnap, settingsSnap] = await Promise.all([
            getDoc(doc(db, "matches", "_results")),
            getDoc(doc(db, "matches", "_bracket")),
            getDocs(collection(db, "matches")),
            getDocs(collection(db, "users")),
            getDoc(doc(db, "matches", "_settings")),
        ]);

        const results = resultsSnap.exists() ? resultsSnap.data() : {};
        const bracket = bracketSnap.exists() ? bracketSnap.data() : null;
        const settings = settingsSnap.exists() ? settingsSnap.data() : {};
        const scoring = { ...DEFAULT_SCORING, ...(settings.scoring || {}) };
        const matchDocs = matchesSnap.docs.filter(d => !d.id.startsWith('_')).map(d => ({ id: d.id, ...d.data() }));

        const users = [];
        for (const userDoc of usersSnap.docs) {
            const d = userDoc.data();
            users.push({
                userId: userDoc.id,
                name: d.name || userDoc.id,
                groupPicks: d.groupPicks || null,
                knockoutPicks: d.knockout || null,
                matchTips: d.matchTips || {}
            });
        }

        const officialGroupStandings = buildOfficialGroupStandings(results, matchDocs);
        const scores = calcLeaderboard(users, results, bracket, scoring, officialGroupStandings);
        scores.sort((a, b) => b.total - a.total);

        const allPlayed = getAllPlayedMatches(results, matchDocs, bracket, sinceDate);
        const allUpcoming = getAllUpcomingMatches(results, matchDocs, bracket);

        // Build email
        let email = '';

        // Header
        email += `<div style="text-align:center; margin-bottom:24px;">`;
        email += `<h1 style="font-size:24px; margin:0;">MunkenTipset 2026</h1>`;
        email += `<p style="color:#888; margin:4px 0 0;">${formatSwedishDate(new Date())}</p>`;
        email += `</div>`;
        email += `<p style="color:#666;">[Skriv din brödtext här...]</p>`;
        email += `<hr style="border:none; border-top:1px solid #eee; margin:20px 0;">`;

        if (opts.results) email += buildResultsSection(allPlayed, opts.resultsCount);
        if (opts.leaderboard) email += buildLeaderboardSection(scores, opts.lbCount);
        if (opts.highlights) email += buildHighlightsSection(users, allPlayed, bracket, officialGroupStandings);
        if (opts.kuriosa) email += buildKuriosaSection(users, results, matchDocs);
        if (opts.upcoming) email += buildUpcomingSection(allUpcoming, opts.upcomingCount);
        if (opts.champion) email += buildChampionSection(users);

        email += `<hr style="border:none; border-top:1px solid #eee; margin:20px 0;">`;
        email += `<p style="font-size:12px; color:#aaa; text-align:center;">Genererat av MunkenTipset 2026</p>`;

        document.getElementById('admin-email-preview').innerHTML = email;
        document.getElementById('admin-email-output').style.display = 'block';

        // Save timestamp
        await setDoc(doc(db, "matches", "_settings"), { lastEmailGenerated: Date.now() }, { merge: true });
        document.getElementById('email-last-generated').textContent =
            `Senast genererat: ${new Date().toLocaleDateString('sv-SE')} ${new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`;

    } finally {
        btn.disabled = false;
        btn.textContent = 'Generera mejlutkast';
    }
}

async function copyEmailDraft() {
    const preview = document.getElementById('admin-email-preview');
    const btn = document.getElementById('admin-copy-email');
    try {
        const blob = new Blob([preview.innerHTML], { type: 'text/html' });
        const plainBlob = new Blob([preview.innerText], { type: 'text/plain' });
        await navigator.clipboard.write([
            new ClipboardItem({ 'text/html': blob, 'text/plain': plainBlob })
        ]);
        btn.textContent = 'Kopierat!';
        btn.style.background = '#28a745';
    } catch {
        try {
            await navigator.clipboard.writeText(preview.innerText);
            btn.textContent = 'Kopierat (text)!';
            btn.style.background = '#28a745';
        } catch {
            btn.textContent = 'Kunde inte kopiera';
            btn.style.background = '#dc3545';
        }
    }
    setTimeout(() => { btn.textContent = 'Kopiera'; btn.style.background = '#28a745'; }, 2500);
}
