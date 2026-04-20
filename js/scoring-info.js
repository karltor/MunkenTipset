import { db } from './config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { DEFAULT_SCORING, buildDefaultScoring } from './scoring.js';
import {
    getKnockoutRounds,
    getSpecialQuestionsConfig,
    hasSpecialQuestions,
    getChampionLabel,
} from './tournament-config.js';

let _cachedScoring = null;

async function fetchScoring() {
    if (_cachedScoring) return _cachedScoring;
    try {
        const snap = await getDoc(doc(db, "matches", "_settings"));
        const settings = snap.exists() ? snap.data() : {};
        const base = buildDefaultScoring ? buildDefaultScoring() : DEFAULT_SCORING;
        _cachedScoring = { ...base, ...(settings.scoring || {}) };
    } catch {
        _cachedScoring = { ...DEFAULT_SCORING };
    }
    return _cachedScoring;
}

export function invalidateScoringInfoCache() {
    _cachedScoring = null;
}

// Convert e.g. "Ditt VM-Guld 2026" → "Rätt VM-Guld 2026"
function championRuleLabel() {
    const raw = (getChampionLabel() || '').trim();
    if (!raw) return 'Rätt turneringsvinnare';
    if (/^ditt\s+/i.test(raw)) return raw.replace(/^ditt\s+/i, 'Rätt ');
    if (/^din\s+/i.test(raw)) return raw.replace(/^din\s+/i, 'Rätt ');
    return 'Rätt ' + raw.charAt(0).toLowerCase() + raw.slice(1);
}

// Build list of active (non-zero) scoring rules.
function buildActiveRules(scoring) {
    const rules = [];

    if (scoring.matchResult > 0) {
        rules.push({ label: 'Rätt 1X2', desc: 'Du tippade rätt vinnare eller oavgjort i en match.', pts: scoring.matchResult });
    }
    if (scoring.matchHomeGoals > 0) {
        rules.push({ label: 'Rätt antal hemmamål', desc: 'Antal mål du tippade på hemmalaget stämmer.', pts: scoring.matchHomeGoals });
    }
    if (scoring.matchAwayGoals > 0) {
        rules.push({ label: 'Rätt antal bortamål', desc: 'Antal mål du tippade på bortalaget stämmer.', pts: scoring.matchAwayGoals });
    }
    if (scoring.exactScore > 0) {
        rules.push({ label: 'Exakt resultat (bonus)', desc: 'Extra bonus när hela matchresultatet är exakt rätt.', pts: scoring.exactScore });
    }
    if (scoring.groupWinner > 0) {
        rules.push({ label: 'Rätt gruppetta', desc: 'Det lag du tippade som gruppetta vann gruppen.', pts: scoring.groupWinner });
    }
    if (scoring.groupRunnerUp > 0) {
        rules.push({ label: 'Rätt grupptvåa', desc: 'Det lag du tippade som grupptvåa slutade tvåa.', pts: scoring.groupRunnerUp });
    }
    if (scoring.groupThird > 0) {
        rules.push({ label: 'Rätt grupptrea', desc: 'Det lag du tippade som grupptrea slutade trea.', pts: scoring.groupThird });
    }

    // Knockout: non-final rounds award per team that advanced to that round.
    // The final round instead awards for picking the actual champion — label it
    // with the tournament's champion label so it reads "Rätt VM-Guld 2026".
    const koRounds = getKnockoutRounds();
    const finalIdx = koRounds.length - 1;
    koRounds.forEach((r, i) => {
        const pts = scoring[`ko_${r.key}`];
        if (!pts || pts <= 0) return;
        if (i === finalIdx) {
            rules.push({
                label: championRuleLabel(),
                desc: 'Du tippade rätt lag som vinner hela turneringen.',
                pts,
            });
        } else {
            rules.push({
                label: `Rätt lag till ${r.label.toLowerCase()}`,
                desc: 'Per lag du tippade som tog sig vidare till denna runda.',
                pts,
            });
        }
    });

    // Special questions — group by points. If all share the same value we show
    // a single compact row; otherwise one row per points-value cluster.
    if (hasSpecialQuestions()) {
        const sp = getSpecialQuestionsConfig();
        const questions = (sp?.questions || []).filter(q => Number(q.points || 0) > 0);
        if (questions.length > 0) {
            const byPts = new Map();
            questions.forEach(q => {
                const p = Number(q.points);
                if (!byPts.has(p)) byPts.set(p, []);
                byPts.get(p).push(q);
            });
            [...byPts.entries()].sort((a, b) => b[0] - a[0]).forEach(([pts, qs]) => {
                rules.push({
                    label: qs.length > 1 ? `Specialfrågor (${qs.length} st)` : 'Specialfråga',
                    desc: qs.length > 1
                        ? `Varje rätt svar på en specialfråga ger ${pts} p.`
                        : '',
                    pts,
                });
            });
        }
    }

    return rules;
}

// Two-match worked example using only the active scoring rules.
function buildExample(scoring) {
    const hasSign = scoring.matchResult > 0;
    const hasHome = scoring.matchHomeGoals > 0;
    const hasAway = scoring.matchAwayGoals > 0;
    const hasExact = scoring.exactScore > 0;

    const matches = [];

    // Match 1: Sverige 2–1 Norge. Tips: 3–1.
    // Rätt vinnare + rätt bortamål, fel hemmamål (inte exakt).
    const m1 = { home: 'Sverige', away: 'Norge', realH: 2, realA: 1, tipH: 3, tipA: 1, breakdown: [], points: 0 };
    const m1SignOK = Math.sign(m1.tipH - m1.tipA) === Math.sign(m1.realH - m1.realA);
    const m1HomeOK = m1.tipH === m1.realH;
    const m1AwayOK = m1.tipA === m1.realA;
    const m1ExactOK = m1HomeOK && m1AwayOK;
    if (hasSign) {
        m1.breakdown.push({ ok: m1SignOK, txt: 'Rätt 1X2 (du tippade hemmaseger)', pts: m1SignOK ? scoring.matchResult : 0 });
        if (m1SignOK) m1.points += scoring.matchResult;
    }
    if (hasHome) {
        m1.breakdown.push({ ok: m1HomeOK, txt: `Fel antal hemmamål (du tippade ${m1.tipH}, rätt var ${m1.realH})`, pts: 0 });
    }
    if (hasAway) {
        m1.breakdown.push({ ok: m1AwayOK, txt: `Rätt antal bortamål (${m1.realA})`, pts: scoring.matchAwayGoals });
        m1.points += scoring.matchAwayGoals;
    }
    if (hasExact) {
        m1.breakdown.push({ ok: m1ExactOK, txt: 'Inte exakt resultat', pts: 0 });
    }
    matches.push(m1);

    // Match 2: Danmark 0–2 Finland. Tips: 2–2.
    // Fel vinnare men rätt antal bortamål.
    const m2 = { home: 'Danmark', away: 'Finland', realH: 0, realA: 2, tipH: 2, tipA: 2, breakdown: [], points: 0 };
    const m2SignOK = Math.sign(m2.tipH - m2.tipA) === Math.sign(m2.realH - m2.realA);
    const m2HomeOK = m2.tipH === m2.realH;
    const m2AwayOK = m2.tipA === m2.realA;
    const m2ExactOK = m2HomeOK && m2AwayOK;
    if (hasSign) {
        m2.breakdown.push({ ok: m2SignOK, txt: 'Fel 1X2 (du tippade oavgjort, Finland vann)', pts: 0 });
    }
    if (hasHome) {
        m2.breakdown.push({ ok: m2HomeOK, txt: `Fel antal hemmamål (du tippade ${m2.tipH}, rätt var ${m2.realH})`, pts: 0 });
    }
    if (hasAway) {
        m2.breakdown.push({ ok: m2AwayOK, txt: `Rätt antal bortamål (${m2.realA})`, pts: scoring.matchAwayGoals });
        m2.points += scoring.matchAwayGoals;
    }
    if (hasExact) {
        m2.breakdown.push({ ok: m2ExactOK, txt: 'Inte exakt resultat', pts: 0 });
    }
    matches.push(m2);

    const total = matches.reduce((s, m) => s + m.points, 0);
    return { matches, total };
}

function renderRulesPanel(rules) {
    let html = `<div class="scoring-info-card-panel"><h3>Aktiva poängregler</h3>`;
    if (rules.length === 0) {
        html += `<p style="color:#888; font-size:13px;">Inga aktiva poängregler är inställda ännu.</p>`;
    } else {
        html += `<div class="scoring-rules-list">`;
        rules.forEach(r => {
            html += `<div class="scoring-rule">
                <div>
                    <div class="scoring-rule-label">${r.label}</div>
                    ${r.desc ? `<div class="scoring-rule-desc">${r.desc}</div>` : ''}
                </div>
                <div class="scoring-rule-pts">+${r.pts} p</div>
            </div>`;
        });
        html += `</div>`;
    }
    html += `</div>`;
    return html;
}

function renderExamplePanel(example, scoring) {
    const hasMatchScoring = scoring.matchResult > 0 || scoring.matchHomeGoals > 0 || scoring.matchAwayGoals > 0 || scoring.exactScore > 0;
    if (!hasMatchScoring) return '';

    let html = `<div class="scoring-info-card-panel"><h3>Räkneexempel — 2 matcher</h3>`;
    example.matches.forEach(m => {
        html += `<div class="scoring-example-match">
            <div class="scoring-example-match-head">
                <span>${m.home} ${m.realH}–${m.realA} ${m.away}</span>
                <span style="font-weight:500; color:#888; font-size:12px;">Ditt tips: ${m.tipH}–${m.tipA}</span>
            </div>
            <div class="scoring-example-breakdown"><ul>`;
        m.breakdown.forEach(b => {
            const icon = b.ok ? '✅' : '❌';
            const ptsTxt = b.pts > 0 ? ` <strong style="color:var(--color-correct,#28a745);">+${b.pts} p</strong>` : '';
            html += `<li>${icon} ${b.txt}${ptsTxt}</li>`;
        });
        html += `</ul></div>
            <div class="scoring-example-total">Delsumma: ${m.points} p</div>
        </div>`;
    });
    html += `<div class="scoring-example-sum">Totalt efter dessa 2 matcher: ${example.total} p</div>`;
    html += `</div>`;
    return html;
}

export async function renderScoringInfoTab() {
    const container = document.getElementById('scoring-info-content');
    if (!container) return;

    container.innerHTML = `<p style="text-align:center; color:#999; grid-column: 1 / -1;">Laddar...</p>`;

    const scoring = await fetchScoring();
    const rules = buildActiveRules(scoring);
    const example = buildExample(scoring);

    container.innerHTML = renderRulesPanel(rules) + renderExamplePanel(example, scoring);
}
