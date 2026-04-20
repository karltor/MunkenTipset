import { db } from './config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { DEFAULT_SCORING, buildDefaultScoring } from './scoring.js';
import { getKnockoutRounds, getSpecialQuestionsConfig, hasSpecialQuestions } from './tournament-config.js';

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

// Public: clear cache (e.g. when admin bumps dataVersion)
export function invalidateScoringInfoCache() {
    _cachedScoring = null;
}

function fmtP(n) { return `${n} p`; }

// Build list of active (non-zero) scoring rules grouped by category.
function buildActiveRules(scoring) {
    const rules = [];

    if (scoring.matchResult > 0) {
        rules.push({
            label: 'Rätt 1X2',
            desc: 'Du tippade rätt vinnare eller oavgjort i en match.',
            pts: scoring.matchResult,
        });
    }
    if (scoring.matchHomeGoals > 0) {
        rules.push({
            label: 'Rätt antal hemmamål',
            desc: 'Antal mål du tippade på hemmalaget stämmer.',
            pts: scoring.matchHomeGoals,
        });
    }
    if (scoring.matchAwayGoals > 0) {
        rules.push({
            label: 'Rätt antal bortamål',
            desc: 'Antal mål du tippade på bortalaget stämmer.',
            pts: scoring.matchAwayGoals,
        });
    }
    if (scoring.exactScore > 0) {
        rules.push({
            label: 'Exakt resultat (bonus)',
            desc: 'Extra bonus när hela matchresultatet är exakt rätt.',
            pts: scoring.exactScore,
        });
    }
    if (scoring.groupWinner > 0) {
        rules.push({
            label: 'Rätt gruppetta',
            desc: 'Det lag du tippade som gruppetta vann gruppen.',
            pts: scoring.groupWinner,
        });
    }
    if (scoring.groupRunnerUp > 0) {
        rules.push({
            label: 'Rätt grupptvåa',
            desc: 'Det lag du tippade som grupptvåa slutade tvåa.',
            pts: scoring.groupRunnerUp,
        });
    }
    if (scoring.groupThird > 0) {
        rules.push({
            label: 'Rätt grupptrea',
            desc: 'Det lag du tippade som grupptrea slutade trea.',
            pts: scoring.groupThird,
        });
    }

    // Knockout advancement per round
    const koRounds = getKnockoutRounds();
    koRounds.forEach(r => {
        const pts = scoring[`ko_${r.key}`];
        if (pts && pts > 0) {
            rules.push({
                label: `Rätt lag vidare till ${r.label.toLowerCase()}`,
                desc: 'Per lag du tippade som tog sig vidare till denna runda.',
                pts,
            });
        }
    });

    // Special questions (each question can have its own point value)
    if (hasSpecialQuestions()) {
        const sp = getSpecialQuestionsConfig();
        (sp?.questions || []).forEach(q => {
            const pts = Number(q.points || 0);
            if (pts > 0) {
                rules.push({
                    label: q.label || q.question || 'Specialfråga',
                    desc: 'Rätt svar på denna specialfråga.',
                    pts,
                });
            }
        });
    }

    return rules;
}

// Build a realistic 2-match example using only the active scoring rules.
// Scenario 1: rätt vinnare + rätt ena lagets mål (inte exakt)
// Scenario 2: fel vinnare men rätt antal bortamål
function buildExample(scoring) {
    const hasSign = scoring.matchResult > 0;
    const hasHome = scoring.matchHomeGoals > 0;
    const hasAway = scoring.matchAwayGoals > 0;
    const hasExact = scoring.exactScore > 0;

    const matches = [];

    // Match 1 — Sverige 2–1 Norge. Tips: 3–1.
    const m1 = {
        home: 'Sverige', away: 'Norge',
        realH: 2, realA: 1,
        tipH: 3, tipA: 1,
        breakdown: [],
        points: 0,
    };
    const m1SignCorrect = Math.sign(m1.tipH - m1.tipA) === Math.sign(m1.realH - m1.realA);
    const m1HomeCorrect = m1.tipH === m1.realH;
    const m1AwayCorrect = m1.tipA === m1.realA;
    const m1ExactCorrect = m1HomeCorrect && m1AwayCorrect;
    if (hasSign) {
        m1.breakdown.push({ ok: m1SignCorrect, txt: m1SignCorrect ? `Rätt 1X2 (du tippade hemmaseger)` : 'Fel 1X2', pts: m1SignCorrect ? scoring.matchResult : 0 });
        if (m1SignCorrect) m1.points += scoring.matchResult;
    }
    if (hasHome) {
        m1.breakdown.push({ ok: m1HomeCorrect, txt: m1HomeCorrect ? `Rätt antal hemmamål (${m1.realH})` : `Fel antal hemmamål (du tippade ${m1.tipH}, rätt var ${m1.realH})`, pts: m1HomeCorrect ? scoring.matchHomeGoals : 0 });
        if (m1HomeCorrect) m1.points += scoring.matchHomeGoals;
    }
    if (hasAway) {
        m1.breakdown.push({ ok: m1AwayCorrect, txt: m1AwayCorrect ? `Rätt antal bortamål (${m1.realA})` : `Fel antal bortamål`, pts: m1AwayCorrect ? scoring.matchAwayGoals : 0 });
        if (m1AwayCorrect) m1.points += scoring.matchAwayGoals;
    }
    if (hasExact) {
        m1.breakdown.push({ ok: m1ExactCorrect, txt: m1ExactCorrect ? 'Exakt resultat (bonus)' : 'Inte exakt resultat', pts: m1ExactCorrect ? scoring.exactScore : 0 });
        if (m1ExactCorrect) m1.points += scoring.exactScore;
    }
    matches.push(m1);

    // Match 2 — Danmark 0–2 Finland. Tips: 2–2.
    // Fel vinnare (du tippade oavgjort, Finland vann) men rätt antal bortamål.
    const m2 = {
        home: 'Danmark', away: 'Finland',
        realH: 0, realA: 2,
        tipH: 2, tipA: 2,
        breakdown: [],
        points: 0,
    };
    const m2SignCorrect = Math.sign(m2.tipH - m2.tipA) === Math.sign(m2.realH - m2.realA);
    const m2HomeCorrect = m2.tipH === m2.realH;
    const m2AwayCorrect = m2.tipA === m2.realA;
    const m2ExactCorrect = m2HomeCorrect && m2AwayCorrect;
    if (hasSign) {
        m2.breakdown.push({ ok: m2SignCorrect, txt: `Fel 1X2 (du tippade oavgjort, Finland vann)`, pts: 0 });
    }
    if (hasHome) {
        m2.breakdown.push({ ok: m2HomeCorrect, txt: `Fel antal hemmamål (du tippade ${m2.tipH}, rätt var ${m2.realH})`, pts: 0 });
    }
    if (hasAway) {
        m2.breakdown.push({ ok: m2AwayCorrect, txt: `Rätt antal bortamål (${m2.realA})`, pts: scoring.matchAwayGoals });
        m2.points += scoring.matchAwayGoals;
    }
    if (hasExact) {
        m2.breakdown.push({ ok: m2ExactCorrect, txt: 'Inte exakt resultat', pts: 0 });
    }
    matches.push(m2);

    const total = matches.reduce((s, m) => s + m.points, 0);
    return { matches, total };
}

function renderRulesHtml(rules) {
    if (rules.length === 0) {
        return `<p style="color:#888; font-size:13px;">Inga aktiva poängregler är inställda ännu.</p>`;
    }
    let html = `<div class="scoring-rules-list">`;
    rules.forEach(r => {
        html += `<div class="scoring-rule">
            <div>
                <div class="scoring-rule-label">${r.label}</div>
                <div class="scoring-rule-desc">${r.desc}</div>
            </div>
            <div class="scoring-rule-pts">+${r.pts} p</div>
        </div>`;
    });
    html += `</div>`;
    return html;
}

function renderExampleHtml(example, scoring) {
    const hasMatchScoring = scoring.matchResult > 0 || scoring.matchHomeGoals > 0 || scoring.matchAwayGoals > 0 || scoring.exactScore > 0;
    if (!hasMatchScoring) return '';

    let html = `<div class="scoring-example">`;
    html += `<h3>Räkneexempel — 2 matcher</h3>`;
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

export async function openScoringInfo() {
    const overlay = document.getElementById('scoring-info-overlay');
    const content = document.getElementById('scoring-info-content');
    if (!overlay || !content) return;

    content.innerHTML = `<p style="text-align:center; color:#999;">Laddar...</p>`;
    overlay.style.display = 'flex';

    const scoring = await fetchScoring();
    const rules = buildActiveRules(scoring);
    const example = buildExample(scoring);

    let html = renderRulesHtml(rules);
    html += renderExampleHtml(example, scoring);
    content.innerHTML = html;
}

export function closeScoringInfo() {
    const overlay = document.getElementById('scoring-info-overlay');
    if (overlay) overlay.style.display = 'none';
}

// Wire up close handlers once on import
export function initScoringInfo() {
    const overlay = document.getElementById('scoring-info-overlay');
    const closeBtn = document.getElementById('scoring-info-close');
    if (closeBtn) closeBtn.addEventListener('click', closeScoringInfo);
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeScoringInfo();
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const o = document.getElementById('scoring-info-overlay');
            if (o && o.style.display !== 'none') closeScoringInfo();
        }
    });
}
