import { auth, db } from './config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { collection, getDocs, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { initWizard, getGroupPicks } from './wizard.js';
import { initBracket } from './bracket.js';
import { loadCommunityStats } from './stats.js';
import { initAdmin, checkTipsLocked } from './admin.js';
import { loadResults } from './results.js';

const ADMINS = ['karl.tornered@nyamunken.se', 'jonas.waltelius@nyamunken.se'];
let allMatchesData = [];
let isAdmin = false;

// Logga ut
document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

// Tab-logik
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const target = e.target.dataset.target;
        if (target === 'bracket-tab' && e.target.classList.contains('locked')) return;

        document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById(target).classList.add('active');

        if (target === 'bracket-tab') initBracket(getGroupPicks());
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

    // Save profile name for stats + ensure parent user doc exists
    await setDoc(doc(db, "users", user.uid), { email: user.email }, { merge: true });
    const profileRef = doc(db, "users", user.uid, "tips", "_profile");
    await setDoc(profileRef, { name: user.displayName || user.email }, { merge: true });

    // Admin check
    isAdmin = ADMINS.includes(email);
    if (isAdmin) {
        document.getElementById('admin-btn').style.display = 'inline-block';
    }

    // Check lock status
    const locked = await checkTipsLocked();

    // Check if user has completed group tips
    const picksRef = doc(db, "users", user.uid, "tips", "_groupPicks");
    const picksSnap = await getDoc(picksRef);
    const welcomeMsg = document.getElementById('welcome-msg');
    if (picksSnap.exists() && picksSnap.data().completedAt) {
        unlockBracket();
        if (welcomeMsg) welcomeMsg.textContent = 'Din tipsrad är inskickad! Kolla leaderboarden nedan.';
    } else {
        lockBracket();
    }

    // Hämta officiella matcher
    const matchesRef = collection(db, "matches");
    const snap = await getDocs(matchesRef);
    if (!snap.empty) {
        allMatchesData = snap.docs.filter(d => !d.id.startsWith('_')).map(d => d.data());
        initWizard(allMatchesData, onGroupsComplete, locked);
    }

    loadCommunityStats();
});

function onGroupsComplete() {
    unlockBracket();
    document.querySelector('.tab-btn[data-target="bracket-tab"]').click();
}

function lockBracket() {
    const btn = document.getElementById('bracket-tab-btn');
    if (btn) { btn.classList.add('locked'); btn.setAttribute('data-lock-msg', 'Tippa gruppspelet först!'); }
}

function unlockBracket() {
    const btn = document.getElementById('bracket-tab-btn');
    if (btn) { btn.classList.remove('locked'); btn.removeAttribute('data-lock-msg'); }
}
