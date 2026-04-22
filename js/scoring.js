import { f } from './wizard.js';
import { getGroupLetters, getKnockoutRounds, getGroupStageConfig, getRoundUserKey, getTournamentYear, isTwoLegged, getSpecialQuestionsConfig } from './tournament-config.js';

// Build default scoring dynamically from tournament config
export function buildDefaultScoring() {
    const groupStage = getGroupStageConfig();
    const koRounds = getKnockoutRounds();
    const scoring = {
        matchResult: 1,
        matchHomeGoals: 1,
        matchAwayGoals: 1,
        exactScore: 0,
        groupWinner: 1,
        groupRunnerUp: 1,
        groupThird: 0,
    };
    if (groupStage?.scoring) {
        Object.assign(scoring, groupStage.scoring);
    }
    koRounds.forEach(r => { scoring[`ko_${r.key}`] = r.points; });
    return scoring;
}

export const DEFAULT_SCORING = buildDefaultScoring();

// ── BUILD OFFICIAL GROUP STANDINGS FROM RESULTS ────���─────
export function buildOfficialGroupStandings(results, matchDocs) {
    const standings = {};
    const groupResults = {};
    const groupMatchCounts = {};
    const groupStage = getGroupStageConfig();
    const teamsPerGroup = groupStage?.groups?.teamsPerGroup || 4;
    // Default matches per group: n*(n-1)/2 for round-robin
    const defaultMatchesPerGroup = (teamsPerGroup * (teamsPerGroup - 1)) / 2;

    if (matchDocs) {
        matchDocs.forEach(m => {
            if (!m.stage || !m.stage.startsWith('Grupp ')) return;
            const letter = m.stage.replace('Grupp ', '');
            groupMatchCounts[letter] = (groupMatchCounts[letter] || 0) + 1;
        });
    }

    Object.entries(results).forEach(([, r]) => {
        if (!r.stage || !r.stage.startsWith('Grupp ')) return;
        if (r.homeScore === undefined) return;
        const letter = r.stage.replace('Grupp ', '');
        if (!groupResults[letter]) groupResults[letter] = [];
        groupResults[letter].push(r);
    });

    Object.entries(groupResults).forEach(([letter, matches]) => {
        const teams = {};
        matches.forEach(m => {
            if (!teams[m.homeTeam]) teams[m.homeTeam] = { pts: 0, gd: 0, gf: 0 };
            if (!teams[m.awayTeam]) teams[m.awayTeam] = { pts: 0, gd: 0, gf: 0 };
            const h = m.homeScore, a = m.awayScore;
            teams[m.homeTeam].gf += h; teams[m.homeTeam].gd += (h - a);
            teams[m.awayTeam].gf += a; teams[m.awayTeam].gd += (a - h);
            if (h > a) { teams[m.homeTeam].pts += 3; }
            else if (a > h) { teams[m.awayTeam].pts += 3; }
            else { teams[m.homeTeam].pts += 1; teams[m.awayTeam].pts += 1; }
        });
        const sorted = Object.entries(teams).sort((a, b) => b[1].pts - a[1].pts || b[1].gd - a[1].gd || b[1].gf - a[1].gf);
        const totalExpected = groupMatchCounts[letter] || defaultMatchesPerGroup;
        standings[letter] = {
            first: sorted[0]?.[0] || null,
            second: sorted[1]?.[0] || null,
            third: sorted[2]?.[0] || null,
            complete: matches.length >= totalExpected
        };
    });
    return standings;
}

// ── SCORING (returns detailed breakdown) ──────────────
export function calcLeaderboard(users, results, bracket, scoring, officialGroupStandings) {
    const koRounds = getKnockoutRounds();
    const groupLetters = getGroupLetters();

    const officialWinners = {};
    if (bracket?.rounds) {
        koRounds.forEach(round => {
            const adminKey = round.adminKey;
            officialWinners[round.key] = [];
            (bracket.rounds[adminKey] || []).forEach(m => {
                if (m.winner) officialWinners[round.key].push(m.winner);
            });
        });
    }

    return users.map(u => {
        let groupPts = 0;
        const detail = { matchResult: 0, matchGoals: 0, exactScore: 0, groupPlace: 0 };

        // Score individual match tips
        Object.entries(u.matchTips).forEach(([matchId, tip]) => {
            const r = results[matchId];
            if (!r || r.homeScore === undefined) return;
            const tipSign = sign(tip.homeScore - tip.awayScore);
            const realSign = sign(r.homeScore - r.awayScore);
            if (tipSign === realSign) { groupPts += scoring.matchResult; detail.matchResult += scoring.matchResult; }
            if (tip.homeScore === r.homeScore) { groupPts += scoring.matchHomeGoals; detail.matchGoals += scoring.matchHomeGoals; }
            if (tip.awayScore === r.awayScore) { groupPts += scoring.matchAwayGoals; detail.matchGoals += scoring.matchAwayGoals; }
            if (scoring.exactScore > 0 && tip.homeScore === r.homeScore && tip.awayScore === r.awayScore) {
                groupPts += scoring.exactScore; detail.exactScore += scoring.exactScore;
            }
        });

        // Score group winner/runner-up predictions (only when all group matches are played)
        if (u.groupPicks) {
            groupLetters.forEach(letter => {
                const pick = u.groupPicks[letter];
                const official = officialGroupStandings[letter];
                if (!pick || !official || !official.complete) return;
                if (official.first && pick.first === official.first) { groupPts += scoring.groupWinner; detail.groupPlace += scoring.groupWinner; }
                if (official.second && pick.second === official.second) { groupPts += scoring.groupRunnerUp; detail.groupPlace += scoring.groupRunnerUp; }
                if (scoring.groupThird > 0 && official.third && pick.third === official.third) { groupPts += scoring.groupThird; detail.groupPlace += scoring.groupThird; }
            });
        }

        let koPts = 0;
        // Score knockout advancement picks
        if (u.knockoutPicks) {
            koRounds.forEach(round => {
                const winners = officialWinners[round.key] || [];
                if (winners.length === 0) return;
                const pts = scoring[`ko_${round.key}`] || 0;
                const finalRoundKey = koRounds.length > 0 ? koRounds[koRounds.length - 1].key : 'final';
                if (round.key === finalRoundKey) {
                    if (u.knockoutPicks[round.key] && winners.includes(u.knockoutPicks[round.key])) koPts += pts;
                } else {
                    const userPicks = u.knockoutPicks[round.key] || [];
                    userPicks.forEach(team => { if (winners.includes(team)) koPts += pts; });
                }
            });
        }

        // Score knockout per-leg match predictions
        if (u.knockoutScores && bracket?.rounds) {
            koRounds.forEach(round => {
                const matches = bracket.rounds[round.adminKey] || [];
                const userScores = u.knockoutScores[round.key] || [];
                const twoLeg = isTwoLegged(round.key);

                matches.forEach((m, mi) => {
                    const tip = userScores[mi];
                    if (!tip) return;

                    // Leg 1 scoring
                    if (m.score1 !== undefined && tip.score1 != null && tip.score2 != null) {
                        const tipSign = sign(tip.score1 - tip.score2);
                        const realSign = sign(m.score1 - m.score2);
                        if (tipSign === realSign) { koPts += scoring.matchResult; detail.matchResult += scoring.matchResult; }
                        if (tip.score1 === m.score1) { koPts += scoring.matchHomeGoals; detail.matchGoals += scoring.matchHomeGoals; }
                        if (tip.score2 === m.score2) { koPts += scoring.matchAwayGoals; detail.matchGoals += scoring.matchAwayGoals; }
                        if (scoring.exactScore > 0 && tip.score1 === m.score1 && tip.score2 === m.score2) {
                            koPts += scoring.exactScore; detail.exactScore += scoring.exactScore;
                        }
                    }

                    // Leg 2 scoring
                    if (twoLeg && m.score1_leg2 !== undefined && tip.score1_leg2 != null && tip.score2_leg2 != null) {
                        const tipSign = sign(tip.score1_leg2 - tip.score2_leg2);
                        const realSign = sign(m.score1_leg2 - m.score2_leg2);
                        if (tipSign === realSign) { koPts += scoring.matchResult; detail.matchResult += scoring.matchResult; }
                        if (tip.score1_leg2 === m.score1_leg2) { koPts += scoring.matchHomeGoals; detail.matchGoals += scoring.matchHomeGoals; }
                        if (tip.score2_leg2 === m.score2_leg2) { koPts += scoring.matchAwayGoals; detail.matchGoals += scoring.matchAwayGoals; }
                        if (scoring.exactScore > 0 && tip.score1_leg2 === m.score1_leg2 && tip.score2_leg2 === m.score2_leg2) {
                            koPts += scoring.exactScore; detail.exactScore += scoring.exactScore;
                        }
                    }
                });
            });
        }

        // Score special questions
        let specialPts = 0;
        const specialConfig = getSpecialQuestionsConfig();
        if (specialConfig?.questions && u.specialPicks) {
            specialConfig.questions.forEach(q => {
                if (q.correctAnswer == null) return;
                const pick = u.specialPicks[q.id];
                if (pick == null) return;
                let correct = false;
                if (q.type === 'numeric') {
                    correct = Number(pick) === Number(q.correctAnswer);
                } else {
                    correct = String(pick) === String(q.correctAnswer);
                }
                if (correct) specialPts += (q.points || 0);
            });
        }

        return { userId: u.userId, name: u.name, potMember: !!u.potMember, groupPts, koPts, specialPts, total: groupPts + koPts + specialPts, detail };
    });
}

export function sign(n) { return n > 0 ? 1 : (n < 0 ? -1 : 0); }

// Parse date like "18 juni 21:00" relative to tournament year
export function parseMatchDate(dateStr) {
    if (!dateStr) return null;
    const months = { 'januari': 0, 'februari': 1, 'mars': 2, 'april': 3, 'maj': 4, 'juni': 5, 'juli': 6, 'augusti': 7, 'september': 8, 'oktober': 9, 'november': 10, 'december': 11 };
    const parts = dateStr.trim().match(/^(\d+)\s+(\w+)\s+(\d{1,2}):(\d{2})$/);
    if (!parts) return null;
    const day = parseInt(parts[1]);
    const month = months[parts[2].toLowerCase()];
    if (month === undefined) return null;
    return new Date(getTournamentYear(), month, day, parseInt(parts[3]), parseInt(parts[4]));
}

export function renderStatBar(team, pct) {
    return `<div class="stat-bar">
        <span class="stat-bar-label">${f(team)}${team}</span>
        <div style="flex:1; margin: 0 8px;"><div class="stat-bar-fill" style="width: ${Math.max(pct, 3)}%;">${pct > 15 ? pct + '%' : ''}</div></div>
        <span class="stat-bar-pct">${pct}%</span>
    </div>`;
}

export function renderTippersSummary(exactTippers, winnerTippers) {
    let html = '';
    if (exactTippers.length > 0) {
        html += renderTippersLine('🎯', exactTippers, 'tippade exakt rätt', '#28a745');
    }
    if (winnerTippers.length > 0) {
        html += renderTippersLine('✓', winnerTippers, 'tippade rätt vinnare', '#17a2b8');
    }
    if (exactTippers.length === 0 && winnerTippers.length === 0) {
        html += `<div style="font-size:12px; color:#999; margin-top:4px; text-align:center;">Ingen annan tippade rätt</div>`;
    }
    return html;
}

export function renderTippersLine(icon, names, suffix, color) {
    if (names.length <= 3) {
        const joined = names.length <= 2 ? names.join(' & ') : names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1];
        return `<div style="font-size:12px; color:${color}; margin-top:4px; text-align:center; display:block; width:100%;">${icon} ${joined} ${suffix}</div>`;
    }

    let displayNames = [...names].sort(() => 0.5 - Math.random());
    let tooltipText = "";
    const MAX_NAMES = 10;

    if (displayNames.length > MAX_NAMES) {
        const selected = displayNames.slice(0, MAX_NAMES);
        const hiddenCount = displayNames.length - MAX_NAMES;
        tooltipText = selected.join(', ') + ` <br><span style="color:#aaa;">(och ${hiddenCount} fler)</span>`;
    } else {
        tooltipText = displayNames.join(', ');
    }

    return `<div class="tipper-hover" style="font-size:12px; color:${color}; margin-top:4px; cursor:default; text-align:center; display:block; width:100%;">
        ${icon} ${names.length} st ${suffix}
        <span class="tipper-tooltip">${tooltipText}</span>
    </div>`;
}
