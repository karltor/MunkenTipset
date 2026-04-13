import { db, auth } from './config.js';
import { doc, getDoc, setDoc, updateDoc, onSnapshot, arrayUnion, arrayRemove }
    from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { f, flags } from './wizard.js';
import { teamImg } from './team-data.js';
import { parseMatchDate } from './scoring.js';
import { getKnockoutRounds, isTwoLegged } from './tournament-config.js';

/* ── state ─────────────────────────────────────────── */
let unsubMessages = null;   // onSnapshot unsubscribe handle
let meta = null;             // { shadowbanned:[], muted:[], chatNames:{} }
let isAdmin = false;
let adminMode = false;       // admin moderation mode active
let msgs = [];               // current messages array
let initialized = false;
let replyingToMsg = null;    // state for active reply
const TRIM_THRESHOLD = 2000; // trim array when it exceeds this

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
    // Always (re-)measure chat layout — tab may have been reopened after leaving
    fitChatLayoutToViewport();
    if (unsubMessages) return; // already listening

    // Inject dynamic CSS for the highlight animation if it doesn't exist
    if (!document.getElementById('chat-dynamic-styles')) {
        const style = document.createElement('style');
        style.id = 'chat-dynamic-styles';
        style.innerHTML = `
            .chat-msg-highlight { animation: chatHighlight 2s ease-out; }
            @keyframes chatHighlight {
                0% { background-color: rgba(255, 193, 7, 0.4); }
                100% { background-color: transparent; }
            }
        `;
        document.head.appendChild(style);
    }

    const container = document.getElementById('chat-messages');
    container.innerHTML = '<p class="chat-empty">Laddar chatt...</p>';

    // Show admin button if admin
    const adminBtn = document.getElementById('chat-admin-btn');
    if (adminBtn) adminBtn.style.display = isAdmin ? 'inline-block' : 'none';

    // Load meta (shadowban/mute lists) — 1 read
    try {
        const metaSnap = await getDoc(doc(db, "chat", "_meta"));
        meta = metaSnap.exists() ? metaSnap.data() : { shadowbanned: [], muted: [], chatNames: {} };
    } catch {
        meta = { shadowbanned: [], muted: [], chatNames: {} };
    }

    // Check if current user is muted
    updateMuteState();

    // Start onSnapshot on single messages document — 1 read + 1 per change
    unsubMessages = onSnapshot(doc(db, "chat", "messages"), (snap) => {
        if (snap.exists()) {
            msgs = snap.data().msgs || [];
        } else {
            msgs = [];
        }
        renderMessages();
    });

    // Build match sidebar from cached data (no reads)
    buildMatchSidebar();

    // Wire input
    if (!initialized) {
        const input = document.getElementById('chat-input');
        const sendBtn = document.getElementById('chat-send');
        sendBtn.addEventListener('click', () => sendMessage());
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        });
        initialized = true;
    }
}

export function destroyChat() {
    if (unsubMessages) {
        unsubMessages();
        unsubMessages = null;
    }
    adminMode = false;
    replyingToMsg = null;
    renderReplyPreview();
}

export function setAdminMode(val) {
    adminMode = val;
    renderMessages();
}

export function getMeta() { return meta; }

export async function refreshMeta() {
    try {
        const metaSnap = await getDoc(doc(db, "chat", "_meta"));
        meta = metaSnap.exists() ? metaSnap.data() : { shadowbanned: [], muted: [], chatNames: {} };
    } catch { /* keep old */ }
    updateMuteState();
    renderMessages();
}

export async function deleteMessage(msg) {
    await updateDoc(doc(db, "chat", "messages"), { msgs: arrayRemove(msg) });
}

/* ── internals ─────────────────────────────────────── */

function updateMuteState() {
    const uid = auth.currentUser?.uid;
    const muted = meta?.muted?.includes(uid);
    const inputRow = document.querySelector('.chat-input-row');
    const notice = document.getElementById('chat-muted-notice');
    if (inputRow) inputRow.style.display = muted ? 'none' : 'flex';
    if (notice) notice.style.display = muted ? 'block' : 'none';
}

function truncateWords(str, num) {
    const words = str.split(/\s+/);
    if (words.length <= num) return str;
    return words.slice(0, num).join(' ') + '...';
}

function renderReplyPreview() {
    let previewEl = document.getElementById('chat-reply-preview-bar');
    
    // Create the preview bar element if it doesn't exist
    if (!previewEl) {
        const inputRow = document.querySelector('.chat-input-row');
        previewEl = document.createElement('div');
        previewEl.id = 'chat-reply-preview-bar';
        // Add styling for the preview bar directly here so you don't need CSS changes
        previewEl.style.cssText = 'display: none; background: #f1f3f5; padding: 6px 12px; font-size: 12px; border-radius: 6px 6px 0 0; border-bottom: 1px solid #ddd; justify-content: space-between; align-items: center; margin-bottom: -1px;';
        inputRow.parentNode.insertBefore(previewEl, inputRow);
    }

    if (replyingToMsg) {
        const name = resolveName(replyingToMsg);
        const snippet = truncateWords(replyingToMsg.text, 8);
        previewEl.innerHTML = `<span style="color:#555;">Svarar <b>${escapeHtml(name)}</b>: <i>"${escapeHtml(snippet)}"</i></span> <button id="cancel-reply-btn" title="Avbryt svar" style="background:none;border:none;cursor:pointer;font-weight:bold;font-size:16px;color:#888;">&times;</button>`;
        previewEl.style.display = 'flex';
        
        document.getElementById('cancel-reply-btn').onclick = () => {
            replyingToMsg = null;
            renderReplyPreview();
        };
    } else {
        previewEl.style.display = 'none';
    }
}

function initiateReply(msg) {
    replyingToMsg = msg;
    renderReplyPreview();
    document.getElementById('chat-input').focus();
}

function scrollToMessage(id) {
    const container = document.getElementById('chat-messages');
    const el = container.querySelector(`[data-msg-id="${id}"]`);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Add highlight class (animation defined in initChat)
        el.classList.add('chat-msg-highlight');
        // Remove class after animation finishes so it can be re-triggered later
        setTimeout(() => el.classList.remove('chat-msg-highlight'), 2000);
    }
}

async function sendMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;

    const uid = auth.currentUser?.uid;
    if (!uid) return;
    if (meta?.muted?.includes(uid)) return;

    // Firestore queues writes silently when offline (promise doesn't reject,
    // message shows optimistically via onSnapshot) but the queue is lost on
    // page reload. Refuse to send upfront so the user can retry after
    // reconnecting. navigator.onLine is reliable for the DevTools Offline
    // toggle and clear network drops.
    if (!navigator.onLine) {
        showToast('Ingen internetanslutning — meddelandet skickades inte.');
        return;
    }

    // Determine display name
    const displayName = meta?.chatNames?.[uid] || auth.currentUser.displayName || auth.currentUser.email;
    const firstName = displayName.split(' ')[0];

    const msg = {
        id: crypto.randomUUID(),
        uid,
        name: firstName,
        fullName: displayName,
        text,
        ts: Date.now()
    };

    // Append reply metadata if active
    if (replyingToMsg) {
        msg.replyToId = replyingToMsg.id;
        msg.replyToName = resolveName(replyingToMsg);
        msg.replyToText = truncateWords(replyingToMsg.text, 8);
        
        // Reset state after capturing
        replyingToMsg = null;
        renderReplyPreview();
    }

    const originalText = text;
    input.value = '';
    input.focus();

    // Ensure document exists, then append
    try {
        const msgRef = doc(db, "chat", "messages");
        const snap = await getDoc(msgRef);
        if (!snap.exists()) {
            await setDoc(msgRef, { msgs: [msg] });
        } else {
            const currentMsgs = snap.data().msgs || [];
            if (currentMsgs.length > TRIM_THRESHOLD) {
                // Trim old messages to keep document size manageable
                const trimmed = currentMsgs.slice(-500);
                trimmed.push(msg);
                await setDoc(msgRef, { msgs: trimmed });
            } else {
                await updateDoc(msgRef, { msgs: arrayUnion(msg) });
            }
        }
    } catch (err) {
        console.error('Chat send error:', err);
        // Restore the user's message so they can retry
        if (!input.value) input.value = originalText;
        showToast('Meddelandet kunde inte skickas. Försök igen.');
    }
}

function renderMessages() {
    const container = document.getElementById('chat-messages');
    const uid = auth.currentUser?.uid;
    const shadowbanned = new Set(meta?.shadowbanned || []);

    // Filter: hide shadowbanned users' messages (except own)
    const visible = msgs.filter(m => {
        if (shadowbanned.has(m.uid) && m.uid !== uid) return false;
        return true;
    });

    if (visible.length === 0) {
        container.innerHTML = '<p class="chat-empty">Inga meddelanden i chatten. Var först att skriva!</p>';
        return;
    }

    // Detect duplicate first names among message authors
    const nameMap = new Map(); // firstName -> Set<uid>
    visible.forEach(m => {
        const name = resolveName(m);
        if (!nameMap.has(name)) nameMap.set(name, new Set());
        nameMap.get(name).add(m.uid);
    });
    const dupeFirstNames = new Set();
    nameMap.forEach((uids, name) => {
        if (uids.size > 1) dupeFirstNames.add(name);
    });

    // Get active matches for tip badges
    const activeMatches = getActiveMatches();
    const chatUids = new Set(visible.map(m => m.uid));
    const tipsByUser = buildTipBadges(activeMatches, chatUids);

    let html = '';
    let lastDateStr = '';

    visible.forEach(m => {
        const d = new Date(m.ts);
        const dateStr = d.toLocaleDateString('sv-SE');

        // Date separator
        if (dateStr !== lastDateStr) {
            const label = isToday(d) ? 'Idag' : (isYesterday(d) ? 'Igår' : dateStr);
            html += `<div class="chat-date-sep">${label}</div>`;
            lastDateStr = dateStr;
        }

        const time = d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
        let displayName = resolveName(m);
        if (dupeFirstNames.has(displayName)) {
            // Add last initial
            const full = meta?.chatNames?.[m.uid] || m.fullName || m.name;
            const parts = full.split(' ');
            if (parts.length > 1) {
                displayName = `${displayName} ${parts[parts.length - 1][0]}`;
            }
        }

        const isOwn = m.uid === uid;
        const isShadow = shadowbanned.has(m.uid) && m.uid === uid;
        const classes = ['chat-msg'];
        if (isOwn) classes.push('chat-msg-own');
        if (isShadow) classes.push('chat-msg-shadow');

        // Tip badges
        const badges = tipsByUser.get(m.uid) || '';

        // Admin delete button
        const adminX = adminMode ? `<button class="chat-msg-admin-x" data-msg-id="${m.id}" title="Ta bort">&times;</button>` : '';

        // XSS FIX: Escape the display name so malicious names don't execute script tags
        const safeDisplayName = escapeHtml(displayName);

        // Admin: clickable name
        const nameHtml = adminMode
            ? `<span class="chat-msg-name" style="cursor:pointer; text-decoration:underline dotted;" data-uid="${m.uid}" data-action="user-menu">${safeDisplayName}</span>`
            : `<span class="chat-msg-name">${safeDisplayName}</span>`;

        // Reply snippet HTML
        let replyHtml = '';
        if (m.replyToId) {
            const safeReplyName = escapeHtml(m.replyToName || 'Någon');
            const safeReplyText = escapeHtml(m.replyToText || '');
            replyHtml = `
                <div class="chat-reply-link" data-target="${m.replyToId}" style="font-size: 11px; color: #666; background: rgba(0,0,0,0.04); padding: 4px 8px; border-radius: 4px; margin-bottom: 6px; cursor: pointer; border-left: 3px solid rgba(0,0,0,0.2);">
                    <span style="opacity: 0.7;">↩ Svar till <b>${safeReplyName}</b>: <i>"${safeReplyText}"</i></span>
                </div>`;
        }

        html += `<div class="${classes.join(' ')}" data-msg-id="${m.id}" style="cursor: pointer;" title="Klicka för att svara">
            <div class="chat-msg-header">
                <span class="chat-msg-time">${time}</span>
                ${nameHtml}
                ${badges ? `<span class="chat-msg-tips">${badges}</span>` : ''}
                ${adminX}
            </div>
            ${replyHtml}
            <span class="chat-msg-text">${escapeHtml(m.text)}</span>
        </div>`;
    });

    container.innerHTML = html;

    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight;

    // --- Wiring Event Listeners ---

    // 1. Click on message to reply
    container.querySelectorAll('.chat-msg').forEach(msgEl => {
        msgEl.addEventListener('click', (e) => {
            // Do not trigger reply if clicking admin elements or a reply link
            if (e.target.closest('.chat-msg-admin-x') || e.target.closest('.chat-msg-name[data-action]') || e.target.closest('.chat-reply-link')) {
                return;
            }
            const msgId = msgEl.dataset.msgId;
            const msg = msgs.find(m => m.id === msgId);
            if (msg) initiateReply(msg);
        });
    });

    // 2. Click on reply snippet to scroll to original message
    container.querySelectorAll('.chat-reply-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevents triggering a reply
            const targetId = link.dataset.target;
            scrollToMessage(targetId);
        });
    });

    // 3. Admin delete buttons
    if (adminMode) {
        container.querySelectorAll('.chat-msg-admin-x').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevents triggering a reply
                const msgId = btn.dataset.msgId;
                const msg = msgs.find(m => m.id === msgId);
                if (msg) deleteMessage(msg);
            });
        });
    }
}

function resolveName(m) {
    if (meta?.chatNames?.[m.uid]) {
        return meta.chatNames[m.uid].split(' ')[0];
    }
    return m.name || 'Anonym';
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function isToday(d) {
    const t = new Date();
    return d.getDate() === t.getDate() && d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear();
}

function isYesterday(d) {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return d.getDate() === y.getDate() && d.getMonth() === y.getMonth() && d.getFullYear() === y.getFullYear();
}

/* ── Match sidebar ─────────────────────────────────── */

function getActiveMatches() {
    const matchDocs = window._cachedMatchDocs || [];
    const results = window._cachedResults || {};
    const now = Date.now();

    const parsed = matchDocs.map(m => ({
        ...m,
        _parsed: parseMatchDate(m.date),
        _hasResult: !!(results[m.id] && results[m.id].homeScore !== undefined)
    }));

    // Ongoing: started (time <= now) but no result yet
    const ongoing = parsed.filter(m => m._parsed && m._parsed.getTime() <= now && !m._hasResult)
        .sort((a, b) => b._parsed - a._parsed);

    // Upcoming: not started yet
    const upcoming = parsed.filter(m => m._parsed && m._parsed.getTime() > now && !m._hasResult)
        .sort((a, b) => a._parsed - b._parsed);

    // Also check knockout bracket for active matches
    const bracketMatches = getActiveBracketMatches(now);

    const all = [...ongoing, ...bracketMatches.ongoing];
    const allUpcoming = [...upcoming, ...bracketMatches.upcoming];

    // Max 4 total: ongoing first, fill with upcoming
    const active = all.slice(0, 4);
    const remaining = 4 - active.length;
    if (remaining > 0) active.push(...allUpcoming.slice(0, remaining));

    return active;
}

function getActiveBracketMatches(now) {
    const bracket = window._cachedBracket;
    if (!bracket?.rounds) return { ongoing: [], upcoming: [] };

    const ongoing = [], upcoming = [];
    getKnockoutRounds().forEach(rd => {
        const twoLeg = isTwoLegged(rd.key);
        (bracket.rounds[rd.adminKey] || []).forEach((m, mi) => {
            if (!m.team1 || !m.team2) return;

            // Leg 1
            if (m.score1 === undefined) {
                const parsed = m.date ? parseMatchDate(m.date) : null;
                const entry = {
                    homeTeam: m.team1, awayTeam: m.team2, date: m.date,
                    stage: twoLeg ? `${rd.label} – Match 1` : rd.label,
                    _parsed: parsed, _hasResult: false,
                    _isKnockout: true, _koRoundKey: rd.key, _koMatchIdx: mi, _koLeg: 1
                };
                if (parsed && parsed.getTime() <= now) ongoing.push(entry);
                else upcoming.push(entry);
            }

            // Leg 2
            if (twoLeg && m.score1_leg2 === undefined) {
                const parsed = m.date_leg2 ? parseMatchDate(m.date_leg2) : null;
                const entry = {
                    homeTeam: m.team2, awayTeam: m.team1, date: m.date_leg2,
                    stage: `${rd.label} – Match 2 (retur)`,
                    _parsed: parsed, _hasResult: false,
                    _isKnockout: true, _koRoundKey: rd.key, _koMatchIdx: mi, _koLeg: 2
                };
                if (parsed && parsed.getTime() <= now) ongoing.push(entry);
                else upcoming.push(entry);
            }
        });
    });

    ongoing.sort((a, b) => (b._parsed || 0) - (a._parsed || 0));
    upcoming.sort((a, b) => (a._parsed || Infinity) - (b._parsed || Infinity));
    return { ongoing, upcoming };
}

function buildMatchSidebar() {
    const container = document.getElementById('chat-match-cards');
    const activeMatches = getActiveMatches();
    const users = window._cachedUsers || [];

    if (activeMatches.length === 0) {
        container.innerHTML = '';
        return;
    }

    let html = '';
    activeMatches.forEach((match, i) => {
        const isKnockout = match.stage && !match.stage.startsWith('Grupp');
        const dist = computeTipDistribution(match, users);
        const timeStr = match.date || '';
        const stageStr = match.stage || '';

        html += `<div class="chat-match-card" data-card-idx="${i}">
            <div class="chat-match-teams">
                <span>${f(match.homeTeam)}${match.homeTeam}</span>
                <span class="chat-match-vs">v</span>
                <span>${match.awayTeam}${f(match.awayTeam)}</span>
            </div>
            <div class="chat-match-popup">
                <div class="chat-match-stage">${stageStr}${timeStr ? ' · ' + timeStr : ''}</div>
                ${renderTipBar(dist, isKnockout)}
            </div>
        </div>`;
    });

    container.innerHTML = html;

    // Wire click-to-expand
    container.querySelectorAll('.chat-match-card').forEach(card => {
        card.addEventListener('click', (e) => {
            e.stopPropagation();
            const wasExpanded = card.classList.contains('expanded');
            // Close all
            container.querySelectorAll('.chat-match-card').forEach(c => c.classList.remove('expanded'));
            if (!wasExpanded) card.classList.add('expanded');
        });
    });

    // Close popup when clicking elsewhere
    document.addEventListener('click', () => {
        container.querySelectorAll('.chat-match-card').forEach(c => c.classList.remove('expanded'));
    }, { once: false });
}

function computeTipDistribution(match, users) {
    let home = 0, draw = 0, away = 0, total = 0;

    if (match._isKnockout) {
        const rk = match._koRoundKey, mi = match._koMatchIdx, leg = match._koLeg;
        users.forEach(u => {
            const tip = u.knockoutScores?.[rk]?.[mi];
            if (!tip) return;
            let h, a;
            if (leg === 1) { h = tip.score1; a = tip.score2; }
            else if (leg === 2) { h = tip.score1_leg2; a = tip.score2_leg2; }
            if (h == null || a == null) return;
            total++;
            if (h > a) home++; else if (h < a) away++; else draw++;
        });
    } else {
        const matchId = String(match.id);
        users.forEach(u => {
            const tip = u.matchTips?.[matchId];
            if (!tip || tip.homeScore === undefined || tip.awayScore === undefined) return;
            total++;
            if (tip.homeScore > tip.awayScore) home++;
            else if (tip.homeScore < tip.awayScore) away++;
            else draw++;
        });
    }

    if (total === 0) return { home: 0, draw: 0, away: 0 };
    return {
        home: Math.round((home / total) * 100),
        draw: Math.round((draw / total) * 100),
        away: Math.round((away / total) * 100)
    };
}

function renderTipBar(dist, isKnockout) {
    if (dist.home === 0 && dist.draw === 0 && dist.away === 0) {
        return '<div class="chat-tip-bar" style="opacity:0.3;"><div class="chat-tip-bar-seg" style="flex:1; background:#ccc;"></div></div>';
    }

    const segments = isKnockout
        ? `<div class="chat-tip-bar-seg chat-tip-bar-home" style="flex-basis:${dist.home + dist.draw / 2}%;"></div>
           <div class="chat-tip-bar-seg chat-tip-bar-away" style="flex-basis:${dist.away + dist.draw / 2}%;"></div>`
        : `<div class="chat-tip-bar-seg chat-tip-bar-home" style="flex-basis:${dist.home}%;"></div>
           <div class="chat-tip-bar-seg chat-tip-bar-draw" style="flex-basis:${dist.draw}%;"></div>
           <div class="chat-tip-bar-seg chat-tip-bar-away" style="flex-basis:${dist.away}%;"></div>`;

    const labels = isKnockout
        ? `<div class="chat-tip-bar-labels"><span>1 ${dist.home + Math.round(dist.draw / 2)}%</span><span>${dist.away + Math.round(dist.draw / 2)}% 2</span></div>`
        : `<div class="chat-tip-bar-labels"><span>1 ${dist.home}%</span><span>X ${dist.draw}%</span><span>${dist.away}% 2</span></div>`;

    return `<div class="chat-tip-bar">${segments}</div>${labels}`;
}

/* ── Tip badges for chat users ─────────────────────── */

function buildTipBadges(activeMatches, chatUids) {
    const users = window._cachedUsers || [];
    const tipMap = new Map(); // uid -> html string

    if (activeMatches.length === 0) return tipMap;

    // Build lookup: uid -> user data (only for chat participants)
    const userLookup = new Map();
    users.forEach(u => {
        if (chatUids.has(u.userId)) userLookup.set(u.userId, u);
    });

    chatUids.forEach(uid => {
        const u = userLookup.get(uid);
        if (!u) return;

        let badges = '';
        activeMatches.forEach(match => {
            let tipH, tipA;

            if (match._isKnockout) {
                const tip = u.knockoutScores?.[match._koRoundKey]?.[match._koMatchIdx];
                if (!tip) return;
                if (match._koLeg === 1) { tipH = tip.score1; tipA = tip.score2; }
                else if (match._koLeg === 2) { tipH = tip.score1_leg2; tipA = tip.score2_leg2; }
                if (tipH == null || tipA == null) return;
            } else {
                const tip = u.matchTips?.[String(match.id)];
                if (!tip || tip.homeScore === undefined) return;
                tipH = tip.homeScore;
                tipA = tip.awayScore;
            }

            const flagHome = teamImg(match.homeTeam, { size: 16, height: 12, style: 'margin:0 2px;' });
            const flagAway = teamImg(match.awayTeam, { size: 16, height: 12, style: 'margin:0 2px;' });

            badges += `<span class="chat-tip-badge">${flagHome}${tipH}-${tipA}${flagAway}</span>`;
        });

        if (badges) tipMap.set(uid, badges);
    });

    return tipMap;
}

// Ensures the chat input row is immediately visible at the bottom of the
// viewport on mobile, by pinning .chat-layout to the viewport (position:
// fixed via CSS). Measure where the chat-tab naturally sits below the
// navbar+tabs chrome and feed that into the CSS --chat-top-offset.
function fitChatLayoutToViewport() {
    if (window.innerWidth > 768) return;
    const tab = document.getElementById('chat-tab');
    if (!tab) return;
    // requestAnimationFrame + tiny timeout so navbar/tabs have finalized layout
    requestAnimationFrame(() => {
        // Scroll to top so measurements are consistent
        window.scrollTo(0, 0);
        // Measure position of chat-tab from viewport top (= distance from top
        // to where the tab starts, i.e. below navbar + tab-buttons row)
        const top = Math.max(tab.getBoundingClientRect().top, 8);
        document.documentElement.style.setProperty('--chat-top-offset', top + 'px');
    });
}

// Re-measure on resize / orientation change so the chat layout stays correct.
if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => {
        const tab = document.getElementById('chat-tab');
        if (tab?.classList.contains('active')) fitChatLayoutToViewport();
    });
}
