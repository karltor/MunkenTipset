import { db } from './config.js';
import { collection, getDocs, doc, setDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { invalidateStatsCache } from './stats.js';
import { bumpDataVersion } from './admin.js';

// Render the admin Prispott panel.
//
// Three membership states per user:
//   • paid     — admin has checked them off (potMember === true)
//   • pending  — user clicked "Ja tack" in the tips-complete popup
//                (potIntent === true) but admin hasn't confirmed payment yet
//   • none     — user hasn't opted in
//
// The "Skicka påminnelse" button opens a mailto draft pre-addressed to all
// pending users so admin can nag them to swish. Uses the notificationEmail
// override when set (mirrors admin-email's recipient logic).
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
            notificationEmail: d.notificationEmail || '',
            potMember: !!d.potMember,
            potIntent: !!d.potIntent,
            potIntentAt: d.potIntentAt || null
        });
    });
    users.sort((a, b) => a.name.localeCompare(b.name, 'sv'));

    const recipientEmail = u => (u.notificationEmail && u.notificationEmail.trim()) || u.email || '';

    const renderSummary = () => {
        const paid = users.filter(u => u.potMember).length;
        const pending = users.filter(u => u.potIntent && !u.potMember).length;
        summary.innerHTML = `<strong>${paid}</strong> betalat · <strong>${pending}</strong> har sagt ja men inte swishat än · ${users.length} tipsare totalt`;
    };
    renderSummary();

    if (users.length === 0) {
        container.innerHTML = '<p style="color:#888;">Inga tipsare har lagt en tipsrad ännu.</p>';
        return;
    }

    const pendingUsers = () => users.filter(u => u.potIntent && !u.potMember);

    const renderReminderBar = () => {
        const pending = pendingUsers();
        const bar = document.getElementById('admin-pot-reminder-bar');
        if (!bar) return;
        if (pending.length === 0) {
            bar.innerHTML = '<p style="color:#888; font-size:12px; margin:0;">Inga som väntar på påminnelse just nu.</p>';
            return;
        }
        bar.innerHTML = `
            <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                <button class="btn" id="admin-pot-send-reminder" style="background:#17a2b8; font-size:13px;">Skicka mejlpåminnelse till ${pending.length} st</button>
                <span style="font-size:12px; color:#888;">Öppnar ett mejlutkast i din mejl-klient.</span>
            </div>`;
        document.getElementById('admin-pot-send-reminder').addEventListener('click', () => {
            const addrs = pendingUsers().map(recipientEmail).filter(Boolean).join(',');
            if (!addrs) return alert('Ingen mejladress tillgänglig för de väntande.');
            const subject = 'Påminnelse: Swisha 100 kr till MunkenTipset-potten';
            const body = [
                'Hej!',
                '',
                'Du har sagt att du vill vara med i prispotten (100 kr) men jag har inte fått din Swish ännu.',
                'Swisha 100 kr senast 11 juni kl 20:00 till 070 390 86 17.',
                '',
                'Tack och må bästa munk vinna!',
                '/Karl'
            ].join('\n');
            // Use BCC so recipients don't see each other's addresses.
            const href = `mailto:?bcc=${encodeURIComponent(addrs)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            window.location.href = href;
        });
    };

    const badgeHtml = (u) => {
        if (u.potMember) return '<span style="background:#28a745; color:#fff; font-size:11px; padding:2px 6px; border-radius:4px;">Betalat</span>';
        if (u.potIntent) return '<span style="background:#ffc107; color:#000; font-size:11px; padding:2px 6px; border-radius:4px;" title="Klickade Ja i popupen men inte swishat ännu">Väntar på swish</span>';
        return '';
    };

    const userRow = (u) => `
        <label style="display:flex; align-items:center; gap:10px; font-size:13px; cursor:pointer; background:#fff; padding:6px 10px; border-radius:6px; border:1px solid #ddd;">
            <input type="checkbox" class="admin-pot-cb" data-uid="${u.uid}" ${u.potMember ? 'checked' : ''} title="Bocka i när swishen kommit in">
            <span style="flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${u.email}">${u.name}</span>
            <span class="admin-pot-badge" data-uid-badge="${u.uid}">${badgeHtml(u)}</span>
        </label>`;

    container.innerHTML = `
        <div id="admin-pot-reminder-bar" style="margin-bottom:12px; padding:10px; background:#f8f9fa; border-radius:6px;"></div>
        <div id="admin-pot-user-list" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:6px;">
            ${users.map(userRow).join('')}
        </div>`;

    renderReminderBar();

    container.querySelectorAll('.admin-pot-cb').forEach(cb => {
        cb.addEventListener('change', async () => {
            const uid = cb.dataset.uid;
            const user = users.find(u => u.uid === uid);
            const previous = !!user.potMember;
            const next = cb.checked;
            user.potMember = next;
            cb.disabled = true;
            // Update only the badge in place — avoid re-rendering the whole
            // row, which would detach the live checkbox listener.
            const badgeEl = container.querySelector(`[data-uid-badge="${uid}"]`);
            if (badgeEl) badgeEl.innerHTML = badgeHtml(user);
            renderSummary();
            renderReminderBar();
            try {
                await setDoc(doc(db, "users", uid), { potMember: next }, { merge: true });
                invalidateStatsCache();
                bumpDataVersion().catch(() => {});
            } catch (err) {
                console.error('Kunde inte uppdatera prispott:', err);
                user.potMember = previous;
                cb.checked = previous;
                if (badgeEl) badgeEl.innerHTML = badgeHtml(user);
                renderSummary();
                renderReminderBar();
            } finally {
                cb.disabled = false;
            }
        });
    });
}
