import { db, auth } from './config.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { getColorMode, setColorMode } from './color-mode.js';

const EMAIL_PREF_KEY = 'emailPref'; // 'often' | 'few' | 'none'
export const WELCOME_DISMISSED_KEY = 'munkentipset_welcome_dismissed';

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

// Initialize the settings tab (radio buttons + welcome toggle)
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

    // Dark mode toggle
    const darkToggle = document.getElementById('settings-dark-mode-toggle');
    if (darkToggle) {
        darkToggle.checked = getColorMode() === 'dark';
        darkToggle.addEventListener('change', () => {
            setColorMode(darkToggle.checked ? 'dark' : 'light');
        });
    }

    // Welcome popup toggle
    const welcomeToggle = document.getElementById('settings-welcome-toggle');
    if (welcomeToggle) {
        // Reflect current state: ON = popup will show (key not set)
        welcomeToggle.checked = !localStorage.getItem(WELCOME_DISMISSED_KEY);

        welcomeToggle.addEventListener('change', () => {
            if (welcomeToggle.checked) {
                localStorage.removeItem(WELCOME_DISMISSED_KEY);
                showWelcomeAgain();
            } else {
                localStorage.setItem(WELCOME_DISMISSED_KEY, '1');
            }
        });
    }
}

function showWelcomeAgain() {
    const overlay = document.getElementById('welcome-overlay');
    const welcomeCard = document.getElementById('welcome-popup-card');
    const emailPrefCard = document.getElementById('email-pref-card');

    if (!overlay || !welcomeCard) return;

    // Reset card states
    if (emailPrefCard) emailPrefCard.style.display = 'none';
    welcomeCard.style.display = '';
    welcomeCard.classList.remove('popup-slide-out');
    overlay.style.display = 'flex';

    function close(dismiss) {
        overlay.style.display = 'none';
        if (dismiss) {
            localStorage.setItem(WELCOME_DISMISSED_KEY, '1');
            const toggle = document.getElementById('settings-welcome-toggle');
            if (toggle) toggle.checked = false;
        }
    }

    // Use { once: true } so re-opening multiple times doesn't stack listeners
    document.getElementById('welcome-close')?.addEventListener('click', () => close(false), { once: true });
    document.getElementById('welcome-dismiss')?.addEventListener('click', () => close(true), { once: true });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); }, { once: true });
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
