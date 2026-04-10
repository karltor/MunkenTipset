/**
 * Special Tips Module
 *
 * User-facing form for answering custom special questions
 * (e.g. "Sverigetipset"). Questions are configured by admin
 * in the tournament config (stage type: "special-questions").
 */

import { db, auth } from './config.js';
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { getSpecialQuestionsConfig } from './tournament-config.js';

let tipsLocked = false;

function showToast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}

export async function initSpecialTips(locked) {
    tipsLocked = locked;
    const container = document.getElementById('special-tips-content');
    if (!container) return;

    const config = getSpecialQuestionsConfig();
    if (!config || !config.questions?.length) {
        container.innerHTML = '<div style="text-align:center; padding:2rem;"><p style="color:#999;">Inga specialfrågor har lagts till ännu.</p></div>';
        return;
    }

    container.innerHTML = '<p style="text-align:center; color:#999;">Laddar...</p>';

    // Load existing picks
    const user = auth.currentUser;
    if (!user) return;

    const userSnap = await getDoc(doc(db, "users", user.uid));
    const userData = userSnap.exists() ? userSnap.data() : {};
    const existingPicks = userData.specialPicks || {};
    const alreadyDone = !!existingPicks.completedAt;

    renderSpecialForm(container, config, existingPicks, alreadyDone);
}

function renderSpecialForm(container, config, existingPicks, alreadyDone) {
    const questions = config.questions;
    const label = config.label || 'Specialtips';

    let html = '';

    if (alreadyDone && !tipsLocked) {
        html += `<div class="already-done-banner" style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; margin-bottom:16px;">`;
        html += `<span>Du har redan svarat på ${label}! Vill du ändra?</span>`;
        html += `<button class="btn" id="btn-edit-special" style="margin-left:10px;">Ändra svar</button>`;
        html += `</div>`;
    }

    html += `<div class="special-tips-form${alreadyDone ? ' special-readonly' : ''}">`;
    html += `<h2 style="text-align:center; margin-bottom:4px;">${label}</h2>`;
    html += `<p style="text-align:center; color:#888; font-size:13px; margin-bottom:20px;">Svara på frågorna nedan och spara dina tips!</p>`;

    questions.forEach((q, i) => {
        const pick = existingPicks[q.id];
        const isResolved = q.correctAnswer != null;
        let correct = false;
        if (isResolved && pick != null) {
            if (q.type === 'numeric') {
                correct = Number(pick) === Number(q.correctAnswer);
            } else {
                correct = String(pick) === String(q.correctAnswer);
            }
        }

        html += `<div class="sq-question-card" data-qid="${q.id}">`;
        html += `<div class="sq-question-header">`;
        html += `<span class="sq-question-number">${i + 1}</span>`;
        html += `<span class="sq-question-text">${q.text || 'Fråga utan text'}</span>`;
        html += `<span class="sq-question-pts">${q.points}p</span>`;
        html += `</div>`;

        if (q.type === 'yesno') {
            html += `<div class="sq-options-row">`;
            (q.options || ['Ja', 'Nej']).forEach(opt => {
                const selected = pick === opt ? 'selected' : '';
                const resultClass = isResolved && pick === opt ? (correct ? 'correct' : 'wrong') : '';
                html += `<button class="sq-option-btn ${selected} ${resultClass}" data-qid="${q.id}" data-value="${opt}">${opt}</button>`;
            });
            html += `</div>`;
        } else if (q.type === 'multi') {
            html += `<div class="sq-options-row sq-options-wrap">`;
            (q.options || []).forEach(opt => {
                const selected = pick === opt ? 'selected' : '';
                const resultClass = isResolved && pick === opt ? (correct ? 'correct' : 'wrong') : '';
                html += `<button class="sq-option-btn ${selected} ${resultClass}" data-qid="${q.id}" data-value="${opt}">${opt}</button>`;
            });
            html += `</div>`;
        } else if (q.type === 'numeric') {
            const resultClass = isResolved && pick != null ? (correct ? 'sq-input-correct' : 'sq-input-wrong') : '';
            html += `<div class="sq-numeric-row">`;
            html += `<input type="number" class="sq-numeric-input ${resultClass}" data-qid="${q.id}" value="${pick != null ? pick : ''}" placeholder="Ditt svar..." min="0">`;
            html += `</div>`;
        }

        // Show correct answer if resolved
        if (isResolved) {
            html += `<div class="sq-correct-answer">Rätt svar: <strong>${q.correctAnswer}</strong></div>`;
        }

        html += `</div>`;
    });

    html += `<div style="text-align:center; margin-top:20px;">`;
    html += `<button class="btn" id="btn-save-special" style="background:#e67e22; font-size:15px; padding:10px 32px;">Spara ${label}</button>`;
    html += `</div>`;
    html += `</div>`;

    container.innerHTML = html;

    // Edit mode toggle
    if (alreadyDone && !tipsLocked) {
        document.getElementById('btn-edit-special')?.addEventListener('click', () => {
            container.querySelector('.special-tips-form')?.classList.remove('special-readonly');
            document.querySelector('.already-done-banner')?.remove();
        });
    }

    // Option button clicks
    container.querySelectorAll('.sq-option-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (container.querySelector('.special-readonly')) return;
            if (tipsLocked) { showToast('Tipsraderna är låsta av admin.'); return; }
            // Deselect siblings
            const qid = btn.dataset.qid;
            container.querySelectorAll(`.sq-option-btn[data-qid="${qid}"]`).forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
    });

    // Save
    document.getElementById('btn-save-special')?.addEventListener('click', () => saveSpecialTips(container, questions));
}

async function saveSpecialTips(container, questions) {
    if (tipsLocked) { showToast('Tipsraderna är låsta av admin.'); return; }
    if (container.querySelector('.special-readonly')) { showToast('Klicka "Ändra svar" först.'); return; }

    const user = auth.currentUser;
    if (!user) return;

    const picks = {};
    let unanswered = 0;

    questions.forEach(q => {
        if (q.type === 'numeric') {
            const input = container.querySelector(`.sq-numeric-input[data-qid="${q.id}"]`);
            if (input && input.value !== '') {
                picks[q.id] = Number(input.value);
            } else {
                unanswered++;
            }
        } else {
            const selected = container.querySelector(`.sq-option-btn[data-qid="${q.id}"].selected`);
            if (selected) {
                picks[q.id] = selected.dataset.value;
            } else {
                unanswered++;
            }
        }
    });

    if (unanswered > 0) {
        if (!confirm(`Du har ${unanswered} obesvarad${unanswered > 1 ? 'e' : ''} frågor. Vill du spara ändå?`)) return;
    }

    picks.completedAt = new Date().toISOString();

    try {
        await updateDoc(doc(db, "users", user.uid), { specialPicks: picks });
        showToast('Dina specialtips har sparats!');
        // Refresh the form to show readonly state
        initSpecialTips(tipsLocked);
    } catch (err) {
        showToast('Fel vid sparning: ' + err.message);
    }
}
