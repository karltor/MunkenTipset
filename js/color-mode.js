// Light / dark mode toggle. Stored locally per-device. Dark mode overrides the
// theme CSS variables via inline styles on :root so it wins over both
// theme.css defaults and admin-theme.js overrides. When the user switches back
// to light, we clear the dark inline styles and re-apply admin overrides.

import { applyStoredTheme } from './admin-theme.js';

const COLOR_MODE_KEY = 'munkentipset_color_mode';

const DARK_MODE_VARS = {
    '--color-page-bg': '#121212',
    '--color-text': '#e6e6e6',
    '--color-navbar-bg': '#0a0a0a',
    '--color-navbar-text': '#f5f5f5',
    '--color-tab-active-bg': '#1e1e1e',
    '--color-tab-active-text': '#f5f5f5',
    '--color-card-bg': '#1e1e1e',
    '--color-card-border': '#333333',
    '--color-card-shadow': 'rgba(0, 0, 0, 0.45)',
    '--color-table-header-bg': '#0a0a0a',
    '--color-table-header-text': '#f5f5f5',
    '--color-highlight-row': 'rgba(40, 167, 69, 0.2)',
};

export function getColorMode() {
    const v = localStorage.getItem(COLOR_MODE_KEY);
    return v === 'dark' ? 'dark' : 'light';
}

export function applyColorMode(mode) {
    const root = document.documentElement;
    if (mode === 'dark') {
        Object.entries(DARK_MODE_VARS).forEach(([k, v]) => root.style.setProperty(k, v));
        root.setAttribute('data-color-mode', 'dark');
    } else {
        Object.keys(DARK_MODE_VARS).forEach(k => root.style.removeProperty(k));
        root.setAttribute('data-color-mode', 'light');
        // Admin overrides share the same keys, so re-apply them after clearing.
        applyStoredTheme();
    }
}

export function setColorMode(mode) {
    const normalized = mode === 'dark' ? 'dark' : 'light';
    localStorage.setItem(COLOR_MODE_KEY, normalized);
    applyColorMode(normalized);
}
