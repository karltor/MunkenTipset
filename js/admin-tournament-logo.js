/**
 * Logo picker + auto-generated background color suggestions.
 *
 * Discovery: the picker reads the repo root via GitHub's public API and
 * surfaces every file whose name matches `*-logo.(webp|png|svg|jpg)`.
 * Admin can also type any filename manually if the API is unavailable
 * or they're testing a file that isn't in the default branch yet.
 */
const GH_REPO = 'karltor/MunkenTipset';
const LOGO_PATTERN = /-logo\.(webp|png|svg|jpe?g)$/i;
let _cachedLogos = null;

function prettyLabel(filename) {
    return filename
        .replace(LOGO_PATTERN, '')
        .replace(/[-_]+/g, ' ')
        .trim()
        .replace(/\b\w/g, c => c.toUpperCase()) || filename;
}

export async function discoverLogos() {
    if (_cachedLogos) return _cachedLogos;
    try {
        const res = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/`, {
            headers: { 'Accept': 'application/vnd.github+json' },
        });
        if (!res.ok) throw new Error('api');
        const files = await res.json();
        _cachedLogos = files
            .filter(f => f.type === 'file' && LOGO_PATTERN.test(f.name))
            .map(f => ({ file: f.name, label: prettyLabel(f.name) }));
    } catch {
        _cachedLogos = [];
    }
    return _cachedLogos;
}

// ── Color extraction ───────────────────────────────────────────────
// Samples non-transparent pixels and returns the dominant RGB plus a
// light/dark bucket count so suggestions can adapt to logos that are
// mostly light text on transparent bg (the Nya Munken case).
function analyzeLogo(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const w = canvas.width = Math.min(120, img.naturalWidth || 120);
                const h = canvas.height = Math.min(120, img.naturalHeight || 120);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                const data = ctx.getImageData(0, 0, w, h).data;
                let r = 0, g = 0, b = 0, count = 0;
                let lightCount = 0, darkCount = 0;
                for (let i = 0; i < data.length; i += 4) {
                    const a = data[i + 3];
                    if (a < 128) continue;
                    const pr = data[i], pg = data[i + 1], pb = data[i + 2];
                    r += pr; g += pg; b += pb; count++;
                    const lum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
                    if (lum > 180) lightCount++;
                    else if (lum < 80) darkCount++;
                }
                if (!count) return resolve(null);
                resolve({
                    r: Math.round(r / count),
                    g: Math.round(g / count),
                    b: Math.round(b / count),
                    lightRatio: lightCount / count,
                    darkRatio: darkCount / count,
                });
            } catch {
                resolve(null);
            }
        };
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

const toHex = (n) => n.toString(16).padStart(2, '0');
const rgbToHex = (r, g, b) => '#' + toHex(r) + toHex(g) + toHex(b);
const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h, s, l };
}

function hslToHex(h, s, l) {
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    return rgbToHex(clamp(r * 255), clamp(g * 255), clamp(b * 255));
}

// Pick the text color (white/dark) that contrasts best with a bg hex.
export function pickTextColor(bgHex) {
    const r = parseInt(bgHex.slice(1, 3), 16);
    const g = parseInt(bgHex.slice(3, 5), 16);
    const b = parseInt(bgHex.slice(5, 7), 16);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return lum > 150 ? '#1a1a1a' : '#ffffff';
}

/**
 * Given an analyzed logo, return 4 background suggestions that should
 * read well. If the logo skews light (gray/white text), we prefer deep
 * saturated darks; if it's dark, we prefer cream/light. We also mix in
 * a hue-shifted option tied to the logo's own palette.
 */
export async function generateBgSuggestions(src) {
    const analysis = await analyzeLogo(src);
    if (!analysis) {
        return [
            { label: 'Klassisk mörk', bg: '#1a1a1a' },
            { label: 'Marinblå', bg: '#1f2a44' },
            { label: 'Kräm', bg: '#f5efe1' },
            { label: 'Mossgrön', bg: '#2d4a3e' },
        ];
    }
    const { r, g, b, lightRatio } = analysis;
    const { h, s } = rgbToHsl(r, g, b);
    // Bias: if most visible pixels are light, bg should be dark (and vice versa).
    const preferDark = lightRatio >= 0.35;

    const suggestions = [];
    if (preferDark) {
        // Deep shades in a few vibes
        suggestions.push({ label: 'Djup indigo', bg: '#1f1f3a' });
        suggestions.push({ label: 'Skogsgrön', bg: '#1e3a2a' });
        suggestions.push({ label: 'Mörk vinröd', bg: '#3a1e28' });
        // Hue-shift based on the logo: shift hue ~0.5 for contrast, keep dark
        const shiftedHue = (h + 0.5) % 1;
        const sat = s > 0.15 ? 0.35 : 0.2;
        suggestions.push({ label: 'Anpassad kontrast', bg: hslToHex(shiftedHue, sat, 0.18) });
    } else {
        suggestions.push({ label: 'Kräm', bg: '#f5efe1' });
        suggestions.push({ label: 'Ljus salvia', bg: '#dfe7dd' });
        suggestions.push({ label: 'Ljust puder', bg: '#f2e5e0' });
        const shiftedHue = (h + 0.5) % 1;
        suggestions.push({ label: 'Anpassad kontrast', bg: hslToHex(shiftedHue, 0.2, 0.92) });
    }
    return suggestions;
}
