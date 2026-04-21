/**
 * Countdown timer to tipsrade-deadline (11 juni 2026 kl 20:00 svensk tid).
 * Placed in the navbar next to the logo. Hidden automatically when:
 *   - The deadline has passed, OR
 *   - Admin has locked the tipsrader (globalTipsLocked === true)
 */

// June 11 2026 20:00 CEST (UTC+2, Swedish summer time)
const DEADLINE = new Date("2026-06-11T20:00:00+02:00").getTime();

let intervalId = null;
let forceHidden = false;

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function renderTimer() {
    const el = document.getElementById('countdown-timer');
    if (!el) return;

    const remaining = DEADLINE - Date.now();
    if (remaining <= 0 || forceHidden) {
        el.style.display = 'none';
        if (intervalId) { clearInterval(intervalId); intervalId = null; }
        return;
    }

    const totalSec = Math.floor(remaining / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;

    const d = document.getElementById('cd-days');
    const h = document.getElementById('cd-hours');
    const m = document.getElementById('cd-minutes');
    const s = document.getElementById('cd-seconds');
    if (d) d.textContent = days;
    if (h) h.textContent = pad(hours);
    if (m) m.textContent = pad(minutes);
    if (s) s.textContent = pad(seconds);

    el.style.display = '';
}

export function startCountdown() {
    forceHidden = false;
    renderTimer();
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(renderTimer, 1000);
}

export function hideCountdown() {
    forceHidden = true;
    const el = document.getElementById('countdown-timer');
    if (el) el.style.display = 'none';
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
}

export function showCountdownIfFuture() {
    if (DEADLINE - Date.now() <= 0) return;
    startCountdown();
}
