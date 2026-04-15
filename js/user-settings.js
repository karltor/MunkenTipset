import { db, auth } from './config.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

const EMAIL_PREF_KEY = 'emailPref'; // 'often' | 'few' | 'none'

// Load the user's current email preference from Firestore.
// If `prefetchedUserData` is supplied (from app.js' initial user-doc read),
// we skip the network round-trip entirely — this matters on slow connections
// where every extra getDoc adds seconds to the critical path.
export async function loadEmailPref(prefetchedUserData) {
    if (prefetchedUserData !== undefined) {
        return (prefetchedUserData && prefetchedUserData[EMAIL_PREF_KEY]) || null;
    }
    const userId = auth.currentUser?.uid;
    if (!userId) return null;
    const snap = await getDoc(doc(db, "users", userId));
    return snap.exists() ? (snap.data()[EMAIL_PREF_KEY] || null) : null;
}

// Save email preference to Firestore user doc
export async function saveEmailPref(pref) {
    const userId = auth.currentUser?.uid;
    if (!userId) return;
    await setDoc(doc(db, "users", userId), { [EMAIL_PREF_KEY]: pref }, { merge: true });
}

// Initialize the settings tab (radio buttons)
export async function initSettingsTab() {
    const pref = await loadEmailPref();
    if (pref) {
        const radio = document.querySelector(`#settings-email-pref input[value="${pref}"]`);
        if (radio) radio.checked = true;
    }

    document.getElementById('settings-save-email-pref').addEventListener('click', async () => {
        const selected = document.querySelector('#settings-email-pref input[name="email-pref"]:checked');
        if (!selected) return;
        await saveEmailPref(selected.value);
        const btn = document.getElementById('settings-save-email-pref');
        btn.textContent = '✓ Sparat!';
        btn.style.background = '#28a745';
        setTimeout(() => { btn.textContent = 'Spara'; btn.style.background = ''; }, 2000);
    });
}

// Show email preference popup (after welcome popup slides out)
export function showEmailPrefPopup(onComplete) {
    const card = document.getElementById('email-pref-card');
    card.style.display = 'block';
    card.classList.add('popup-slide-in');

    card.querySelectorAll('.email-pref-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const pref = btn.dataset.pref;
            await saveEmailPref(pref);

            // Brief visual feedback
            btn.style.borderColor = '#28a745';
            btn.style.background = 'rgba(40,167,69,0.2)';

            setTimeout(() => {
                const overlay = document.getElementById('welcome-overlay');
                overlay.style.opacity = '0';
                overlay.style.transition = 'opacity 0.3s';
                setTimeout(() => {
                    overlay.style.display = 'none';
                    overlay.style.opacity = '';
                    overlay.style.transition = '';
                    if (onComplete) onComplete();
                }, 300);
            }, 400);
        });
    });
}
