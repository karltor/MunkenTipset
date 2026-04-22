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

// Called from each save-handler after a successful write. If all tipsrader
// are now done and the user hasn't previously dismissed the popup, show it.
export async function maybeShowTipsCompleteModal() {
    if (localStorage.getItem(DISMISSED_KEY)) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
        const snap = await getDoc(doc(db, "users", uid));
        if (!snap.exists()) return;
        const d = snap.data();
        if (!isAllTipsComplete(d)) return;
        showTipsCompleteModal();
    } catch { /* noop */ }
}

// Force-show (used by settings "Visa popup igen")
export function showTipsCompleteModalForced() {
    showTipsCompleteModal();
}

function showTipsCompleteModal() {
    const overlay = document.getElementById('tips-complete-overlay');
    const card1 = document.getElementById('tips-complete-card');
    const card2 = document.getElementById('pot-swish-card');
    if (!overlay || !card1 || !card2) return;

    overlay.style.display = 'flex';
    card1.style.display = '';
    card2.style.display = 'none';

    const close = () => {
        overlay.style.display = 'none';
        localStorage.setItem(DISMISSED_KEY, '1');
    };

    // Use direct assignment (not addEventListener) so re-opening the modal
    // multiple times doesn't stack listeners from previous opens.
    document.getElementById('tips-complete-no').onclick = () => {
        close();
        document.querySelector('.tab-btn[data-target="start-tab"]')?.click();
    };

    document.getElementById('tips-complete-yes').onclick = async () => {
        try {
            const uid = auth.currentUser?.uid;
            if (uid) {
                await setDoc(
                    doc(db, "users", uid),
                    { potIntent: true, potIntentAt: new Date().toISOString() },
                    { merge: true }
                );
            }
        } catch { /* noop — still show step 2 even if write fails */ }
        card1.style.display = 'none';
        card2.style.display = '';
    };

    document.getElementById('pot-swish-close').onclick = close;

    overlay.onclick = (e) => { if (e.target === overlay) close(); };
}
