const THEME_STORAGE_KEY = 'munkentipset_theme';

// All themeable variables grouped by where they appear on the site
const THEME_GROUPS = [
    {
        label: 'Typsnitt',
        type: 'fonts',
        items: [
            { key: '--font-body', label: 'Brödtext', desc: 'All vanlig text på sidan' },
            { key: '--font-heading', label: 'Rubriker & logotyp', desc: 'Logotypen, grupptabellernas headers, VM-mästare' },
        ]
    },
    {
        label: 'Sidans bakgrund & text',
        items: [
            { key: '--color-page-bg', label: 'Bakgrundsfärg', desc: 'Bakgrunden bakom alla kort och paneler' },
            { key: '--color-text', label: 'Textfärg', desc: 'All vanlig brödtext' },
        ]
    },
    {
        label: 'Navbar (övre menyraden)',
        items: [
            { key: '--color-navbar-bg', label: 'Bakgrund', desc: 'Den mörka listen högst upp' },
            { key: '--color-navbar-text', label: 'Text', desc: 'Logotypen och användarnamn' },
        ]
    },
    {
        label: 'Knappar',
        items: [
            { key: '--color-btn-primary', label: 'Primärknapp (grön)', desc: '"Spara", "Nästa" etc.' },
            { key: '--color-btn-danger', label: 'Varningsknapp (röd)', desc: '"Logga ut", "Ta bort" etc.' },
            { key: '--color-btn-warning', label: 'Accentknapp (gul)', desc: '"Admin"-knappen, bracket-accenter' },
        ]
    },
    {
        label: 'Flikar & tabbar',
        items: [
            { key: '--color-tab-active-bg', label: 'Aktiv flik — bakgrund', desc: 'Den valda fliken (Start, Gruppspel etc.)' },
            { key: '--color-tab-active-text', label: 'Aktiv flik — text', desc: 'Textfärg i den valda fliken' },
        ]
    },
    {
        label: 'Kort & paneler',
        items: [
            { key: '--color-card-bg', label: 'Kortbakgrund', desc: 'Vita kort med statistik, leaderboard etc.' },
            { key: '--color-card-border', label: 'Kortkant', desc: 'Tunn ram runt matchkort' },
        ]
    },
    {
        label: 'Slutspel / Bracket',
        items: [
            { key: '--color-bracket-bg-from', label: 'Bakgrund (start)', desc: 'Översta/vänstra färgen i gradient' },
            { key: '--color-bracket-bg-to', label: 'Bakgrund (slut)', desc: 'Nedersta/högra färgen i gradient' },
            { key: '--color-bracket-text', label: 'Text', desc: 'Lagnamn i bracket-vyn' },
            { key: '--color-bracket-border', label: 'Kantlinjer', desc: 'Ramar runt lag och matchrutor' },
            { key: '--color-bracket-selected', label: 'Valt lag (bakgrund)', desc: 'Bakgrundsfärg när ett lag är valt' },
            { key: '--color-bracket-accent', label: 'Accentfärg', desc: 'Hoverfärg, finalram, VM-mästare-rubrik' },
        ]
    },
    {
        label: 'Välkomstpopup',
        items: [
            { key: '--color-welcome-bg-from', label: 'Bakgrund (start)', desc: 'Gradient startfärg' },
            { key: '--color-welcome-bg-to', label: 'Bakgrund (slut)', desc: 'Gradient slutfärg' },
            { key: '--color-welcome-heading', label: 'Rubrikfärg', desc: '"Välkommen till MunkenTipset"' },
        ]
    },
    {
        label: 'Resultatfärger',
        items: [
            { key: '--color-correct', label: 'Rätt (grön)', desc: 'Rätt tips, rätt gruppetta etc.' },
            { key: '--color-wrong', label: 'Fel (röd)', desc: 'Fel tips, utslagen i gruppspel' },
            { key: '--color-partial', label: 'Delvis rätt (blå)', desc: 'Rätt vinnare men fel siffror' },
        ]
    },
    {
        label: 'Progressbar & statistik',
        items: [
            { key: '--color-progress-from', label: 'Gradient start', desc: 'Progressbar och stapeldiagram' },
            { key: '--color-progress-to', label: 'Gradient slut', desc: 'Andra änden av staplarna' },
        ]
    },
    {
        label: 'Grupptabell-header',
        items: [
            { key: '--color-table-header-bg', label: 'Bakgrund', desc: 'Mörka rubriken "Grupp A" etc.' },
            { key: '--color-table-header-text', label: 'Text', desc: 'Vit text i tabellhuvudet' },
        ]
    },
];

const FONT_OPTIONS = [
    { value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", label: 'System (standard)' },
    { value: "'Playfair Display', serif", label: 'Playfair Display' },
    { value: "'Georgia', serif", label: 'Georgia' },
    { value: "'Trebuchet MS', sans-serif", label: 'Trebuchet MS' },
    { value: "'Verdana', sans-serif", label: 'Verdana' },
    { value: "'Courier New', monospace", label: 'Courier New' },
    { value: "'Arial', sans-serif", label: 'Arial' },
    { value: "'Comic Sans MS', cursive", label: 'Comic Sans MS' },
];

// Read the current computed value for a CSS variable
function getDefaultValue(key) {
    return getComputedStyle(document.documentElement).getPropertyValue(key).trim();
}

// Load saved overrides from localStorage
function loadOverrides() {
    try {
        const raw = localStorage.getItem(THEME_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

// Save overrides to localStorage and apply
function saveOverrides(overrides) {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(overrides));
    } catch { /* quota */ }
}

// Apply overrides to :root
function applyOverrides(overrides) {
    const root = document.documentElement;
    Object.entries(overrides).forEach(([key, value]) => {
        root.style.setProperty(key, value);
    });
}

// Remove all overrides from :root
function clearOverrides() {
    const root = document.documentElement;
    THEME_GROUPS.forEach(group => {
        group.items.forEach(item => {
            root.style.removeProperty(item.key);
        });
    });
}

// Apply saved theme immediately on page load (called from app.js)
export function applyStoredTheme() {
    const overrides = loadOverrides();
    if (Object.keys(overrides).length > 0) {
        applyOverrides(overrides);
    }
}

// Render the theme editor UI
export function initThemeEditor() {
    const container = document.getElementById('admin-theme-editor');
    const overrides = loadOverrides();

    let html = '';
    THEME_GROUPS.forEach(group => {
        html += `<div class="admin-section" style="margin-bottom:12px;">`;
        html += `<h4 style="margin:0 0 10px; font-size:14px;">${group.label}</h4>`;

        group.items.forEach(item => {
            const currentValue = overrides[item.key] || '';
            const isFont = group.type === 'fonts';

            html += `<div class="theme-row">`;
            html += `<div class="theme-row-info">`;
            html += `<span class="theme-row-label">${item.label}</span>`;
            html += `<span class="theme-row-desc">${item.desc}</span>`;
            html += `</div>`;

            if (isFont) {
                html += `<select class="theme-input theme-font-select" data-key="${item.key}">`;
                FONT_OPTIONS.forEach(opt => {
                    const selected = currentValue === opt.value ? 'selected' : '';
                    html += `<option value="${opt.value}" ${selected}>${opt.label}</option>`;
                });
                html += `</select>`;
            } else {
                html += `<div class="theme-color-wrapper">`;
                html += `<input type="color" class="theme-input theme-color-input" data-key="${item.key}" value="${currentValue || getDefaultValue(item.key) || '#000000'}">`;
                if (currentValue) {
                    html += `<button class="theme-reset-single" data-key="${item.key}" title="Återställ">×</button>`;
                }
                html += `</div>`;
            }

            html += `</div>`;
        });

        html += `</div>`;
    });

    container.innerHTML = html;

    // Wire color inputs
    container.querySelectorAll('.theme-color-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const key = e.target.dataset.key;
            const val = e.target.value;
            const ov = loadOverrides();
            ov[key] = val;
            saveOverrides(ov);
            applyOverrides(ov);
            // Show reset button
            let resetBtn = e.target.parentElement.querySelector('.theme-reset-single');
            if (!resetBtn) {
                resetBtn = document.createElement('button');
                resetBtn.className = 'theme-reset-single';
                resetBtn.dataset.key = key;
                resetBtn.title = 'Återställ';
                resetBtn.textContent = '×';
                resetBtn.addEventListener('click', () => resetSingle(key));
                e.target.parentElement.appendChild(resetBtn);
            }
        });
    });

    // Wire font selects
    container.querySelectorAll('.theme-font-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const key = e.target.dataset.key;
            const val = e.target.value;
            const ov = loadOverrides();
            ov[key] = val;
            saveOverrides(ov);
            applyOverrides(ov);
        });
    });

    // Wire single reset buttons
    container.querySelectorAll('.theme-reset-single').forEach(btn => {
        btn.addEventListener('click', () => resetSingle(btn.dataset.key));
    });

    // Wire reset all
    document.getElementById('theme-reset').addEventListener('click', () => {
        clearOverrides();
        localStorage.removeItem(THEME_STORAGE_KEY);
        initThemeEditor(); // re-render
    });

    // Wire export
    document.getElementById('theme-export').addEventListener('click', exportTheme);
    document.getElementById('theme-copy-export').addEventListener('click', copyExport);
}

function resetSingle(key) {
    const ov = loadOverrides();
    delete ov[key];
    saveOverrides(ov);
    document.documentElement.style.removeProperty(key);
    initThemeEditor(); // re-render to update UI
}

function exportTheme() {
    const overrides = loadOverrides();
    if (Object.keys(overrides).length === 0) {
        alert('Inga ändringar att exportera — allt är standard.');
        return;
    }

    // Build a readable CSS block for easy application
    let css = '/* MunkenTipset tema — genererat ' + new Date().toLocaleDateString('sv-SE') + ' */\n';
    css += ':root {\n';
    Object.entries(overrides).forEach(([key, value]) => {
        // Find the label for this key
        let label = key;
        THEME_GROUPS.forEach(g => g.items.forEach(i => { if (i.key === key) label = `${g.label} > ${i.label}`; }));
        css += `    ${key}: ${value}; /* ${label} */\n`;
    });
    css += '}\n';

    document.getElementById('theme-export-text').value = css;
    document.getElementById('theme-export-output').style.display = 'block';
}

async function copyExport() {
    const text = document.getElementById('theme-export-text').value;
    const btn = document.getElementById('theme-copy-export');
    try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Kopierat!';
    } catch {
        btn.textContent = 'Kunde inte kopiera';
    }
    setTimeout(() => { btn.textContent = 'Kopiera'; }, 2000);
}
