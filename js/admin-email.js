import { db } from './config.js';
import { doc, getDoc, setDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f, flags } from './wizard.js';
import { DEFAULT_SCORING, buildOfficialGroupStandings, calcLeaderboard, sign, parseMatchDate } from './scoring.js';
import { allMatches, existingResults } from './admin.js';

const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

export async function initEmailDraft() {
    // Load last generated timestamp
    const snap = await getDoc(doc(db, "matches", "_settings"));
    const settings = snap.exists() ? snap.data() : {};
    const lastGen = settings.lastEmailGenerated || null;

    const el = document.getElementById('email-last-generated');
    if (lastGen) {
        const d = new Date(lastGen);
        el.textContent = `Senast genererat: ${d.toLocaleDateString('sv-SE')} ${d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`;
        // Pre-fill the date picker with last generated date
        document.getElementById('email-since-date').value = d.toISOString().slice(0, 10);
    } else {
        el.textContent = 'Aldrig genererat';
    }

    document.getElementById('email-reset-since').addEventListener('click', () => {
        document.getElementById('email-since-date').value = '';
    });

    document.getElementById('admin-generate-email').addEventListener('click', generateEmailDraft);
    document.getElementById('admin-copy-email').addEventListener('click', copyEmailDraft);
}

async function generateEmailDraft() {
    const btn = document.getElementById('admin-generate-email');
    btn.disabled = true;
    btn.textContent = 'Genererar...';

    try {
        // Gather options
        const opts = {
            leaderboard: document.getElementById('email-opt-leaderboard').checked,
            results: document.getElementById('email-opt-results').checked,
            highlights: document.getElementById('email-opt-highlights').checked,
            upcoming: document.getElementById('email-opt-upcoming').checked,
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

        // Build the email
        let email = '';

        // Header
        email += `<div style="text-align:center; margin-bottom:24px;">`;
        email += `<h1 style="font-size:24px; margin:0;">MunkenTipset 2026</h1>`;
        email += `<p style="color:#888; margin:4px 0 0;">${formatSwedishDate(new Date())}</p>`;
        email += `</div>`;

        email += `<p style="color:#666;">[Skriv din brödtext här...]</p>`;
        email += `<hr style="border:none; border-top:1px solid #eee; margin:20px 0;">`;

        // Recent results
        if (opts.results) {
            const recentResults = getRecentResults(results, matchDocs, bracket, sinceDate);
            if (recentResults.length > 0) {
                email += `<h2 style="font-size:18px; border-bottom:2px solid #1a1a1a; padding-bottom:6px;">Senaste resultat</h2>`;

                // Group by stage
                const byStage = {};
                recentResults.forEach(m => {
                    const stage = m.stage || 'Övrigt';
                    if (!byStage[stage]) byStage[stage] = [];
                    byStage[stage].push(m);
                });

                Object.entries(byStage).forEach(([stage, matches]) => {
                    email += `<h3 style="font-size:14px; color:#888; margin:16px 0 8px;">${stage}</h3>`;
                    matches.forEach(m => {
                        const hw = m.homeScore > m.awayScore ? 'font-weight:700;' : '';
                        const aw = m.awayScore > m.homeScore ? 'font-weight:700;' : '';
                        email += `<div style="padding:6px 0; font-size:14px; display:flex; align-items:center;">`;
                        email += `<span style="flex:1; text-align:right; ${hw}">${m.homeTeam}</span>`;
                        email += `<span style="font-weight:800; padding:0 12px; min-width:50px; text-align:center;">${m.homeScore} - ${m.awayScore}</span>`;
                        email += `<span style="flex:1; text-align:left; ${aw}">${m.awayTeam}</span>`;
                        email += `</div>`;
                    });
                });
                email += `<br>`;
            }
        }

        // Leaderboard
        if (opts.leaderboard && scores.length > 0) {
            email += `<h2 style="font-size:18px; border-bottom:2px solid #1a1a1a; padding-bottom:6px;">Leaderboard</h2>`;
            email += `<table style="width:100%; border-collapse:collapse; font-size:14px; margin:8px 0;">`;
            email += `<thead><tr style="border-bottom:2px solid #ddd;">`;
            email += `<th style="text-align:left; padding:6px;">#</th>`;
            email += `<th style="text-align:left; padding:6px;">Namn</th>`;
            email += `<th style="text-align:center; padding:6px;">Grupp</th>`;
            email += `<th style="text-align:center; padding:6px;">Slutspel</th>`;
            email += `<th style="text-align:center; padding:6px; font-weight:800;">Totalt</th>`;
            email += `</tr></thead><tbody>`;

            const top = Math.min(scores.length, 10);
            for (let i = 0; i < top; i++) {
                const s = scores[i];
                const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : `${i + 1}`));
                const bg = i < 3 ? 'background:rgba(40,167,69,0.06);' : '';
                email += `<tr style="border-bottom:1px solid #eee; ${bg}">`;
                email += `<td style="padding:6px;">${medal}</td>`;
                email += `<td style="padding:6px; font-weight:${i < 3 ? '700' : '400'};">${s.name}</td>`;
                email += `<td style="padding:6px; text-align:center;">${s.groupPts}</td>`;
                email += `<td style="padding:6px; text-align:center;">${s.koPts}</td>`;
                email += `<td style="padding:6px; text-align:center; font-weight:800;">${s.total}</td>`;
                email += `</tr>`;
            }
            email += `</tbody></table>`;
            if (scores.length > 10) {
                email += `<p style="font-size:12px; color:#888;">...och ${scores.length - 10} till</p>`;
            }
            email += `<br>`;
        }

        // Highlights
        if (opts.highlights) {
            const highlights = buildHighlights(users, results, matchDocs, bracket, scoring, officialGroupStandings, sinceDate);
            if (highlights.length > 0) {
                email += `<h2 style="font-size:18px; border-bottom:2px solid #1a1a1a; padding-bottom:6px;">Höjdpunkter</h2>`;
                email += `<ul style="padding-left:20px; font-size:14px; line-height:1.8;">`;
                highlights.forEach(h => { email += `<li>${h}</li>`; });
                email += `</ul><br>`;
            }
        }

        // Upcoming
        if (opts.upcoming) {
            const upcoming = getUpcomingMatches(results, matchDocs, bracket);
            if (upcoming.length > 0) {
                email += `<h2 style="font-size:18px; border-bottom:2px solid #1a1a1a; padding-bottom:6px;">Kommande matcher</h2>`;
                upcoming.slice(0, 6).forEach(m => {
                    email += `<div style="padding:4px 0; font-size:14px; display:flex; align-items:center;">`;
                    email += `<span style="flex:1; text-align:right;">${m.homeTeam}</span>`;
                    email += `<span style="padding:0 12px; color:#999; min-width:50px; text-align:center;">vs</span>`;
                    email += `<span style="flex:1; text-align:left;">${m.awayTeam}</span>`;
                    email += `</div>`;
                    if (m.date) {
                        email += `<div style="text-align:center; font-size:11px; color:#aaa; margin-bottom:4px;">${m.date}${m.stage ? ' · ' + m.stage : ''}</div>`;
                    }
                });
                email += `<br>`;
            }
        }

        // Champion picks
        if (opts.champion) {
            const champCounts = {};
            users.forEach(u => {
                if (u.knockoutPicks?.final) champCounts[u.knockoutPicks.final] = (champCounts[u.knockoutPicks.final] || 0) + 1;
            });
            if (Object.keys(champCounts).length > 0) {
                const sorted = Object.entries(champCounts).sort((a, b) => b[1] - a[1]);
                const total = sorted.reduce((s, [, c]) => s + c, 0);
                email += `<h2 style="font-size:18px; border-bottom:2px solid #1a1a1a; padding-bottom:6px;">Tippade VM-mästare</h2>`;
                email += `<table style="width:100%; max-width:400px; border-collapse:collapse; font-size:14px;">`;
                sorted.forEach(([team, count]) => {
                    const pct = Math.round((count / total) * 100);
                    email += `<tr style="border-bottom:1px solid #eee;">`;
                    email += `<td style="padding:6px; font-weight:600;">${team}</td>`;
                    email += `<td style="padding:6px; text-align:right; color:#888;">${count} st (${pct}%)</td>`;
                    email += `</tr>`;
                });
                email += `</table><br>`;
            }
        }

        // Footer
        email += `<hr style="border:none; border-top:1px solid #eee; margin:20px 0;">`;
        email += `<p style="font-size:12px; color:#aaa; text-align:center;">Genererat av MunkenTipset 2026</p>`;

        // Show output
        document.getElementById('admin-email-preview').innerHTML = email;
        document.getElementById('admin-email-output').style.display = 'block';

        // Save last generated timestamp
        await setDoc(doc(db, "matches", "_settings"), { lastEmailGenerated: Date.now() }, { merge: true });
        document.getElementById('email-last-generated').textContent =
            `Senast genererat: ${new Date().toLocaleDateString('sv-SE')} ${new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`;

    } finally {
        btn.disabled = false;
        btn.textContent = 'Generera mejlutkast';
    }
}

function getRecentResults(results, matchDocs, bracket, sinceDate) {
    const played = [];
    const roundNames = { 'R32': 'Sextondelsfinal', 'R16': 'Åttondelsfinal', 'KF': 'Kvartsfinal', 'SF': 'Semifinal', 'Final': 'Final' };

    // Group matches
    Object.entries(results).forEach(([matchId, r]) => {
        if (r.homeScore === undefined) return;
        const parsed = parseMatchDate(r.date || matchDocs.find(m => String(m.id) === matchId)?.date);
        if (sinceDate && parsed && parsed < sinceDate) return;
        played.push({
            homeTeam: r.homeTeam, awayTeam: r.awayTeam,
            homeScore: r.homeScore, awayScore: r.awayScore,
            stage: r.stage, date: r.date, _parsed: parsed
        });
    });

    // Knockout matches
    if (bracket?.rounds) {
        ['R32', 'R16', 'KF', 'SF', 'Final'].forEach(round => {
            (bracket.rounds[round] || []).forEach(m => {
                if (!m.winner || !m.team1 || !m.team2 || m.score1 === undefined) return;
                const parsed = m.date ? parseMatchDate(m.date) : null;
                if (sinceDate && parsed && parsed < sinceDate) return;
                played.push({
                    homeTeam: m.team1, awayTeam: m.team2,
                    homeScore: m.score1, awayScore: m.score2,
                    stage: roundNames[round], date: m.date, _parsed: parsed
                });
            });
        });
    }

    played.sort((a, b) => (b._parsed || 0) - (a._parsed || 0));
    return played;
}

function getUpcomingMatches(results, matchDocs, bracket) {
    const upcoming = [];
    const roundNames = { 'R32': 'Sextondelsfinal', 'R16': 'Åttondelsfinal', 'KF': 'Kvartsfinal', 'SF': 'Semifinal', 'Final': 'Final' };
    const now = new Date();

    matchDocs.forEach(m => {
        if (results[m.id]?.homeScore !== undefined) return;
        const parsed = parseMatchDate(m.date);
        if (parsed && parsed <= now) return;
        upcoming.push({ homeTeam: m.homeTeam, awayTeam: m.awayTeam, date: m.date, stage: m.stage, _parsed: parsed });
    });

    if (bracket?.rounds) {
        ['R32', 'R16', 'KF', 'SF', 'Final'].forEach(round => {
            (bracket.rounds[round] || []).forEach(m => {
                if (!m.team1 || !m.team2 || m.winner) return;
                const parsed = m.date ? parseMatchDate(m.date) : null;
                if (parsed && parsed <= now) return;
                upcoming.push({ homeTeam: m.team1, awayTeam: m.team2, date: m.date, stage: roundNames[round], _parsed: parsed });
            });
        });
    }

    upcoming.sort((a, b) => (a._parsed || Infinity) - (b._parsed || Infinity));
    return upcoming;
}

function buildHighlights(users, results, matchDocs, bracket, scoring, officialGroupStandings, sinceDate) {
    const highlights = [];
    const playedResults = [];

    // Gather recent results for analysis
    Object.entries(results).forEach(([matchId, r]) => {
        if (r.homeScore === undefined) return;
        const parsed = parseMatchDate(r.date || matchDocs.find(m => String(m.id) === matchId)?.date);
        if (sinceDate && parsed && parsed < sinceDate) return;
        playedResults.push({ matchId, ...r, _parsed: parsed });
    });

    if (playedResults.length === 0 && !bracket?.rounds) return highlights;

    // Find exact score tippers for recent matches
    const exactCounts = {};
    users.forEach(u => {
        let count = 0;
        playedResults.forEach(r => {
            const tip = u.matchTips[r.matchId];
            if (tip && tip.homeScore === r.homeScore && tip.awayScore === r.awayScore) count++;
        });
        if (count > 0) exactCounts[u.name] = count;
    });

    // Sort by count and highlight top performers
    const topExact = Object.entries(exactCounts).sort((a, b) => b[1] - a[1]);
    if (topExact.length > 0 && topExact[0][1] >= 2) {
        const top3 = topExact.slice(0, 3).map(([name, c]) => `<strong>${name}</strong> (${c} st)`);
        highlights.push(`Flest exakta resultat: ${top3.join(', ')}`);
    }

    // Big upsets (high-scoring games or unexpected results)
    playedResults.forEach(r => {
        const totalGoals = r.homeScore + r.awayScore;
        if (totalGoals >= 7) {
            highlights.push(`Målkalas! <strong>${r.homeTeam} ${r.homeScore} - ${r.awayScore} ${r.awayTeam}</strong> (${totalGoals} mål)`);
        }
    });

    // Who tipped the most right winners
    const winnerCounts = {};
    users.forEach(u => {
        let count = 0;
        playedResults.forEach(r => {
            const tip = u.matchTips[r.matchId];
            if (tip && sign(tip.homeScore - tip.awayScore) === sign(r.homeScore - r.awayScore)) count++;
        });
        if (count > 0) winnerCounts[u.name] = count;
    });

    if (playedResults.length >= 3) {
        const topWinners = Object.entries(winnerCounts).sort((a, b) => b[1] - a[1]);
        if (topWinners.length > 0) {
            const best = topWinners[0];
            const pct = Math.round((best[1] / playedResults.length) * 100);
            highlights.push(`Bäst på 1X2: <strong>${best[0]}</strong> med ${best[1]}/${playedResults.length} rätt (${pct}%)`);
        }
    }

    // Group stage drama — completed groups with tight finishes
    GROUP_LETTERS.forEach(letter => {
        const og = officialGroupStandings[letter];
        if (!og || !og.complete) return;
        // Check how many got the group right
        let correctFirst = 0, correctSecond = 0;
        users.forEach(u => {
            const pick = u.groupPicks?.[letter];
            if (!pick) return;
            if (pick.first === og.first) correctFirst++;
            if (pick.second === og.second) correctSecond++;
        });
        const total = users.filter(u => u.groupPicks?.[letter]).length;
        if (total > 0 && correctFirst === 0) {
            highlights.push(`Ingen tippade rätt etta i Grupp ${letter}! (<strong>${og.first}</strong> vann gruppen)`);
        } else if (total > 0 && correctFirst <= 2) {
            const names = users.filter(u => u.groupPicks?.[letter]?.first === og.first).map(u => u.name);
            highlights.push(`Bara ${names.map(n => `<strong>${n}</strong>`).join(' & ')} tippade rätt etta i Grupp ${letter} (${og.first})`);
        }
    });

    // Knockout highlights
    if (bracket?.rounds) {
        const roundNames = { 'R32': 'sextondelsfinalen', 'R16': 'åttondelsfinalen', 'KF': 'kvartsfinalen', 'SF': 'semifinalen', 'Final': 'finalen' };
        ['R32', 'R16', 'KF', 'SF', 'Final'].forEach(round => {
            const matches = (bracket.rounds[round] || []).filter(m => m.winner);
            if (matches.length === 0) return;

            // Find if anyone got all winners right in this round
            const koKey = round === 'KF' ? 'qf' : round.toLowerCase();
            const winners = matches.map(m => m.winner);
            users.forEach(u => {
                if (!u.knockoutPicks) return;
                const picks = koKey === 'final' ? (u.knockoutPicks.final ? [u.knockoutPicks.final] : []) : (u.knockoutPicks[koKey] || []);
                const correct = picks.filter(t => winners.includes(t)).length;
                if (correct === winners.length && winners.length >= 2) {
                    highlights.push(`<strong>${u.name}</strong> tippade alla ${winners.length} rätt i ${roundNames[round]}!`);
                }
            });
        });
    }

    return highlights;
}

function formatSwedishDate(date) {
    const months = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

async function copyEmailDraft() {
    const preview = document.getElementById('admin-email-preview');
    const btn = document.getElementById('admin-copy-email');
    try {
        // Copy as rich text (HTML) for email clients
        const blob = new Blob([preview.innerHTML], { type: 'text/html' });
        const plainBlob = new Blob([preview.innerText], { type: 'text/plain' });
        await navigator.clipboard.write([
            new ClipboardItem({
                'text/html': blob,
                'text/plain': plainBlob,
            })
        ]);
        btn.textContent = 'Kopierat!';
        btn.style.background = '#28a745';
    } catch {
        // Fallback: copy as plain text
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
