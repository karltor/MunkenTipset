import { db, auth } from './config.js';
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { hasStageType, getTournamentName, getChampionLabel } from './tournament-config.js';
import { teamImg } from './team-data.js';
import { DEFAULT_SCORING, buildDefaultScoring, buildOfficialGroupStandings, calcLeaderboard } from './scoring.js';

// localStorage key stores `${tournamentName}::${champion}`. When the final
// result is added/changed/removed the stored identifier no longer matches the
// live one, so the modal shows again — which is exactly what we want for the
// start of a new tournament where this preference shouldn't carry over.
const DISMISSED_KEY = 'munkentipset_final_modal_dismissed';

// Session flag — don't reopen the modal twice in the same tab. Reset only on
// reload, so a realtime data push that fires while the user already has the
// modal open doesn't stack.
let _shownThisSession = false;

function currentIdentifier(bracket) {
    const champion = bracket?.rounds?.Final?.[0]?.winner;
    if (!champion) return null;
    return `${getTournamentName()}::${champion}`;
}

function f(team) {
    try { return teamImg(team); } catch { return ''; }
}

// Fetch the data we need to compute the MunkenTipset winner. Called only when
// a final result is detected, so the cost is acceptable.
async function fetchScoresAndChampion() {
    try {
        const [bracketSnap, settingsSnap, matchesSnap, usersSnap] = await Promise.all([
            getDoc(doc(db, "matches", "_bracket")),
            getDoc(doc(db, "matches", "_settings")),
            getDocs(collection(db, "matches")),
            getDocs(collection(db, "users")),
        ]);
        const bracket = bracketSnap.exists() ? bracketSnap.data() : null;
        const settings = settingsSnap.exists() ? settingsSnap.data() : {};
        const scoring = settings.scoring || DEFAULT_SCORING || buildDefaultScoring();

        const results = {};
        const matchDocs = [];
        matchesSnap.docs.forEach(d => {
            if (d.id.startsWith('_')) return;
            const data = d.data();
            matchDocs.push({ id: d.id, ...data });
            if (data.homeScore !== undefined) results[d.id] = data;
        });

        const users = [];
        usersSnap.docs.forEach(d => {
            const data = d.data();
            const u = {
                userId: d.id,
                name: data.name || d.id,
                potMember: !!data.potMember,
                groupPicks: data.groupPicks || null,
                knockoutPicks: data.knockout || null,
                knockoutScores: data.knockoutScores || null,
                matchTips: data.matchTips || {},
                specialPicks: data.specialPicks || null,
            };
            if (u.groupPicks || u.knockoutPicks || Object.keys(u.matchTips).length > 0 || u.specialPicks) {
                users.push(u);
            }
        });

        const officialStandings = buildOfficialGroupStandings(results, matchDocs);
        const scores = calcLeaderboard(users, results, bracket, scoring, officialStandings);
        scores.sort((a, b) => b.total - a.total);
        return { bracket, scores };
    } catch (e) {
        console.warn('Final modal data fetch failed:', e);
        return null;
    }
}

// Public entry point. Safe to call any number of times — it's gated by the
// dismissed flag and a session-shown flag.
export async function maybeShowFinalModal({ bracket, scores } = {}) {
    if (!hasStageType('single-elimination')) return;
    if (_shownThisSession) return;

    // If caller didn't pass data, fetch it.
    if (!bracket || !scores) {
        const fetched = await fetchScoresAndChampion();
        if (!fetched) return;
        bracket = fetched.bracket;
        scores = fetched.scores;
    }

    const id = currentIdentifier(bracket);
    if (!id) {
        // Final not (or no longer) decided. Clear any stale dismissed flag so
        // that when a final result is entered again — same tournament or a
        // brand new one — the modal is guaranteed to show at least once.
        localStorage.removeItem(DISMISSED_KEY);
        return;
    }

    const dismissed = localStorage.getItem(DISMISSED_KEY);
    if (dismissed === id) return;  // user said "visa inte igen" for this final

    const champion = bracket.rounds.Final[0].winner;
    showFinalModal({ champion, scores, identifier: id });
    _shownThisSession = true;
}

function showFinalModal({ champion, scores, identifier }) {
    const overlay = document.getElementById('final-modal-overlay');
    if (!overlay) return;

    const top = scores.slice(0, 3);
    const winner = top[0];
    const myUid = auth.currentUser?.uid;
    const myRank = scores.findIndex(s => s.userId === myUid);
    const isWinner = winner && winner.userId === myUid;

    const championLabel = getChampionLabel();
    const tournamentName = getTournamentName();

    const podiumColors = ['#f1c40f', '#d1d8e0', '#cd7f32'];
    const podiumLabels = ['🥇 1:a', '🥈 2:a', '🥉 3:a'];

    const podiumHtml = top.map((s, i) => `
        <div style="background: ${podiumColors[i]}22; border:1px solid ${podiumColors[i]}; border-radius:10px; padding:10px 12px; display:flex; align-items:center; gap:10px; ${s.userId === myUid ? 'box-shadow:0 0 0 2px #28a745;' : ''}">
            <span style="font-weight:800; color:${podiumColors[i] === '#d1d8e0' ? '#5b6a7a' : '#7a5c00'};">${podiumLabels[i]}</span>
            <span style="flex:1; font-weight:700; color:#fff;">${s.name}</span>
            <span style="font-weight:800; color:#fff;">${s.total} p</span>
        </div>
    `).join('');

    const yourLine = myRank >= 0 && !isWinner
        ? `<div style="margin-top:10px; text-align:center; font-size:13px; color:rgba(255,255,255,0.75);">Din placering: <strong style="color:#fff;">${myRank + 1}:a</strong> av ${scores.length} med ${scores[myRank].total} poäng</div>`
        : '';
    const winnerHero = isWinner
        ? `<div style="margin-top:10px; text-align:center; font-size:14px; font-weight:700; color:#28a745;">🎉 Grattis — du vann ${tournamentName}!</div>`
        : '';

    const html = `
        <div class="welcome-popup" id="final-modal-card" style="max-width:520px;">
            <div style="text-align:center; font-size:11px; letter-spacing:2px; font-weight:800; color:#a67c00;">🏆 ${tournamentName.toUpperCase()} ÄR AVGJORT</div>
            <h2 style="margin-top:6px; text-align:center;">${championLabel}: ${f(champion)} ${champion}</h2>

            <div style="margin:18px 0 6px; font-size:11px; letter-spacing:2px; font-weight:800; color:rgba(255,255,255,0.7); text-align:center;">🎯 VINNARE AV ${tournamentName.toUpperCase()}-TIPSET</div>
            <div style="display:flex; flex-direction:column; gap:8px;">
                ${podiumHtml}
            </div>
            ${yourLine}
            ${winnerHero}

            <div style="display:flex; flex-direction:column; gap:8px; margin-top:18px;">
                <button class="btn-welcome" id="final-modal-close" style="background:#f1c40f; color:#000; border-color:#f1c40f;">Stäng</button>
                <button class="btn-welcome btn-welcome-dismiss" id="final-modal-hide-forever" style="font-size:13px;">Visa inte igen</button>
            </div>
        </div>
    `;

    overlay.innerHTML = html;
    overlay.style.display = 'flex';

    const close = ({ dismiss = false } = {}) => {
        overlay.style.display = 'none';
        if (dismiss) localStorage.setItem(DISMISSED_KEY, identifier);
    };

    document.getElementById('final-modal-close').onclick = () => close();
    document.getElementById('final-modal-hide-forever').onclick = () => close({ dismiss: true });
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
}
