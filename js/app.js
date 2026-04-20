import { auth, db } from './config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { collection, getDocs, doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { loadTournamentConfig, getTournamentName, getLogo, hasStageType, getSpecialQuestionsConfig } from './tournament-config.js';
import { initWizard, getGroupPicks, setWizardLocked } from './wizard.js';
import { initBracket, setBracketLocked } from './bracket.js';
import { loadCommunityStats } from './stats.js';
import { showAllTips } from './compare.js';
import { renderScoringInfoTab, invalidateScoringInfoCache } from './scoring-info.js';
import { initAdmin, checkTipsLocked } from './admin.js';
import { initSpecialTips, setSpecialLocked } from './special-tips.js';
import { loadResults } from './results.js';
import { applyStoredTheme } from './admin-theme.js';
import { getColorMode, applyColorMode } from './color-mode.js';
import { loadEmailPref, showEmailPrefPopup, initSettingsTab, WELCOME_DISMISSED_KEY } from './user-settings.js';
import { initChat, destroyChat, setChatAdmin } from './chat.js';
import { toggleChatAdminPanel } from './chat-admin.js';

// Apply saved theme and color mode immediately before anything renders
applyStoredTheme();
applyColorMode(getColorMode());

// Loading screen: hide after minimum duration (to cover font/layout flashes)
const _loaderStart = Date.now();
const MIN_LOADER_MS = 500;
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
let allMatchesData = [];
let isAdmin = false;
let globalTipsLocked = false;
let currentDataVersion = 0;
let liveUnsub = null;
let pendingDataRefresh = null;
const LIVE_REFRESH_DEBOUNCE_MS = 1500;

function applyBranding() {
    const name = getTournamentName();
    const logo = getLogo();
    const el = document.querySelector('.logo-text');
    if (el) {
        if (logo.type === 'image' && logo.image) {
            el.innerHTML = `<img src="${logo.image}" alt="${name}" class="logo-img">`;
        } else {
            el.textContent = name;
        }
    }
    document.title = name;
    if (logo.navbarBg) {
        // User's own theme override (from Utseende) takes precedence so they can
        // change the navbar color back without admin re-saving the tournament.
        let userOverride = null;
        try {
            const raw = localStorage.getItem('munkentipset_theme');
            userOverride = raw ? JSON.parse(raw)['--color-navbar-bg'] : null;
        } catch {}
        if (!userOverride) {
            document.documentElement.style.setProperty('--color-navbar-bg', logo.navbarBg);
        }
    }
}

function applyTabVisibility() {
    const hasGroups = hasStageType('round-robin-groups');
    const hasKnockout = hasStageType('single-elimination');
    const hasLeague = hasStageType('league');
    const hasSpecial = hasStageType('special-questions');
    const wizardBtn = document.querySelector('.tab-btn[data-target="wizard-tab"]');
    const bracketBtn = document.querySelector('.tab-btn[data-target="bracket-tab"]');
    const specialBtn = document.querySelector('.tab-btn[data-target="special-tab"]');
    const allTipsBtn = document.getElementById('all-tipsters-tab-btn');
    const scoringInfoBtn = document.getElementById('scoring-info-tab-btn');

    // When admin has locked tipping, the tip-tabs are replaced by a single
    // "Alla tipsare" shortcut — users can't edit tips anyway, so we declutter
    // the tab row and surface the compare-view instead.
    if (globalTipsLocked) {
        if (wizardBtn) wizardBtn.style.display = 'none';
        if (bracketBtn) bracketBtn.style.display = 'none';
        if (specialBtn) specialBtn.style.display = 'none';
        if (allTipsBtn) allTipsBtn.style.display = '';
        if (scoringInfoBtn) scoringInfoBtn.style.display = '';
        return;
    }

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
    if (allTipsBtn) allTipsBtn.style.display = 'none';
    if (scoringInfoBtn) scoringInfoBtn.style.display = 'none';
}

// Logga ut
document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

// Tab-logik
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
        const btnEl = e.currentTarget;
        const target = btnEl.dataset.target;
        const action = btnEl.dataset.action;
        if (btnEl.classList.contains('locked')) return;
        if (!target) return;

        document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
        btnEl.classList.add('active');
        document.getElementById(target).classList.add('active');

        // Destroy chat listener when leaving chat tab (saves reads)
        destroyChat();

        if (target === 'bracket-tab') initBracket(getGroupPicks(), globalTipsLocked);
        if (target === 'special-tab') initSpecialTips(globalTipsLocked);
        if (target === 'results-tab') loadResults(allMatchesData);
        if (target === 'scoring-info-tab') renderScoringInfoTab();
        if (target === 'start-tab') {
            // "Alla tipsare" button: load stats first (populates compare cache),
            // then jump straight into the compare view.
            await loadCommunityStats();
            if (action === 'show-all-tips') showAllTips();
        }
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
    applyBranding();

    // Check lock status + get settings first (1 read — reused everywhere)
    const { locked, settings } = await checkTipsLocked();
    globalTipsLocked = locked;
    let dataVersion = settings.dataVersion || 0;

    // Set up live listener on _settings doc (1 Firestore listener per user —
    // cheap: ~1 read per settings update × connected users). Enables:
    //  1. Instant lock/unlock when admin toggles tipsLocked
    //  2. Live data refresh when admin bumps dataVersion (match results, etc.)
    setupLiveSync(user, dataVersion);

    // Load tournament config + user doc in parallel (need both before hiding loader
    // so we can apply final lock state to tabs — otherwise they flash unlocked)
    const [, userSnap] = await Promise.all([
        loadTournamentConfig(dataVersion),
        getDoc(doc(db, "users", user.uid))
    ]);
    const userData = userSnap.data() || {};

    // Re-apply branding and tab visibility with confirmed config
    applyBranding();
    applyTabVisibility();

    // Admin check
    isAdmin = ADMINS.includes(email);
    setChatAdmin(isAdmin);
    if (isAdmin) {
        document.getElementById('admin-btn').style.display = 'inline-block';
        document.getElementById('chat-admin-btn').addEventListener('click', () => toggleChatAdminPanel());
    }

    // Apply final tab lock state BEFORE hiding the loader, so users never see
    // unlocked tip-tabs flash before the lock kicks in
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

    // Hide loading screen now that branding, tabs AND lock state are in their final state
    hideLoader();

    // Ensure user doc exists with email + display name (single write, fire-and-forget)
    setDoc(doc(db, "users", user.uid), { email: user.email, name: user.displayName || user.email }, { merge: true });

    // Show welcome/email popup IMMEDIATELY after loader hides — don't wait for
    // matches/stats to load. emailPref is derived from the userData we already
    // fetched above, so this is a zero-round-trip operation even on slow links.
    const emailPref = await loadEmailPref(userData);
    if (!localStorage.getItem(WELCOME_DISMISSED_KEY)) {
        showWelcomePopup(emailPref);
    } else if (!emailPref) {
        // Welcome already dismissed but email pref never set — show just the email popup
        showEmailPrefOnly();
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
        // Pass the already-fetched userData so initWizard doesn't re-read the same doc
        initWizard(allMatchesData, onGroupsComplete, locked, userData);
    }

    if (isAdmin) initAdmin(allMatchesData);

    // Only load community stats eagerly if start-tab is the active tab on load
    // (which it is by default). If the user restored a different tab, defer:
    // the stats will load when they click the Start tab.
    const activeTabOnLoad = document.querySelector('.tab-content.active')?.id;
    if (activeTabOnLoad === 'start-tab') {
        loadCommunityStats(settings);
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
        if (dismiss) {
            localStorage.setItem(WELCOME_DISMISSED_KEY, '1');
            // Keep the settings toggle in sync
            const toggle = document.getElementById('settings-welcome-toggle');
            if (toggle) toggle.checked = false;
        }

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
        const toggle = document.getElementById('settings-welcome-toggle');
        if (toggle) toggle.checked = false;
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

// ─── Global toast (used by live-sync notifications) ────────────
function showGlobalToast(msg, type = 'info') {
    let t = document.getElementById('global-toast');
    if (!t) { t = document.createElement('div'); t.id = 'global-toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.style.background = type === 'warn' ? '#dc3545' : (type === 'success' ? '#28a745' : '#333');
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 4000);
}

// ─── Live sync: listen for admin-driven changes ───────────────
function setupLiveSync(user, initialDataVersion) {
    currentDataVersion = initialDataVersion;
    if (liveUnsub) liveUnsub();

    liveUnsub = onSnapshot(doc(db, "matches", "_settings"), async (snap) => {
        if (!snap.exists()) return;
        const settings = snap.data();
        const newLocked = settings.tipsLocked === true;
        const newDataVersion = settings.dataVersion || 0;

        // ── Lock state change ───────────────────────────────
        if (newLocked !== globalTipsLocked) {
            globalTipsLocked = newLocked;
            if (newLocked) {
                applyLiveLock();
            } else {
                applyLiveUnlock(user);
            }
        }

        // ── Data version bumped by admin (new result, match edit, etc.) ──
        // Debounce: a single admin "Save" can bump dataVersion once, but a
        // burst of saves (or multi-step flows like bracket edits) can fire
        // the listener several times within a second. Without debouncing,
        // every fire re-runs applyLiveDataRefresh → multiple full refetches
        // per connected user. Collapse into one refresh after the burst.
        if (newDataVersion !== currentDataVersion) {
            currentDataVersion = newDataVersion;
            clearTimeout(pendingDataRefresh);
            pendingDataRefresh = setTimeout(() => {
                applyLiveDataRefresh(newDataVersion);
            }, LIVE_REFRESH_DEBOUNCE_MS);
        }
    }, (err) => {
        console.warn('Live sync listener error:', err);
    });
}

function applyLiveLock() {
    // Propagate to child modules so any in-flight save will abort
    setWizardLocked(true);
    setBracketLocked(true);
    setSpecialLocked(true);

    lockTab('wizard-tab', 'Tipsraderna är låsta av admin.');
    lockTab('bracket-tab', 'Tipsraderna är låsta av admin.');
    lockTab('special-tab', 'Tipsraderna är låsta av admin.');

    // Hide the (now-locked) tip-tab buttons and reveal the "Alla tipsare"
    // shortcut instead.
    applyTabVisibility();

    // If user is currently editing tips, kick them to start tab
    const activeTab = document.querySelector('.tab-content.active')?.id;
    if (['wizard-tab', 'bracket-tab', 'special-tab'].includes(activeTab)) {
        document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
        document.querySelector('.tab-btn[data-target="start-tab"]').classList.add('active');
        document.getElementById('start-tab').classList.add('active');
        destroyChat();
        loadCommunityStats();
        showGlobalToast('🔒 Tipsraderna har låsts av admin. Dina osparade ändringar sparades inte.', 'warn');
    } else {
        showGlobalToast('🔒 Tipsraderna har låsts av admin.', 'warn');
    }
}

function applyLiveUnlock(user) {
    setWizardLocked(false);
    setBracketLocked(false);
    setSpecialLocked(false);

    unlockTab('wizard-tab');
    unlockTab('special-tab');

    // If one of the lock-only shortcut buttons was active, transfer the active
    // state to the regular Start button before we hide them.
    const allTipsBtn = document.getElementById('all-tipsters-tab-btn');
    const scoringInfoBtn = document.getElementById('scoring-info-tab-btn');
    [allTipsBtn, scoringInfoBtn].forEach(b => {
        if (b?.classList.contains('active')) {
            b.classList.remove('active');
            document.querySelector('.tab-btn[data-target="start-tab"]')?.classList.add('active');
        }
    });
    // If the scoring-info tab itself was active, swap content back to start
    const scoringInfoTab = document.getElementById('scoring-info-tab');
    if (scoringInfoTab?.classList.contains('active')) {
        scoringInfoTab.classList.remove('active');
        document.getElementById('start-tab')?.classList.add('active');
    }

    // Restore the original tip-tab buttons and hide the shortcut buttons.
    applyTabVisibility();
    // Bracket depends on whether user has done groups — re-evaluate async
    (async () => {
        if (!hasStageType('round-robin-groups')) {
            unlockBracket();
        } else {
            try {
                const s = await getDoc(doc(db, "users", user.uid));
                const d = s.data() || {};
                if (d.groupPicks?.completedAt) unlockBracket();
                else lockBracket();
            } catch { /* noop */ }
        }
    })();

    showGlobalToast('🔓 Admin har låst upp tipsraderna.', 'success');
}

async function applyLiveDataRefresh(newDataVersion) {
    // Scoring rules may have changed — drop the Poänginfo cache so the next
    // modal open re-reads them from Firestore.
    invalidateScoringInfoCache();

    // Note: we intentionally do NOT call invalidateStatsCache() or clear the
    // matches localStorage cache here. Both caches are keyed on dataVersion,
    // so the next read will self-invalidate via the stale-version check.
    // Proactively nuking them just forces an extra fetch even when the user
    // isn't looking at stats/matches.

    // Only re-fetch matches + tournament config if the active tab actually
    // needs them. Otherwise defer: the cache will refresh lazily on tab click
    // (the dataVersion mismatch in app.js load path triggers a fresh fetch).
    const activeTab = document.querySelector('.tab-content.active')?.id;
    const needsMatches = ['start-tab', 'results-tab', 'wizard-tab', 'bracket-tab', 'admin-tab'].includes(activeTab);

    if (needsMatches) {
        try {
            await loadTournamentConfig(newDataVersion);
            const snap = await getDocs(collection(db, "matches"));
            allMatchesData = snap.docs.filter(d => !d.id.startsWith('_')).map(d => d.data());
            localStorage.setItem(MATCHES_CACHE_KEY, JSON.stringify({ dataVersion: newDataVersion, matches: allMatchesData }));
        } catch (e) {
            console.warn('Live refresh fetch failed:', e);
            return;
        }

        // Re-apply tab visibility (tournament structure may have changed)
        applyTabVisibility();
        applyBranding();
    }

    // Refresh the visible data tab — but NEVER disrupt a user mid-tipping
    if (activeTab === 'start-tab') loadCommunityStats();
    else if (activeTab === 'results-tab') loadResults(allMatchesData);
    // wizard/bracket/special: leave alone — user may be mid-edit

    showGlobalToast('📊 Resultat uppdaterade.', 'success');
}
