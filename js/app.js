import { auth, db } from './config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { initWizard } from './wizard.js';
import { initBracket } from './bracket.js';

let allMatchesData = [];

// Logga ut
document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

// Tab-logik
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById(e.target.dataset.target).classList.add('active');
        
        // Ladda bracketen när fliken klickas
        if(e.target.dataset.target === 'bracket-tab') initBracket();
    });
});

// Auth & Start
onAuthStateChanged(auth, async (user) => {
    const email = user ? user.email.toLowerCase() : '';
    if (!user || !email.endsWith('@nyamunken.se') || email.startsWith('qq')) { window.location.href = 'index.html'; return; }
    document.getElementById('user-name').textContent = user.displayName || user.email;

    // Visa admin-knapp för admins
    const admins = ['karl.tornered@nyamunken.se', 'jonas.waltelius@nyamunken.se'];
    if (admins.includes(email)) {
        const adminBtn = document.getElementById('admin-btn');
        if (adminBtn) adminBtn.style.display = 'inline-block';
    }
    
    // Hämta officiella matcher EN gång
    const matchesRef = collection(db, "matches");
    const snap = await getDocs(matchesRef);
    if (!snap.empty) {
        allMatchesData = snap.docs.map(doc => doc.data());
        initWizard(allMatchesData); // Skicka datan till wizarden!
    }
});
