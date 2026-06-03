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
let threadsExpanded = false; // show full thread list vs. top few
const THREAD_PREVIEW = 5;    // threads shown before "Visa fler"
const TRIM_THRESHOLD = 4000; // trim posts array when it grows beyond this
const FEED_LIMIT = 30;       // posts shown in the all-threads feed
const SEEN_KEY = 'forumSeen';

let seenCache = {};          // { threadId: ts } — mirror of users/{uid}.forumSeen
let seenLoaded = false;      // false until we've hydrated from Firestore
let seenUid = null;          // uid that seenCache belongs to

const THREAD_ICONS = ['⚽', '👕', '🥅', '🚩', '👟', '🏆', '🧤', '📣', '🔥', '😂'];
const REACTION_EMOJIS = ['😅', '😂', '😡', '✌️', '👍', '🏆', '❤️'];

let reactPopupEl = null;     // floating emoji picker element
let reactScrollHandler = null;

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

    await loadSeen();

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
    seenCache = {};
    seenLoaded = false;
    seenUid = null;
    closeReactPicker();
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

    // Close the emoji picker on outside click / Escape
    document.addEventListener('click', (e) => {
        if (reactPopupEl && !e.target.closest('.forum-react-popup')) closeReactPicker();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeReactPicker(); });

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

/* ── seen tracking (Firestore, per account) ─────────── */

async function loadSeen() {
    const uid = auth.currentUser?.uid;
    if (!uid) { seenCache = {}; seenLoaded = false; seenUid = null; return; }

    // Read local fallback (legacy + offline cache).
    let local = {};
    try { local = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch { /* ignore */ }

    let remote = {};
    try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (snap.exists()) remote = snap.data().forumSeen || {};
    } catch { /* keep empty */ }

    // Merge: take max ts per thread.
    const merged = { ...remote };
    let needsWrite = false;
    for (const [tid, ts] of Object.entries(local)) {
        if (!merged[tid] || ts > merged[tid]) { merged[tid] = ts; needsWrite = true; }
    }

    seenCache = merged;
    seenUid = uid;
    seenLoaded = true;

    if (needsWrite) {
        try { await updateDoc(doc(db, 'users', uid), { forumSeen: merged }); }
        catch { /* non-fatal */ }
    }
    // Migration done — drop legacy localStorage so we have a single source of truth.
    try { localStorage.removeItem(SEEN_KEY); } catch { /* ignore */ }
}

function getSeen() {
    return seenCache;
}
function markSeen(threadId, ts) {
    const uid = auth.currentUser?.uid;
    if (!uid || !seenLoaded || uid !== seenUid) return;
    if (seenCache[threadId] && ts <= seenCache[threadId]) return;
    seenCache[threadId] = ts;
    updateDoc(doc(db, 'users', uid), { [`forumSeen.${threadId}`]: ts })
        .catch(() => { /* non-fatal — next markSeen or reload will retry */ });
}
function hasUnseen(threadId, lastTs) {
    if (!seenLoaded) return false; // avoid flashing badge before hydration
    const uid = auth.currentUser?.uid;
    const tp = threadPosts(threadId);
    const lastPost = tp[tp.length - 1];
    if (!lastPost || lastPost.uid === uid) return false; // own latest post = nothing new
    const seen = seenCache[threadId] || 0;
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

    const shown = threadsExpanded ? ordered : ordered.slice(0, THREAD_PREVIEW);

    list.innerHTML = shown.map(t => {
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

    const countEl = document.getElementById('forum-thread-count');
    if (ordered.length > THREAD_PREVIEW) {
        countEl.innerHTML = threadsExpanded
            ? `<button class="forum-show-more" id="forum-toggle-threads">Visa färre ▲</button>`
            : `<button class="forum-show-more" id="forum-toggle-threads">Visa fler (${ordered.length - THREAD_PREVIEW}) ▼</button>`;
        document.getElementById('forum-toggle-threads').addEventListener('click', () => {
            threadsExpanded = !threadsExpanded;
            renderThreads();
        });
    } else {
        countEl.textContent = `Visar ${ordered.length} av ${ordered.length} trådar`;
    }

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
            ? groupConsecutive(tp).map(g => groupCardHtml(g, null)).join('')
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
    // Each feed item is a standalone post (own group of one) with a thread chip
    list.innerHTML = feed.map(p => groupCardHtml([p], threadById.get(p.threadId))).join('');
    wirePostCards(list);
}

/* Collapse consecutive posts by the same author into groups. */
function groupConsecutive(postList) {
    const groups = [];
    postList.forEach(p => {
        const last = groups[groups.length - 1];
        if (last && last[0].uid === p.uid) last.push(p);
        else groups.push([p]);
    });
    return groups;
}

/* Render one card for a group of consecutive posts by the same author.
   Name + time share the top row; the message sits underneath. Extra posts
   in the group are stacked with their own timestamps. */
function groupCardHtml(group, thread) {
    const uid = auth.currentUser?.uid;
    const shadow = new Set(meta?.shadowbanned || []);
    const first = group[0];
    const isOwn = first.uid === uid;
    const isShadow = shadow.has(first.uid) && first.uid === uid;
    const name = escapeHtml(resolveName(first));

    const chip = thread
        ? `<div class="forum-card-chip forum-chip-clickable" data-open-thread="${first.threadId}" title="Öppna tråden"><span class="forum-thread-icon">${thread.icon || '⚽'}</span><span>${escapeHtml(thread.title)}</span></div>`
        : '';

    const nameHtml = adminMode
        ? `<span class="forum-card-name" style="cursor:pointer;text-decoration:underline dotted;" data-uid="${first.uid}" data-action="user-menu">${name}</span>`
        : `<span class="forum-card-name">${name}</span>`;

    const msgsHtml = group.map((p, i) => {
        const time = new Date(p.ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
        const day = relTime(p.ts);
        const adminX = adminMode
            ? `<button class="chat-msg-admin-x" data-del-post="${p.id}" title="Ta bort">&times;</button>` : '';
        const head = i === 0
            ? `<div class="forum-msg-head">${nameHtml}<span class="forum-msg-time">${day} ${time}</span>${adminX}</div>`
            : `<div class="forum-msg-head forum-msg-head-cont"><span class="forum-msg-time">${time}</span>${adminX}</div>`;
        return `<div class="forum-msg forum-msg-react" data-post-id="${p.id}" title="Klicka för att reagera">
            ${head}
            <div class="forum-card-text">${escapeHtml(p.text)}</div>
            ${reactionsHtml(p)}
        </div>`;
    }).join('');

    const classes = `forum-card${isOwn ? ' own' : ''}${isShadow ? ' shadow' : ''}`;

    return `<div class="${classes}">
        ${chip}
        <div class="forum-card-net">${msgsHtml}</div>
    </div>`;
}

function wirePostCards(list) {
    // Thread chip (feed view) → open the thread
    list.querySelectorAll('[data-open-thread]').forEach(chip => {
        chip.addEventListener('click', (e) => {
            e.stopPropagation();
            openThread(chip.dataset.openThread);
        });
    });
    // Message → open the emoji reaction picker
    list.querySelectorAll('.forum-msg-react').forEach(msg => {
        msg.addEventListener('click', (e) => {
            if (e.target.closest('[data-del-post]') || e.target.closest('[data-action]')) return;
            e.stopPropagation();
            const anchor = e.target.closest('.forum-react-pill') || msg;
            openReactPicker(msg.dataset.postId, anchor);
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

/* ── reactions ─────────────────────────────────────── */

/* Pill summarising the reactions on a post: distinct emojis + total count. */
function reactionsHtml(post) {
    const r = post.reactions || {};
    const entries = Object.entries(r);
    if (!entries.length) return '';
    const uid = auth.currentUser?.uid;
    const counts = {};
    for (const [, emoji] of entries) counts[emoji] = (counts[emoji] || 0) + 1;
    const emojis = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).join('');
    const mine = r[uid] ? ' mine' : '';
    return `<div class="forum-react-row">
        <div class="forum-react-pill${mine}">
            <span class="forum-react-emojis">${emojis}</span>
            <span class="forum-react-count">${entries.length}</span>
        </div>
    </div>`;
}

function openReactPicker(postId, anchorEl) {
    closeReactPicker();
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    if (meta?.muted?.includes(uid)) { showToast('Du kan inte reagera just nu.'); return; }
    const post = posts.find(p => p.id === postId);
    if (!post) return;
    const mine = post.reactions?.[uid];

    const pop = document.createElement('div');
    pop.className = 'forum-react-popup';
    pop.innerHTML = `<div class="forum-react-popup-label">Reagera med en emoji</div>
        <div class="forum-react-popup-row">${REACTION_EMOJIS.map(e =>
            `<button type="button" class="forum-react-opt${mine === e ? ' active' : ''}" data-emoji="${e}">${e}</button>`).join('')}</div>`;
    document.body.appendChild(pop);
    reactPopupEl = pop;

    // Position just below the anchor, clamped to the viewport
    const rect = anchorEl.getBoundingClientRect();
    const left = Math.max(8 + window.scrollX,
        Math.min(rect.left + window.scrollX,
            window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 10));
    pop.style.left = `${left}px`;
    pop.style.top = `${rect.bottom + window.scrollY + 6}px`;

    pop.querySelectorAll('.forum-react-opt').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleReaction(postId, btn.dataset.emoji);
            closeReactPicker();
        });
    });

    // Close if the post list scrolls away under the popup
    const scroller = document.getElementById('forum-post-list');
    if (scroller) {
        reactScrollHandler = () => closeReactPicker();
        scroller.addEventListener('scroll', reactScrollHandler, { passive: true });
    }
}

function closeReactPicker() {
    if (reactScrollHandler) {
        document.getElementById('forum-post-list')?.removeEventListener('scroll', reactScrollHandler);
        reactScrollHandler = null;
    }
    if (reactPopupEl) { reactPopupEl.remove(); reactPopupEl = null; }
}

/* Toggle the current user's reaction on a post. One reaction per user:
   picking the same emoji clears it, a different emoji replaces it. */
async function toggleReaction(postId, emoji) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    if (meta?.muted?.includes(uid)) return;
    if (!navigator.onLine) { showToast('Ingen internetanslutning — reaktionen sparades inte.'); return; }

    const ref = doc(db, "chat", "posts");
    try {
        const snap = await getDoc(ref);
        const arr = snap.exists() ? (snap.data().posts || []) : [];
        const idx = arr.findIndex(p => p.id === postId);
        if (idx === -1) return;
        const reactions = { ...(arr[idx].reactions || {}) };
        if (reactions[uid] === emoji) delete reactions[uid]; // toggle off
        else reactions[uid] = emoji;                         // set / replace
        arr[idx] = { ...arr[idx], reactions };
        await setDoc(ref, { posts: arr });
    } catch (err) {
        console.error('Reaction error:', err);
        showToast('Reaktionen kunde inte sparas. Försök igen.');
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
