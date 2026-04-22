import { db, auth } from './config.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { hasStageType, getFinalRound, hasSpecialQuestions } from './tournament-config.js';

// Once-per-user dismissal lives in localStorage so the popup doesn't re-trigger
// every time the user re-saves an already-complete tipsrad. Settings has a
// "Visa popup igen" button that bypasses the dismiss and shows it on demand.
const DISMISSED_KEY = 'munkentipset_tips_complete_dismissed';

function isAllTipsComplete(d) {
    if (hasStageType('round-robin-groups') && !d.groupPicks?.completedAt) return false;
    if (hasStageType('single-elimination')) {
        const finalKey = getFinalRound()?.key;
        if (!finalKey) return false;
        const pick = d.knockout?.[finalKey];
        const koDone = typeof pick === 'string' ? !!pick : !!(pick && pick.length);
        if (!koDone) return false;
    }
    if (hasSpecialQuestions() && !d.specialPicks?.completedAt) return false;
    return true;
}

// Called from each save-handler after a successful write. Shows the popup if:
//   (a) all tipsrader are complete AND the user hasn't previously dismissed, OR
//   (b) the user opted into the pot but admin hasn't marked them paid yet —
//       then we show it again as a Swish reminder (skipping step 1).
export async function maybeShowTipsCompleteModal() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
        const snap = await getDoc(doc(db, "users", uid));
        if (!snap.exists()) return;
        const d = snap.data();
        if (!isAllTipsComplete(d)) return;

        const dismissed = !!localStorage.getItem(DISMISSED_KEY);
        const pendingPayment = !!d.potIntent && !d.potMember;

        if (pendingPayment) {
            // Skip the opt-in screen — they've already said yes.
            showTipsCompleteModal({ startAtStep: 2 });
        } else if (!dismissed) {
            showTipsCompleteModal();
        }
    } catch { /* noop */ }
}

// Force-show (used by settings "Visa popup igen")
export function showTipsCompleteModalForced() {
    showTipsCompleteModal();
}

function showTipsCompleteModal({ startAtStep = 1 } = {}) {
    const overlay = document.getElementById('tips-complete-overlay');
    const card1 = document.getElementById('tips-complete-card');
    const card2 = document.getElementById('pot-swish-card');
    if (!overlay || !card1 || !card2) return;

    overlay.style.display = 'flex';
    card1.style.display = startAtStep === 2 ? 'none' : '';
    card2.style.display = startAtStep === 2 ? '' : 'none';

    const close = ({ redirect = false } = {}) => {
        overlay.style.display = 'none';
        localStorage.setItem(DISMISSED_KEY, '1');
        if (redirect) {
            document.querySelector('.tab-btn[data-target="start-tab"]')?.click();
        }
    };

    const writeIntent = async (value) => {
        try {
            const uid = auth.currentUser?.uid;
            if (!uid) return;
            const update = { potIntent: value };
            if (value) update.potIntentAt = new Date().toISOString();
            await setDoc(doc(db, "users", uid), update, { merge: true });
        } catch { /* noop */ }
    };

    // Use direct assignment (not addEventListener) so re-opening the modal
    // multiple times doesn't stack listeners from previous opens.
    document.getElementById('tips-complete-no').onclick = async () => {
        // Explicit "no" — clear any prior intent so admin's Prispott reflects it.
        await writeIntent(false);
        close({ redirect: true });
    };

    document.getElementById('tips-complete-yes').onclick = async () => {
        await writeIntent(true);
        card1.style.display = 'none';
        card2.style.display = '';
    };

    // Closing the swish step takes the user back to the dashboard start so they
    // land somewhere useful rather than staying on the save-screen they just
    // left. Backdrop click does the same for consistency.
    document.getElementById('pot-swish-close').onclick = () => close({ redirect: true });
    overlay.onclick = (e) => { if (e.target === overlay) close({ redirect: true }); };
}
