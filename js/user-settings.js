import { db, auth } from './config.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { getColorMode, setColorMode } from './color-mode.js';

const EMAIL_PREF_KEY = 'emailPref'; // 'often' | 'few' | 'none'
const NOTIFICATION_EMAIL_KEY = 'notificationEmail';
export const WELCOME_DISMISSED_KEY = 'munkentipset_welcome_dismissed';

// RFC 5322-ish pragmatic check — rejects obvious typos without being picky about
// unusual but valid addresses. The backend (admin's mail client) does final delivery.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(s) {
    return typeof s === 'string' && EMAIL_REGEX.test(s.trim());
}

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
    const userId = auth.currentUser?.uid;
    const snap = userId ? await getDoc(doc(db, "users", userId)) : null;
    const userData = snap?.exists() ? snap.data() : {};

    const pref = userData[EMAIL_PREF_KEY] || null;
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

    initNotificationEmailField(userData);

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

function initNotificationEmailField(userData) {
    const input = document.getElementById('settings-notification-email');
    const errorEl = document.getElementById('settings-notification-email-error');
    const saveBtn = document.getElementById('settings-save-notification-email');
    const defaultEl = document.getElementById('settings-notification-email-default');
    if (!input || !saveBtn) return;

    const accountEmail = auth.currentUser?.email || userData.email || '';
    if (defaultEl) defaultEl.textContent = accountEmail;

    input.value = userData[NOTIFICATION_EMAIL_KEY] || '';
    input.placeholder = accountEmail || 'din.privata@mejl.com';

    const showError = (msg) => {
        if (!errorEl) return;
        errorEl.textContent = msg;
        errorEl.style.display = msg ? 'block' : 'none';
    };

    input.addEventListener('input', () => showError(''));

    saveBtn.addEventListener('click', async () => {
        const raw = input.value.trim();
        const userId = auth.currentUser?.uid;
        if (!userId) return;

        if (raw && !isValidEmail(raw)) {
            showError('Ogiltig mejladress — kontrollera stavningen.');
            input.focus();
            return;
        }
        showError('');

        saveBtn.disabled = true;
        const originalText = saveBtn.textContent;
        try {
            // Empty string clears the override and falls back to the account email.
            await setDoc(
                doc(db, "users", userId),
                { [NOTIFICATION_EMAIL_KEY]: raw || null },
                { merge: true }
            );
            input.value = raw;
            saveBtn.textContent = '✓ Sparat!';
            saveBtn.style.background = '#28a745';
        } catch {
            saveBtn.textContent = 'Kunde inte spara';
            saveBtn.style.background = '#dc3545';
        } finally {
            setTimeout(() => {
                saveBtn.textContent = originalText;
                saveBtn.style.background = '';
                saveBtn.disabled = false;
            }, 2000);
        }
    });
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
