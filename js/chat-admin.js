import { db } from './config.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { getMeta, refreshMeta, setAdminMode } from './chat.js';

let panelWired = false;

export function initChatAdmin() {
    const panel = document.getElementById('chat-admin-panel');
    const meta = getMeta() || { shadowbanned: [], muted: [], chatNames: {} };

    // Build user list from cached data
    const users = (window._cachedUsers || []).map(u => ({ uid: u.userId, name: u.name }));

    let html = '';

    // ── Shadowbanned ──
    html += `<h4>Shadowbannade</h4>`;
    if (meta.shadowbanned?.length > 0) {
        html += `<div class="chat-admin-list">`;
        meta.shadowbanned.forEach(uid => {
            const name = lookupName(uid, users, meta);
            html += `<span class="chat-admin-chip">${name} <button data-action="unshadowban" data-uid="${uid}">&times;</button></span>`;
        });
        html += `</div>`;
    } else {
        html += `<p style="font-size:12px; color:#999; margin:0 0 12px;">Inga shadowbannade.</p>`;
    }

    // ── Muted ──
    html += `<h4>Mutade</h4>`;
    if (meta.muted?.length > 0) {
        html += `<div class="chat-admin-list">`;
        meta.muted.forEach(uid => {
            const name = lookupName(uid, users, meta);
            html += `<span class="chat-admin-chip">${name} <button data-action="unmute" data-uid="${uid}">&times;</button></span>`;
        });
        html += `</div>`;
    } else {
        html += `<p style="font-size:12px; color:#999; margin:0 0 12px;">Inga mutade.</p>`;
    }

    // ── Add user to lists ──
    html += `<h4>Lägg till</h4>`;
    html += `<div class="chat-admin-add-row">`;
    html += `<select id="chat-admin-user-select">`;
    html += `<option value="">Välj användare...</option>`;
    users.forEach(u => {
        html += `<option value="${u.uid}">${u.name}</option>`;
    });
    html += `</select>`;
    html += `<button data-action="shadowban" style="background:#6f42c1;">Shadowbanna</button>`;
    html += `<button data-action="mute" style="background:var(--color-btn-danger, #dc3545);">Muta</button>`;
    html += `</div>`;

    // ── Rename ──
    html += `<h4>Byt chattnamn</h4>`;
    html += `<div class="chat-admin-add-row">`;
    html += `<select id="chat-admin-rename-select">`;
    html += `<option value="">Valj användare...</option>`;
    users.forEach(u => {
        const current = meta.chatNames?.[u.uid];
        const label = current ? `${u.name} (visas som: ${current})` : u.name;
        html += `<option value="${u.uid}">${label}</option>`;
    });
    html += `</select>`;
    html += `<input type="text" id="chat-admin-rename-input" placeholder="Nytt chattnamn" style="flex:1; padding:6px 8px; border:1px solid #ddd; border-radius:6px; font-size:12px;">`;
    html += `<button data-action="rename" style="background:var(--color-btn-primary, #28a745);">Spara</button>`;
    html += `</div>`;

    // Current name overrides
    const overrides = Object.entries(meta.chatNames || {});
    if (overrides.length > 0) {
        html += `<div class="chat-admin-list" style="margin-top:6px;">`;
        overrides.forEach(([uid, name]) => {
            const origName = lookupName(uid, users, null);
            html += `<span class="chat-admin-chip">${origName} → ${name} <button data-action="unrename" data-uid="${uid}">&times;</button></span>`;
        });
        html += `</div>`;
    }

    panel.innerHTML = html;

    // Wire event handlers
    panel.querySelectorAll('button[data-action]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            const uid = btn.dataset.uid;

            if (action === 'unshadowban' && uid) {
                await removeFromList('shadowbanned', uid);
            } else if (action === 'unmute' && uid) {
                await removeFromList('muted', uid);
            } else if (action === 'unrename' && uid) {
                await removeChatName(uid);
            } else if (action === 'shadowban') {
                const sel = document.getElementById('chat-admin-user-select');
                if (sel.value) await addToList('shadowbanned', sel.value);
            } else if (action === 'mute') {
                const sel = document.getElementById('chat-admin-user-select');
                if (sel.value) await addToList('muted', sel.value);
            } else if (action === 'rename') {
                const sel = document.getElementById('chat-admin-rename-select');
                const input = document.getElementById('chat-admin-rename-input');
                if (sel.value && input.value.trim()) await setChatName(sel.value, input.value.trim());
            }
        });
    });
}

export function toggleChatAdminPanel() {
    const panel = document.getElementById('chat-admin-panel');
    const isVisible = panel.style.display !== 'none';

    if (isVisible) {
        panel.style.display = 'none';
        setAdminMode(false);
    } else {
        panel.style.display = 'block';
        btn.textContent = '🛡 Stäng moderering';
        setAdminMode(true);
        initChatAdmin();
    }
}

/* ── Firestore operations ─────────────────────────── */

async function addToList(listName, uid) {
    const metaRef = doc(db, "chat", "_meta");
    const snap = await getDoc(metaRef);
    const data = snap.exists() ? snap.data() : {};
    const list = data[listName] || [];
    if (list.includes(uid)) return;
    list.push(uid);
    await setDoc(metaRef, { [listName]: list }, { merge: true });
    await refreshMeta();
    initChatAdmin();
}

async function removeFromList(listName, uid) {
    const metaRef = doc(db, "chat", "_meta");
    const snap = await getDoc(metaRef);
    const data = snap.exists() ? snap.data() : {};
    const list = (data[listName] || []).filter(id => id !== uid);
    await setDoc(metaRef, { [listName]: list }, { merge: true });
    await refreshMeta();
    initChatAdmin();
}

async function setChatName(uid, newName) {
    const metaRef = doc(db, "chat", "_meta");
    const snap = await getDoc(metaRef);
    const data = snap.exists() ? snap.data() : {};
    const names = data.chatNames || {};
    names[uid] = newName;
    await setDoc(metaRef, { chatNames: names }, { merge: true });
    await refreshMeta();
    initChatAdmin();
}

async function removeChatName(uid) {
    const metaRef = doc(db, "chat", "_meta");
    const snap = await getDoc(metaRef);
    const data = snap.exists() ? snap.data() : {};
    const names = data.chatNames || {};
    delete names[uid];
    await setDoc(metaRef, { chatNames: names }, { merge: true });
    await refreshMeta();
    initChatAdmin();
}

function lookupName(uid, users, meta) {
    if (meta?.chatNames?.[uid]) return meta.chatNames[uid];
    const u = users.find(u => u.uid === uid);
    return u ? u.name : uid.substring(0, 8);
}
