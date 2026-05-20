import { db, auth } from './config.js';
import { doc, getDoc, setDoc, updateDoc, onSnapshot, arrayUnion, arrayRemove }
    from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

/* ── state ─────────────────────────────────────────── */
let unsubThreads = null;     // onSnapshot handle for chat/threads
let unsubPosts = null;       // onSnapshot handle for chat/posts
let unsubMeta = null;        // onSnapshot handle for chat/_meta
let meta = null;             // { shadowbanned:[], muted:[], chatNames:{} }
let isAdmin = false;
let adminMode = false;       // admin moderation mode active
let threads = [];            // [{ id, title, icon, byUid, byName, ts }]
let posts = [];              // [{ id, threadId, uid, name, fullName, text, ts, replyTo* }]
let initialized = false;
let activeThreadId = null;   // null = "all threads" feed; else single-thread view
let formOpen = false;        // new-thread form visible
let selectedIcon = '⚽';     // chosen icon in new-thread form
const TRIM_THRESHOLD = 4000; // trim posts array when it grows beyond this
const FEED_LIMIT = 30;       // posts shown in the all-threads feed
const SEEN_KEY = 'forumSeen';

const THREAD_ICONS = ['⚽', '👕', '🥅', '🚩', '👟', '🏆', '🧤', '📣', '🔥', '😂'];

function showToast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}

/* ── public api ────────────────────────────────────── */

export function setChatAdmin(val) { isAdmin = val; }

export async function initChat() {
    if (unsubPosts) return; // already listening

    if (!document.getElementById('chat-dynamic-styles')) {
        const style = document.createElement('style');
        style.id = 'chat-dynamic-styles';
        style.innerHTML = `
            .forum-post-highlight { animation: forumHighlight 2s ease-out; }
            @keyframes forumHighlight {
                0% { background-color: rgba(255, 193, 7, 0.35); }
                100% { background-color: transparent; }
            }`;
        document.head.appendChild(style);
    }

    const adminBtn = document.getElementById('chat-admin-btn');
    if (adminBtn) adminBtn.style.display = isAdmin ? 'flex' : 'none';

    // Load meta (shadowban/mute lists) — 1 read
    try {
        const metaSnap = await getDoc(doc(db, "chat", "_meta"));
        meta = metaSnap.exists() ? metaSnap.data() : { shadowbanned: [], muted: [], chatNames: {} };
    } catch {
        meta = { shadowbanned: [], muted: [], chatNames: {} };
    }
    updateMuteState();

    // Live listeners
    unsubThreads = onSnapshot(doc(db, "chat", "threads"), (snap) => {
        threads = snap.exists() ? (snap.data().threads || []) : [];
        renderThreads();
        renderPosts();
    });

    unsubPosts = onSnapshot(doc(db, "chat", "posts"), (snap) => {
        posts = snap.exists() ? (snap.data().posts || []) : [];
        renderThreads();
        renderPosts();
    });

    unsubMeta = onSnapshot(doc(db, "chat", "_meta"), (snap) => {
        meta = snap.exists() ? snap.data() : { shadowbanned: [], muted: [], chatNames: {} };
        updateMuteState();
        renderThreads();
        renderPosts();
    });

    wireUi();
}

export function destroyChat() {
    if (unsubThreads) { unsubThreads(); unsubThreads = null; }
    if (unsubPosts) { unsubPosts(); unsubPosts = null; }
    if (unsubMeta) { unsubMeta(); unsubMeta = null; }
    adminMode = false;
}

export function setAdminMode(val) {
    adminMode = val;
    renderThreads();
    renderPosts();
}

export function getMeta() { return meta; }

export async function refreshMeta() {
    try {
        const metaSnap = await getDoc(doc(db, "chat", "_meta"));
        meta = metaSnap.exists() ? metaSnap.data() : { shadowbanned: [], muted: [], chatNames: {} };
    } catch { /* keep old */ }
    updateMuteState();
    renderThreads();
    renderPosts();
}

export async function deleteMessage(post) {
    await updateDoc(doc(db, "chat", "posts"), { posts: arrayRemove(post) });
}

/* ── wiring ────────────────────────────────────────── */

function wireUi() {
    if (initialized) return;

    document.getElementById('forum-new-thread').addEventListener('click', openNewThreadForm);
    document.getElementById('forum-create-cancel').addEventListener('click', closeNewThreadForm);
    document.getElementById('forum-create-submit').addEventListener('click', createThread);

    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');
    sendBtn.addEventListener('click', () => sendReply());
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
    });

    initialized = true;
}

/* ── new-thread form ───────────────────────────────── */

function openNewThreadForm() {
    formOpen = true;
    selectedIcon = THREAD_ICONS[Math.floor(Math.random() * THREAD_ICONS.length)];
    document.getElementById('forum-post-list').style.display = 'none';
    document.getElementById('forum-reply-row').style.display = 'none';
    const form = document.getElementById('forum-new-form');
    form.style.display = 'flex';
    document.getElementById('forum-posts-title').textContent = '➕ NY TRÅD';

    const picker = document.getElementById('forum-icon-picker');
    picker.innerHTML = THREAD_ICONS.map(ic =>
        `<button type="button" class="forum-icon-opt${ic === selectedIcon ? ' selected' : ''}" data-icon="${ic}">${ic}</button>`
    ).join('');
    picker.querySelectorAll('.forum-icon-opt').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedIcon = btn.dataset.icon;
            picker.querySelectorAll('.forum-icon-opt').forEach(b => b.classList.toggle('selected', b === btn));
        });
    });

    document.getElementById('forum-thread-title').value = '';
    document.getElementById('forum-thread-body').value = '';
    document.getElementById('forum-thread-title').focus();
}

function closeNewThreadForm() {
    formOpen = false;
    document.getElementById('forum-new-form').style.display = 'none';
    document.getElementById('forum-post-list').style.display = '';
    renderPosts();
}

async function createThread() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    if (meta?.muted?.includes(uid)) { showToast('Du kan inte skriva i forumet just nu.'); return; }
    if (!navigator.onLine) { showToast('Ingen internetanslutning — tråden skapades inte.'); return; }

    const title = document.getElementById('forum-thread-title').value.trim();
    const body = document.getElementById('forum-thread-body').value.trim();
    if (!title) { showToast('Tråden behöver en rubrik.'); return; }
    if (!body) { showToast('Skriv ett första inlägg.'); return; }

    const displayName = meta?.chatNames?.[uid] || auth.currentUser.displayName || auth.currentUser.email;
    const firstName = displayName.split(' ')[0];
    const now = Date.now();
    const threadId = crypto.randomUUID();

    const thread = { id: threadId, title, icon: selectedIcon, byUid: uid, byName: firstName, ts: now };
    const post = { id: crypto.randomUUID(), threadId, uid, name: firstName, fullName: displayName, text: body, ts: now };

    try {
        await appendToDoc("threads", "threads", thread);
        await appendToDoc("posts", "posts", post);
    } catch (err) {
        console.error('Create thread error:', err);
        showToast('Tråden kunde inte skapas. Försök igen.');
        return;
    }

    markSeen(threadId, now);
    closeNewThreadForm();
    openThread(threadId);
}

/* Append an item to an array-field document, creating it if needed and
   trimming the posts array if it grows too large. */
async function appendToDoc(docId, field, item) {
    const ref = doc(db, "chat", docId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
        await setDoc(ref, { [field]: [item] });
        return;
    }
    const current = snap.data()[field] || [];
    if (field === 'posts' && current.length > TRIM_THRESHOLD) {
        const trimmed = current.slice(-1000);
        trimmed.push(item);
        await setDoc(ref, { [field]: trimmed });
    } else {
        await updateDoc(ref, { [field]: arrayUnion(item) });
    }
}

/* ── reply ─────────────────────────────────────────── */

async function sendReply() {
    if (!activeThreadId) return;
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;

    const uid = auth.currentUser?.uid;
    if (!uid) return;
    if (meta?.muted?.includes(uid)) return;
    if (!navigator.onLine) { showToast('Ingen internetanslutning — inlägget skickades inte.'); return; }

    const displayName = meta?.chatNames?.[uid] || auth.currentUser.displayName || auth.currentUser.email;
    const firstName = displayName.split(' ')[0];
    const now = Date.now();
    const post = { id: crypto.randomUUID(), threadId: activeThreadId, uid, name: firstName, fullName: displayName, text, ts: now };

    const original = text;
    input.value = '';
    input.focus();

    try {
        await appendToDoc("posts", "posts", post);
        markSeen(activeThreadId, now);
    } catch (err) {
        console.error('Reply error:', err);
        if (!input.value) input.value = original;
        showToast('Inlägget kunde inte skickas. Försök igen.');
    }
}

/* ── derived data ──────────────────────────────────── */

function visiblePosts() {
    const uid = auth.currentUser?.uid;
    const shadow = new Set(meta?.shadowbanned || []);
    return posts.filter(p => !(shadow.has(p.uid) && p.uid !== uid));
}

function threadPosts(threadId) {
    return visiblePosts().filter(p => p.threadId === threadId).sort((a, b) => a.ts - b.ts);
}

function threadStats(threadId) {
    const tp = threadPosts(threadId);
    const last = tp.length ? tp[tp.length - 1].ts : 0;
    return { count: tp.length, lastTs: last };
}

/* ── seen tracking (localStorage) ──────────────────── */

function getSeen() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); }
    catch { return {}; }
}
function markSeen(threadId, ts) {
    const seen = getSeen();
    if (!seen[threadId] || ts > seen[threadId]) seen[threadId] = ts;
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* ignore */ }
}
function hasUnseen(threadId, lastTs) {
    const uid = auth.currentUser?.uid;
    const tp = threadPosts(threadId);
    const lastPost = tp[tp.length - 1];
    if (!lastPost || lastPost.uid === uid) return false; // own latest post = nothing new
    const seen = getSeen()[threadId] || 0;
    return lastTs > seen;
}

/* ── render: threads (left) ────────────────────────── */

function renderThreads() {
    const list = document.getElementById('forum-thread-list');
    if (!list) return;

    const ordered = threads
        .map(t => ({ ...t, ...threadStats(t.id) }))
        .sort((a, b) => (b.lastTs || b.ts) - (a.lastTs || a.ts));

    if (ordered.length === 0) {
        list.innerHTML = '<p class="chat-empty">Inga trådar än. Slå ett nytt inlägg!</p>';
        document.getElementById('forum-thread-count').textContent = '';
        return;
    }

    list.innerHTML = ordered.map(t => {
        const unseen = hasUnseen(t.id, t.lastTs);
        const adminX = adminMode
            ? `<button class="forum-thread-del" data-del-thread="${t.id}" title="Ta bort tråd">&times;</button>` : '';
        return `<div class="forum-thread${t.id === activeThreadId ? ' active' : ''}" data-thread="${t.id}">
            <span class="forum-thread-icon">${t.icon || '⚽'}</span>
            <div class="forum-thread-main">
                <div class="forum-thread-title">${escapeHtml(t.title)}</div>
                <div class="forum-thread-meta">Startad av ${escapeHtml(t.byName || 'Anonym')} · ${relTime(t.ts)}</div>
            </div>
            ${unseen ? '<span class="forum-badge-new">NYA INLÄGG</span>' : ''}
            <span class="forum-thread-count-pill">💬 ${t.count}</span>
            ${adminX}
        </div>`;
    }).join('');

    document.getElementById('forum-thread-count').textContent =
        `Visar ${ordered.length} av ${ordered.length} trådar`;

    list.querySelectorAll('.forum-thread').forEach(el => {
        el.addEventListener('click', (e) => {
            if (e.target.closest('[data-del-thread]')) return;
            openThread(el.dataset.thread);
        });
    });
    if (adminMode) {
        list.querySelectorAll('[data-del-thread]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteThread(btn.dataset.delThread);
            });
        });
    }
}

/* ── render: posts (right) ─────────────────────────── */

function renderPosts() {
    if (formOpen) return;
    const list = document.getElementById('forum-post-list');
    const title = document.getElementById('forum-posts-title');
    const replyRow = document.getElementById('forum-reply-row');
    if (!list) return;

    document.querySelector('.forum-body')?.classList.toggle('viewing-thread', !!activeThreadId);

    // Single-thread view
    if (activeThreadId) {
        const thread = threads.find(t => t.id === activeThreadId);
        if (!thread) { activeThreadId = null; return renderPosts(); }

        const tp = threadPosts(activeThreadId);
        title.innerHTML = `<button class="forum-back-btn" id="forum-back">← Alla trådar</button>
            <span class="forum-thread-icon">${thread.icon || '⚽'}</span> ${escapeHtml(thread.title)}`;

        list.innerHTML = tp.length
            ? tp.map(p => postCardHtml(p, null)).join('')
            : '<p class="chat-empty">Inga inlägg i tråden än.</p>';

        replyRow.style.display = meta?.muted?.includes(auth.currentUser?.uid) ? 'none' : 'flex';
        if (tp.length) markSeen(activeThreadId, tp[tp.length - 1].ts);

        document.getElementById('forum-back').addEventListener('click', () => {
            activeThreadId = null;
            renderThreads();
            renderPosts();
        });
        wirePostCards(list);
        list.scrollTop = list.scrollHeight;
        renderThreads(); // refresh unseen badges
        return;
    }

    // All-threads feed: only the single latest post from each thread
    title.textContent = '📣 SENASTE INLÄGGEN FRÅN ALLA TRÅDAR';
    replyRow.style.display = 'none';

    const threadById = new Map(threads.map(t => [t.id, t]));
    const feed = threads
        .map(t => {
            const tp = threadPosts(t.id);
            return tp.length ? tp[tp.length - 1] : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.ts - a.ts)
        .slice(0, FEED_LIMIT);

    if (feed.length === 0) {
        list.innerHTML = '<p class="chat-empty">Inga inlägg än. Var först att slå ett nytt inlägg!</p>';
        return;
    }
    list.innerHTML = feed.map(p => postCardHtml(p, threadById.get(p.threadId))).join('');
    wirePostCards(list);
}

function postCardHtml(p, thread) {
    const uid = auth.currentUser?.uid;
    const shadow = new Set(meta?.shadowbanned || []);
    const isOwn = p.uid === uid;
    const isShadow = shadow.has(p.uid) && p.uid === uid;
    const time = new Date(p.ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    const dayLabel = relTime(p.ts);
    const name = escapeHtml(resolveName(p));

    // Thread chip only shown in the all-threads feed
    const chip = thread
        ? `<div class="forum-card-chip"><span class="forum-thread-icon">${thread.icon || '⚽'}</span><span>${escapeHtml(thread.title)}</span></div>`
        : '';

    const nameHtml = adminMode
        ? `<span class="forum-card-name" style="cursor:pointer;text-decoration:underline dotted;" data-uid="${p.uid}" data-action="user-menu">${name}</span>`
        : `<span class="forum-card-name">${name}</span>`;

    const adminX = adminMode
        ? `<button class="chat-msg-admin-x" data-del-post="${p.id}" title="Ta bort">&times;</button>` : '';

    const clickable = thread ? ' forum-card-clickable' : '';
    const classes = `forum-card${isOwn ? ' own' : ''}${isShadow ? ' shadow' : ''}${clickable}`;

    return `<div class="${classes}" data-post-id="${p.id}"${thread ? ` data-open-thread="${p.threadId}"` : ''}>
        ${chip}
        <div class="forum-card-net">
            <div class="forum-card-top">
                <span class="forum-card-day">${dayLabel} ${time}</span>
                ${adminX}
            </div>
            <div class="forum-card-text">${escapeHtml(p.text)}</div>
            ${nameHtml}
        </div>
    </div>`;
}

function wirePostCards(list) {
    list.querySelectorAll('.forum-card-clickable').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('[data-del-post]') || e.target.closest('[data-action]')) return;
            openThread(card.dataset.openThread);
        });
    });
    if (adminMode) {
        list.querySelectorAll('[data-del-post]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const post = posts.find(p => p.id === btn.dataset.delPost);
                if (post) deleteMessage(post);
            });
        });
    }
}

/* ── thread navigation / admin ─────────────────────── */

function openThread(threadId) {
    activeThreadId = threadId;
    if (formOpen) closeNewThreadForm();
    renderThreads();
    renderPosts();
    document.getElementById('chat-input')?.focus();
}

async function deleteThread(threadId) {
    const thread = threads.find(t => t.id === threadId);
    if (!thread) return;
    const toRemove = posts.filter(p => p.threadId === threadId);
    try {
        await updateDoc(doc(db, "chat", "threads"), { threads: arrayRemove(thread) });
        if (toRemove.length) {
            const ref = doc(db, "chat", "posts");
            const snap = await getDoc(ref);
            const remaining = (snap.data()?.posts || []).filter(p => p.threadId !== threadId);
            await setDoc(ref, { posts: remaining });
        }
        if (activeThreadId === threadId) activeThreadId = null;
    } catch (err) {
        console.error('Delete thread error:', err);
        showToast('Kunde inte ta bort tråden.');
    }
}

/* ── helpers ───────────────────────────────────────── */

function updateMuteState() {
    const uid = auth.currentUser?.uid;
    const muted = meta?.muted?.includes(uid);
    const notice = document.getElementById('chat-muted-notice');
    const replyRow = document.getElementById('forum-reply-row');
    if (notice) notice.style.display = muted ? 'block' : 'none';
    if (muted && replyRow) replyRow.style.display = 'none';
}

function resolveName(p) {
    if (meta?.chatNames?.[p.uid]) return meta.chatNames[p.uid];
    return p.name || 'Anonym';
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
}

function relTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const y = new Date(now); y.setDate(y.getDate() - 1);
    const yesterday = d.toDateString() === y.toDateString();
    if (sameDay) return 'Idag';
    if (yesterday) return 'Igår';
    const days = Math.floor((now - d) / 86400000);
    if (days < 7) return `${days} dagar sedan`;
    return d.toLocaleDateString('sv-SE');
}
