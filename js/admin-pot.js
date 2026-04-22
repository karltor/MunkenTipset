import { db } from './config.js';
import { collection, getDocs, doc, setDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { invalidateStatsCache } from './stats.js';
import { bumpDataVersion } from './admin.js';

// Render the admin Prispott panel: list every user who has placed any tips
// with a checkbox for pot membership. Changes persist immediately to the user
// doc (users/{uid}.potMember). bumpDataVersion() triggers peer clients to
// refresh their stats cache so the 💰 markers appear for other pot members.
export async function initAdminPot() {
    const container = document.getElementById('admin-pot-users');
    const summary = document.getElementById('admin-pot-summary');
    if (!container) return;

    container.innerHTML = '<p style="color:#888;">Laddar tipsare...</p>';

    const usersSnap = await getDocs(collection(db, "users"));
    const users = [];
    usersSnap.docs.forEach(userDoc => {
        const d = userDoc.data();
        const hasTips = d.groupPicks || d.knockout || d.specialPicks
            || (d.matchTips && Object.keys(d.matchTips).length > 0);
        if (!hasTips) return;
        users.push({
            uid: userDoc.id,
            name: d.name || userDoc.id,
            email: d.email || '',
            potMember: !!d.potMember
        });
    });
    users.sort((a, b) => a.name.localeCompare(b.name, 'sv'));

    const renderSummary = () => {
        const count = users.filter(u => u.potMember).length;
        summary.textContent = `${count} av ${users.length} tipsare i potten.`;
    };
    renderSummary();

    if (users.length === 0) {
        container.innerHTML = '<p style="color:#888;">Inga tipsare har lagt en tipsrad ännu.</p>';
        return;
    }

    container.innerHTML = '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:6px;">'
        + users.map(u => `
            <label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer; background:#fff; padding:6px 10px; border-radius:6px; border:1px solid #ddd;">
                <input type="checkbox" class="admin-pot-cb" data-uid="${u.uid}" ${u.potMember ? 'checked' : ''}>
                <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${u.email}">${u.name}</span>
            </label>`).join('')
        + '</div>';

    container.querySelectorAll('.admin-pot-cb').forEach(cb => {
        cb.addEventListener('change', async () => {
            const uid = cb.dataset.uid;
            const user = users.find(u => u.uid === uid);
            const previous = !!user.potMember;
            const next = cb.checked;
            user.potMember = next;
            renderSummary();
            cb.disabled = true;
            try {
                await setDoc(doc(db, "users", uid), { potMember: next }, { merge: true });
                invalidateStatsCache();
                // Bump _settings.dataVersion so other tabs/clients refresh their
                // cached users list and start showing (or hiding) the 💰 marker.
                bumpDataVersion().catch(() => {});
            } catch (err) {
                console.error('Kunde inte uppdatera prispott:', err);
                cb.checked = previous;
                user.potMember = previous;
                renderSummary();
            } finally {
                cb.disabled = false;
            }
        });
    });
}
