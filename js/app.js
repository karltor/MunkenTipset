import { auth, db } from './config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { collection, getDocs, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { initWizard, getGroupPicks } from './wizard.js';
import { initBracket } from './bracket.js';
import { loadCommunityStats } from './stats.js';
import { initAdmin, checkTipsLocked } from './admin.js';
import { loadResults } from './results.js';

const ADMINS = ['karl.tornered@nyamunken.se', 'jonas.waltelius@nyamunken.se'];
const MATCHES_CACHE_KEY = 'munkentipset_matches_cache_v1';
const WELCOME_DISMISSED_KEY = 'munkentipset_welcome_dismissed';
let allMatchesData = [];
let isAdmin = false;
let globalTipsLocked = false;

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

        if (target === 'bracket-tab') initBracket(getGroupPicks(), globalTipsLocked);
        if (target === 'results-tab') loadResults(allMatchesData);
        if (target === 'start-tab') loadCommunityStats();
    });
});

// Admin button → toggle admin tab
document.getElementById('admin-btn').addEventListener('click', () => {
    const adminTab = document.getElementById('admin-tab');
    const isShown = adminTab.classList.contains('active');

    document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));

    if (isShown) {
        // Go back to start
        document.querySelector('.tab-btn[data-target="start-tab"]').classList.add('active');
        document.getElementById('start-tab').classList.add('active');
    } else {
        adminTab.classList.add('active');
        if (allMatchesData.length > 0) initAdmin(allMatchesData);
    }
});

// Auth & Start
onAuthStateChanged(auth, async (user) => {
    const email = user ? user.email.toLowerCase() : '';
    if (!user || !email.endsWith('@nyamunken.se') || email.startsWith('qq')) {
        window.location.href = 'index.html';
        return;
    }
    document.getElementById('user-name').textContent = user.displayName || user.email;

    // Ensure user doc exists with email + display name (single write)
    await setDoc(doc(db, "users", user.uid), { email: user.email, name: user.displayName || user.email }, { merge: true });

    // Admin check
    isAdmin = ADMINS.includes(email);
    if (isAdmin) {
        document.getElementById('admin-btn').style.display = 'inline-block';
    }

    // Check lock status + get settings (1 read — reused by loadCommunityStats)
    const { locked, settings } = await checkTipsLocked();
    globalTipsLocked = locked;
    const dataVersion = settings.dataVersion || 0;

    // Check if user has completed group tips (read from user doc)
    const userSnap = await getDoc(doc(db, "users", user.uid));
    const userData = userSnap.data() || {};

    // When tips are locked by admin, lock both wizard and bracket tabs
    if (locked) {
        lockTab('wizard-tab', 'Tipsraderna är låsta av admin.');
        lockTab('bracket-tab', 'Tipsraderna är låsta av admin.');
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

    loadCommunityStats(settings);

    // Show welcome popup for first-time visitors
    if (!localStorage.getItem(WELCOME_DISMISSED_KEY)) {
        showWelcomePopup();
    }
});

function showWelcomePopup() {
    const overlay = document.getElementById('welcome-overlay');
    overlay.style.display = 'flex';

    document.getElementById('welcome-close').addEventListener('click', () => {
        overlay.style.display = 'none';
    });
    document.getElementById('welcome-dismiss').addEventListener('click', () => {
        localStorage.setItem(WELCOME_DISMISSED_KEY, '1');
        overlay.style.display = 'none';
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.style.display = 'none';
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
