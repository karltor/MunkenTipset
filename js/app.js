import { auth, db } from './config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { collection, getDocs, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { initWizard, getGroupPicks } from './wizard.js';
import { initBracket } from './bracket.js';
import { loadCommunityStats } from './stats.js';

let allMatchesData = [];
let groupsCompleted = false;

// Logga ut
document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

// Tab-logik
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const target = e.target.dataset.target;

        // Block locked bracket tab
        if (target === 'bracket-tab' && e.target.classList.contains('locked')) {
            return;
        }

        document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById(target).classList.add('active');

        if (target === 'bracket-tab') {
            const picks = getGroupPicks();
            initBracket(picks);
        }
        if (target === 'start-tab') loadCommunityStats();
    });
});

// Auth & Start
onAuthStateChanged(auth, async (user) => {
    const email = user ? user.email.toLowerCase() : '';
    if (!user || !email.endsWith('@nyamunken.se') || email.startsWith('qq')) { window.location.href = 'index.html'; return; }
    document.getElementById('user-name').textContent = user.displayName || user.email;

    // Save profile name for stats
    const profileRef = doc(db, "users", user.uid, "tips", "_profile");
    await setDoc(profileRef, { name: user.displayName || user.email }, { merge: true });

    // Visa admin-knapp för admins
    const admins = ['karl.tornered@nyamunken.se', 'jonas.waltelius@nyamunken.se'];
    if (admins.includes(email)) {
        const adminBtn = document.getElementById('admin-btn');
        if (adminBtn) adminBtn.style.display = 'inline-block';
    }

    // Check if user has completed group tips
    const picksRef = doc(db, "users", user.uid, "tips", "_groupPicks");
    const picksSnap = await getDoc(picksRef);
    if (picksSnap.exists() && picksSnap.data().completedAt) {
        groupsCompleted = true;
        unlockBracket();
    } else {
        lockBracket();
    }

    // Hämta officiella matcher
    const matchesRef = collection(db, "matches");
    const snap = await getDocs(matchesRef);
    if (!snap.empty) {
        allMatchesData = snap.docs.map(doc => doc.data());
        initWizard(allMatchesData, onGroupsComplete);
    }

    // Load community stats on start tab
    loadCommunityStats();
});

function onGroupsComplete() {
    groupsCompleted = true;
    unlockBracket();
    // Navigate to bracket tab
    const bracketBtn = document.querySelector('.tab-btn[data-target="bracket-tab"]');
    if (bracketBtn) bracketBtn.click();
}

function lockBracket() {
    const btn = document.getElementById('bracket-tab-btn');
    if (btn) {
        btn.classList.add('locked');
        btn.setAttribute('data-lock-msg', 'Tippa gruppspelet först!');
    }
}

function unlockBracket() {
    const btn = document.getElementById('bracket-tab-btn');
    if (btn) {
        btn.classList.remove('locked');
        btn.removeAttribute('data-lock-msg');
    }
}
