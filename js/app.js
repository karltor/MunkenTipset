import { auth, db } from './config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { collection, getDocs, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { loadTournamentConfig, getTournamentName, hasStageType, getSpecialQuestionsConfig } from './tournament-config.js';
import { initWizard, getGroupPicks } from './wizard.js';
import { initBracket } from './bracket.js';
import { loadCommunityStats } from './stats.js';
import { initAdmin, checkTipsLocked } from './admin.js';
import { initSpecialTips } from './special-tips.js';
import { loadResults } from './results.js';
import { applyStoredTheme } from './admin-theme.js';
import { loadEmailPref, showEmailPrefPopup, initSettingsTab } from './user-settings.js';
import { initChat, destroyChat, setChatAdmin } from './chat.js';
import { toggleChatAdminPanel } from './chat-admin.js';

// Apply saved theme immediately before anything renders
applyStoredTheme();

// Loading screen: hide after minimum duration (to cover font/layout flashes)
const _loaderStart = Date.now();
const MIN_LOADER_MS = 900;
function hideLoader() {
    const elapsed = Date.now() - _loaderStart;
    const wait = Math.max(0, MIN_LOADER_MS - elapsed);
    setTimeout(() => {
        const el = document.getElementById('mt-loader');
        if (!el) return;
        el.classList.add('mt-loader-hidden');
        setTimeout(() => el.remove(), 450);
    }, wait);
}
// Safety fallback: always hide loader after 5s even if init stalls
setTimeout(hideLoader, 5000);

const ADMINS = ['karl.tornered@nyamunken.se', 'jonas.waltelius@nyamunken.se'];
const MATCHES_CACHE_KEY = 'munkentipset_matches_cache_v1';
const WELCOME_DISMISSED_KEY = 'munkentipset_welcome_dismissed';
let allMatchesData = [];
let isAdmin = false;
let globalTipsLocked = false;

function applyTabVisibility() {
    const hasGroups = hasStageType('round-robin-groups');
    const hasKnockout = hasStageType('single-elimination');
    const hasLeague = hasStageType('league');
    const hasSpecial = hasStageType('special-questions');
    const wizardBtn = document.querySelector('.tab-btn[data-target="wizard-tab"]');
    const bracketBtn = document.querySelector('.tab-btn[data-target="bracket-tab"]');
    const specialBtn = document.querySelector('.tab-btn[data-target="special-tab"]');
    if (wizardBtn) {
        wizardBtn.style.display = (hasGroups || hasLeague) ? '' : 'none';
        if (hasLeague && !hasGroups) wizardBtn.textContent = '🎯 Tippa Tabell';
    }
    if (bracketBtn) bracketBtn.style.display = hasKnockout ? '' : 'none';
    if (specialBtn) {
        specialBtn.style.display = hasSpecial ? '' : 'none';
        if (hasSpecial) {
            const cfg = getSpecialQuestionsConfig();
            if (cfg?.label) specialBtn.textContent = '⭐ ' + cfg.label;
        }
    }
}

// Logga ut
document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

// Tab-logik
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const target = e.target.dataset.target;
        if (e.target.classList.contains('locked')) return;

        document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById(target).classList.add('active');

        // Destroy chat listener when leaving chat tab (saves reads)
        destroyChat();

        if (target === 'bracket-tab') initBracket(getGroupPicks(), globalTipsLocked);
        if (target === 'special-tab') initSpecialTips(globalTipsLocked);
        if (target === 'results-tab') loadResults(allMatchesData);
        if (target === 'start-tab') loadCommunityStats();
        if (target === 'chat-tab') initChat();
    });
});

// Admin button → toggle admin tab
document.getElementById('admin-btn').addEventListener('click', () => {
    const adminTab = document.getElementById('admin-tab');
    const isShown = adminTab.classList.contains('active');

    destroyChat();
    document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));

    if (isShown) {
        // Go back to start
        document.querySelector('.tab-btn[data-target="start-tab"]').classList.add('active');
        document.getElementById('start-tab').classList.add('active');
    } else {
        adminTab.classList.add('active');
    }
});

// Settings button → toggle settings tab
document.getElementById('settings-btn').addEventListener('click', () => {
    const settingsTab = document.getElementById('settings-tab');
    const isShown = settingsTab.classList.contains('active');

    destroyChat();
    document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));

    if (isShown) {
        document.querySelector('.tab-btn[data-target="start-tab"]').classList.add('active');
        document.getElementById('start-tab').classList.add('active');
    } else {
        settingsTab.classList.add('active');
        initSettingsTab();
    }
});

// Auth & Start
onAuthStateChanged(auth, async (user) => {
    const email = user ? user.email.toLowerCase() : '';
    if (!user || !email.endsWith('@nyamunken.se') || email.startsWith('qq')) {
        hideLoader();
        window.location.href = 'index.html';
        return;
    }
    document.getElementById('user-name').textContent = user.displayName || user.email;

    // Apply cached config immediately to prevent tab flicker
    // (tournament-config.js pre-loads from localStorage synchronously)
    applyTabVisibility();
    const cachedName = getTournamentName();
    if (cachedName !== 'MunkenTipset') {
        document.querySelector('.logo-text').textContent = cachedName;
        document.title = cachedName;
    }

    // Check lock status + get settings first (1 read — reused everywhere)
    const { locked, settings } = await checkTipsLocked();
    globalTipsLocked = locked;
    const dataVersion = settings.dataVersion || 0;

    // Load tournament config (validates cache against dataVersion, fetches if stale)
    await loadTournamentConfig(dataVersion);

    // Re-apply branding and tab visibility with confirmed config
    const tName = getTournamentName();
    document.querySelector('.logo-text').textContent = tName;
    document.title = tName;
    applyTabVisibility();

    // Hide loading screen now that branding & tabs are in their final state
    hideLoader();

    // Ensure user doc exists with email + display name (single write)
    await setDoc(doc(db, "users", user.uid), { email: user.email, name: user.displayName || user.email }, { merge: true });

    // Admin check
    isAdmin = ADMINS.includes(email);
    setChatAdmin(isAdmin);
    if (isAdmin) {
        document.getElementById('admin-btn').style.display = 'inline-block';
        document.getElementById('chat-admin-btn').addEventListener('click', () => toggleChatAdminPanel());
    }

    // Check if user has completed group tips (read from user doc)
    const userSnap = await getDoc(doc(db, "users", user.uid));
    const userData = userSnap.data() || {};

    // When tips are locked by admin, lock wizard, bracket and special tabs
    if (locked) {
        lockTab('wizard-tab', 'Tipsraderna är låsta av admin.');
        lockTab('bracket-tab', 'Tipsraderna är låsta av admin.');
        lockTab('special-tab', 'Tipsraderna är låsta av admin.');
    } else if (!hasStageType('round-robin-groups')) {
        // No group stage — bracket is always available
        unlockBracket();
    } else if (userData.groupPicks?.completedAt) {
        unlockBracket();
    } else {
        lockBracket();
    }

    // Load matches — cached in localStorage, only re-fetched when dataVersion changes
    let matchesCached;
    try {
        const raw = localStorage.getItem(MATCHES_CACHE_KEY);
        matchesCached = raw ? JSON.parse(raw) : null;
    } catch { matchesCached = null; }

    if (matchesCached && matchesCached.dataVersion === dataVersion && Array.isArray(matchesCached.matches)) {
        allMatchesData = matchesCached.matches;
    } else {
        const snap = await getDocs(collection(db, "matches"));
        if (!snap.empty) {
            allMatchesData = snap.docs.filter(d => !d.id.startsWith('_')).map(d => d.data());
        }
        try {
            localStorage.setItem(MATCHES_CACHE_KEY, JSON.stringify({ dataVersion, matches: allMatchesData }));
        } catch { /* quota exceeded */ }
    }

    if (allMatchesData.length > 0) {
        initWizard(allMatchesData, onGroupsComplete, locked);
    }

    if (isAdmin) initAdmin(allMatchesData);

    loadCommunityStats(settings);

    // Show welcome popup for first-time visitors, or email pref if not set
    const emailPref = await loadEmailPref();
    if (!localStorage.getItem(WELCOME_DISMISSED_KEY)) {
        showWelcomePopup(emailPref);
    } else if (!emailPref) {
        // Welcome already dismissed but email pref never set — show just the email popup
        showEmailPrefOnly();
    }
});

function showEmailPrefOnly() {
    const overlay = document.getElementById('welcome-overlay');
    const welcomeCard = document.getElementById('welcome-popup-card');
    welcomeCard.style.display = 'none';
    overlay.style.display = 'flex';
    showEmailPrefPopup();
}

function showWelcomePopup(emailPref) {
    const overlay = document.getElementById('welcome-overlay');
    overlay.style.display = 'flex';

    function closeWelcome(dismiss) {
        if (dismiss) localStorage.setItem(WELCOME_DISMISSED_KEY, '1');

        // If email pref already set, just close
        if (emailPref) {
            overlay.style.display = 'none';
            return;
        }

        // Slide welcome out, slide email pref in
        const welcomeCard = document.getElementById('welcome-popup-card');
        welcomeCard.classList.add('popup-slide-out');
        setTimeout(() => {
            welcomeCard.style.display = 'none';
            showEmailPrefPopup();
        }, 350);
        // Also dismiss welcome so it won't show again
        localStorage.setItem(WELCOME_DISMISSED_KEY, '1');
    }

    document.getElementById('welcome-close').addEventListener('click', () => closeWelcome(false));
    document.getElementById('welcome-dismiss').addEventListener('click', () => closeWelcome(true));
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeWelcome(false);
    });
}

function onGroupsComplete() {
    unlockBracket();
    document.querySelector('.tab-btn[data-target="bracket-tab"]').click();
}

function lockTab(tabTarget, msg) {
    const btn = document.querySelector(`.tab-btn[data-target="${tabTarget}"]`);
    if (btn) { btn.classList.add('locked'); btn.setAttribute('data-lock-msg', msg); }
}

function unlockTab(tabTarget) {
    const btn = document.querySelector(`.tab-btn[data-target="${tabTarget}"]`);
    if (btn) { btn.classList.remove('locked'); btn.removeAttribute('data-lock-msg'); }
}

function lockBracket() {
    lockTab('bracket-tab', 'Tippa gruppspelet först!');
}

function unlockBracket() {
    unlockTab('bracket-tab');
}
